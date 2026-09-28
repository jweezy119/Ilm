import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Passage, ScoreSource, TextId } from '@ilm/shared';
import { setJevJudge, resetJevJudge, type JevJudge, type JevQuestion } from '../src/services/typesafe-client';
import {
  blendSearchScore,
  expandQueryTheme,
  localQueryTheme,
  rerankForQuery,
  themeSearchTerms,
  type ScoreSource,
  computeAlignments,
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
  options: { available?: boolean; id?: ScoreSource; label?: string } = {}
): JevJudge & { calls: Array<{ state: unknown; questions: JevQuestion[] }> } {
  const calls: Array<{ state: unknown; questions: JevQuestion[] }> = [];

  const id = (options.id ?? 'jev') as ScoreSource;

  return {
    id,
    label: options.label ?? 'stub',
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
      // The verdict carries its own source, so a stub standing in for a local model
      // is reported as one.
      return { answers: out, source: id };
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
    // A Noul answers with the probability of its `true` outcome.
    setJevJudge(stubJudge((q) => ({ value: q.id === 'corpus' ? 0.95 : 0.8 })));
    const result = await rerankForQuery('mercy', candidates);
    expect(result?.verdict).toBe('addressed');
    expect(result?.source).toBe('jev');
  });

  it('reads the corpus noul as P(addressed), not as silence', async () => {
    setJevJudge(stubJudge((q) => ({ value: q.id === 'corpus' ? 0.95 : 0.8 })));
    const result = await rerankForQuery('mercy', candidates);
    expect(result?.silence).toBeCloseTo(0.05);
  });

  it('reports a partial match separately from a full one', async () => {
    setJevJudge(stubJudge((q) => ({ value: q.id === 'corpus' ? 0.5 : 0.5 })));
    const result = await rerankForQuery('something nearby', candidates);
    expect(result?.verdict).toBe('partial');
  });

  it('reports an unaddressed corpus, which is a real answer', async () => {
    setJevJudge(stubJudge((q) => ({ value: q.id === 'corpus' ? 0.03 : 0.1 })));
    const result = await rerankForQuery('reincarnation', candidates);
    expect(result?.verdict).toBe('unaddressed');
    expect(result?.silence).toBeCloseTo(0.97);
  });

  it('leaves the verdict undecided when the corpus question goes unanswered', async () => {
    setJevJudge(stubJudge((q) => (q.id === 'corpus' ? undefined : { value: 0.8 })));
    const result = await rerankForQuery('mercy', candidates);
    expect(result?.verdict).toBe('unknown');
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

describe('computeAlignments', () => {
  /** Eight passages, one per slot, as a full comparison would hold. */
  const many = (n: number): Passage[] =>
    Array.from({ length: n }, (_, i) =>
      passage({ id: `p${i}`, passageKey: `nt:John:${i + 1}:1`, translation: `The passage number ${i} speaks of mercy and light.` })
    );

  const pairsOf = (ps: Passage[]): Array<[Passage, Passage]> => {
    const pairs: Array<[Passage, Passage]> = [];
    for (let i = 0; i < ps.length; i += 1) for (let j = i + 1; j < ps.length; j += 1) pairs.push([ps[i], ps[j]]);
    return pairs;
  };

  it('asks every pair in one request, not one request per pair', async () => {
    const judge = stubJudge((q) => (q.id.endsWith('.type') ? { value: 0, choice: 'thematic_parallel' } : { value: 0.6 }));
    setJevJudge(judge);

    const pairs = pairsOf(many(8));
    expect(pairs).toHaveLength(28);

    await computeAlignments(pairs);

    // 28 pairs of 8 passages used to mean 28 HTTP requests.
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0].questions).toHaveLength(56);
  });

  it('carries each distinct passage once in the state', async () => {
    const judge = stubJudge((q) => (q.id.endsWith('.type') ? { value: 0, choice: 'theological_echo' } : { value: 0.5 }));
    setJevJudge(judge);

    await computeAlignments(pairsOf(many(4)));

    const state = judge.calls[0].state as { passages: unknown[] };
    expect(state.passages).toHaveLength(4);
  });

  it('returns results in the order it was given the pairs', async () => {
    setJevJudge(
      stubJudge((q) => {
        if (!q.id.endsWith('.type')) return { value: 0.5 };
        // Only the first pair is a quote; everything else is unrelated.
        return { value: 0, choice: q.id === 'p0.type' ? 'direct_quote' : 'none' };
      })
    );

    const result = await computeAlignments(pairsOf(many(3)));

    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('direct_quote');
    expect(result[1].type).toBe('none');
    expect(result.every((r) => r.source === 'jev')).toBe(true);
  });

  it('falls back per pair when the request fails, rather than dropping the comparison', async () => {
    setJevJudge({
      available: true,
      reason: 'stub',
      async ask() {
        throw new Error('network down');
      },
      async verify() {
        return { model: 'stub' };
      },
    });

    const result = await computeAlignments(pairsOf(many(3)));

    expect(result).toHaveLength(3);
    expect(result.every((r) => r.source === 'derived')).toBe(true);
  });

  it('falls back per pair when the model omits that pair', async () => {
    // Answers only the first pair; the other two come back undefined.
    setJevJudge(stubJudge((q) => (q.id.startsWith('p0.') ? { value: 0.7, choice: 'narrative_parallel' } : undefined)));

    const result = await computeAlignments(pairsOf(many(3)));

    expect(result[0].source).toBe('jev');
    expect(result[1].source).toBe('derived');
    expect(result[2].source).toBe('derived');
  });

  it('does not call the model at all when it is unavailable', async () => {
    const judge = stubJudge(() => undefined, { available: false });
    setJevJudge(judge);

    const result = await computeAlignments(pairsOf(many(4)));

    expect(judge.calls).toHaveLength(0);
    expect(result.every((r) => r.source === 'derived')).toBe(true);
  });

  it('handles an empty pair list without calling the model', async () => {
    const judge = stubJudge(() => undefined);
    setJevJudge(judge);

    expect(await computeAlignments([])).toEqual([]);
    expect(judge.calls).toHaveLength(0);
  });
});
