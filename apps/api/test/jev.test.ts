import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Passage, TextId } from '@ilm/shared';
import { setJevJudge, resetJevJudge, type JevJudge, type JevQuestion } from '../src/services/typesafe-client';
import {
  blendSearchScore,
  expandQueryTheme,
  localQueryTheme,
  rerankForQuery,
  themeSearchTerms,
  type ScoreSource,
} from '../src/services/typesafe';

function passage(over: Partial<Passage> = {}): Passage {
  return {
    id: 'p1',
    passageKey: 'quran:1:1:1',
    textId: 'quran',
    book: '1',
    chapter: 1,
    verse: 1,
    originalText: '',
    translation: 'In the name of Allah, the Entirely Merciful',
    alternativeTranslations: [],
    metadata: { language: 'arabic', writingSystem: 'Arabic', canonicalOrder: 1, verseOrder: 1 },
    embeddings: [],
    themes: [],
    crossReferences: [],
    ...over,
  };
}

/** Records every question it is asked, and answers from a caller-supplied map. */
function stubJudge(
  answer: (question: JevQuestion) => { value: number; probabilities?: Record<string, number>; confidence?: number; choice?: string } | undefined,
  options: { available?: boolean } = {}
): JevJudge & { calls: Array<{ state: unknown; questions: JevQuestion[] }> } {
  const calls: Array<{ state: unknown; questions: JevQuestion[] }> = [];

  return {
    available: options.available ?? true,
    reason: 'stub',
    calls,
    async ask(state, questions) {
      calls.push({ state, questions });

      const out: Record<string, { value: number; probabilities: Record<string, number>; confidence: number; choice?: string }> = {};
      for (const q of questions) {
        const result = answer(q);
        if (result) {
          out[q.id] = {
            value: result.value,
            probabilities: result.probabilities ?? {},
            confidence: result.confidence ?? 0.8,
            choice: result.choice,
          };
        }
      }
      return out;
    },
    async verify() {
      return { model: 'stub' };
    },
  };
}

beforeEach(() => {
  resetJevJudge();
});

afterEach(() => {
  resetJevJudge();
});

describe('rerankForQuery', () => {
  const candidates = [
    passage({ id: 'a', passageKey: 'quran:2:1:255', translation: 'Allah, there is no deity except Him' }),
    passage({ id: 'b', passageKey: 'ot:John:3:16', textId: 'nt', book: 'John', translation: 'For God so loved the world' }),
    passage({ id: 'c', passageKey: 'nt:John:1:1', textId: 'nt', book: 'John', verse: 1, translation: 'In the beginning was the Word' }),
  ];

  it('returns null when Jev is unavailable, so callers keep full-text order', async () => {
    setJevJudge(stubJudge(() => undefined, { available: false }));
    expect(await rerankForQuery('mercy', candidates)).toBeNull();
  });

  it('returns null for an empty shortlist without calling the model', async () => {
    const judge = stubJudge(() => ({ value: 1 }));
    setJevJudge(judge);
    expect(await rerankForQuery('mercy', [])).toBeNull();
    expect(judge.calls).toHaveLength(0);
  });

  it('batches every candidate and the corpus check into a single request', async () => {
    const judge = stubJudge((q) => (q.id === 'corpus' ? { value: 0 } : { value: 0.5 }));
    setJevJudge(judge);

    await rerankForQuery('mercy', candidates);

    expect(judge.calls).toHaveLength(1);
    // One noul per candidate, plus the corpus-level noul.
    expect(judge.calls[0].questions).toHaveLength(candidates.length + 1);
    expect(judge.calls[0].questions.filter((q) => q.kind === 'noul')).toHaveLength(candidates.length + 1);
  });

  it('orders candidates by relevance, not by input order', async () => {
    // c is the best match even though it arrived last.
    setJevJudge(
      stubJudge((q) => {
        if (q.id === 'corpus') return { value: 0.05 };
        const scores: Record<string, number> = { r0: 0.2, r1: 0.3, r2: 0.95 };
        return { value: scores[q.id] ?? 0 };
      })
    );

    const result = await rerankForQuery('the word', candidates);
    expect(result?.order).toEqual(['nt:John:1:1', 'ot:John:3:16', 'quran:2:1:255']);
  });

  it('reports a corpus that addresses the query', async () => {
    setJevJudge(stubJudge((q) => ({ value: q.id === 'corpus' ? 0.05 : 0.8 })));
    const result = await rerankForQuery('mercy', candidates);
    expect(result?.verdict).toBe('addressed');
    expect(result?.source).toBe('jev');
  });

  it('reports a partial match separately from a full one', async () => {
    setJevJudge(stubJudge((q) => ({ value: q.id === 'corpus' ? 0.5 : 0.5 })));
    const result = await rerankForQuery('something nearby', candidates);
    expect(result?.verdict).toBe('partial');
  });

  it('reports an unaddressed corpus, which is a real answer', async () => {
    setJevJudge(stubJudge((q) => ({ value: q.id === 'corpus' ? 0.97 : 0.1 })));
    const result = await rerankForQuery('reincarnation', candidates);
    expect(result?.verdict).toBe('unaddressed');
    expect(result?.silence).toBeCloseTo(0.97);
  });

  it('keeps relevance within 0-1 even if the model overshoots', async () => {
    setJevJudge(stubJudge((q) => ({ value: q.id === 'corpus' ? 0 : 4.2 })));
    const result = await rerankForQuery('mercy', candidates);
    for (const score of Object.values(result!.relevance)) {
      expect(score).toBeLessThanOrEqual(1);
      expect(score).toBeGreaterThanOrEqual(0);
    }
  });

  it('degrades to null when the request throws', async () => {
    setJevJudge({
      available: true,
      reason: 'stub',
      async ask() {
        throw new Error('429 rate limited');
      },
      async verify() {
        return { model: 'stub' };
      },
    });
    expect(await rerankForQuery('mercy', candidates)).toBeNull();
  });
});

