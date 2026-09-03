/**
 * CWS store locales offered for translation audits, with display names.
 *
 * The first 15 are the PRD 5.3.6 defaults (see DEFAULT_SETTINGS.translationLocales);
 * the rest are additional store locales a user may add in Settings.
 */

export interface LocaleOption {
  /** CWS `hl=` code, e.g. "pt_BR". */
  code: string;
  /** English display name. */
  name: string;
}

export const AUDIT_LOCALE_OPTIONS: readonly LocaleOption[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt_BR', name: 'Portuguese (Brazil)' },
  { code: 'ja', name: 'Japanese' },
  { code: 'zh_CN', name: 'Chinese (Simplified)' },
  { code: 'ko', name: 'Korean' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'it', name: 'Italian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
];

/** Display name for a locale code; the code itself when unknown. */
export function localeName(code: string): string {
  return AUDIT_LOCALE_OPTIONS.find((o) => o.code === code)?.name ?? code;
}
