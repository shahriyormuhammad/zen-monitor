/**
 * Детерминированный PRNG и sampler-ы для bandit-алгоритмов P72.
 *
 * Используется mulberry32 — compact 32-bit PRNG с хорошей статистической
 * равномерностью на [0, 1). Все производные sampler-ы (Normal, Gamma, Beta)
 * тянут uniforms из одного PRNG, поэтому один seed → одна детерминированная
 * последовательность чисел и стабильные тесты.
 */

export type Prng = () => number;

export function createMulberry32(seed: number): Prng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TWO_PI = 2 * Math.PI;
const EPSILON = 1e-12;

export function sampleUniform(prng: Prng): number {
  return prng();
}

export function sampleStandardNormal(prng: Prng): number {
  const u1 = Math.max(prng(), EPSILON);
  const u2 = prng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
}

export function sampleNormal(prng: Prng, mean: number, stdDev: number): number {
  return mean + Math.max(stdDev, 0) * sampleStandardNormal(prng);
}

/**
 * Gamma sampler по методу Marsaglia-Tsang (shape ≥ 1) с boosting через
 * u^(1/shape) для shape < 1. Rate по умолчанию 1 (shape/scale=1 convention).
 */
export function sampleGamma(prng: Prng, shape: number): number {
  if (shape <= 0) {
    return 0;
  }
  if (shape < 1) {
    const boosted = sampleGamma(prng, shape + 1);
    const u = Math.max(prng(), EPSILON);
    return boosted * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Rejection sampling: безусловно завершится (E[iterations] < 2).
  // Безопасный cap 256 защищает от NaN seed в тестах.
  for (let attempt = 0; attempt < 256; attempt += 1) {
    const x = sampleStandardNormal(prng);
    const v = Math.pow(1 + c * x, 3);
    if (v <= 0) continue;
    const u = Math.max(prng(), EPSILON);
    if (u < 1 - 0.0331 * x * x * x * x) {
      return d * v;
    }
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
  return d;
}

export function sampleBeta(prng: Prng, alpha: number, beta: number): number {
  const a = Math.max(alpha, EPSILON);
  const b = Math.max(beta, EPSILON);
  const x = sampleGamma(prng, a);
  const y = sampleGamma(prng, b);
  const sum = x + y;
  if (sum <= 0) {
    return 0.5;
  }
  return x / sum;
}
