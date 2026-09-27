import { describe, expect, it } from 'vitest';
import { createBoundedMemo } from '../src/lib/memo';

describe('createBoundedMemo', () => {
  it('computes once and reuses the value', () => {
    const memo = createBoundedMemo<number>(10);
    let calls = 0;

    const first = memo('a', () => ++calls);
    const second = memo('a', () => ++calls);

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(calls).toBe(1);
  });

  it('treats different keys separately', () => {
    const memo = createBoundedMemo<number>(10);
    expect(memo('a', () => 1)).toBe(1);
    expect(memo('b', () => 2)).toBe(2);
  });

  it('evicts the coldest key once full, so memory stays bounded', () => {
    const memo = createBoundedMemo<number>(2);
    let calls = 0;

    memo('a', () => ++calls);
    memo('b', () => ++calls);
    memo('c', () => ++calls);
    expect(calls).toBe(3);

    // 'a' was the oldest and is gone, so it is computed again.
    memo('a', () => ++calls);
    expect(calls).toBe(4);
  });

  it('keeps every key when the working set fits inside the bound', () => {
    // Capacity must exceed the number of distinct keys, or LRU correctly keeps
    // evicting and nothing survives — which is the point of the bound, not a bug.
    const memo = createBoundedMemo<number>(3);
    let calls = 0;

    memo('a', () => ++calls);
    memo('b', () => ++calls);
    memo('c', () => ++calls);
    expect(calls).toBe(3);

    memo('a', () => ++calls);
    memo('b', () => ++calls);
    memo('c', () => ++calls);
    expect(calls).toBe(3);
  });

  it('keeps a recently used key alive over an older one', () => {
    const memo = createBoundedMemo<number>(2);
    let calls = 0;

    memo('a', () => ++calls);
    memo('b', () => ++calls);
    memo('a', () => ++calls); // 'a' is now the most recent
    memo('c', () => ++calls); // evicts 'b', the coldest

    memo('a', () => ++calls);
    expect(calls).toBe(3); // 'a' was never recomputed
  });
});
