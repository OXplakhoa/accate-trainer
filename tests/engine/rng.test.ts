import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/engine';

describe('createRng', () => {
  it('produces the exact same first 1,000 numbers for the same seed and differs for different seeds', () => {
    const a1 = createRng('accate-seed-1');
    const a2 = createRng('accate-seed-1');
    const b = createRng('accate-seed-2');

    const seqA1 = Array.from({ length: 1000 }, () => a1.next());
    const seqA2 = Array.from({ length: 1000 }, () => a2.next());
    const seqB = Array.from({ length: 1000 }, () => b.next());

    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);

    for (const v of seqA1) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('supports numeric seeds deterministically and exposes seed as string', () => {
    const r1 = createRng(42);
    const r2 = createRng('42');
    expect(r1.seed).toBe('42');
    expect(Array.from({ length: 20 }, () => r1.next())).toEqual(
      Array.from({ length: 20 }, () => r2.next()),
    );
  });

  it('int(n) always stays within [0, n) for n = 1, 2, 7, 52, 2^31', () => {
    const rng = createRng('int-bounds');
    const sizes = [1, 2, 7, 52, 2 ** 31] as const;

    for (const n of sizes) {
      for (let i = 0; i < 500; i++) {
        const val = rng.int(n);
        expect(Number.isInteger(val)).toBe(true);
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(n);
      }
    }
  });

  it('shuffle(52) returns a valid permutation, does not mutate input, and is deterministic by seed', () => {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    const snapshot = [...deck];

    const r1 = createRng('shuffle-52');
    const r2 = createRng('shuffle-52');

    const s1 = r1.shuffle(deck);
    const s2 = r2.shuffle(deck);

    expect(deck).toEqual(snapshot);
    expect(s1).not.toBe(deck);
    expect(s1).toEqual(s2);
    expect(s1).toHaveLength(52);
    expect(new Set(s1).size).toBe(52);
    expect([...s1].sort((x, y) => x - y)).toEqual(deck);
  });

  it('produces uniform distribution across 60,000 shuffles of [0..5] (<= 5% deviation at index 0)', () => {
    const rng = createRng('uniform-shuffle-check');
    const items = [0, 1, 2, 3, 4, 5];
    const counts = [0, 0, 0, 0, 0, 0];
    const trials = 60_000;

    for (let i = 0; i < trials; i++) {
      const shuffled = rng.shuffle(items);
      const first = shuffled[0]!;
      counts[first] = (counts[first] ?? 0) + 1;
    }

    const expected = trials / items.length; // 10,000
    for (const count of counts) {
      const relativeError = Math.abs(count - expected) / expected;
      expect(relativeError).toBeLessThanOrEqual(0.05);
    }
  });

  it('fork("deal") yields the same sequence regardless of parent or sibling RNG calls', () => {
    const parentA = createRng('fork-independence');
    const dealA = parentA.fork('deal');
    const seqA = Array.from({ length: 100 }, () => dealA.int(52));

    const parentB = createRng('fork-independence');
    for (let i = 0; i < 500; i++) {
      parentB.next();
    }
    const botB = parentB.fork('bot');
    for (let i = 0; i < 200; i++) {
      botB.int(100);
    }
    const dealB = parentB.fork('deal');
    const seqB = Array.from({ length: 100 }, () => dealB.int(52));

    expect(seqA).toEqual(seqB);

    const botFresh = createRng('fork-independence').fork('bot');
    const seqBot = Array.from({ length: 100 }, () => botFresh.int(52));
    expect(seqBot).not.toEqual(seqA);
  });

  it('pick returns an element from the array deterministically', () => {
    const items = ['A', 'B', 'C', 'D'] as const;
    const r1 = createRng('pick-test');
    const r2 = createRng('pick-test');

    const p1 = Array.from({ length: 20 }, () => r1.pick(items));
    const p2 = Array.from({ length: 20 }, () => r2.pick(items));
    expect(p1).toEqual(p2);
    for (const picked of p1) {
      expect(items).toContain(picked);
    }
  });

  it('throws on invalid inputs', () => {
    const rng = createRng('invalid-inputs');

    expect(() => rng.int(0)).toThrow();
    expect(() => rng.int(-1)).toThrow();
    expect(() => rng.int(-100)).toThrow();
    expect(() => rng.int(1.5)).toThrow();
    expect(() => rng.int(Number.NaN)).toThrow();
    expect(() => rng.int(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => rng.int(2 ** 32 + 1)).toThrow();

    expect(() => rng.pick([])).toThrow();

    expect(() => createRng(Number.NaN)).toThrow();
    expect(() => createRng(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => createRng(Number.NEGATIVE_INFINITY)).toThrow();
  });
});
