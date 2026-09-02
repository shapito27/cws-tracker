/**
 * Translation manipulation detection (Phase 3.6.2).
 *
 * Pure heuristics that compare an extension's localized CWS listings against
 * its English (baseline) listing and against each other, looking for the
 * tricks developers use to game store search through translations:
 *
 *  1. differentName        - localized title is not the same product name
 *  2. differentShortDesc   - short description replaced rather than translated
 *  3. competitorNames      - competitor brand names planted in the text
 *  4. extendedDescription  - one locale's description is far longer than the rest
 *  5. keywordsAtEnd        - a keyword list appended after the real description
 *  6. keywordsInline       - comma-separated keyword blocks inside the prose
 *  7. differentDescription - full description unrelated to the English one
 *  8. untranslatedEnglish  - English copy left in a non-English locale
 *
 * Everything here is a heuristic over text, not a semantic judgement. Each
 * detector is conservative on purpose: a legitimate translation of tech copy
 * routinely shares almost no characters with its English source, so raw
 * edit-distance thresholds would flag every honest localization. Where the
 * PRD prescribed a Levenshtein cutoff that cannot distinguish "translated" from
 * "replaced", the detector falls back to signals that can - emptiness, keyword
 * list shapes, same-language divergence, length blow-ups and shared-term
 * overlap - and the reasoning is documented on each function.
 *
 * No Vue, DOM, chrome.* or IndexedDB imports: shared by the service worker
 * (flags are computed when a translation_audit job lands) and the dashboard.
 */

import type { ManipulationFlags } from '../types';
import { levenshteinDistance, levenshteinSimilarity } from './text-analysis';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The eight manipulation tricks, keyed as they appear on ManipulationFlags. */
export type TrickKey = keyof ManipulationFlags;

/** Severity as specified in PRD 5.3.6. */
export type TrickSeverity = 'high' | 'medium' | 'low';

/** Text of one localized listing, as fed into the cross-locale analysis. */
export interface LocaleListingText {
  locale: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
}

