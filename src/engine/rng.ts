/**
 * Seeded 32-bit PRNG using cyrb128 (string-to-128-bit state hash) and sfc32 (PRNG).
 */

const UINT32_RANGE = 0x1_0000_0000; // 2^32
const WARMUP_ROUNDS = 15;

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /**
   * Unbiased integer in `[0, maxExclusive)` using rejection sampling.
   * Domain: `maxExclusive` must be an integer with `1 <= maxExclusive <= 2**32`.
   */
  int(maxExclusive: number): number;
  /** Picks one element uniformly at random from a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Fisher–Yates shuffle returning a new array without mutating the input. */
  shuffle<T>(items: readonly T[]): T[];
  /** Independent child RNG deterministically derived from parent seed and label. */
  fork(label: string): Rng;
  readonly seed: string;
}

/** cyrb128: hashes an arbitrary string into four 32-bit unsigned integers. */
function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;

  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32: Small Fast Chaotic 32-bit PRNG returning unsigned integers in [0, 2^32). */
function createSfc32(a: number, b: number, c: number, d: number): () => number {
  let s0 = a >>> 0;
  let s1 = b >>> 0;
  let s2 = c >>> 0;
  let s3 = d >>> 0;

  const nextUint32 = (): number => {
    s0 |= 0;
    s1 |= 0;
    s2 |= 0;
    s3 |= 0;
    const t = (((s0 + s1) | 0) + s3) | 0;
    s3 = (s3 + 1) | 0;
    s0 = s1 ^ (s1 >>> 9);
    s1 = (s2 + (s2 << 3)) | 0;
    s2 = (s2 << 21) | (s2 >>> 11);
    s2 = (s2 + t) | 0;
    return t >>> 0;
  };

  for (let i = 0; i < WARMUP_ROUNDS; i++) {
    nextUint32();
  }

  return nextUint32;
}

export function createRng(seed: string | number): Rng {
  if (typeof seed === 'number' && !Number.isFinite(seed)) {
    throw new RangeError(`Invalid numeric seed: ${String(seed)}`);
  }

  const normalizedSeed = typeof seed === 'number' ? String(seed) : seed;
  const [a, b, c, d] = cyrb128(normalizedSeed);
  const nextUint32 = createSfc32(a, b, c, d);

  const next = (): number => nextUint32() / UINT32_RANGE;

  const int = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
      throw new RangeError(
        `maxExclusive must be an integer in [1, ${UINT32_RANGE}], received ${String(maxExclusive)}`,
      );
    }

    // Rejection sampling: discard values >= largest multiple of maxExclusive <= 2^32
    // so every remainder in [0, maxExclusive) has identical probability.
    const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    let sample = nextUint32();
    while (sample >= limit) {
      sample = nextUint32();
    }
    return sample % maxExclusive;
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new RangeError('Cannot pick from an empty array');
    }
    return items[int(items.length)] as T;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = int(i + 1);
      const tmp = result[i] as T;
      result[i] = result[j] as T;
      result[j] = tmp;
    }
    return result;
  };

  const fork = (label: string): Rng => {
    // Length-prefix parent seed so ("a/b", "c") cannot collide with ("a", "b/c").
    return createRng(`${normalizedSeed.length}:${normalizedSeed}:${label}`);
  };

  return Object.freeze({
    next,
    int,
    pick,
    shuffle,
    fork,
    seed: normalizedSeed,
  });
}
