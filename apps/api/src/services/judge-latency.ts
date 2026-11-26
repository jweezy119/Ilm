/**
 * Round-trip timings for hosted judge calls, per process.
 *
 * The budget tells us what Jev costs; this tells us what it costs in time.
 * Both are in-process counters and both reset on restart, which makes them
 * liveness-adjacent numbers rather than historical analytics: an operator
 * looking at /health wants to know what THIS instance is doing now.
 *
 * Only calls that actually reached the SDK are recorded. A call refused by the
 * budget never left the process, so counting it as a Jev round-trip would make
 * the latency figure lie.
 */

export interface JudgeLatency {
  /** Hosted requests attempted since this process started. */
  readonly calls: number;
  readonly avgMs: number;
  readonly maxMs: number;
  readonly lastMs: number;
}

let calls = 0;
let totalMs = 0;
let maxMs = 0;
let lastMs = 0;

export function recordJudgeLatency(elapsedMs: number): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  calls += 1;
  totalMs += elapsedMs;
  maxMs = Math.max(maxMs, elapsedMs);
  lastMs = elapsedMs;
}

export function judgeLatency(): JudgeLatency {
  return {
    calls,
    avgMs: calls > 0 ? Number((totalMs / calls).toFixed(1)) : 0,
    maxMs: Number(maxMs.toFixed(1)),
    lastMs: Number(lastMs.toFixed(1)),
  };
}

/** Test seam: forget everything recorded so far. */
export function resetJudgeLatency(): void {
  calls = 0;
  totalMs = 0;
  maxMs = 0;
  lastMs = 0;
}