/** Input for {@link analyzeLocaleSet}. */
export interface LocaleSetInput {
  /**
   * The reference listing the locales are compared against - the `en` locale
   * snapshot when one was captured, otherwise the default-locale listing
   * snapshot. `null` when no baseline exists: cross-locale comparisons are then
   * skipped and only the standalone detectors (3, 4, 5, 6) run.
   */
  baseline: Omit<LocaleListingText, 'locale'> | null;
  /** Every localized listing captured for the extension on the audit date. */
  locales: LocaleListingText[];
  /**
   * Names of the *other* tracked extensions in the same project(s). The
   * caller must exclude the audited extension's own name.
   */
  competitorNames: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ALL_TRICKS: readonly TrickKey[] = [
  'differentName',
  'differentShortDesc',
  'competitorNames',
  'extendedDescription',
  'keywordsAtEnd',
  'keywordsInline',
  'differentDescription',
  'untranslatedEnglish',
];

/** Severity per trick (PRD 5.3.6). "MEDIUM-HIGH" and "LOW-MEDIUM" round to the higher label. */
export const TRICK_SEVERITY: Readonly<Record<TrickKey, TrickSeverity>> = {
  differentName: 'high',
  competitorNames: 'high',
  keywordsAtEnd: 'high',
  differentDescription: 'high',
  extendedDescription: 'high',
  differentShortDesc: 'medium',
  keywordsInline: 'medium',
  untranslatedEnglish: 'medium',
};

/** Human-readable labels for the report UI. */
export const TRICK_LABELS: Readonly<Record<TrickKey, string>> = {
  differentName: 'Different extension name',
  differentShortDesc: 'Different short description',
  competitorNames: 'Competitor names in text',
  extendedDescription: 'Considerably longer description',
  keywordsAtEnd: 'Keyword list at end of description',
  keywordsInline: 'Keyword stuffing inside description',
  differentDescription: 'Unrelated description',
  untranslatedEnglish: 'Untranslated English',
};

/**
 * Score contribution per detected trick. Weighted by severity so one HIGH
 * trick alone reads as a serious signal; the sum is capped at 100.
 */
const TRICK_WEIGHTS: Readonly<Record<TrickKey, number>> = {
  differentName: 20,
  competitorNames: 20,
  keywordsAtEnd: 20,
  differentDescription: 15,
  extendedDescription: 12,
  differentShortDesc: 8,
  keywordsInline: 8,
  untranslatedEnglish: 5,
};

/** Levenshtein / brand-retention similarity below which a Latin-script title is "different". */
const NAME_SIMILARITY_THRESHOLD = 0.5;
/** Composite similarity below which a short description in the *same language* is "different". */
const SHORT_DESC_SIMILARITY_THRESHOLD = 0.6;
/** Localized short description this many times longer than English is treated as padded. */
const SHORT_DESC_LENGTH_RATIO_THRESHOLD = 2.5;
/** Description length must exceed this multiple of the cross-locale median (strict). */
const EXTENDED_DESCRIPTION_RATIO = 2;
/** Keyword-at-end block: at least this many short trailing lines... */
const KEYWORDS_AT_END_MIN_LINES = 5;
/** ...each no longer than this. */
const KEYWORDS_AT_END_MAX_LINE_LENGTH = 50;
/** ...preceded by at least this many consecutive newlines. */
const KEYWORDS_AT_END_MIN_NEWLINES = 3;
/** Inline keyword run: at least this many comma-separated segments... */
const KEYWORDS_INLINE_MIN_SEGMENTS = 5;
/** ...unless the segments average fewer than two words, in which case this many. */
const KEYWORDS_INLINE_MIN_SINGLE_WORD_SEGMENTS = 7;
/** Longest segment (in words) that still counts as a keyword rather than a clause. */
const KEYWORDS_INLINE_MAX_SEGMENT_WORDS = 4;
/** Near-duplicate sentences (template keyword injection): this many with similarity >= 0.8. */
const TEMPLATE_SENTENCE_MIN_COUNT = 3;
const TEMPLATE_SENTENCE_SIMILARITY = 0.8;
const TEMPLATE_SENTENCE_MIN_LENGTH = 30;
/** Term-overlap coefficient below which the full description is "unrelated". */
const DESCRIPTION_OVERLAP_THRESHOLD = 0.1;
/** Both texts need at least this many extractable terms for overlap to mean anything. */
const DESCRIPTION_MIN_TERMS = 5;
/** Proportion of English content above which a non-English locale is "untranslated". */
const UNTRANSLATED_ENGLISH_THRESHOLD = 0.7;
/** Minimum evidence before the English-ratio detector will fire. */
const UNTRANSLATED_MIN_LETTERS = 20;
const UNTRANSLATED_MIN_MARKER_HITS = 3;
/**
 * Share of tokens that are English function words in ordinary English prose.
 * Used to normalize the marker share into a 0-1 "how English is this" ratio
 * for Latin-script locales we have no marker list for.
 */
const EXPECTED_ENGLISH_MARKER_SHARE = 0.3;
/** Excerpts stored on flags are capped to this many characters (PRD 4.1.7.1). */
const EXCERPT_LENGTH = 200;

/** Languages written in Latin script (base language code, lowercase). */
const LATIN_SCRIPT_LANGUAGES = new Set([
  'en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'tr', 'sv', 'da', 'no', 'nb',
  'fi', 'cs', 'sk', 'hu', 'ro', 'hr', 'sl', 'lt', 'lv', 'et', 'id', 'ms', 'vi',
  'fil', 'tl', 'ca', 'eu', 'gl', 'af', 'sw',
]);

/** Languages written in a non-Latin script (base language code, lowercase). */
const NON_LATIN_SCRIPT_LANGUAGES = new Set([
  'ja', 'zh', 'ko', 'ru', 'uk', 'bg', 'sr', 'mk', 'be', 'kk', 'ar', 'fa', 'ur',
  'he', 'hi', 'bn', 'mr', 'gu', 'ta', 'te', 'kn', 'ml', 'pa', 'th', 'el', 'ka',
  'hy', 'am', 'my', 'km', 'lo', 'si', 'ne',
]);

/**
 * Function words per language. Used two ways: to estimate how "English" a
 * Latin-script text is relative to its expected language (trick 8), and to
 * guess the language of Latin-script text ({@link detectLanguage}).
 *
 * Words shared between English and the target language are removed pairwise
 * at comparison time, so ambiguous tokens ("a", "no", "de") never count.
 */
const FUNCTION_WORDS: Readonly<Record<string, readonly string[]>> = {
  en: [
    'the', 'and', 'is', 'are', 'for', 'to', 'with', 'of', 'in', 'on', 'your',
    'you', 'this', 'that', 'it', 'from', 'by', 'can', 'or', 'all', 'be', 'as',
    'at', 'an', 'will', 'not', 'any', 'more', 'when', 'which', 'into', 'use',
    'using', 'a', 'our', 'we', 'have', 'has', 'if', 'also', 'get', 'its',
  ],
  es: [
    'el', 'la', 'los', 'las', 'de', 'del', 'que', 'y', 'en', 'un', 'una', 'es',
    'para', 'con', 'por', 'se', 'su', 'sus', 'no', 'al', 'lo', 'como', 'más',
    'pero', 'o', 'este', 'esta', 'sin', 'sobre', 'también', 'puede', 'todo',
    'todos', 'tu', 'tus', 'a',
  ],
  fr: [
    'le', 'la', 'les', 'des', 'de', 'du', 'et', 'en', 'un', 'une', 'est', 'pour',
    'avec', 'par', 'sur', 'que', 'qui', 'ne', 'pas', 'vous', 'votre', 'vos',
    'ce', 'cette', 'ces', 'dans', 'plus', 'ou', 'sont', 'aussi', 'tout', 'tous',
    'à', 'au', 'aux',
  ],
  de: [
    'der', 'die', 'das', 'und', 'ist', 'sind', 'für', 'mit', 'von', 'zu', 'auf',
    'den', 'dem', 'des', 'ein', 'eine', 'einen', 'nicht', 'sie', 'ihre', 'ihr',
    'auch', 'oder', 'wird', 'werden', 'im', 'am', 'aus', 'bei', 'wie', 'kann',
    'können', 'alle', 'einer', 'einem',
  ],
  pt: [
    'o', 'a', 'os', 'as', 'de', 'do', 'da', 'dos', 'das', 'e', 'em', 'um', 'uma',
    'é', 'para', 'com', 'por', 'se', 'seu', 'sua', 'não', 'ao', 'no', 'na',
    'como', 'mais', 'mas', 'ou', 'este', 'esta', 'sem', 'também', 'pode',
    'todos', 'você', 'são',
  ],
  it: [
    'il', 'lo', 'la', 'i', 'gli', 'le', 'di', 'del', 'della', 'dei', 'delle',
    'e', 'ed', 'in', 'un', 'una', 'è', 'per', 'con', 'da', 'su', 'che', 'non',
    'si', 'al', 'alla', 'come', 'più', 'ma', 'o', 'questo', 'questa', 'anche',
    'tutti', 'sono',
  ],
  nl: [
    'de', 'het', 'een', 'en', 'van', 'is', 'zijn', 'voor', 'met', 'op', 'te',
    'dat', 'die', 'niet', 'je', 'uw', 'ook', 'of', 'naar', 'bij', 'om', 'aan',
    'kan', 'kunnen', 'alle', 'dit', 'deze', 'wordt', 'worden', 'u',
  ],
  pl: [
    'i', 'w', 'na', 'z', 'do', 'nie', 'się', 'jest', 'są', 'to', 'że', 'dla',
    'o', 'jak', 'oraz', 'lub', 'przez', 'po', 'od', 'tym', 'tego', 'można',
    'wszystkie', 'twoje', 'aby', 'ze',
  ],
  tr: [
    've', 'bir', 'bu', 'için', 'ile', 'de', 'da', 'olarak', 'veya', 'daha',
    'en', 'gibi', 'her', 'tüm', 'olan', 'var', 'değil', 'çok', 'sizin', 'kadar',
    'sonra', 'ancak', 'ya', 'ki',
  ],
};

/** English stop words dropped when extracting brand tokens and content terms. */
const ENGLISH_STOP_WORDS = new Set([
  ...FUNCTION_WORDS.en,
  'but', 'so', 'than', 'then', 'they', 'their', 'them', 'these', 'those',
  'was', 'were', 'been', 'being', 'do', 'does', 'did', 'just', 'very', 'only',
  'about', 'over', 'out', 'up', 'down', 'no', 'yes', 'my', 'me', 'i',
]);

// ---------------------------------------------------------------------------
// Locale & script helpers
// ---------------------------------------------------------------------------

/** Base language of a CWS locale code: `pt_BR` -> `pt`, `zh-CN` -> `zh`, `EN` -> `en`. */
export function baseLanguage(locale: string): string {
  return locale.trim().toLowerCase().split(/[_-]/)[0] ?? '';
}

/**
 * Whether a locale's language is written in Latin script.
 *
 * Unknown languages default to Latin: most of the world's store locales are,
 * and the Latin-script detectors are the more conservative set.
 */
export function isLatinScriptLocale(locale: string): boolean {
  const lang = baseLanguage(locale);
  if (NON_LATIN_SCRIPT_LANGUAGES.has(lang)) return false;
  return LATIN_SCRIPT_LANGUAGES.has(lang) || true;
}

/** Writing systems {@link dominantScript} can tell apart. */
export type Script =
  | 'latin' | 'cyrillic' | 'arabic' | 'hebrew' | 'greek' | 'devanagari'
  | 'thai' | 'hangul' | 'kana' | 'han' | 'none';

const SCRIPT_RANGES: ReadonlyArray<[Exclude<Script, 'none'>, RegExp]> = [
  ['latin', /[A-Za-zÀ-ɏ]/],
  ['cyrillic', /[Ѐ-ӿ]/],
  ['arabic', /[؀-ۿݐ-ݿ]/],
  ['hebrew', /[֐-׿]/],
  ['greek', /[Ͱ-Ͽ]/],
  ['devanagari', /[ऀ-ॿ]/],
  ['thai', /[฀-๿]/],
  ['hangul', /[가-힯ᄀ-ᇿ]/],
  ['kana', /[぀-ヿ]/],
  ['han', /[一-鿿㐀-䶿]/],
];

/** Count letters per script. Digits, punctuation and whitespace are ignored. */
export function countScripts(text: string): Record<Script, number> {
  const counts: Record<Script, number> = {
    latin: 0, cyrillic: 0, arabic: 0, hebrew: 0, greek: 0, devanagari: 0,
    thai: 0, hangul: 0, kana: 0, han: 0, none: 0,
  };
  for (const ch of text) {
    let matched = false;
    for (const [script, re] of SCRIPT_RANGES) {
      if (re.test(ch)) {
        counts[script] += 1;
        matched = true;
        break;
      }
    }
    if (!matched && /\p{L}/u.test(ch)) counts.none += 1;
  }
  return counts;
}

/** The script with the most letters, or `'none'` for text with no letters. */
export function dominantScript(text: string): Script {
  const counts = countScripts(text);
  let best: Script = 'none';
  let bestCount = 0;
  for (const [script, count] of Object.entries(counts) as Array<[Script, number]>) {
    if (script === 'none') continue;
    if (count > bestCount) {
      best = script;
      bestCount = count;
    }
  }
  return best;
}

/** Latin letters as a share of all letters. 0 for text with no letters. */
function latinLetterRatio(text: string): number {
  const counts = countScripts(text);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return counts.latin / total;
}

/** Lowercase word tokens (letters, digits, apostrophes), any script. */
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
}