describe('blendSearchScore', () => {
  it('follows the semantic score closely by default', () => {
    expect(blendSearchScore(1, 0)).toBeCloseTo(0.75);
  });

  it('keeps a literal match reachable', () => {
    // A passage that literally contains the query should not fall to the bottom
    // just because Jev scored it slightly lower.
    const exact = blendSearchScore(0.4, 1);
    const unrelated = blendSearchScore(0.9, 0.1);
    expect(exact).toBeGreaterThan(0.4);
    expect(unrelated).toBeGreaterThan(exact * 0.6);
  });

  it('stays within 0-1', () => {
    expect(blendSearchScore(1, 1)).toBeLessThanOrEqual(1);
    expect(blendSearchScore(0, 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('query expansion', () => {
  it('recognises a theme from keywords when Jev is unavailable', () => {
    setJevJudge(stubJudge(() => undefined, { available: false }));
    expect(localQueryTheme('passages about divine forgiveness').theme).toBe('forgiveness');
  });

  it('returns no theme for a bare reference rather than inventing one', () => {
    expect(localQueryTheme('john 3:16').theme).toBeNull();
  });

  it('asks Jev to choose from the taxonomy, with a none option', async () => {
    const judge = stubJudge((q) => (q.id === 'theme' ? { value: 1, choice: 'covenant', confidence: 0.9 } : undefined));
    setJevJudge(judge);

    const result = await expandQueryTheme('what does the binding promise mean?');

    expect(result.theme).toBe('covenant');
    expect(result.source).toBe('jev');

    const question = judge.calls[0].questions[0];
    expect(question.kind).toBe('choice');
    if (question.kind === 'choice') {
      expect(question.criteria).toHaveProperty('none');
      expect(question.criteria).toHaveProperty('covenant');
    }
  });

  it('falls back to the local guess when Jev picks none', async () => {
    setJevJudge(stubJudge((q) => (q.id === 'theme' ? { value: 1, choice: 'none' } : undefined)));
    const result = await expandQueryTheme('forgiveness of God');
    expect(result.theme).toBe('forgiveness');
    expect(result.source).toBe('derived');
  });

  it('produces usable search terms for a theme', () => {
    const terms = themeSearchTerms('mercy');
    expect(terms).toContain('mercy');
    expect(terms.every((t) => t.length > 3)).toBe(true);
  });
});

describe('ScoreSource labelling', () => {
  it('always reports a provenance for a judged result', () => {
    const sources: ScoreSource[] = ['jev', 'derived'];
    expect(sources).toHaveLength(2);
  });
});
