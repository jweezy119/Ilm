import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { judgeLatency, recordJudgeLatency, resetJudgeLatency } from '../src/services/judge-latency';

describe('judge latency', () => {
  beforeEach(() => resetJudgeLatency());
  afterEach(() => resetJudgeLatency());

  it('starts empty rather than reporting a misleading zero-cost call', () => {
    expect(judgeLatency()).toEqual({ calls: 0, avgMs: 0, maxMs: 0, lastMs: 0 });
  });

  it('reports average, last and worst round-trip for the process', () => {
    for (const ms of [120, 240, 60]) recordJudgeLatency(ms);
    expect(judgeLatency()).toEqual({ calls: 3, avgMs: 140, maxMs: 240, lastMs: 60 });
  });

  it('ignores invalid timings instead of poisoning the average', () => {
    recordJudgeLatency(Number.NaN);
    recordJudgeLatency(-5);
    recordJudgeLatency(80);
    expect(judgeLatency()).toEqual({ calls: 1, avgMs: 80, maxMs: 80, lastMs: 80 });
  });

  it('is surfaced in the health response', () => {
    const health = readFileSync(join(__dirname, '../src/routes/api.ts'), 'utf8');
    expect(health).toContain('latency: judgeLatency()');
    expect(health).toContain('spentUsd:');
  });
});
