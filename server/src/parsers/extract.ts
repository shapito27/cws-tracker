/**
 * Low-level extraction of AF_initDataCallback data from CWS HTML responses.
 * Both listing and search parsers depend on this module.
 */

import { ParserError } from './types.js';

/**
 * Extract the JSON data payload from an AF_initDataCallback call in CWS HTML.
 *
 * CWS embeds data in script tags like:
 *   AF_initDataCallback({key: 'ds:0', hash: '2', data:[...]});
 *
 * @param html - Full HTML response from CWS
 * @param key - The data key to extract (e.g., 'ds:0', 'ds:1')
 * @param parserVersion - Parser version string for error messages
 * @returns Parsed JSON data array, or null if the key is not found
 */
export function extractCallbackData(
  html: string,
  key: string,
  parserVersion: string,
): unknown[] | null {
  // Match the start of the callback for the given key
  const pattern = `AF_initDataCallback({key: '${key}',`;
  const startIdx = html.indexOf(pattern);
  if (startIdx === -1) return null;

  // Find 'data:' within this callback
  const dataMarker = 'data:';
  const dataStart = html.indexOf(dataMarker, startIdx);
  if (dataStart === -1 || dataStart - startIdx > 200) {
    return null;
  }

  const jsonStart = dataStart + dataMarker.length;

  // Find the matching closing bracket using bracket counting
  // Must handle strings (with escapes) to avoid counting brackets inside strings
  let depth = 0;
  let i = jsonStart;
  let inString = false;
  let escape = false;

  for (; i < html.length; i++) {
    const ch = html[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\') {
      if (inString) escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }

  if (depth !== 0) {
    throw new ParserError(
      `Unbalanced brackets parsing ${key} data`,
      parserVersion,
    );
  }

  const jsonStr = html.substring(jsonStart, i);

  try {
    const data = JSON.parse(jsonStr);
    if (!Array.isArray(data)) {
      throw new ParserError(
        `Expected array for ${key} data, got ${typeof data}`,
        parserVersion,
      );
    }
    return data;
  } catch (e) {
    if (e instanceof ParserError) throw e;
    throw new ParserError(
      `Failed to parse ${key} JSON: ${(e as Error).message}`,
      parserVersion,
    );
  }
}

/**
 * Safely access a deeply nested array value.
 * Returns undefined if any level is null/undefined or not an array.
 */
export function safeGet(data: unknown, ...path: number[]): unknown {
  let current: unknown = data;
  for (const idx of path) {
    if (!Array.isArray(current) || idx >= current.length) {
      return undefined;
    }
    current = current[idx];
  }
  return current;
}
