'use client';

/**
 * Highlighter utility for rendering text with alignment highlights
 */

export interface HighlightSegment {
  text: string;
  highlighted: boolean;
  alignmentId?: string;
  type?: string;
}

export function computeHighlights(
  text: string,
  alignments: Array<{ matchedSegments: Array<{ textA: string; textB: string }> }>
): HighlightSegment[] {
  if (!alignments.length) return [{ text, highlighted: false }];
  
  // Collect all matched segments
  const segments = alignments.flatMap(a => a.matchedSegments);
  const matchedTexts = new Set(segments.map(s => s.textA).concat(segments.map(s => s.textB)));
  
  if (!matchedTexts.size) return [{ text, highlighted: false }];
  
  // Simple approach: find all occurrences of matched texts
  const highlights: HighlightSegment[] = [];
  let remainingText = text;
  
  // Sort matched texts by length (longest first) to avoid partial overlaps
  const sortedMatches = Array.from(matchedTexts).sort((a, b) => b.length - a.length);
  
  for (const match of sortedMatches) {
    const regex = new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let matchResult;
    
    while ((matchResult = regex.exec(remainingText)) !== null) {
      // Found a match - would need more sophisticated logic for production
    }
  }
  
  // For now, return simple highlighting
  return [{ text, highlighted: false }];
}

export function renderHighlightedText(
  text: string,
  highlights: HighlightSegment[]
): React.ReactNode {
  return (
    <span>
      {highlights.map((segment, i) => (
        segment.highlighted ? (
          <mark
            key={i}
            className="bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded"
            data-alignment-id={segment.alignmentId}
            data-type={segment.type}
          >
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      ))}
    </span>
  );
}

/**
 * Advanced highlighter using diff algorithm
 */
export function diffHighlight(original: string, modified: string): HighlightSegment[] {
  // Simplified diff - in production use a proper diff library like 'diff'
  const originalWords = original.split(/(\s+)/);
  const modifiedWords = modified.split(/(\s+)/);
  
  const segments: HighlightSegment[] = [];
  let i = 0, j = 0;
  
  while (i < originalWords.length || j < modifiedWords.length) {
    if (i < originalWords.length && j < modifiedWords.length && originalWords[i] === modifiedWords[j]) {
      segments.push({ text: originalWords[i], highlighted: false });
      i++; j++;
    } else if (j < modifiedWords.length && (i >= originalWords.length || !originalWords.slice(i).includes(modifiedWords[j]))) {
      segments.push({ text: modifiedWords[j], highlighted: true, type: 'added' });
      j++;
    } else {
      segments.push({ text: originalWords[i], highlighted: true, type: 'removed' });
      i++;
    }
  }
  
  return segments;
}

/**
 * Find common substrings between two texts (for alignment visualization)
 */
export function findCommonSubstrings(textA: string, textB: string, minLength = 10): Array<{ text: string; indexA: number; indexB: number }> {
  const results: Array<{ text: string; indexA: number; indexB: number }> = [];
  const wordsA = textA.toLowerCase().split(/\s+/);
  const wordsB = textB.toLowerCase().split(/\s+/);
  
  // Find common phrases of 3+ words
  for (let i = 0; i < wordsA.length - 2; i++) {
    for (let len = 3; len <= 8 && i + len <= wordsA.length; len++) {
      const phrase = wordsA.slice(i, i + len).join(' ');
      const indexB = textB.toLowerCase().indexOf(phrase);
      
      if (indexB !== -1) {
        const indexA = textA.toLowerCase().indexOf(phrase);
        if (indexA !== -1) {
          results.push({ text: phrase, indexA, indexB });
        }
      }
    }
  }
  
  // Remove duplicates and sort by length
  const unique = new Map<string, { text: string; indexA: number; indexB: number }>();
  for (const r of results) {
    if (!unique.has(r.text) || unique.get(r.text)!.text.length < r.text.length) {
      unique.set(r.text, r);
    }
  }
  
  return Array.from(unique.values()).sort((a, b) => b.text.length - a.text.length);
}