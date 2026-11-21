import { afterEach, describe, expect, it } from 'vitest';
import type { Passage } from '@ilm/shared';
import {
  LocalNeuralJudge,
  calibrateCrossEncoderLogit,
  corpusAddressedProbability,
} from '../src/services/local-judge';
import { ChainedJudge, resetJevJudge, setJevJudge } from '../src/services/typesafe-client';
import { classifySearchIntent, rerankForQuery } from '../src/services/typesafe';

function makePassage(key: string, translation: string): Passage {
  return {
    id: key,
    passageKey: key,
    textId: 'nt',
    book: 'matthew',
    chapter: 5,
    verse: 7,
    originalText: '',
    translation,
    alternativeTranslations: [],
    metadata: {
      language: 'english',
      writingSystem: 'Latin',
      canonicalOrder: 1,
      verseOrder: 1,
    },
    embeddings: [],
    themes: [],
    crossReferences: [],
  };
}

describe('LocalNeuralJudge (local ONNX cross-encoder chain)', () => {
  afterEach(() => {
    resetJevJudge();
  });

  it('calibrates logits and corpus silence verdict cleanly', () => {
    expect(calibrateCrossEncoderLogit(4.0)).toBeGreaterThan(0.85);
    expect(calibrateCrossEncoderLogit(0.0)).toBeCloseTo(0.5, 5);
    expect(calibrateCrossEncoderLogit(-6.0)).toBeLessThan(0.08);

    // Strong topical hit -> addressed
    expect(corpusAddressedProbability([0.92, 0.78, 0.65, 0.12])).toBeGreaterThan(0.6);
    // Out-of-domain hits -> unaddressed (< 0.3)
    expect(corpusAddressedProbability([0.11, 0.08, 0.05])).toBeLessThan(0.3);
  });

  it('reranks passages with source: "local" and distinguishes addressed vs unaddressed queries', async () => {
    const fakeScorer = async (pairs: Array<[string, string]>) =>
      pairs.map(([query, doc]) => {
        if (query.includes('quantum')) return -6.0;
        if (doc.toLowerCase().includes('forgive')) return 4.5;
        if (doc.toLowerCase().includes('mercy')) return 2.2;
        return -3.0;
      });

    const local = new LocalNeuralJudge({ enabled: true, scorer: fakeScorer });
    setJevJudge(new ChainedJudge([local]));

    const candidates = [
      makePassage('ot:genesis:5:1', 'This is the book of the generations of Adam.'),
      makePassage('nt:matthew:6:14', 'If you forgive others their trespasses, your heavenly Father will also forgive you.'),
      makePassage('nt:matthew:5:7', 'Blessed are the merciful, for they shall receive mercy.'),
    ];

    // Addressed query
    const addressed = await rerankForQuery('forgiving someone who wronged you', candidates);
    expect(addressed).not.toBeNull();
    expect(addressed!.source).toBe('local');
    expect(addressed!.verdict).toBe('addressed');
    expect(addressed!.order[0]).toBe('nt:matthew:6:14');
    expect(addressed!.order[1]).toBe('nt:matthew:5:7');

    // Out-of-domain query -> corpus silence verdict reports 'unaddressed'
    const silent = await rerankForQuery('quantum computing error correction', candidates);
    expect(silent).not.toBeNull();
    expect(silent!.source).toBe('local');
    expect(silent!.verdict).toBe('unaddressed');
    expect(silent!.silence).toBeGreaterThan(0.7);
  });

  it('answers choice questions (search intent) with source: "local" and falls back cleanly on error', async () => {
    const local = new LocalNeuralJudge({
      enabled: true,
      scorer: async (pairs) =>
        pairs.map(([, option]) => (option.startsWith('comparison:') ? 4.0 : -1.0)),
    });
    setJevJudge(new ChainedJudge([local]));

    const intent = await classifySearchIntent('compare forgiveness in Quran and Gospel');
    expect(intent.source).toBe('local');
    expect(intent.intent).toBe('comparison');
    expect(intent.confidence).toBeGreaterThan(0.5);

    // Failing local model degrades gracefully to deterministic 'derived'
    const failing = new LocalNeuralJudge({
      enabled: true,
      scorer: async () => {
        throw new Error('simulated ONNX offline error');
      },
    });
    setJevJudge(new ChainedJudge([failing]));

    const fallback = await classifySearchIntent('compare mercy across texts');
    expect(fallback.source).toBe('derived');
    expect(fallback.intent).toBe('comparison');
  });
});
