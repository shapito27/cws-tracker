/**
 * Autocomplete Parser v1 - Parses CWS search autocomplete (suggestion) responses.
 *
 * CWS autocomplete endpoint: batchexecute RPC with method QcU9bc
 *
 * Response data layout (after extracting from batchexecute envelope):
 *   data = array of up to 10 suggestions
 *
 * Two suggestion types:
 *   Extension suggestion: [null, ["Extension Name", "extensionId", 1, "iconUrl"]]
 *   Text suggestion:      [["Suggested search term"]]
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

/**
 * Parse a single suggestion entry from the autocomplete response.
 */
function parseSuggestionEntry(
  entry: unknown,
  position: number
): AutocompleteSuggestion | null {
  if (!Array.isArray(entry)) return null;

  // Extension suggestion: [null, ["Name", "extensionId", 1, "iconUrl"]]
  if (entry.length >= 2 && entry[0] === null && Array.isArray(entry[1])) {
    const extData = entry[1];
    const name = typeof extData[0] === 'string' ? extData[0] : '';
    const extensionId = typeof extData[1] === 'string' ? extData[1] : '';
    const iconUrl = typeof extData[3] === 'string' ? extData[3] : '';

    if (!extensionId || !/^[a-z]{32}$/.test(extensionId)) {
      return null;
    }

    return {
      type: 'extension',
      name,
      extensionId,
      iconUrl,
      position,
    };
  }

  // Text suggestion: [["Suggested search term"]]
  if (
    entry.length >= 1 &&
    Array.isArray(entry[0]) &&
    typeof entry[0][0] === 'string'
  ) {
    return {
      type: 'text',
      text: entry[0][0],
      position,
    };
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

    const suggestions: AutocompleteSuggestion[] = [];
    for (let i = 0; i < entries.length; i++) {
      const suggestion = parseSuggestionEntry(entries[i], i + 1);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    return { suggestions };
  },
};
