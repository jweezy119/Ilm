import { describe, expect, it } from 'vitest';
import type { ScoreSource } from '@ilm/shared';
import { ChainedJudge, type JevJudge, type JevQuestion, type JevVerdict } from '../src/services/typesafe-client';

function judge(opts: {
  id: ScoreSource;
  label?: string;
  available?: boolean;
  reason?: string;
  ask?: (state: unknown, questions: JevQuestion[]) => Promise<JevVerdict>;
  verifyFails?: boolean;
}): JevJudge {
  return {
    id: opts.id,
    label: opts.label ?? opts.id,
    available: opts.available ?? true,
    reason: opts.reason ?? 'configured',
    async ask(state, questions) {
      if (opts.ask) return opts.ask(state, questions);
      const answers: Record<string, never> = {};
      for (const q of questions) answers[q.id] = { value: 0.5, probabilities: {}, confidence: 0.9 } as never;
      return { answers, source: opts.id };
    },
    async verify() {
      if (opts.verifyFails) throw new Error('cannot verify');
      return { model: opts.id };
    },
  };
}

const question: JevQuestion = { kind: 'noul', id: 'q', instructions: 'does this match?' };

describe('ChainedJudge', () => {
  it('uses the first available engine and labels the answer as it', async () => {
    const chain = new ChainedJudge([judge({ id: 'jev' }), judge({ id: 'local' })]);
    const verdict = await chain.ask({}, [question]);
    expect(verdict.source).toBe('jev');
  });

  it('falls through to the next engine when the first is unavailable', async () => {
    const chain = new ChainedJudge([
      judge({ id: 'jev', available: false, reason: 'TYPESAFE_API_KEY is not set' }),
      judge({ id: 'local' }),
    ]);
    const verdict = await chain.ask({}, [question]);
    expect(verdict.source).toBe('local');
  });

  it('falls through when the first engine throws', async () => {
    const chain = new ChainedJudge([
      judge({
        id: 'jev',
        ask: async () => {
          throw new Error('402 no credits');
        },
      }),
      judge({ id: 'local' }),
    ]);
    const verdict = await chain.ask({}, [question]);
    expect(verdict.source).toBe('local');
  });

  it('falls through when the first engine answers nothing', async () => {
    // The dangerous case: an empty answer map is silence, not a verdict of "no".
    const chain = new ChainedJudge([judge({ id: 'jev', ask: async () => ({ answers: {}, source: 'jev' }) }), judge({ id: 'local' })]);
    const verdict = await chain.ask({}, [question]);
    expect(verdict.source).toBe('local');
  });

  it('throws only once every engine has failed, naming them all', async () => {
    const boom = async () => {
      throw new Error('down');
    };
    const chain = new ChainedJudge([judge({ id: 'jev', ask: boom }), judge({ id: 'local', ask: boom })]);

    await expect(chain.ask({}, [question])).rejects.toThrow(/Jev|jev/);
    await expect(chain.ask({}, [question])).rejects.toThrow(/local/);
  });

  it('reports available while any engine can run, and not at all when none can', () => {
    expect(new ChainedJudge([judge({ id: 'jev' })]).available).toBe(true);
    expect(new ChainedJudge([judge({ id: 'jev', available: false }), judge({ id: 'local', available: false })]).available).toBe(false);
  });

  it('explains every engine in its reason when none is available', () => {
    const chain = new ChainedJudge([
      judge({ id: 'jev', available: false, reason: 'no credits' }),
      judge({ id: 'local', available: false, reason: 'model missing' }),
    ]);
    expect(chain.reason).toContain('no credits');
    expect(chain.reason).toContain('model missing');
  });

  it('describes each engine for health output', () => {
    const described = new ChainedJudge([judge({ id: 'jev' }), judge({ id: 'local', available: false, reason: 'not installed' })]).describe();
    expect(described).toHaveLength(2);
    expect(described[1]).toMatchObject({ id: 'local', available: false, reason: 'not installed' });
  });

  it('verifies against the first engine that can be reached', async () => {
    const chain = new ChainedJudge([
      judge({ id: 'jev', verifyFails: true }),
      judge({ id: 'local' }),
    ]);
    expect((await chain.verify()).model).toBe('local');
  });
});
