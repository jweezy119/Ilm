/**
 * Text segmentation for alignment highlights.
 *
 * Pure string logic, no JSX, so it can be unit tested and reused outside React.
 */

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
  /** Id of the alignment this segment belongs to, when highlighted. */
  alignmentId?: string;
  /** Alignment type, e.g. `direct_quote`. */
  type?: string;
}

/**
 * Split `text` into alternating plain and highlighted runs, marking every
 * occurrence of each phrase. Longer phrases win, so a four-word match is not
 * broken up by a two-word match inside it.
 */
export function segmentByPhrases(
  text: string,
  phrases: Array<{ phrase: string; alignmentId?: string; type?: string }>,
  minLength = 4
): HighlightSegment[] {
  const usable = phrases
    .filter((p) => p.phrase.trim().length >= minLength)
    .sort((a, b) => b.phrase.length - a.phrase.length);

  if (usable.length === 0) return text ? [{ text, highlighted: false }] : [];

  // One pass, longest alternative first: the regex engine tries each alternative
  // in order at every position, so the first match is always the longest.
  const alternatives = usable.map((p) => escapeRegExp(p.phrase.trim())).join('|');
  const lookup = new Map(usable.map((p) => [p.phrase.trim().toLowerCase(), p]));

  const parts = text.split(new RegExp(`(${alternatives})`, 'gi'));

  const segments: HighlightSegment[] = [];
  for (const part of parts) {
    if (!part) continue;
    const match = lookup.get(part.trim().toLowerCase());
    if (match) {
      segments.push({ text: part, highlighted: true, alignmentId: match.alignmentId, type: match.type });
    } else {
      segments.push({ text: part, highlighted: false });
    }
  }

  return mergeAdjacent(segments);
}

/** Collapse neighbouring segments that share a highlight state. */
export function mergeAdjacent(segments: HighlightSegment[]): HighlightSegment[] {
  const merged: HighlightSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.highlighted === segment.highlighted && last.type === segment.type && last.alignmentId === segment.alignmentId) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

export interface SharedPhrase {
  /** Lowercased match key, for de-duplication. */
  phrase: string;
  /** The matched span as it appears in textA, at indexA. */
  textA: string;
  /** The matched span as it appears in textB, at indexB. */
  textB: string;
  indexA: number;
  indexB: number;
}

/**
 * Phrases appearing in both texts, as a windowed word match.
 *
 * Returns the longest distinct matches only, so a passage repeated does not
 * produce duplicate evidence. Matching is case-insensitive, so the same phrase
 * can differ in case between the two texts; `textA`/`textB` carry each text's own
 * rendering, while `phrase` stays lowercased as a stable key.
 */
export function sharedPhrases(textA: string, textB: string, minWords = 3, maxPhrases = 8): SharedPhrase[] {
  const lowerA = textA.toLowerCase();
  const lowerB = textB.toLowerCase();
  const wordsA = lowerA.split(/\s+/);

  const found = new Map<string, SharedPhrase>();

  for (let i = 0; i < wordsA.length - minWords + 1; i += 1) {
    for (let length = Math.min(8, wordsA.length - i); length >= minWords; length -= 1) {
      const phrase = wordsA.slice(i, i + length).join(' ');
      if (found.has(phrase)) continue;

      const indexA = lowerA.indexOf(phrase);
      if (indexA === -1) continue;
      const indexB = lowerB.indexOf(phrase);
      if (indexB === -1) continue;

      found.set(phrase, {
        phrase,
        textA: textA.slice(indexA, indexA + phrase.length),
        textB: textB.slice(indexB, indexB + phrase.length),
        indexA,
        indexB,
      });
      i += length - 1;
      break;
    }
  }

  return [...found.values()].sort((a, b) => b.phrase.length - a.phrase.length).slice(0, maxPhrases);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