/** Latin-script terms of 3+ chars, lowercased, English stop words removed. */
export function extractTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const token of text.toLowerCase().match(/[a-z0-9À-ɏ]+/g) ?? []) {
    if (token.length < 3) continue;
    if (ENGLISH_STOP_WORDS.has(token)) continue;
    terms.add(token);
  }
  return terms;
}

/** Count how many tokens of `tokens` appear in `words`. */
function countHits(tokens: string[], words: ReadonlySet<string>): number {
  let hits = 0;
  for (const t of tokens) if (words.has(t)) hits += 1;
  return hits;
}

/**
 * Marker sets for an English-vs-target comparison, with the words the two
 * languages share removed from both sides so they cannot vote either way.
 */
function disjointMarkers(targetLang: string): { en: Set<string>; target: Set<string> } | null {
  const targetWords = FUNCTION_WORDS[targetLang];
  if (!targetWords || targetLang === 'en') return null;
  const en = new Set(FUNCTION_WORDS.en);
  const target = new Set(targetWords);
  for (const w of [...en]) {
    if (target.has(w)) {
      en.delete(w);
      target.delete(w);
    }
  }
  return { en, target };
}

/**
 * Best-effort language guess for a piece of text, as a base language code.
 *
 * Non-Latin scripts map straight to their dominant language (kana -> ja,
 * hangul -> ko, ...). Latin text is attributed to whichever function-word
 * list scores most hits, when that list holds a clear majority. Returns `null`
 * when there is not enough evidence.
 */
