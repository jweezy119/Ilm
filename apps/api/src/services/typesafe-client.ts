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

export type { ChoiceCriteria, EntryType, Questions, ScoreCriteria };

export interface JevAnswer {
  /** Probability-weighted 0-1 value for score/noul questions. */
  value: number;
  /** 0-1 distribution across score levels or choice options. */
  probabilities: Record<string, number>;
  confidence: number;
  /** Selected option id, for choice questions only. */
  choice?: string;
}

/** A question in the shape the rest of the app uses. */
export type JevQuestion =
  | { kind: 'score'; id: string; instructions: EntryType; criteria: string[] }
  | { kind: 'choice'; id: string; instructions: EntryType; criteria: ChoiceCriteria }
  | { kind: 'noul'; id: string; instructions: EntryType; criteria?: { true?: EntryType; false?: EntryType } };

export interface JevJudge {
  /** Ask every question against the same state in a single request. */
  ask(state: EntryType, questions: JevQuestion[]): Promise<Record<string, JevAnswer>>;
  /** False when no API key is configured; callers must provide a fallback. */
  readonly available: boolean;
  /** Why the client is unavailable, for surfacing in health output. */
  readonly reason: string;
  /** Ping the models endpoint. Throws when the key is missing or rejected. */
  verify(): Promise<{ model: string }>;
}

class UnavailableJudge implements JevJudge {
  readonly available = false;
  readonly reason: string;

  constructor(reason: string) {
    this.reason = reason;
  }

  async ask(): Promise<Record<string, JevAnswer>> {
    throw new Error(`Jev unavailable: ${this.reason}`);
  }

  async verify(): Promise<{ model: string }> {
    throw new Error(`Jev unavailable: ${this.reason}`);
  }
}

class SdkJudge implements JevJudge {
  readonly available = true;
  readonly reason = 'configured';

  constructor(private readonly client: TypeSafeClient) {}

  async ask(state: EntryType, questions: JevQuestion[]): Promise<Record<string, JevAnswer>> {
    if (questions.length === 0) return {};

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

    const { answers } = await this.client.systemOne({ state, questions: payload as unknown as Questions });

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

    return out;
  }

  async verify(): Promise<{ model: string }> {
    const models = await this.client.models.list();
    return { model: models[0]?.name ?? 'unknown' };
  }
}

let judge: JevJudge | null = null;

export function getJevJudge(): JevJudge {
  if (judge) return judge;
  judge = buildJudge();
  return judge;
}

function buildJudge(): JevJudge {

  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey || apiKey.startsWith('your_')) {
    return new UnavailableJudge('TYPESAFE_API_KEY is not set');
  }

  return new SdkJudge(
    new TypeSafeClient({
      apiKey,
      timeout: Number(process.env.TYPESAFE_TIMEOUT_MS ?? 30000),
      retry: { maxRetries: Number(process.env.TYPESAFE_MAX_RETRIES ?? 2) },
    })
  );
}

/**
 * Replace the judge. Tests pass a stub to exercise the Jev code paths, including
 * the degraded ones, without a key or network access.
 */
export function setJevJudge(next: JevJudge | null): void {
  judge = next;
}

/** Reset the memoized client so the next call re-reads the environment. */
export function resetJevJudge(): void {
  judge = null;
}
