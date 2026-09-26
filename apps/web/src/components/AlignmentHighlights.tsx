'use client';

import { Alignment } from '@ilm/shared';
import { HighlightSegment, findCommonSubstrings } from '@/lib/highlighter';

interface AlignmentHighlightsProps {
  alignments: Alignment[];
  passageId: string;
  text: string;
  type: 'original' | 'translation';
}

export function AlignmentHighlights({ alignments, passageId, text, type }: AlignmentHighlightsProps) {
  // Filter alignments for this passage
  const relevantAlignments = alignments.filter(
    a => a.passageAId === passageId || a.passageBId === passageId
  );
  
  if (!relevantAlignments.length) return null;
  
  // Compute highlights for this text
  const highlights = computeTextHighlights(text, relevantAlignments, passageId);
  
  return (
    <span className="alignment-highlights">
      {highlights.map((segment, i) => (
        segment.highlighted ? (
          <mark
            key={i}
            className="relative bg-yellow-200 dark:bg-yellow-800 px-0.5 rounded"
            data-alignment-id={segment.alignmentId}
            data-type={segment.type}
          >
            {segment.text}
            <span className="absolute -top-6 left-0 text-xs bg-ilm-900 text-white px-1 rounded opacity-0 hover:opacity-100 transition-opacity whitespace-nowrap">
              {segment.type}
            </span>
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        )
      ))}
    </span>
  );
}

function computeTextHighlights(
  text: string,
  alignments: Alignment[],
  passageId: string
): HighlightSegment[] {
  // Collect all matched segments for this passage
  const matchedSegments = alignments.flatMap(a => {
    const isSource = a.passageAId === passageId;
    return a.matchedSegments.map(s => ({
      text: isSource ? s.textA : s.textB,
      alignmentId: `${a.passageAId}-${a.passageBId}`,
      type: a.type,
    }));
  });
  
  if (!matchedSegments.length) return [{ text, highlighted: false }];
  
  // Create a map of matched text to alignment info
  const matchMap = new Map<string, { alignmentId: string; type: string }>();
  for (const seg of matchedSegments) {
    if (seg.text.trim().length >= 5) { // Only highlight meaningful matches
      matchMap.set(seg.text.toLowerCase(), { alignmentId: seg.alignmentId, type: seg.type });
    }
  }
  
  // Simple highlighting: wrap matched phrases
  const segments: HighlightSegment[] = [];
  let remaining = text;
  
  // Sort matches by length (longest first)
  const sortedMatches = Array.from(matchMap.keys()).sort((a, b) => b.length - a.length);
  
  for (const match of sortedMatches) {
    const regex = new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let lastIndex = 0;
    let matchResult;
    
    while ((matchResult = regex.exec(remaining)) !== null) {
      const start = matchResult.index;
      const end = start + matchResult[0].length;
      
      if (start > lastIndex) {
        segments.push({ text: remaining.slice(lastIndex, start), highlighted: false });
      }
      segments.push({ 
        text: remaining.slice(start, end), 
        highlighted: true, 
        alignmentId: matchMap.get(match)!.alignmentId,
        type: matchMap.get(match)!.type,
      });
      lastIndex = end;
    }
    
    if (lastIndex < remaining.length) {
      segments.push({ text: remaining.slice(lastIndex), highlighted: false });
    }
  }
  
  // Merge adjacent segments with same highlight state
  const merged: HighlightSegment[] = [];
  for (const seg of segments) {
    if (merged.length && merged[merged.length - 1].highlighted === seg.highlighted) {
      merged[merged.length - 1].text += seg.text;
    } else {
      merged.push(seg);
    }
  }
  
  return merged.length ? merged : [{ text, highlighted: false }];
}