export function detectLanguage(text: string): string | null {
  if (text.trim().length === 0) return null;
  const counts = countScripts(text);

  // Non-Latin scripts are unambiguous enough on their own.
  if (counts.kana > 0 && counts.kana + counts.han >= counts.latin) return 'ja';
  const script = dominantScript(text);
  switch (script) {
    case 'han': return 'zh';
    case 'hangul': return 'ko';
    case 'cyrillic': return 'ru';
    case 'arabic': return 'ar';
    case 'hebrew': return 'he';
    case 'greek': return 'el';
    case 'devanagari': return 'hi';
    case 'thai': return 'th';
    case 'none': return null;
    case 'latin': break;
    default: return null;
  }

  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  let bestLang: string | null = null;
  let bestHits = 0;
  let runnerUp = 0;
  for (const [lang, words] of Object.entries(FUNCTION_WORDS)) {
    const hits = countHits(tokens, new Set(words));
    if (hits > bestHits) {
      runnerUp = bestHits;
      bestHits = hits;
      bestLang = lang;
    } else if (hits > runnerUp) {
      runnerUp = hits;
    }
  }
  // Romance languages share many function words ("un", "de", "la"), so the
  // winner is required to beat the runner-up clearly rather than hold an
  // absolute majority of all hits.
  if (bestLang === null || bestHits < UNTRANSLATED_MIN_MARKER_HITS) return null;
  if (bestHits < runnerUp * 1.5) return null;
  return bestLang;
}

/**
 * Proportion of `text` that reads as English (0-1), judged against
 * `expectedLocale`.
 *
 * - Non-Latin expected script: the share of letters that are Latin. Japanese
 *   copy with a few English brand names scores low; English copy scores ~1.
 * - Latin expected script with a known function-word list: English marker
 *   hits over English + target marker hits, shared words excluded.
 * - Other Latin locales: English marker share, normalized against the share
 *   ordinary English prose carries, capped at 1.
 *
 * Returns 0 when there is too little text to judge.
 */
export function englishRatio(text: string, expectedLocale: string): number {
  const lang = baseLanguage(expectedLocale);
  if (!isLatinScriptLocale(expectedLocale)) {
    const counts = countScripts(text);
    const letters = Object.values(counts).reduce((a, b) => a + b, 0);
    if (letters < UNTRANSLATED_MIN_LETTERS) return 0;
    return latinLetterRatio(text);
  }

  const tokens = tokenize(text);
  const markers = disjointMarkers(lang);
  if (markers) {
    const enHits = countHits(tokens, markers.en);
    const targetHits = countHits(tokens, markers.target);
    if (enHits + targetHits < UNTRANSLATED_MIN_MARKER_HITS) return 0;
    return enHits / (enHits + targetHits);
  }

  if (tokens.length < UNTRANSLATED_MIN_LETTERS / 4) return 0;
  const enHits = countHits(tokens, new Set(FUNCTION_WORDS.en));
  if (enHits < UNTRANSLATED_MIN_MARKER_HITS) return 0;
  return Math.min(1, enHits / tokens.length / EXPECTED_ENGLISH_MARKER_SHARE);
}

// ---------------------------------------------------------------------------
// Shared text-shape helpers
// ---------------------------------------------------------------------------

/** Collapse whitespace and lowercase, for edit-distance comparisons. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-phrase, case-insensitive containment that works across scripts.
 * `\b` only understands ASCII word characters, so boundaries are checked as
 * "not preceded/followed by a letter or digit" instead.
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const p = phrase.trim();
  if (p.length === 0 || text.length === 0) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(p)}(?![\\p{L}\\p{N}])`, 'iu');
  return re.test(text);
}

/**
 * Significant tokens of an English title: the words a translation would be
 * expected to keep (brand words), i.e. Latin-script tokens of 2+ chars that
 * are not English stop words.
 */
export function brandTokens(title: string): string[] {
  const out: string[] = [];
  for (const token of title.toLowerCase().match(/[a-z0-9À-ɏ]+/g) ?? []) {
    if (token.length < 2) continue;
    if (ENGLISH_STOP_WORDS.has(token)) continue;
    out.push(token);
  }
  return out;
}

/** Share of `tokens` that appear (case-insensitive, whole word) in `text`. 1 when there are none to check. */
function retentionRatio(tokens: string[], text: string): number {
  if (tokens.length === 0) return 1;
  const lower = text.toLowerCase();
  let kept = 0;
  for (const t of tokens) if (containsPhrase(lower, t)) kept += 1;
  return kept / tokens.length;
}

