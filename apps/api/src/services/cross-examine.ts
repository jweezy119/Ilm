import {
  Passage,
  SearchQuery,
  TextId,
  CorpusVerdict,
  CrossExaminationResponse,
  TextIdSchema
} from '@ilm/shared';
import { runFullText } from './search';
import { askJev, clamp01, verdictFromSilence, passageView } from './typesafe';
import type { JevQuestion } from './typesafe-client';
import { getPassagesByKeys } from './passage';

const TEXT_IDS = TextIdSchema.options;
const RERANK_LIMIT = 5;

export async function crossExamine(query: string): Promise<CrossExaminationResponse> {
  const candidatesByCorpus: Partial<Record<TextId, Passage[]>> = {};
  const orderByCorpus: Partial<Record<TextId, string[]>> = {};

  // 1. Fetch top candidates per corpus in parallel
  await Promise.all(
    TEXT_IDS.map(async (textId) => {
      const searchQuery: SearchQuery = {
        query,
        limit: RERANK_LIMIT,
        offset: 0,
        includeScores: false,
        semantic: false,
        expand: false,
        filters: { texts: [textId] },
      };
      const result = await runFullText(query, searchQuery);
      const keys = result.hits.slice(0, RERANK_LIMIT).map(h => h.document.passageKey);
      const passages = await getPassagesByKeys(keys);
      // Preserve order
      candidatesByCorpus[textId] = keys.map(k => passages.find(p => p.passageKey === k)).filter(Boolean) as Passage[];
      orderByCorpus[textId] = candidatesByCorpus[textId].map(p => p.passageKey);
    })
  );

  // 2. Construct batched Jev questions
  const questions: JevQuestion[] = [];
  const candidatesDocs: Record<string, ReturnType<typeof passageView>> = {};

  for (const textId of TEXT_IDS) {
    const candidates = candidatesByCorpus[textId] || [];
    if (candidates.length === 0) continue;

    const docs = candidates.map(passageView);
    
    // Add corpus-level question
    questions.push({
      kind: 'noul',
      id: `corpus_${textId}`,
      instructions: {
        question: `Taking these passages from the ${textId} together, do they address what the reader is looking for: "${query}"?`,
        search: query,
        passages: docs,
      },
      criteria: {
        true: 'At least one passage makes the reader\'s point, or clearly touches on it',
        false: 'The passages are on a different subject, and a reader would be better served elsewhere',
      },
    });

    // Add per-passage questions
    candidates.forEach((candidate, i) => {
      const qId = `r_${textId}_${i}`;
      candidatesDocs[qId] = docs[i];
      questions.push({
        kind: 'noul',
        id: qId,
        instructions: {
          question: 'Does this passage speak to what the reader is looking for, even where it uses entirely different words?',
          search: query,
          candidate: docs[i],
        },
        criteria: {
          true: "The passage addresses the reader's interest in its own words",
          false: 'The passage is on an unrelated topic, or merely shares generic religious vocabulary with the query',
        },
      });
    });
  }

  const resultsByCorpus: Partial<CrossExaminationResponse['resultsByCorpus']> = {};

  // 3. Single Jev batch call
  let source: CrossExaminationResponse['source'] = 'derived';
  if (questions.length > 0) {
    // Send empty state since candidate state is passed in each instruction
    const result = await askJev({ search: query }, questions);
    if (result) {
      source = result.source;
      
      for (const textId of TEXT_IDS) {
        const candidates = candidatesByCorpus[textId] || [];
        if (candidates.length === 0) continue;
        
        const relevance: Record<string, number> = {};
        candidates.forEach((candidate: any, i: number) => {
          relevance[candidate.passageKey] = clamp01(result.answers[`r_${textId}_${i}`]?.value ?? 0);
        });

        const corpusScore = result.answers[`corpus_${textId}`]?.value;
        const verdict = corpusScore === undefined ? 'unknown' : verdictFromSilence(clamp01(1 - corpusScore));

        resultsByCorpus[textId] = {
          verdict,
          passages: candidates.map((p: any) => ({
            passage: p,
            score: relevance[p.passageKey],
            matchedFields: [],
            highlights: {},
            widenedVia: undefined,
            matchMode: 'exact'
          })).sort((a: any, b: any) => b.score - a.score)
        };
      }
    }
  }

  return {
    query,
    resultsByCorpus: resultsByCorpus as CrossExaminationResponse['resultsByCorpus'],
    source
  };
}
