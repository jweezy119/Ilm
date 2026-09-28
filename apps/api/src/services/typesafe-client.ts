/**
 * TypeSafe / Jev client
 *
 * Wraps the official `@typesafe-ai/sdk` so the rest of the app can ask many
 * independent questions in ONE round trip (fan-out) and consume typed answers.
 *
 * When TYPESAFE_API_KEY is absent the client reports itself as unavailable and
 * callers fall back to deterministic local scoring, so the app stays functional
 * without credentials.
 */

import { TypeSafeClient, choice, noul, score } from '@typesafe-ai/sdk';
import type { ChoiceCriteria, EntryType, Questions, ScoreCriteria } from '@typesafe-ai/sdk';
import type { ScoreSource } from '@ilm/shared';
import { judgeBudget, recordJudgeUsage, reserveJudgeCall } from './judge-budget';

export type { ChoiceCriteria, EntryType, Questions, ScoreCriteria };
export { judgeBudget };

export interface JevAnswer {
  /** Probability-weighted 0-1 value for score/noul questions. */
  value: number;
  /** 0-1 distribution across score levels or choice options. */
  probabilities: Record<string, number>;
  confidence: number;
  /** Selected option id, for choice questions only. */
  choice?: string;
}

/** One engine's reply, tagged with which engine produced it. */
export interface JevVerdict {
  answers: Record<string, JevAnswer>;
  /**
   * Which engine answered. Carried on the reply rather than inferred by the caller,
   * so a fallback that fires mid-request is still labelled honestly.
   */
  source: ScoreSource;
}

/** A question in the shape the rest of the app uses. */
export type JevQuestion =
  | { kind: 'score'; id: string; instructions: EntryType; criteria: string[] }
  | { kind: 'choice'; id: string; instructions: EntryType; criteria: ChoiceCriteria }
  | { kind: 'noul'; id: string; instructions: EntryType; criteria?: { true?: EntryType; false?: EntryType } };

export interface JevJudge {
  /** Stable id, and the value reported as `source` when this engine answers. */
  readonly id: ScoreSource;
  /** Human-readable name, for /health and the settings page. */
  readonly label: string;
  /** Ask every question against the same state in a single request. */
  ask(state: EntryType, questions: JevQuestion[]): Promise<JevVerdict>;
  /** False when this engine cannot run; the chain moves to the next one. */
  readonly available: boolean;
  /** Why this engine is unavailable, for surfacing in health output. */
  readonly reason: string;
  /** Ping the models endpoint. Throws when the key is missing or rejected. */
  verify(): Promise<{ model: string }>;
}

class UnavailableJudge implements JevJudge {
  readonly available = false;
  readonly reason: string;
  readonly id: ScoreSource = 'derived';
  readonly label = 'none';

  constructor(reason: string) {
    this.reason = reason;
  }

  async ask(): Promise<JevVerdict> {
    throw new Error(`No judge available: ${this.reason}`);
  }

  async verify(): Promise<{ model: string }> {
    throw new Error(`No judge available: ${this.reason}`);
  }
}

/**
 * Tries each engine in order until one answers.
 *
 * The engines are independent, so a hosted model that is out of credit, rate
 * limited or simply down should not cost the reader the feature: the next engine
 * answers the same batch of questions. The chain is what makes "a local model as a
 * fallback" a configuration choice rather than a refactor — a new engine is one
 * entry in `buildChain` and nothing else changes.
 *
 * An engine that throws, or that returns nothing, is passed over rather than
 * treated as an answer. An empty answer map is the dangerous case: treating it as a
 * verdict would report silence as a judgement.
 */
export class ChainedJudge implements JevJudge {
  readonly id: ScoreSource = 'jev';
  readonly label: string;

  constructor(private readonly judges: JevJudge[]) {
    this.label = judges.map((j) => j.label).join(' → ');
  }

  get available(): boolean {
    return this.judges.some((judge) => judge.available);
  }

  /** Why each engine is or is not usable, for /health. */
  describe(): Array<{ id: ScoreSource; label: string; available: boolean; reason: string }> {
    return this.judges.map((judge) => ({ id: judge.id, label: judge.label, available: judge.available, reason: judge.reason }));
  }

  get reason(): string {
    if (this.judges.length === 0) return 'no judges registered';
    return this.available
      ? this.judges
          .filter((j) => j.available)
          .map((j) => j.label)
          .join(' → ')
      : this.judges.map((j) => `${j.label}: ${j.reason}`).join('; ');
  }

  async ask(state: EntryType, questions: JevQuestion[]): Promise<JevVerdict> {
    const failures: string[] = [];

    for (const judge of this.judges) {
      if (!judge.available) {
        failures.push(`${judge.label} unavailable (${judge.reason})`);
        continue;
      }

      try {
        const verdict = await judge.ask(state, questions);
        if (Object.keys(verdict.answers).length > 0) return verdict;
        failures.push(`${judge.label} returned no answers`);
      } catch (error) {
        failures.push(`${judge.label} failed: ${(error as Error).message}`);
      }
    }

    throw new Error(`Every judge failed — ${failures.join('; ')}`);
  }

