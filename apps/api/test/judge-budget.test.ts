import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('judge budget', () => {
  const saved = { ...process.env };
  let budget: typeof import('../src/services/judge-budget');

  /**
   * Loaded fresh each time because the limit is read from the environment once, at
   * module load, so a test cannot change it on an already-imported module.
   */
  const load = async () => {
    vi.resetModules();
    budget = await import('../src/services/judge-budget');
    budget.resetJudgeBudget();
    return budget;
  };

  beforeEach(async () => {
    delete process.env.JEV_BUDGET_USD;
    await load();
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it('is uncapped by default, so existing behaviour is unchanged', () => {
    const state = budget.judgeBudget();
    expect(state.limitUsd).toBeNull();
    expect(state.exhausted).toBe(false);
    expect(budget.reserveJudgeCall()).toBe(true);
  });

  it('accumulates cost from input tokens', () => {
    budget.recordJudgeUsage(1_000_000);
    const state = budget.judgeBudget();
    expect(state.spentTokens).toBe(1_000_000);
    // $0.042 per million input tokens.
    expect(state.spentUsd).toBeCloseTo(0.042, 6);
  });

  it('ignores a non-positive or non-finite usage report', () => {
    budget.recordJudgeUsage(0);
    budget.recordJudgeUsage(-5);
    budget.recordJudgeUsage(Number.NaN);
    expect(budget.judgeBudget().spentTokens).toBe(0);
  });

  it('refuses once the cap is reached, and counts the refusals', async () => {
    process.env.JEV_BUDGET_USD = '0.05';
    const capped = await load();

    // $0.042/M, so 2M tokens is $0.084 — past a $0.05 cap.
    capped.recordJudgeUsage(2_000_000);

    expect(capped.judgeBudget().exhausted).toBe(true);
    expect(capped.reserveJudgeCall()).toBe(false);
    expect(capped.reserveJudgeCall()).toBe(false);
    expect(capped.judgeBudget().refused).toBe(2);
  });

  it('refuses a call whose own estimate would breach the cap', async () => {
    process.env.JEV_BUDGET_USD = '0.01';
    const capped = await load();

    // Nothing spent yet, but 1M tokens is $0.042, over a $0.01 cap.
    expect(capped.judgeBudget().exhausted).toBe(false);
    expect(capped.reserveJudgeCall(1_000_000)).toBe(false);
  });

  it('allows a call that fits inside the cap', async () => {
    process.env.JEV_BUDGET_USD = '0.10';
    const capped = await load();

    expect(capped.reserveJudgeCall(500_000)).toBe(true); // $0.021
    capped.recordJudgeUsage(500_000);
    expect(capped.reserveJudgeCall(500_000)).toBe(true);
  });
});
