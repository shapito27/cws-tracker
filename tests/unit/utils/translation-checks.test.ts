/**
 * Tests for translation manipulation detection (Phase 3.6.2).
 *
 * Cases follow the TODO 3.6.2 list trick by trick, plus the aggregation
 * helpers used by the report.
 */
import { describe, it, expect } from 'vitest';
import {
  analyzeLocaleSet,
  baseLanguage,
  brandTokens,
  computeManipulationScore,
  computeOverallScore,
  containsPhrase,
  detectCompetitorNames,
  detectDifferentDescription,
  detectDifferentName,
  identifyBrandTokens,
  detectDifferentShortDesc,
  detectExtendedDescription,
  detectKeywordsAtEnd,
  detectKeywordsInline,
  detectLanguage,
  detectUntranslatedEnglish,
  detectedTricks,
  emptyManipulationFlags,
  englishRatio,
  extractTerms,
  isLatinScriptLocale,
  isLocaleSupported,
  looksLikeKeywordList,
  scoreLabel,
  termOverlap,
  TRICK_SEVERITY,
} from '@/shared/utils/translation-checks';

const EN_DESC =
  'uBlock Origin is not an "ad blocker", it\'s a wide-spectrum content blocker with CPU and memory ' +
  'efficiency as a primary feature. Out of the box, these lists of filters are loaded and enforced: ' +
  'uBlock Origin filter lists, EasyList (ads), EasyPrivacy (tracking), Peter Lowe\'s Ad server list, ' +
  'Online Malicious URL Blocklist. More lists are available for you to select if you wish.';

const JA_DESC =
  '効率的なブロッカー：コンピュータのメモリとCPUのフットプリントはより少なく、別の人気のブロッカーよりも' +
  '何千ものフィルタをロードし、強制的にブロックができます。\n\n以下のフィルターが読み込まれ、適用されます：\n' +
  '- uBlock Origin filter lists\n- EasyList (ads)\n- EasyPrivacy (tracking)\n- Peter Lowe\'s Ad server list\n' +
  '- Online Malicious URL Blocklist';

const ES_DESC =
  'Un bloqueador eficiente: capaz de cargar y aplicar miles más de filtros en comparación con otros ' +
  'populares bloqueadores, manteniendo un mínimo consumo de memoria y CPU. Estas listas de filtros se ' +
  'cargan y aplican: uBlock Origin filter lists, EasyList (ads), EasyPrivacy (tracking), Peter Lowe\'s ' +
  'Ad server list, Online Malicious URL Blocklist.';

// ---------------------------------------------------------------------------
// Locale & script helpers
// ---------------------------------------------------------------------------

describe('locale helpers', () => {
  it('baseLanguage strips region and normalizes case', () => {
    expect(baseLanguage('pt_BR')).toBe('pt');
    expect(baseLanguage('zh-CN')).toBe('zh');
    expect(baseLanguage('EN')).toBe('en');
    expect(baseLanguage('')).toBe('');
  });

  it('classifies PRD locales by script', () => {
    for (const l of ['en', 'es', 'fr', 'de', 'pt_BR', 'it', 'nl', 'pl', 'tr']) {
      expect(isLatinScriptLocale(l)).toBe(true);
    }
    for (const l of ['ja', 'zh_CN', 'ko', 'ar', 'hi', 'ru']) {
      expect(isLatinScriptLocale(l)).toBe(false);
    }
  });

  it('unknown locales default to Latin script', () => {
    expect(isLatinScriptLocale('xx')).toBe(true);
  });

  it('isLocaleSupported matches CWS hyphenated codes against underscore settings codes', () => {
    const shipped = ['en', 'de', 'ja', 'pt-BR', 'zh-CN'];
    expect(isLocaleSupported('ja', shipped)).toBe(true);
    expect(isLocaleSupported('pt_BR', shipped)).toBe(true);
    expect(isLocaleSupported('zh_CN', shipped)).toBe(true);
    expect(isLocaleSupported('ru', shipped)).toBe(false);
    expect(isLocaleSupported('es', shipped)).toBe(false);
    // Base-language match counts as shipped.
    expect(isLocaleSupported('pt_BR', ['pt-PT'])).toBe(true);
    // No list reported: assume shipped so the detectors still run.
    expect(isLocaleSupported('ru', [])).toBe(true);
  });

  it('detectLanguage recognizes non-Latin scripts', () => {
    expect(detectLanguage('広告ブロッカーついに登場')).toBe('ja');
    expect(detectLanguage('高效的广告拦截器')).toBe('zh');
    expect(detectLanguage('효율적인 광고 차단기')).toBe('ko');
    expect(detectLanguage('Эффективный блокировщик рекламы')).toBe('ru');
    expect(detectLanguage('أداة حظر إعلانات فعالة')).toBe('ar');
    expect(detectLanguage('प्रभावी विज्ञापन अवरोधक')).toBe('hi');
  });

  it('detectLanguage attributes Latin prose to the dominant function-word list', () => {
    expect(detectLanguage('This is the best blocker for your browser and it is free to use')).toBe('en');
    expect(detectLanguage('Un bloqueador eficiente que carga y aplica los filtros con un consumo mínimo de la memoria')).toBe('es');
    expect(detectLanguage('Der beste Blocker für den Browser und die Privatsphäre mit einer einfachen Bedienung')).toBe('de');
  });

  it('detectLanguage returns null without evidence', () => {
    expect(detectLanguage('')).toBe(null);
    expect(detectLanguage('12345 !!!')).toBe(null);
    expect(detectLanguage('uBlock')).toBe(null);
  });
});