  async verify(): Promise<{ model: string }> {
    for (const judge of this.judges) {
      if (!judge.available) continue;
      try {
        return await judge.verify();
      } catch {
        // Try the next engine; verification is only used by an admin probe.
      }
    }
    throw new Error('No judge could be verified');
  }
}

class SdkJudge implements JevJudge {
  readonly available = true;
  readonly reason = 'configured';
  readonly id: ScoreSource = 'jev';
  readonly label = 'Jev';

  constructor(private readonly client: TypeSafeClient) {}

  async ask(state: EntryType, questions: JevQuestion[]): Promise<JevVerdict> {
    if (questions.length === 0) return { answers: {}, source: this.id };

    const payload: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul> | ReturnType<typeof score>> = {};
    for (const q of questions) {
      if (q.kind === 'score') {
        payload[q.id] = score(q.instructions, q.criteria as unknown as ScoreCriteria);
      } else if (q.kind === 'choice') {
        payload[q.id] = choice(q.instructions, q.criteria);
      } else {
        payload[q.id] = noul(q.instructions, q.criteria ?? null);
      }
    }

    // The budget is checked here, in the one place every hosted request passes
    // through, so a new caller cannot bypass it. Refusing is not an error: the
    // chain moves to the next engine and, failing that, the caller falls back to
    // its deterministic path and labels the result accordingly.
    if (!reserveJudgeCall()) {
      throw new Error(`Judge budget reached (${judgeBudget().spentUsd.toFixed(4)} spent)`);
    }

    const { answers, usage } = await this.client.systemOne({ state, questions: payload as unknown as Questions });

    if (usage) recordJudgeUsage(usage.input_tokens, usage.output_tokens);

    const out: Record<string, JevAnswer> = {};
    for (const q of questions) {
      const answer = (answers as unknown as Record<string, Record<string, unknown>>)[q.id];
      if (!answer) continue;

      if (q.kind === 'noul') {
        out[q.id] = {
          value: typeof answer.noul === 'number' ? answer.noul : 0,
          probabilities: {},
          confidence: 0,
        };
        continue;
      }

      const probabilities = (answer.probabilities ?? {}) as Record<string, number>;
      const rawScore = typeof answer.score === 'number' ? answer.score : 0;
      const levelCount = q.kind === 'score' ? q.criteria.length : 0;

      out[q.id] = {
        // Score answers are probability-weighted level indices (0-based). Normalize to 0-1.
        value: q.kind === 'score' ? (levelCount > 1 ? rawScore / (levelCount - 1) : 0) : rawScore,
        probabilities,
        confidence: typeof answer.confidence === 'number' ? answer.confidence : 0,
        choice: typeof answer.choice === 'string' ? answer.choice : undefined,
      };
    }

    return { answers: out, source: this.id };
  }

  async verify(): Promise<{ model: string }> {
    const models = await this.client.models.list();
    return { model: models[0]?.name ?? 'unknown' };
  }
}

let judge: JevJudge | null = null;

/**
 * The engines, in the order they are tried.
 *
 * The hosted model comes first because it is the best judge available. Anything
 * after it is a fallback and must earn its place: it should only be reached when
 * the ones before it are unavailable or failed, and whatever it produces is
 * reported as `local` rather than as the hosted model's opinion.
 *
 * Adding an engine here is the whole integration. Nothing else in the app changes,
 * because every caller reads the source off the reply.
 */
function buildChain(): JevJudge[] {
  const chain: JevJudge[] = [];

  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (apiKey && !apiKey.startsWith('your_')) {
    chain.push(
      new SdkJudge(
        new TypeSafeClient({
          apiKey,
          timeout: Number(process.env.TYPESAFE_TIMEOUT_MS ?? 30000),
          retry: { maxRetries: Number(process.env.TYPESAFE_MAX_RETRIES ?? 2) },
        })
      )
    );
  } else {
    chain.push(new UnavailableJudge(apiKey ? 'TYPESAFE_API_KEY is a placeholder' : 'TYPESAFE_API_KEY is not set'));
  }

  return chain;
}

export function getJevJudge(): JevJudge {
  if (!judge) judge = new ChainedJudge(buildChain());
  return judge;
}

/** The chain's composition, for /health. */
export function describeJudgeChain(): Array<{ id: ScoreSource; label: string; available: boolean; reason: string }> {
  const current = getJevJudge();
  return current instanceof ChainedJudge ? current.describe() : [{ id: current.id, label: current.label, available: current.available, reason: current.reason }];
}

/**
 * Replace the judge. Tests pass a stub to exercise the fallback paths, including
 * the degraded ones, without a key or network access.
 */
export function setJevJudge(next: JevJudge | null): void {
  judge = next;
}

/** Reset the memoized chain so the next call re-reads the environment. */
export function resetJevJudge(): void {
  judge = null;
}
