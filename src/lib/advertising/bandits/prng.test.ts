import { describe, it, expect } from 'vitest';
import {
  createMulberry32,
  sampleBeta,
  sampleGamma,
  sampleNormal,
  sampleStandardNormal,
  sampleUniform,
} from './prng';

const SEED = 1234567;

describe('createMulberry32', () => {
  it('даёт детерминированную последовательность на одном seed', () => {
    const a = createMulberry32(SEED);
    const b = createMulberry32(SEED);
    for (let i = 0; i < 20; i += 1) {
      expect(a()).toBe(b());
    }
  });

  it('отличные seed дают отличные последовательности', () => {
    const a = createMulberry32(SEED);
    const b = createMulberry32(SEED + 1);
    const valuesA = Array.from({ length: 10 }, () => a());
    const valuesB = Array.from({ length: 10 }, () => b());
    expect(valuesA).not.toEqual(valuesB);
  });

  it('выдаёт uniforms в [0, 1)', () => {
    const prng = createMulberry32(SEED);
    for (let i = 0; i < 5_000; i += 1) {
      const value = sampleUniform(prng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('среднее больших выборок близко к 0.5', () => {
    const prng = createMulberry32(SEED);
    const n = 20_000;
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += prng();
    expect(sum / n).toBeCloseTo(0.5, 2);
  });
});

describe('sampleStandardNormal', () => {
  it('даёт среднее ≈ 0 и дисперсию ≈ 1 на большой выборке', () => {
    const prng = createMulberry32(SEED);
    const n = 20_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i += 1) {
      const x = sampleStandardNormal(prng);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(mean).toBeCloseTo(0, 1);
    expect(variance).toBeCloseTo(1, 1);
  });
});

describe('sampleNormal', () => {
  it('сдвигает и масштабирует стандартное распределение', () => {
    const prng = createMulberry32(SEED);
    const n = 20_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i += 1) {
      const x = sampleNormal(prng, 5, 2);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(mean).toBeCloseTo(5, 1);
    expect(variance).toBeCloseTo(4, 0);
  });
});

describe('sampleGamma', () => {
  it('Gamma(k=2) имеет среднее ≈ 2 и variance ≈ 2', () => {
    const prng = createMulberry32(SEED);
    const n = 20_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i += 1) {
      const x = sampleGamma(prng, 2);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(mean).toBeCloseTo(2, 0);
    expect(variance).toBeCloseTo(2, 0);
  });

  it('Gamma(k=0.5) всегда неотрицательна и конечна', () => {
    const prng = createMulberry32(SEED);
    for (let i = 0; i < 500; i += 1) {
      const value = sampleGamma(prng, 0.5);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('возвращает 0 для shape ≤ 0', () => {
    const prng = createMulberry32(SEED);
    expect(sampleGamma(prng, 0)).toBe(0);
    expect(sampleGamma(prng, -1)).toBe(0);
  });
});

describe('sampleBeta', () => {
  it('Beta(1, 1) имеет среднее ≈ 0.5', () => {
    const prng = createMulberry32(SEED);
    const n = 10_000;
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += sampleBeta(prng, 1, 1);
    expect(sum / n).toBeCloseTo(0.5, 1);
  });

  it('Beta(10, 2) концентрируется около 10/12 ≈ 0.833', () => {
    const prng = createMulberry32(SEED);
    const n = 10_000;
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += sampleBeta(prng, 10, 2);
    expect(sum / n).toBeCloseTo(10 / 12, 1);
  });

  it('все samples остаются в [0, 1]', () => {
    const prng = createMulberry32(SEED);
    for (let i = 0; i < 2_000; i += 1) {
      const value = sampleBeta(prng, 3, 7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});