/** Two Latin terms are cognates if equal, or long and within 2 edits / sharing a 5-char prefix. */
function areCognates(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5) return false;
  if (a.slice(0, 5) === b.slice(0, 5)) return true;
  if (Math.abs(a.length - b.length) > 2) return false;
  return levenshteinDistance(a, b) <= 2;
}

/**
 * Overlap coefficient of two term sets, cognate-aware: |A ∩ B| / min(|A|, |B|).
 *
 * The overlap coefficient rather than Jaccard, because a Japanese description
 * legitimately carries only a handful of Latin terms (brand names, "CPU",
 * filter-list names) while its English source carries a hundred; Jaccard would
 * read every honest translation as unrelated. Returns `null` when either set
 * is empty.
 */
export function termOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number | null {
  if (a.size === 0 || b.size === 0) return null;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const largeArr = [...large];
  let shared = 0;
  for (const term of small) {
    if (large.has(term) || largeArr.some((other) => areCognates(term, other))) shared += 1;
  }
  return shared / small.size;
}

/** Composite similarity for a pair of short texts: the best of edit distance, term overlap and brand retention. */
function compositeSimilarity(english: string, localized: string): number {
  const lev = levenshteinSimilarity(normalize(english), normalize(localized));
  const overlap = termOverlap(extractTerms(english), extractTerms(localized)) ?? 0;
  return Math.max(lev, overlap);
}

/**
 * Whether a text is shaped like a bare keyword list: several comma-separated
 * segments, each a word or short phrase, with no sentence punctuation.
 */
export function looksLikeKeywordList(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return false;
  if (/[.!?;:]/.test(t.replace(/[.!?]$/, ''))) return false;
  const segments = t.split(/[,、，]/).map((s) => s.trim()).filter((s) => s.length > 0);
  if (segments.length < 4) return false;
  return segments.every((s) => tokenize(s).length <= KEYWORDS_INLINE_MAX_SEGMENT_WORDS);
}

function excerpt(text: string): string {
  const t = text.trim();
  return t.length > EXCERPT_LENGTH ? `${t.slice(0, EXCERPT_LENGTH)}…` : t;
}

// ---------------------------------------------------------------------------
// Trick 1: Different extension name
// ---------------------------------------------------------------------------

/**
 * Is the localized title still the same product?
 *
 * - Empty localized title: flagged.
 * - Title contains a competitor's name: flagged.
 * - Latin-script locale: similarity is the better of normalized Levenshtein
 *   similarity and brand-token retention (so "AdBlock Plus - Bloqueador de
 *   anuncios" keeps its brand and passes even though the string is longer).
 *   Flagged below 0.5.
 * - Non-Latin locale: edit distance is meaningless across scripts, so only
 *   brand retention counts. Flagged when *none* of the English brand tokens
 *   survive ("広告ブロッカー" for "AdBlock Plus"); a title that keeps the brand
 *   ("AdBlock Plus - 広告ブロッカー") passes.
 */
export function detectDifferentName(
  englishTitle: string,
  localizedTitle: string,
  locale: string,
  competitorNames: string[]
): ManipulationFlags['differentName'] {
  const localized = localizedTitle.trim();
  if (localized.length === 0) {
    return { detected: true, similarity: 0, details: 'Localized title is empty' };
  }

  const tokens = brandTokens(englishTitle);
  const retention = retentionRatio(tokens, localized);
  const lev = levenshteinSimilarity(normalize(englishTitle), normalize(localized));

  const competitor = competitorNames.find((name) => containsPhrase(localized, name));
  if (competitor) {
    return {
      detected: true,
      similarity: Math.max(lev, retention),
      details: `Title contains competitor name "${competitor}"`,
    };
  }

  if (isLatinScriptLocale(locale)) {
    const similarity = Math.max(lev, retention);
    return similarity < NAME_SIMILARITY_THRESHOLD
      ? {
          detected: true,
          similarity,
          details: `Title "${localized}" shares little with "${englishTitle}" (similarity ${similarity.toFixed(2)})`,
        }
      : { detected: false, similarity };
  }

  // Non-Latin: brand retention only. No brand tokens to check means we cannot
  // tell, and the conservative answer is "not flagged".
  if (tokens.length === 0) return { detected: false, similarity: 1 };
  return retention === 0
    ? {
        detected: true,
        similarity: 0,
        details: `English brand name "${englishTitle}" is absent from localized title "${localized}"`,
      }
    : { detected: false, similarity: retention };
}

// ---------------------------------------------------------------------------
// Trick 2: Different short description
// ---------------------------------------------------------------------------

/**
 * Was the short description translated, or replaced?
 *
 * A faithful Spanish translation of an English sentence shares ~30% of its
 * characters with the source, so the PRD's "Levenshtein < 0.6" cutoff would
 * flag every honest localization. Instead this flags on signals that do
 * distinguish replacement from translation:
 *
 * - Localized text is empty.
 * - Localized text is shaped like a keyword list ("a, b, c, d").
 * - Localized text is itself English (for a non-English locale) yet differs
 *   from the English original: same language, different message.
 * - Localized text is far longer than the English one and dissimilar - a
 *   one-liner padded out with extra copy.
 *
 * A fluent, same-length, unrelated translation is indistinguishable from a
 * legitimate one without semantic comparison; that case is not detected.
 */
