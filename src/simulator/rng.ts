/**
 * Deterministic, serialisable PRNG (sfc32) seeded via splitmix32.
 * State is four uint32 values so it can be persisted in MongoDB and resumed
 * exactly after a restart.
 */
export type RngState = [number, number, number, number];

export class Rng {
  private a: number; private b: number; private c: number; private d: number;

  private constructor(state: RngState) {
    [this.a, this.b, this.c, this.d] = state;
  }

  static fromSeed(seed: number): Rng {
    let s = (seed >>> 0) || 0x9e3779b9;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    const rng = new Rng([next(), next(), next(), next()]);
    for (let i = 0; i < 12; i++) rng.next();
    return rng;
  }

  static fromState(state: RngState): Rng {
    if (state.length !== 4 || state.some((v) => !Number.isInteger(v) || v < 0 || v > 0xffffffff)) {
      throw new Error("Invalid RNG state");
    }
    return new Rng([state[0], state[1], state[2], state[3]]);
  }

  getState(): RngState {
    return [this.a >>> 0, this.b >>> 0, this.c >>> 0, this.d >>> 0];
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    const t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const out = (t + this.d) | 0;
    this.c = (this.c + out) | 0;
    return (out >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Cannot pick from empty list");
    return items[Math.floor(this.next() * items.length)];
  }

  weightedPick<T>(items: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of items) total += Math.max(0, weight(item));
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (const item of items) {
      r -= Math.max(0, weight(item));
      if (r <= 0) return item;
    }
    return items[items.length - 1];
  }

  /** Standard normal via Box-Muller. */
  normal(mean = 0, sd = 1): number {
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Binomial(n, p). Exact for small n, normal approximation for large n; always within [0, n]. */
  binomial(n: number, p: number): number {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n <= 64) {
      let k = 0;
      for (let i = 0; i < n; i++) if (this.next() < p) k++;
      return k;
    }
    const mean = n * p;
    const sd = Math.sqrt(n * p * (1 - p));
    const k = Math.round(this.normal(mean, sd));
    return Math.min(n, Math.max(0, k));
  }

  /** Poisson(lambda). Knuth for small lambda, normal approximation above 50. */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 50) return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > limit);
    return k - 1;
  }
}

/** Small stable 32-bit hash for deriving per-record RNG streams (e.g. storefront orders). */
export function hash32(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
