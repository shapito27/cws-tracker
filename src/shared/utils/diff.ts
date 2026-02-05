/**
 * Word-level text diff utilities (Phase 2.5).
 *
 * Provides a word-level diff algorithm that splits text into segments
 * marked as 'equal', 'added', or 'removed'. Used in event detail
 * expansion to show what changed between consecutive listing snapshots.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A segment of a text diff result. */
export interface DiffSegment {
  type: 'equal' | 'added' | 'removed';
  text: string;
}

// ---------------------------------------------------------------------------
// Internal: Myers-like LCS for word-level diff
// ---------------------------------------------------------------------------

/**
 * Tokenize text into words preserving whitespace.
 *
 * Returns an array of tokens where each token is either a word or whitespace.
 * This allows reconstructing the original text exactly from the tokens.
 */
function tokenize(text: string): string[] {
  if (text.length === 0) return [];
  // Split on word boundaries, keeping whitespace as separate tokens
  return text.match(/\S+|\s+/g) ?? [];
}

/**
 * Compute the longest common subsequence table for two token arrays.
 *
 * Returns a 2D table where lcs[i][j] is the LCS length of
 * tokens1[0..i-1] and tokens2[0..j-1].
 */
function lcsTable(tokens1: string[], tokens2: string[]): number[][] {
  const m = tokens1.length;
  const n = tokens2.length;
  const table: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (tokens1[i - 1] === tokens2[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

/**
 * Backtrack through the LCS table to produce diff segments.
 */
function backtrack(
  table: number[][],
  tokens1: string[],
  tokens2: string[],
  i: number,
  j: number
): DiffSegment[] {
  const segments: DiffSegment[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tokens1[i - 1] === tokens2[j - 1]) {
      segments.push({ type: 'equal', text: tokens1[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      segments.push({ type: 'added', text: tokens2[j - 1] });
      j--;
    } else {
      segments.push({ type: 'removed', text: tokens1[i - 1] });
      i--;
    }
  }

  segments.reverse();
  return segments;
}

/**
 * Merge consecutive segments of the same type into single segments.
 */
function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  if (segments.length === 0) return [];

  const merged: DiffSegment[] = [{ ...segments[0] }];

  for (let i = 1; i < segments.length; i++) {
    const last = merged[merged.length - 1];
    if (segments[i].type === last.type) {
      last.text += segments[i].text;
    } else {
      merged.push({ ...segments[i] });
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a word-level diff between two strings.
 *
 * Returns an array of `DiffSegment` objects, each with a type:
 * - `'equal'`: text present in both old and new
 * - `'removed'`: text present in old but not in new
 * - `'added'`: text present in new but not in old
 *
 * Consecutive segments of the same type are merged. The segments
 * preserve whitespace so that concatenating all segment texts
 * reconstructs the original texts (removed + equal = old, added + equal = new).
 *
 * @param oldText - The original text
 * @param newText - The modified text
 * @returns Array of diff segments
 */
export function computeTextDiff(
  oldText: string,
  newText: string
): DiffSegment[] {
  // Handle edge cases
  if (oldText === newText) {
    return oldText.length > 0 ? [{ type: 'equal', text: oldText }] : [];
  }

  if (oldText.length === 0) {
    return [{ type: 'added', text: newText }];
  }

  if (newText.length === 0) {
    return [{ type: 'removed', text: oldText }];
  }

  const tokens1 = tokenize(oldText);
  const tokens2 = tokenize(newText);

  const table = lcsTable(tokens1, tokens2);
  const raw = backtrack(table, tokens1, tokens2, tokens1.length, tokens2.length);

  return mergeSegments(raw);
}