export function detectDifferentShortDesc(
  english: string,
  localized: string,
  locale: string
): ManipulationFlags['differentShortDesc'] {
  const loc = localized.trim();
  if (loc.length === 0) {
    return { detected: true, similarity: 0, details: 'Localized short description is empty' };
  }
  const similarity = compositeSimilarity(english, loc);

  if (looksLikeKeywordList(loc)) {
    return { detected: true, similarity, details: 'Short description looks like a keyword list' };
  }

  const sameLanguageAsEnglish =
    baseLanguage(locale) !== 'en' &&
    englishRatio(loc, locale) > UNTRANSLATED_ENGLISH_THRESHOLD;
  if (sameLanguageAsEnglish && similarity < SHORT_DESC_SIMILARITY_THRESHOLD) {
    return {
      detected: true,
      similarity,
      details: 'Short description is in English but differs from the English listing',
    };
  }

  const en = english.trim();
  const lengthRatio = en.length > 0 ? loc.length / en.length : Infinity;
  if (similarity < SHORT_DESC_SIMILARITY_THRESHOLD && lengthRatio > SHORT_DESC_LENGTH_RATIO_THRESHOLD) {
    return {
      detected: true,
      similarity,
      details: `Short description is ${lengthRatio === Infinity ? 'much' : `${lengthRatio.toFixed(1)}x`} longer than the English one and dissimilar to it`,
    };
  }

  return { detected: false, similarity };
}

// ---------------------------------------------------------------------------
// Trick 3: Competitor names in text
// ---------------------------------------------------------------------------

/**
 * Are competitor names planted in the listing text?
 *
 * Exact matches are whole-phrase and case-insensitive ("block" does not match
 * inside "blockchain"). Fuzzy matches (one edit) are only attempted for names
 * of 8+ characters and require the first character to agree, so a short name
 * like "uBlock" cannot be "found" in the common word "block".
 */
