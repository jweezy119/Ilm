/**
 * A hard ceiling on what a process will spend on the hosted judge.
 *
 * The cost of this app is small in absolute terms but not obviously small: a theme
 * backfill is tens of thousands of requests, and a bug that removed a cache would
 * quietly multiply that. A cap turns "we should be careful" into something enforced,
 * and it is enforced in the one place every request passes through, so a new
 * feature cannot bypass it by accident.
 *
 * Input tokens are what TypeSafe bills; output is free. Usage is reported per
 * request by the SDK and recorded here.
 *
 *   JEV_BUDGET_USD=0.50        refuse further calls once this process has spent it
 *   JEV_BUDGET_USD=0            no cap (the default)
 *
 * In-process, so it resets on restart. That is deliberate: it bounds a runaway run,
 * which is the failure that actually happens, and it means the cap cannot strand a
 * service that restarts often.
 */

/** TypeSafe's published rate: $0.042 per million input tokens, output free. */
const USD_PER_MILLION_INPUT_TOKENS = 0.042;

const limit = Number(process.env.JEV_BUDGET_USD ?? 0);

let spentTokens = 0;
let spentUsd = 0;
let refused = 0;

export interface JudgeBudget {
  /** What this process has spent. */
  readonly spentUsd: number;
  readonly spentTokens: number;
  /** The configured ceiling, or null when uncapped. */
  readonly limitUsd: number | null;
  /** True once the cap is reached, after which no call is made. */
  readonly exhausted: boolean;
  /** How many calls were skipped because the cap was already reached. */
  readonly refused: number;
}

export function judgeBudget(): JudgeBudget {
  return {
    spentUsd,
    spentTokens,
    limitUsd: Number.isFinite(limit) && limit > 0 ? limit : null,
    exhausted: isExhausted(),
    refused,
  };
}

function isExhausted(): boolean {
  return Number.isFinite(limit) && limit > 0 && spentUsd >= limit;
}

/**
 * Whether a call may proceed, and records what the last one cost.
 *
 * `reserve` is the expected input size, checked before the call so an
 * unexpectedly large request cannot overshoot before it is measured. It is
 * deliberately not a hard block on the estimate, only on the accumulated spend.
 */
export function reserveJudgeCall(estimatedInputTokens = 0): boolean {
  if (isExhausted()) {
    refused += 1;
    return false;
  }

  // Refuse early when the *estimate alone* would take the process past the cap, so
  // a large request is declined rather than billed and then noticed.
  if (Number.isFinite(limit) && limit > 0 && estimatedInputTokens > 0) {
    const projected = spentUsd + (estimatedInputTokens / 1e6) * USD_PER_MILLION_INPUT_TOKENS;
    if (projected > limit) {
      refused += 1;
      return false;
    }
  }

  return true;
}

export function recordJudgeUsage(inputTokens: number, outputTokens = 0): void {
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return;
  spentTokens += inputTokens;
  spentUsd += (inputTokens / 1e6) * USD_PER_MILLION_INPUT_TOKENS;
  void outputTokens;
}

/** Test seam: forget everything spent. */
export function resetJudgeBudget(): void {
  spentTokens = 0;
  spentUsd = 0;
  refused = 0;
}
