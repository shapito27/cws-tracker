/**
 * Autocomplete Parser v1 - Parses CWS search autocomplete (suggestion) responses.
 *
 * CWS autocomplete endpoint: batchexecute RPC with method QcU9bc
 *
 * Response data layout (after extracting from batchexecute envelope):
 *   data = array of up to 10 suggestions
 *
 * Two suggestion types:
 *   Extension suggestion: [<marker>, ["Extension Name", "extensionId", <num>, "iconUrl"]]
 *     where <marker> is typically null but may vary (CWS has used null, 0, etc.)
 *   Text suggestion:      [["Suggested search term"]]
 *
 * Detection strategy: extension entries are identified by the presence of a valid
 * 32-char lowercase extension ID in entry[1][1], NOT by the value of entry[0].
 * This makes the parser resilient to CWS changing the marker value.
 *
 * The proxy extracts the inner JSON from the batchexecute response and returns
 * it directly as the `data` field.
 */

import type {
  AutocompleteData,
  AutocompleteParser,
  AutocompleteSuggestion,
} from './types.js';
import { ParserError } from './types.js';

const VERSION = 'autocomplete-v1';
const EXTENSION_ID_RE = /^[a-z]{32}$/;

/**
 * Try to extract extension data from an entry's sub-array.
 * Returns the extension suggestion if a valid 32-char ID is found, null otherwise.
 */
function tryParseExtension(
  extData: unknown[],
  position: number
): AutocompleteSuggestion | null {
  const extensionId = typeof extData[1] === 'string' ? extData[1] : '';
  if (!extensionId || !EXTENSION_ID_RE.test(extensionId)) {
    return null;
  }

  const name = typeof extData[0] === 'string' ? extData[0] : '';
  const iconUrl = typeof extData[3] === 'string' ? extData[3] : '';

  return {
    type: 'extension',
    name,
    extensionId,
    iconUrl,
    position,
  };
}

/**
 * Try to parse a flat (unwrapped) suggestion array.
 * Returns the suggestion if recognized, null otherwise.
 */
function tryParseSuggestionFlat(
  arr: unknown[],
  position: number
): AutocompleteSuggestion | null {
  // Extension suggestion: [<marker>, ["Name", "extensionId", <num>, "iconUrl"]]
  if (arr.length >= 2 && Array.isArray(arr[1])) {
    const result = tryParseExtension(arr[1], position);
    if (result) return result;
  }

  // Text suggestion: [["Suggested search term"]]
  if (
    arr.length >= 1 &&
    Array.isArray(arr[0]) &&
    typeof arr[0][0] === 'string'
  ) {
    return {
      type: 'text',
      text: arr[0][0],
      position,
    };
  }

  return null;
}

/**
 * Parse a single suggestion entry from the autocomplete response.
 *
 * Handles both direct entries and entries wrapped in an extra single-element array
 * (CWS format change: [[null, [...]]] instead of [null, [...]]).
 *
 * Strategy: try parsing as-is first, then try unwrapping one level if that fails.
 */
function parseSuggestionEntry(
  entry: unknown,
  position: number
): AutocompleteSuggestion | null {
  if (!Array.isArray(entry)) return null;

  // Try parsing the entry directly (standard format)
  const direct = tryParseSuggestionFlat(entry, position);
  if (direct) return direct;

  // Try unwrapping one level: [[null, [...]]] → [null, [...]]
  if (entry.length === 1 && Array.isArray(entry[0])) {
    const unwrapped = tryParseSuggestionFlat(entry[0] as unknown[], position);
    if (unwrapped) return unwrapped;
  }

  // Unknown entry format — log for diagnostics
  if (typeof console !== 'undefined') {
    console.warn(
      `[${VERSION}] Unrecognized autocomplete entry at position ${position}:`,
      JSON.stringify(entry).slice(0, 200)
    );
  }

  return null;
}

export const autocompleteParserV1: AutocompleteParser = {
  version: VERSION,

  parse(json: string): AutocompleteData {
    if (!json || json.trim().length === 0) {
      throw new ParserError(
        'Empty autocomplete response',
        VERSION,
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(json);
    } catch {
      throw new ParserError(
        'Invalid JSON in autocomplete response',
        VERSION,
      );
    }

    if (!Array.isArray(data)) {
      throw new ParserError(
        'Autocomplete response is not an array',
        VERSION,
      );
    }

    // data is the top-level array of suggestions
    // It may be nested one level: [[suggestions...]]
    let entries: unknown[] = data;
    if (
      entries.length === 1 &&
      Array.isArray(entries[0]) &&
      Array.isArray(entries[0][0])
    ) {
      // Check if this is [[suggestion1, suggestion2, ...]] vs [suggestion1]
      // A single top-level array wrapping all suggestions
      entries = entries[0];
    }

    const raw: AutocompleteSuggestion[] = [];
    for (let i = 0; i < entries.length; i++) {
      const suggestion = parseSuggestionEntry(entries[i], i + 1);
      if (suggestion) {
        raw.push(suggestion);
      }
    }

    // CWS dropdown shows extensions first, then text suggestions.
    // Reorder to match visual display and reassign 1-based positions.
    const extensions = raw.filter((s) => s.type === 'extension');
    const textSuggestions = raw.filter((s) => s.type === 'text');
    const suggestions: AutocompleteSuggestion[] = [...extensions, ...textSuggestions];
    suggestions.forEach((s, idx) => {
      s.position = idx + 1;
    });

    return { suggestions };
  },
};