export function detectCompetitorNames(
  title: string,
  shortDesc: string,
  fullDesc: string,
  competitorNames: string[]
): ManipulationFlags['competitorNames'] {
  const text = `${title}\n${shortDesc}\n${fullDesc}`;
  const lower = text.toLowerCase();
  const matches: string[] = [];
  // Dedupe case-insensitively, keeping the first spelling seen.
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of competitorNames) {
    const name = raw.trim();
    if (name.length < 3 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  if (names.length === 0 || lower.trim().length === 0) return { detected: false, matches };

  const words = tokenize(text);
  for (const name of names) {
    if (containsPhrase(lower, name)) {
      matches.push(name);
      continue;
    }
    const target = normalize(name);
    if (target.length < 8) continue;
    const n = tokenize(name).length;
    if (n === 0) continue;
    for (let i = 0; i + n <= words.length; i++) {
      const window = words.slice(i, i + n).join(' ');
      if (window[0] !== target[0]) continue;
      if (Math.abs(window.length - target.length) > 1) continue;
      if (levenshteinDistance(window, target) <= 1) {
        matches.push(name);
        break;
      }
    }
  }
  return { detected: matches.length > 0, matches };
}

// ---------------------------------------------------------------------------
// Trick 4: Considerably more extensive description
// ---------------------------------------------------------------------------

/** Median of a list of numbers; the average of the two middle values for an even count. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Is one locale's description far longer than the others'?
 *
 * Compares each description's length to the median length of the *other*
 * locales; flagged when strictly more than 2x. Leaving the locale under test
 * out of its own median keeps the check meaningful for small sets: with two
 * locales an all-inclusive median is their average, and 2L / (S + L) can never
 * exceed 2, so the PRD's "2 locales: still compares" would be impossible.
 * A single locale, or a zero median, cannot be judged and is never flagged.
 */
export function detectExtendedDescription(
  allLocaleDescriptions: Map<string, string>
): Map<string, ManipulationFlags['extendedDescription']> {
  const out = new Map<string, ManipulationFlags['extendedDescription']>();
  const lengths = [...allLocaleDescriptions.entries()].map(([locale, d]) => [locale, d.length] as const);

  if (lengths.length < 2) {
    for (const [locale] of lengths) out.set(locale, { detected: false, ratio: 1 });
    return out;
  }

  for (const [locale, length] of lengths) {
    const others = lengths.filter(([l]) => l !== locale).map(([, len]) => len);
    const median = medianOf(others);
    if (median === 0) {
      out.set(locale, { detected: false, ratio: length === 0 ? 1 : 0 });
      continue;
    }
    const ratio = length / median;
    if (ratio > EXTENDED_DESCRIPTION_RATIO) {
      out.set(locale, {
        detected: true,
        ratio,
        details: `Description is ${ratio.toFixed(1)}x the median length across locales (${length} vs ${Math.round(median)} chars)`,
      });
    } else {
      out.set(locale, { detected: false, ratio });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Trick 5: Keywords at end of description
// ---------------------------------------------------------------------------

/** Lines that look like list bullets are a legitimate feature list, not keywords. */
function isBulletLine(line: string): boolean {
  return /^\s*([-*•·▪‣]|\d+[.)]|[a-z][.)])\s+/i.test(line);
}

/**
 * Is a keyword block appended after the description?
 *
 * Looks for the classic shape: the description ends, then 3+ newlines, then
 * 5+ short lines (< 50 chars each) that are not bullet points. Also catches a
 * trailing comma-separated keyword line after the same gap. Bullet lists are
 * excluded - they are how developers write feature lists - and blank lines
 * inside the trailing block break it.
 */
export function detectKeywordsAtEnd(description: string): ManipulationFlags['keywordsAtEnd'] {
  const text = description.replace(/\r\n?/g, '\n').trimEnd();
  if (text.length === 0) return { detected: false };

  const lines = text.split('\n');
  // Walk back over the trailing non-blank lines.
  let start = lines.length;
  while (start > 0 && lines[start - 1].trim().length > 0) start -= 1;
  const block = lines.slice(start);
  if (block.length === 0) return { detected: false };

  // Count the newline run immediately before the block.
  let gap = 0;
  for (let i = start - 1; i >= 0 && lines[i].trim().length === 0; i--) gap += 1;
  const newlinesBefore = start === 0 ? 0 : gap + 1;
  if (newlinesBefore < KEYWORDS_AT_END_MIN_NEWLINES) return { detected: false };

  const blockText = block.join('\n');
  const shortLines = block.filter(
    (l) => l.trim().length > 0 && l.trim().length <= KEYWORDS_AT_END_MAX_LINE_LENGTH && !isBulletLine(l)
  );
  if (shortLines.length === block.length && shortLines.length >= KEYWORDS_AT_END_MIN_LINES) {
    return { detected: true, excerpt: excerpt(blockText) };
  }

  // One or two trailing lines that are themselves a comma-separated keyword list.
  if (block.length <= 2 && looksLikeKeywordList(blockText.replace(/\n/g, ', '))) {
    const segments = blockText.split(/[,\n、，]/).map((s) => s.trim()).filter(Boolean);
    if (segments.length >= KEYWORDS_AT_END_MIN_LINES) {
      return { detected: true, excerpt: excerpt(blockText) };
    }
  }

  return { detected: false };
}

// ---------------------------------------------------------------------------
// Trick 6: Keywords within description
// ---------------------------------------------------------------------------

/** Split prose into sentences on terminal punctuation or line breaks. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Are keyword blocks stuffed inside the description text?
 *
 * Two shapes are detected:
 * - A run of comma-separated short segments (1-4 words each). Five segments
 *   suffice when they are multi-word phrases ("ad blocker, popup blocker,
 *   tracker blocker, ..."); single words need seven, so a plain list of
 *   supported browsers or sites does not trip it.
 * - Template injection: three or more sentences of 30+ chars that are near
 *   duplicates of each other (similarity >= 0.8), i.e. the same sentence
 *   repeated with one keyword swapped.
 *
 * Language-agnostic, so an English keyword block inside Japanese prose is
 * caught the same way.
 */
export function detectKeywordsInline(description: string): ManipulationFlags['keywordsInline'] {
  const text = description.trim();
  if (text.length === 0) return { detected: false };

  // Comma runs: scan each line/sentence independently so a list cannot span
  // paragraphs.
  for (const chunk of text.split(/\n+/)) {
    const segments = chunk.split(/[,、，]/).map((s) => s.trim()).filter((s) => s.length > 0);
    if (segments.length < KEYWORDS_INLINE_MIN_SEGMENTS) continue;

    // Find the longest run of consecutive short segments.
    let run: string[] = [];
    let bestRun: string[] = [];
    for (const seg of segments) {
      // Strip a leading label like "features:" from the first segment.
      const core = seg.replace(/^[^:]{0,40}:\s*/, '');
      const words = tokenize(core).length;
      const isShort = words >= 1 && words <= KEYWORDS_INLINE_MAX_SEGMENT_WORDS && !/[.!?;]/.test(core.slice(0, -1));
      if (isShort) {
        run.push(core.replace(/[.!?]+$/, ''));
      } else {
        if (run.length > bestRun.length) bestRun = run;
        run = [];
      }
    }
    if (run.length > bestRun.length) bestRun = run;

    if (bestRun.length >= KEYWORDS_INLINE_MIN_SEGMENTS) {
      const avgWords = bestRun.reduce((sum, s) => sum + tokenize(s).length, 0) / bestRun.length;
      if (avgWords >= 2 || bestRun.length >= KEYWORDS_INLINE_MIN_SINGLE_WORD_SEGMENTS) {
        return { detected: true, excerpt: excerpt(bestRun.join(', ')) };
      }
    }
  }

  // Template injection: near-duplicate sentences.
  const sentences = splitSentences(text).filter((s) => s.length >= TEMPLATE_SENTENCE_MIN_LENGTH);
  for (let i = 0; i < sentences.length; i++) {
    const group = [sentences[i]];
    for (let j = i + 1; j < sentences.length; j++) {
      const a = normalize(sentences[i]);
      const b = normalize(sentences[j]);
      if (Math.abs(a.length - b.length) > a.length * 0.3) continue;
      if (levenshteinSimilarity(a, b) >= TEMPLATE_SENTENCE_SIMILARITY) group.push(sentences[j]);
    }
    if (group.length >= TEMPLATE_SENTENCE_MIN_COUNT) {
      return { detected: true, excerpt: excerpt(group.join(' ')) };
    }
  }

  return { detected: false };
}

// ---------------------------------------------------------------------------
// Trick 7: Completely different description
// ---------------------------------------------------------------------------

/**
 * Does the localized description describe the same product?
 *
 * Compares the Latin-script terms (brand names, product names, filter lists,
 * URLs, tech words) each text carries, using a cognate-aware overlap
 * coefficient so a Japanese description with a dozen Latin terms is judged on
 * those dozen. Flagged when overlap is below 0.1 and both sides carry enough
 * terms to compare. An empty localized description is flagged outright; a
 * localized text with no extractable Latin terms cannot be compared and is not.
 */
export function detectDifferentDescription(
  english: string,
  localized: string
): ManipulationFlags['differentDescription'] {
  if (localized.trim().length === 0) {
    return { detected: true, similarity: 0, details: 'Localized description is empty' };
  }
  const a = extractTerms(english);
  const b = extractTerms(localized);
  const overlap = termOverlap(a, b);
  if (overlap === null) {
    return { detected: false, similarity: 0, details: 'No shared-script terms to compare' };
  }
  if (a.size < DESCRIPTION_MIN_TERMS || b.size < DESCRIPTION_MIN_TERMS) {
    return { detected: false, similarity: overlap, details: 'Too few terms to compare reliably' };
  }
  return overlap < DESCRIPTION_OVERLAP_THRESHOLD
    ? {
        detected: true,
        similarity: overlap,
        details: `Only ${(overlap * 100).toFixed(0)}% of the smaller text's terms appear in the other`,
      }
    : { detected: false, similarity: overlap };
}

// ---------------------------------------------------------------------------
// Trick 8: Untranslated English
// ---------------------------------------------------------------------------

/**
 * Is a non-English locale's text still English?
 *
 * See {@link englishRatio} for how the ratio is estimated per script. Flagged
 * above 0.7. Never flagged for an English locale or for text too short to
 * judge.
 */
export function detectUntranslatedEnglish(
  text: string,
  expectedLocale: string
): ManipulationFlags['untranslatedEnglish'] {
  if (text.trim().length === 0 || baseLanguage(expectedLocale) === 'en') {
    return { detected: false, englishRatio: 0 };
  }
  const ratio = englishRatio(text, expectedLocale);
  return { detected: ratio > UNTRANSLATED_ENGLISH_THRESHOLD, englishRatio: ratio };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Flags with nothing detected - the state of a snapshot before analysis. */
export function emptyManipulationFlags(): ManipulationFlags {
  return {
    differentName: { detected: false, similarity: 1 },
    differentShortDesc: { detected: false, similarity: 1 },
    competitorNames: { detected: false, matches: [] },
    extendedDescription: { detected: false, ratio: 1 },
    keywordsAtEnd: { detected: false },
    keywordsInline: { detected: false },
    differentDescription: { detected: false, similarity: 1 },
    untranslatedEnglish: { detected: false, englishRatio: 0 },
  };
}

/** The tricks a set of flags has detected, in canonical order. */
export function detectedTricks(flags: ManipulationFlags): TrickKey[] {
  return ALL_TRICKS.filter((k) => flags[k].detected);
}

/** Weighted 0-100 manipulation score for one locale's flags. */
export function computeManipulationScore(flags: ManipulationFlags): number {
  let score = 0;
  for (const key of detectedTricks(flags)) score += TRICK_WEIGHTS[key];
  return Math.min(100, score);
}

/**
 * Overall 0-100 score for an extension across its locales: the worst locale,
 * plus 5 points for every additional locale that also tripped something, so
 * manipulation spread across many locales scores higher than one bad locale.
 */
export function computeOverallScore(localeScores: number[]): number {
  if (localeScores.length === 0) return 0;
  const sorted = [...localeScores].sort((a, b) => b - a);
  const others = sorted.slice(1).filter((s) => s > 0).length;
  return Math.min(100, sorted[0] + others * 5);
}

/** Coarse label for a score, for badges. */
export function scoreLabel(score: number): 'clean' | 'low' | 'medium' | 'high' {
  if (score === 0) return 'clean';
  if (score < 20) return 'low';
  if (score < 45) return 'medium';
  return 'high';
}

/**
 * Run every detector over one extension's captured locales.
 *
 * The baseline is the English listing. When the `en` locale is among the
 * captured snapshots it should be passed as the baseline by the caller;
 * cross-locale comparisons for that locale itself then trivially pass and only
 * the standalone detectors matter for it. Returns flags per locale code.
 */
export function analyzeLocaleSet(input: LocaleSetInput): Map<string, ManipulationFlags> {
  const { baseline, locales, competitorNames } = input;
  const out = new Map<string, ManipulationFlags>();

  const descriptions = new Map<string, string>();
  for (const l of locales) descriptions.set(l.locale, l.fullDescription);
  const extended = detectExtendedDescription(descriptions);

  for (const l of locales) {
    const flags = emptyManipulationFlags();
    const isEnglish = baseLanguage(l.locale) === 'en';

    if (baseline && !isEnglish) {
      flags.differentName = detectDifferentName(baseline.title, l.title, l.locale, competitorNames);
      flags.differentShortDesc = detectDifferentShortDesc(baseline.shortDescription, l.shortDescription, l.locale);
      flags.differentDescription = detectDifferentDescription(baseline.fullDescription, l.fullDescription);
    } else if (baseline && isEnglish) {
      // The English locale is compared to itself only for the competitor check
      // below, but an English title carrying a competitor's name is still a
      // different-name signal worth surfacing.
      const competitor = competitorNames.find((name) => containsPhrase(l.title, name));
      if (competitor) {
        flags.differentName = {
          detected: true,
          similarity: 1,
          details: `Title contains competitor name "${competitor}"`,
        };
      }
    }

    flags.competitorNames = detectCompetitorNames(l.title, l.shortDescription, l.fullDescription, competitorNames);
    flags.extendedDescription = extended.get(l.locale) ?? { detected: false, ratio: 1 };
    flags.keywordsAtEnd = detectKeywordsAtEnd(l.fullDescription);
    flags.keywordsInline = detectKeywordsInline(l.fullDescription);
    flags.untranslatedEnglish = detectUntranslatedEnglish(
      `${l.title}\n${l.shortDescription}\n${l.fullDescription}`,
      l.locale
    );

    out.set(l.locale, flags);
  }
  return out;
}