describe('text helpers', () => {
  it('containsPhrase is whole-phrase and case-insensitive across scripts', () => {
    expect(containsPhrase('Try uBlock Origin today', 'ublock origin')).toBe(true);
    expect(containsPhrase('blockchain wallet', 'block')).toBe(false);
    expect(containsPhrase('広告ブロッカー AdBlock Plus です', 'AdBlock Plus')).toBe(true);
    expect(containsPhrase('', 'x')).toBe(false);
    expect(containsPhrase('x', '')).toBe(false);
  });

  it('brandTokens keeps significant words and drops English stop words', () => {
    expect(brandTokens('Adblock for YouTube')).toEqual(['adblock', 'youtube']);
    expect(brandTokens('The Great Suspender')).toEqual(['great', 'suspender']);
    expect(brandTokens('')).toEqual([]);
  });

  it('extractTerms lowercases, drops short tokens and stop words', () => {
    const terms = extractTerms('The uBlock Origin CPU is efficient, and the memory too');
    expect(terms.has('ublock')).toBe(true);
    expect(terms.has('cpu')).toBe(true);
    expect(terms.has('the')).toBe(false);
    expect(terms.has('is')).toBe(false);
  });

  it('termOverlap is null for empty sets and cognate-aware otherwise', () => {
    expect(termOverlap(new Set(), new Set(['a']))).toBe(null);
    expect(termOverlap(new Set(['filters', 'memory']), new Set(['filtros', 'memoria', 'otros']))).toBe(1);
    expect(termOverlap(new Set(['youtube', 'download']), new Set(['ublock', 'filters']))).toBe(0);
  });

  it('looksLikeKeywordList recognizes bare comma lists only', () => {
    expect(looksLikeKeywordList('ad blocker, popup blocker, vpn, proxy, privacy')).toBe(true);
    expect(looksLikeKeywordList('Finally, an efficient blocker. Easy on CPU and memory.')).toBe(false);
    expect(looksLikeKeywordList('fast and secure')).toBe(false);
    expect(looksLikeKeywordList('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trick 1: Different extension name
// ---------------------------------------------------------------------------

describe('detectDifferentName', () => {
  const competitors = ['uBlock Origin', 'Ghostery'];

  it('"AdBlock Plus" vs "AdBlock Plus" (es): not flagged (same name)', () => {
    const r = detectDifferentName('AdBlock Plus', 'AdBlock Plus', 'es', competitors);
    expect(r.detected).toBe(false);
    expect(r.similarity).toBe(1);
  });

  it('"AdBlock Plus" vs "El Mejor Bloqueador" (es): flagged (< 50% similarity)', () => {
    const r = detectDifferentName('AdBlock Plus', 'El Mejor Bloqueador', 'es', competitors);
    expect(r.detected).toBe(true);
    expect(r.similarity).toBeLessThan(0.5);
    expect(r.details).toBeDefined();
  });

  it('Latin locale keeping the brand with a translated suffix: not flagged', () => {
    const r = detectDifferentName('AdBlock Plus', 'AdBlock Plus - Bloqueador de anuncios gratis', 'es', competitors);
    expect(r.detected).toBe(false);
  });

  it('"AdBlock Plus" vs "AdBlock Plus - 広告ブロッカー" (ja): not flagged (brand name retained)', () => {
    const r = detectDifferentName('AdBlock Plus', 'AdBlock Plus - 広告ブロッカー', 'ja', competitors);
    expect(r.detected).toBe(false);
    expect(r.similarity).toBe(1);
  });

  it('"AdBlock Plus" vs "広告ブロッカー" (ja): flagged (brand name absent)', () => {
    const r = detectDifferentName('AdBlock Plus', '広告ブロッカー', 'ja', competitors);
    expect(r.detected).toBe(true);
    expect(r.similarity).toBe(0);
  });

  it('"AdBlock Plus" vs "uBlock Origin" (any locale): flagged (competitor name)', () => {
    for (const locale of ['es', 'ja', 'en']) {
      const r = detectDifferentName('AdBlock Plus', 'uBlock Origin', locale, competitors);
      expect(r.detected).toBe(true);
      expect(r.details).toContain('uBlock Origin');
    }
  });

  it('empty localized title: flagged', () => {
    const r = detectDifferentName('AdBlock Plus', '   ', 'es', competitors);
    expect(r.detected).toBe(true);
    expect(r.similarity).toBe(0);
  });

  it('non-Latin locale with no brand tokens to check: not flagged', () => {
    const r = detectDifferentName('', '広告ブロッカー', 'ja', []);
    expect(r.detected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trick 2: Different short description
// ---------------------------------------------------------------------------

describe('detectDifferentShortDesc', () => {
  it('similar descriptions in different languages: not flagged if similarity > 0.6 (Latin)', () => {
    const r = detectDifferentShortDesc('AdBlock Plus blocks ads on YouTube', 'AdBlock Plus bloquea ads en YouTube', 'es');
    expect(r.detected).toBe(false);
    expect(r.similarity).toBeGreaterThan(0.6);
  });

  it('an honest translation with few shared characters is not flagged', () => {
    const r = detectDifferentShortDesc(
      'Finally, an efficient blocker. Easy on CPU and memory.',
      'Por fin, un bloqueador eficiente con uso mínimo de procesador y memoria.',
      'es'
    );
    expect(r.detected).toBe(false);
  });

  it('completely different description (English left in a non-English locale): flagged', () => {
    const r = detectDifferentShortDesc(
      'Finally, an efficient blocker. Easy on CPU and memory.',
      'Download videos from YouTube, Facebook and Instagram for free with the best downloader',
      'es'
    );
    expect(r.detected).toBe(true);
    expect(r.similarity).toBeLessThan(0.6);
  });

  it('completely different description padded far beyond the English length: flagged', () => {
    const r = detectDifferentShortDesc(
      'Block ads.',
      'Descarga videos gratis de YouTube, Facebook, Instagram y TikTok rápidamente sin límites ni registro desde cualquier sitio web',
      'es'
    );
    expect(r.detected).toBe(true);
  });

  it('description replaced with "keyword1, keyword2, keyword3": flagged', () => {
    const r = detectDifferentShortDesc(
      'Finally, an efficient blocker.',
      'bloqueador de anuncios, adblock, vpn gratis, proxy, privacidad',
      'es'
    );
    expect(r.detected).toBe(true);
    expect(r.details).toContain('keyword list');
  });

  it('empty localized short description: flagged', () => {
    const r = detectDifferentShortDesc('Finally, an efficient blocker.', '', 'fr');
    expect(r.detected).toBe(true);
    expect(r.similarity).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Trick 3: Competitor names in text
// ---------------------------------------------------------------------------

describe('detectCompetitorNames', () => {
  const competitors = ['uBlock Origin', 'Ghostery', 'AdGuard'];

  it('description contains exact competitor name: flagged with match', () => {
    const r = detectCompetitorNames('My Blocker', 'Better than uBlock Origin', 'Long text', competitors);
    expect(r.detected).toBe(true);
    expect(r.matches).toEqual(['uBlock Origin']);
  });

  it('description contains fuzzy match (1 char difference): flagged', () => {
    const r = detectCompetitorNames('My Blocker', '', 'An alternative to uBlock Origins and more', competitors);
    expect(r.detected).toBe(true);
    expect(r.matches).toContain('uBlock Origin');
  });

  it('competitor name as part of a different word: not flagged ("block" in "blockchain")', () => {
    const r = detectCompetitorNames('Wallet', '', 'A blockchain wallet for crypto, with blocklists', ['block']);
    expect(r.detected).toBe(false);
  });

  it('short competitor names are never fuzzy-matched', () => {
    // "block" is one edit from "ublock" but must not match.
    const r = detectCompetitorNames('X', '', 'a content block tool', ['uBlock']);
    expect(r.detected).toBe(false);
  });

  it('no competitor names in text: not flagged', () => {
    const r = detectCompetitorNames('My Blocker', 'Fast and light', EN_DESC.replace(/uBlock Origin/g, 'it'), ['Ghostery', 'AdGuard']);
    expect(r.detected).toBe(false);
    expect(r.matches).toEqual([]);
  });

  it('competitor names array is empty: not flagged, no error', () => {
    const r = detectCompetitorNames('My Blocker', 'x', 'y', []);
    expect(r.detected).toBe(false);
    expect(r.matches).toEqual([]);
  });

  it('matches are case-insensitive and deduplicated', () => {
    const r = detectCompetitorNames('GHOSTERY killer', 'ghostery ghostery', '', ['Ghostery', 'ghostery ']);
    expect(r.matches).toEqual(['Ghostery']);
  });
});

// ---------------------------------------------------------------------------
// Trick 4: Considerably more extensive description
// ---------------------------------------------------------------------------

describe('detectExtendedDescription', () => {
  it('all locales similar length: none flagged', () => {
    const r = detectExtendedDescription(new Map([
      ['en', 'a'.repeat(1000)],
      ['es', 'b'.repeat(1100)],
      ['ja', 'c'.repeat(900)],
    ]));
    for (const flag of r.values()) expect(flag.detected).toBe(false);
    expect(r.get('en')!.ratio).toBeCloseTo(1);
  });

  it('one locale 3x median length: flagged', () => {
    const r = detectExtendedDescription(new Map([
      ['en', 'a'.repeat(1000)],
      ['es', 'b'.repeat(1000)],
      ['ru', 'c'.repeat(3000)],
    ]));
    expect(r.get('ru')!.detected).toBe(true);
    expect(r.get('ru')!.ratio).toBeCloseTo(3);
    expect(r.get('ru')!.details).toContain('3.0x');
    expect(r.get('en')!.detected).toBe(false);
  });

  it('one locale exactly 2x median: not flagged (> 2x, not >=)', () => {
    const r = detectExtendedDescription(new Map([
      ['en', 'a'.repeat(1000)],
      ['es', 'b'.repeat(1000)],
      ['de', 'c'.repeat(1000)],
      ['ru', 'd'.repeat(2000)],
    ]));
    // Even count: median is the average of 1000 and 1000 = 1000.
    expect(r.get('ru')!.ratio).toBeCloseTo(2);
    expect(r.get('ru')!.detected).toBe(false);
  });

  it('only 1 locale available: not flagged', () => {
    const r = detectExtendedDescription(new Map([['en', 'a'.repeat(5000)]]));
    expect(r.get('en')!.detected).toBe(false);
    expect(r.get('en')!.ratio).toBe(1);
  });

  it('2 locales: compares each against the other, still compares', () => {
    const r = detectExtendedDescription(new Map([
      ['en', 'a'.repeat(1000)],
      ['ru', 'b'.repeat(6000)],
    ]));
    // Leave-one-out median: ru is judged against en (1000) and vice versa.
    expect(r.get('ru')!.ratio).toBeCloseTo(6);
    expect(r.get('ru')!.detected).toBe(true);
    expect(r.get('en')!.ratio).toBeCloseTo(1000 / 6000);
    expect(r.get('en')!.detected).toBe(false);

    const close = detectExtendedDescription(new Map([
      ['en', 'a'.repeat(1000)],
      ['ru', 'b'.repeat(1800)],
    ]));
    expect(close.get('ru')!.detected).toBe(false);
  });

  it('median excludes the locale under test (even-count median is an average)', () => {
    const r = detectExtendedDescription(new Map([
      ['en', 'a'.repeat(1000)],
      ['es', 'b'.repeat(1200)],
      ['de', 'c'.repeat(1400)],
      ['ru', 'd'.repeat(2500)],
    ]));
    // ru vs median(1000, 1200, 1400) = 1200 → 2.08x → flagged.
    expect(r.get('ru')!.detected).toBe(true);
    // de vs median(1000, 1200, 2500) = 1200 → 1.17x.
    expect(r.get('de')!.ratio).toBeCloseTo(1400 / 1200);
  });

  it('zero median: nothing flagged', () => {
    const r = detectExtendedDescription(new Map([['en', ''], ['es', ''], ['ru', 'x'.repeat(500)]]));
    expect(r.get('ru')!.detected).toBe(false);
  });

  it('empty input: empty output', () => {
    expect(detectExtendedDescription(new Map()).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Trick 5: Keywords at end of description
// ---------------------------------------------------------------------------

describe('detectKeywordsAtEnd', () => {
  it('normal description: not flagged', () => {
    expect(detectKeywordsAtEnd(EN_DESC).detected).toBe(false);
  });

  it('description ending with a newline gap then 5 short lines: flagged', () => {
    const r = detectKeywordsAtEnd(`${EN_DESC}\n\n\n\nkeyword1\nkeyword2\nkeyword3\nkeyword4\nkeyword5`);
    expect(r.detected).toBe(true);
    expect(r.excerpt).toContain('keyword1');
    expect(r.excerpt).toContain('keyword5');
  });

  it('trailing comma-separated keyword line after a gap: flagged', () => {
    const r = detectKeywordsAtEnd(`${EN_DESC}\n\n\nad blocker, adblock, popup blocker, vpn, proxy, privacy`);
    expect(r.detected).toBe(true);
  });

  it('description ending with a bullet-point list (legitimate): not flagged', () => {
    const r = detectKeywordsAtEnd(
      `${EN_DESC}\n\n\nFeatures:\n- Block ads\n- Block trackers\n- Block popups\n- Block malware\n- Block miners`
    );
    expect(r.detected).toBe(false);
  });

  it('bullet list preceded by a single newline: not flagged', () => {
    const r = detectKeywordsAtEnd(`${EN_DESC}\nfilters\nlists\nblocks\nads\ntrackers`);
    expect(r.detected).toBe(false);
  });

  it('description with newlines in middle (not at end): not flagged', () => {
    const r = detectKeywordsAtEnd(`Intro line\n\n\n\nMore prose here that continues the description in full sentences. ${EN_DESC}`);
    expect(r.detected).toBe(false);
  });

  it('fewer than 5 trailing lines: not flagged', () => {
    const r = detectKeywordsAtEnd(`${EN_DESC}\n\n\n\nkw1\nkw2\nkw3\nkw4`);
    expect(r.detected).toBe(false);
  });

  it('empty description: not flagged', () => {
    expect(detectKeywordsAtEnd('').detected).toBe(false);
    expect(detectKeywordsAtEnd('\n\n\n').detected).toBe(false);
  });

  it('excerpt is capped at 200 characters', () => {
    const block = Array.from({ length: 30 }, (_, i) => `keyword number ${i} here`).join('\n');
    const r = detectKeywordsAtEnd(`${EN_DESC}\n\n\n\n${block}`);
    expect(r.detected).toBe(true);
    expect(r.excerpt!.length).toBeLessThanOrEqual(201);
  });
});

// ---------------------------------------------------------------------------
// Trick 6: Keywords within description
// ---------------------------------------------------------------------------

describe('detectKeywordsInline', () => {
  it('normal prose: not flagged', () => {
    expect(detectKeywordsInline(EN_DESC).detected).toBe(false);
    expect(detectKeywordsInline(ES_DESC).detected).toBe(false);
  });

  it('"features: ad blocker, popup blocker, tracker blocker, script blocker, cookie blocker": flagged', () => {
    const r = detectKeywordsInline(
      `${EN_DESC}\nfeatures: ad blocker, popup blocker, tracker blocker, script blocker, cookie blocker`
    );
    expect(r.detected).toBe(true);
    expect(r.excerpt).toContain('ad blocker');
  });

  it('single comma-separated pair ("fast and secure"): not flagged', () => {
    expect(detectKeywordsInline('It is fast and secure, and free.').detected).toBe(false);
  });

  it('a short list of single words (supported sites) is not flagged', () => {
    expect(detectKeywordsInline('Works on Chrome, Edge, Brave, Opera, Vivaldi and more.').detected).toBe(false);
  });

  it('a long run of single words is flagged', () => {
    expect(detectKeywordsInline('adblock, vpn, proxy, privacy, tracker, popup, malware, cookies').detected).toBe(true);
  });

  it('English keyword block inside non-English text: flagged', () => {
    const r = detectKeywordsInline(`${JA_DESC}\nad blocker, popup blocker, tracker blocker, youtube adblock, free vpn`);
    expect(r.detected).toBe(true);
  });

  it('template-injected near-duplicate sentences: flagged', () => {
    const r = detectKeywordsInline(
      'The best ad blocker for YouTube videos and streams. ' +
      'The best ad blocker for Twitch videos and streams. ' +
      'The best ad blocker for Facebook videos and streams. It also saves memory.'
    );
    expect(r.detected).toBe(true);
    expect(r.excerpt).toContain('YouTube');
  });

  it('empty description: not flagged', () => {
    expect(detectKeywordsInline('').detected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trick 7: Completely different description
// ---------------------------------------------------------------------------

describe('detectDifferentDescription', () => {
  it('legitimate translation (shared brand / tech terms): not flagged', () => {
    expect(detectDifferentDescription(EN_DESC, JA_DESC).detected).toBe(false);
    expect(detectDifferentDescription(EN_DESC, ES_DESC).detected).toBe(false);
  });

  it('completely unrelated text: flagged', () => {
    const unrelated =
      'Descarga videos de YouTube, Facebook, Instagram, TikTok, Twitter y Vimeo gratis. ' +
      'El mejor downloader para guardar clips, música y películas en alta calidad sin registro.';
    const r = detectDifferentDescription(EN_DESC, unrelated);
    expect(r.detected).toBe(true);
    expect(r.similarity).toBeLessThan(0.1);
  });

  it('same text (not translated): not flagged (high overlap)', () => {
    const r = detectDifferentDescription(EN_DESC, EN_DESC);
    expect(r.detected).toBe(false);
    expect(r.similarity).toBe(1);
  });

  it('empty localized description: flagged', () => {
    const r = detectDifferentDescription(EN_DESC, '   ');
    expect(r.detected).toBe(true);
    expect(r.similarity).toBe(0);
  });

  it('localized text with no Latin terms cannot be compared: not flagged', () => {
    const r = detectDifferentDescription(EN_DESC, '効率的なブロッカーです。メモリの使用量が少ない。');
    expect(r.detected).toBe(false);
    expect(r.details).toBeDefined();
  });

  it('too few terms on either side: not flagged', () => {
    const r = detectDifferentDescription('Block ads', 'Guarda pestañas');
    expect(r.detected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Trick 8: Untranslated English
// ---------------------------------------------------------------------------

describe('detectUntranslatedEnglish', () => {
  it("English text with expectedLocale='ja': flagged (high English ratio)", () => {
    const r = detectUntranslatedEnglish(EN_DESC, 'ja');
    expect(r.detected).toBe(true);
    expect(r.englishRatio).toBeGreaterThan(0.9);
  });

  it("Japanese text with expectedLocale='ja': not flagged", () => {
    const r = detectUntranslatedEnglish(JA_DESC, 'ja');
    expect(r.detected).toBe(false);
    expect(r.englishRatio).toBeLessThan(0.7);
  });

  it('mixed text (~50% English, ~50% Japanese): below the 70% threshold, not flagged', () => {
    const mixed = '効率的なブロッカーです。メモリの使用量が少ないです。 This is an efficient blocker with low memory.';
    const r = detectUntranslatedEnglish(mixed, 'ja');
    expect(r.englishRatio).toBeGreaterThan(0.3);
    expect(r.englishRatio).toBeLessThan(0.7);
    expect(r.detected).toBe(false);
  });

  it('Japanese text with only English brand names: not flagged (low English ratio)', () => {
    const r = detectUntranslatedEnglish('uBlock Origin は効率的な広告ブロッカーです。CPU とメモリーに負担をかけません。', 'ja');
    expect(r.detected).toBe(false);
  });

  it('English text in a Latin-script locale (es): flagged via function words', () => {
    const r = detectUntranslatedEnglish(EN_DESC, 'es');
    expect(r.detected).toBe(true);
    expect(r.englishRatio).toBeGreaterThan(0.7);
  });

  it('Spanish text in es: not flagged', () => {
    const r = detectUntranslatedEnglish(ES_DESC, 'es');
    expect(r.detected).toBe(false);
  });

  it('English locale is never flagged', () => {
    expect(detectUntranslatedEnglish(EN_DESC, 'en').detected).toBe(false);
  });

  it('empty text: not flagged', () => {
    const r = detectUntranslatedEnglish('', 'ja');
    expect(r.detected).toBe(false);
    expect(r.englishRatio).toBe(0);
  });

  it('Latin locale without a marker list falls back to English marker share', () => {
    expect(englishRatio(EN_DESC, 'sv')).toBeGreaterThan(0.7);
    expect(englishRatio('kort text', 'sv')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

describe('scoring', () => {
  it('empty flags score 0 and are "clean"', () => {
    const flags = emptyManipulationFlags();
    expect(detectedTricks(flags)).toEqual([]);
    expect(computeManipulationScore(flags)).toBe(0);
    expect(scoreLabel(0)).toBe('clean');
  });

  it('weights are by severity and capped at 100', () => {
    const flags = emptyManipulationFlags();
    flags.keywordsAtEnd = { detected: true };
    expect(computeManipulationScore(flags)).toBe(20);
    flags.untranslatedEnglish = { detected: true, englishRatio: 1 };
    expect(computeManipulationScore(flags)).toBe(25);
    for (const key of Object.keys(flags) as Array<keyof typeof flags>) flags[key].detected = true;
    expect(computeManipulationScore(flags)).toBe(100);
    expect(detectedTricks(flags)).toHaveLength(8);
  });

  it('every trick has a severity', () => {
    for (const key of Object.keys(emptyManipulationFlags()) as Array<keyof typeof TRICK_SEVERITY>) {
      expect(['high', 'medium', 'low']).toContain(TRICK_SEVERITY[key]);
    }
  });

  it('overall score is the worst locale plus 5 per additional flagged locale', () => {
    expect(computeOverallScore([])).toBe(0);
    expect(computeOverallScore([0, 0, 0])).toBe(0);
    expect(computeOverallScore([20])).toBe(20);
    expect(computeOverallScore([20, 8, 0, 8])).toBe(30);
    expect(computeOverallScore([100, 50, 50])).toBe(100);
  });

  it('scoreLabel bands', () => {
    expect(scoreLabel(5)).toBe('low');
    expect(scoreLabel(20)).toBe('medium');
    expect(scoreLabel(45)).toBe('high');
  });
});

describe('analyzeLocaleSet', () => {
  const baseline = {
    title: 'uBlock Origin',
    shortDescription: 'Finally, an efficient blocker. Easy on CPU and memory.',
    fullDescription: EN_DESC,
  };

  it('clean honest localizations produce no flags', () => {
    const flags = analyzeLocaleSet({
      baseline,
      locales: [
        { locale: 'en', title: 'uBlock Origin', shortDescription: baseline.shortDescription, fullDescription: EN_DESC },
        { locale: 'es', title: 'uBlock Origin', shortDescription: 'Por fin, un bloqueador eficiente con uso mínimo de procesador y memoria.', fullDescription: ES_DESC },
        { locale: 'ja', title: 'uBlock Origin', shortDescription: '高効率ブロッカーついに登場。CPU とメモリーに負担をかけません。', fullDescription: JA_DESC },
      ],
      competitorNames: ['AdBlock Plus', 'Ghostery'],
    });
    expect(flags.size).toBe(3);
    for (const [, f] of flags) expect(detectedTricks(f)).toEqual([]);
  });

  it('a manipulated locale is flagged on the relevant tricks', () => {
    const stuffed =
      'Download YouTube videos, Facebook videos and TikTok videos with the fastest downloader. Better than Ghostery.\n\n\n\n' +
      'adblock\nad blocker\nyoutube adblock\nfree vpn\npopup blocker\nprivacy';
    const flags = analyzeLocaleSet({
      baseline,
      locales: [
        { locale: 'en', title: 'uBlock Origin', shortDescription: baseline.shortDescription, fullDescription: EN_DESC },
        { locale: 'ru', title: 'Лучший блокировщик', shortDescription: 'adblock, vpn, proxy, privacy, youtube', fullDescription: `${stuffed}${'x'.repeat(2000)}` },
      ],
      competitorNames: ['AdBlock Plus', 'Ghostery'],
    });
    const ru = flags.get('ru')!;
    expect(ru.differentName.detected).toBe(true);
    expect(ru.differentShortDesc.detected).toBe(true);
    expect(ru.competitorNames.matches).toEqual(['Ghostery']);
    expect(ru.extendedDescription.detected).toBe(true);
    expect(ru.untranslatedEnglish.detected).toBe(true);
    expect(computeManipulationScore(ru)).toBeGreaterThan(40);
    // The English locale stays clean.
    expect(detectedTricks(flags.get('en')!)).toEqual([]);
  });

  it('English locale title carrying a competitor name is flagged as a different name', () => {
    const flags = analyzeLocaleSet({
      baseline,
      locales: [{ locale: 'en', title: 'uBlock Origin - better than Ghostery', shortDescription: 'x', fullDescription: EN_DESC }],
      competitorNames: ['Ghostery'],
    });
    expect(flags.get('en')!.differentName.detected).toBe(true);
    expect(flags.get('en')!.competitorNames.detected).toBe(true);
  });

  it('without a baseline only standalone detectors run', () => {
    const flags = analyzeLocaleSet({
      baseline: null,
      locales: [{ locale: 'ja', title: '広告ブロッカー', shortDescription: '', fullDescription: `${JA_DESC}\n\n\n\nkw1\nkw2\nkw3\nkw4\nkw5` }],
      competitorNames: [],
    });
    const ja = flags.get('ja')!;
    expect(ja.differentName.detected).toBe(false);
    expect(ja.differentShortDesc.detected).toBe(false);
    expect(ja.keywordsAtEnd.detected).toBe(true);
  });

  it('empty locale list: empty result', () => {
    expect(analyzeLocaleSet({ baseline, locales: [], competitorNames: [] }).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Brand identification across locales (the "Pinterest Pin Stats" false positive)
// ---------------------------------------------------------------------------

describe('identifyBrandTokens', () => {
  const EN = 'Pinterest Pin Stats - Sort Pins';
  const ES = 'Estadísticas de pines de Pinterest - Ordenar pines';
  const FR = 'Statistiques des épingles Pinterest - Trier les épingles';
  const DE = 'Pinterest Pin-Statistiken - Pins sortieren';

  it('with no other locales only coined-looking words count as brand', () => {
    expect(identifyBrandTokens(EN)).toEqual([]);
    expect(identifyBrandTokens('uBlock Origin')).toEqual(['uBlock']);
    expect(identifyBrandTokens('1Password - Password Manager')).toEqual(['1Password']);
    expect(identifyBrandTokens('AdBlock Plus')).toEqual(['AdBlock']);
  });

  it('a word kept by most other translated titles is the brand; translated words are not', () => {
    expect(identifyBrandTokens(EN, [ES, FR, DE])).toEqual(['Pinterest']);
  });

  it('a word that only one of several locales keeps (partial translation) is not brand', () => {
    // "Pin"/"Pins" survive only in German.
    expect(identifyBrandTokens(EN, [ES, FR, DE])).not.toContain('Pins');
  });

  it('a Latin word inside a non-Latin title is brand evidence on its own', () => {
    expect(identifyBrandTokens(EN, ['Pinterest ピン統計 - ピンを並べ替え'])).toEqual(['Pinterest']);
  });

  it('untranslated copies of the English title carry no evidence', () => {
    expect(identifyBrandTokens(EN, [EN, EN, 'pinterest pin stats - sort pins'])).toEqual([]);
    // ...even when mixed with a real translation: the copy does not vote.
    expect(identifyBrandTokens(EN, [EN, ES])).toEqual(['Pinterest']);
  });

  it('ignores stop words, single characters and empty titles', () => {
    expect(identifyBrandTokens('The a of', ['The a of x'])).toEqual([]);
    expect(identifyBrandTokens('', ['x'])).toEqual([]);
    expect(identifyBrandTokens(EN, ['', '   '])).toEqual([]);
  });
});

describe('detectDifferentName with other locales as evidence', () => {
  const EN = 'Pinterest Pin Stats - Sort Pins';
  const ES = 'Estadísticas de pines de Pinterest - Ordenar pines';
  const FR = 'Statistiques des épingles Pinterest - Trier les épingles';
  const DE = 'Pinterest Pin-Statistiken - Pins sortieren';

  it('an honest Spanish translation that keeps the brand is not flagged', () => {
    const r = detectDifferentName(EN, ES, 'es', [], [FR, DE]);
    expect(r.detected).toBe(false);
    expect(r.similarity).toBe(1);
  });

  it('a descriptive title with no identifiable brand is never flagged for wording alone', () => {
    const r = detectDifferentName(EN, ES, 'es', []);
    expect(r.detected).toBe(false);
  });

  it('a locale that drops the brand every other locale kept is flagged and names the brand', () => {
    const r = detectDifferentName(EN, 'ピン統計 - ピンを並べ替え', 'ja', [], [ES, FR, DE]);
    expect(r.detected).toBe(true);
    expect(r.similarity).toBe(0);
    expect(r.details).toContain('"Pinterest"');
    expect(r.details).toContain(EN);
  });

  it('a Latin locale that drops the brand is flagged too', () => {
    const r = detectDifferentName(EN, 'Estadísticas de pines - Ordenar pines', 'es', [], [FR, DE]);
    expect(r.detected).toBe(true);
    expect(r.details).toContain('Pinterest');
  });

  it('competitor names in the title win over brand retention', () => {
    const r = detectDifferentName(EN, 'Pinterest Pin Stats by Tailwind', 'en', ['Tailwind'], [ES]);
    expect(r.detected).toBe(true);
    expect(r.details).toContain('Tailwind');
  });
});

// ---------------------------------------------------------------------------
// Keyword detectors explain what they caught
// ---------------------------------------------------------------------------

describe('keyword detector details and verbatim excerpts', () => {
  it('detectKeywordsAtEnd (short lines) says how many lines and how big the gap was', () => {
    const r = detectKeywordsAtEnd(`${EN_DESC}\n\n\n\nkeyword1\nkeyword2\nkeyword3\nkeyword4\nkeyword5`);
    expect(r.detected).toBe(true);
    expect(r.details).toContain('5 short lines');
    expect(r.details).toContain('4-newline gap');
  });

  it('detectKeywordsAtEnd (comma list) says how many keywords', () => {
    const r = detectKeywordsAtEnd(`${EN_DESC}\n\n\nad blocker, adblock, popup blocker, vpn, proxy, privacy`);
    expect(r.detected).toBe(true);
    expect(r.details).toContain('6 keywords');
    expect(r.excerpt).toBe('ad blocker, adblock, popup blocker, vpn, proxy, privacy');
  });

  it('detectKeywordsInline (comma run) returns the offending line verbatim so it can be highlighted', () => {
    const line = 'features: ad blocker, popup blocker, tracker blocker, script blocker, cookie blocker';
    const r = detectKeywordsInline(`${EN_DESC}\n${line}`);
    expect(r.detected).toBe(true);
    expect(r.excerpt).toBe(line);
    expect(r.details).toContain('comma-separated short phrases');
    expect(r.details).toContain('in one line');
  });

  it('detectKeywordsInline (template) lists the repeated sentences one per line', () => {
    const base = 'Download videos from YouTube with the fastest downloader you can find here.';
    const text = [
      base,
      base.replace('YouTube', 'Facebook'),
      base.replace('YouTube', 'TikTok'),
      base.replace('YouTube', 'Vimeo'),
    ].join(' ');
    const r = detectKeywordsInline(text);
    expect(r.detected).toBe(true);
    expect(r.details).toContain('near-identical sentences');
    expect(r.excerpt!.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(r.excerpt).toContain('YouTube');
  });
});

describe('analyzeLocaleSet brand evidence', () => {
  const EN = 'Pinterest Pin Stats - Sort Pins';
  const baseline = { title: EN, shortDescription: 'See stats for any pin and sort a board by them.', fullDescription: EN_DESC };

  it('honest translations of a descriptive title are not flagged as a different name', () => {
    const flags = analyzeLocaleSet({
      baseline,
      locales: [
        { locale: 'en', title: EN, shortDescription: baseline.shortDescription, fullDescription: EN_DESC },
        { locale: 'es', title: 'Estadísticas de pines de Pinterest - Ordenar pines', shortDescription: 'Mira las estadísticas de cualquier pin y ordena un tablero por ellas.', fullDescription: ES_DESC },
        { locale: 'fr', title: 'Statistiques des épingles Pinterest - Trier les épingles', shortDescription: 'Voir les statistiques de chaque épingle et trier un tableau.', fullDescription: ES_DESC },
        { locale: 'ja', title: 'ピン統計 - ピンを並べ替え', shortDescription: 'ピンの統計を見てボードを並べ替えます。', fullDescription: JA_DESC },
      ],
      competitorNames: [],
    });
    expect(flags.get('es')!.differentName.detected).toBe(false);
    expect(flags.get('fr')!.differentName.detected).toBe(false);
    // ja dropped "Pinterest", which en/es/fr all kept.
    expect(flags.get('ja')!.differentName.detected).toBe(true);
    expect(flags.get('ja')!.differentName.details).toContain('Pinterest');
  });
});
