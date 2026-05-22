import { describe, it, expect } from 'vitest';
import {
  createLinUCBArm,
  linUCBScore,
  pickLinUCB,
  updateLinUCBArm,
  buildLinUCBFeatures,
  LINUCB_FEATURE_DIM,
  LINUCB_DEFAULT_ALPHA,
} from './linucb';

describe('createLinUCBArm', () => {
  it('создаёт arm с единичной матрицей A и нулевым b', () => {
    const arm = createLinUCBArm('test', 4);
    expect(arm.id).toBe('test');
    expect(arm.A).toHaveLength(16);
    expect(arm.b).toHaveLength(4);
    // A = I_4: диагональные элементы = 1, остальные = 0
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        expect(arm.A[i * 4 + j]).toBe(i === j ? 1 : 0);
      }
    }
    expect(arm.b.every(v => v === 0)).toBe(true);
  });
});

describe('linUCBScore', () => {
  it('при A=I и b=0 score = alpha * |x|', () => {
    const arm = createLinUCBArm('a', 4);
    const features = [1, 0, 0, 0];
    const alpha = 1.0;
    // theta = A^{-1} b = 0, x^T A^{-1} x = x^T x = 1 => score = 0 + 1*sqrt(1) = 1
    expect(linUCBScore(arm, features, alpha)).toBeCloseTo(1.0, 6);
  });

  it('при известном reward строит корректный score', () => {
    let arm = createLinUCBArm('a', 2);
    const x = [1.0, 0.5];
    arm = updateLinUCBArm(arm, x, 1.0);
    const score = linUCBScore(arm, x, 0.5);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });
});

describe('pickLinUCB', () => {
  it('выбирает arm с наибольшим score', () => {
    const features = [1, 0, 0, 0];
    // arm_b имеет больше reward-наблюдений → должен выиграть
    const armA = createLinUCBArm('a', 4);
    let armB = createLinUCBArm('b', 4);
    for (let i = 0; i < 20; i++) armB = updateLinUCBArm(armB, features, 1.0);

    const pick = pickLinUCB([armA, armB], features, 0.1);
    expect(pick.arm.id).toBe('b');
    expect(pick.scores).toHaveLength(2);
    expect(Number.isFinite(pick.scores[0]?.score)).toBe(true);
    expect(Number.isFinite(pick.scores[1]?.score)).toBe(true);
  });

  it('детерминирован (при тех же arm-ах и features даёт тот же результат)', () => {
    const arms = [createLinUCBArm('x', 2), createLinUCBArm('y', 2)];
    const features = [0.5, 0.8];
    expect(pickLinUCB(arms, features).arm.id).toBe(pickLinUCB(arms, features).arm.id);
  });

  it('бросает ошибку при пустом списке', () => {
    expect(() => pickLinUCB([], [1, 0])).toThrow();
  });
});

describe('updateLinUCBArm', () => {
  it('не мутирует исходный arm', () => {
    const original = createLinUCBArm('a', 2);
    const originalA = [...original.A];
    const originalB = [...original.b];
    updateLinUCBArm(original, [1, 0], 0.5);
    expect(original.A).toEqual(originalA);
    expect(original.b).toEqual(originalB);
  });

  it('после обновления A != I', () => {
    const arm = createLinUCBArm('a', 2);
    const updated = updateLinUCBArm(arm, [1, 0], 1.0);
    // A[0][0] должен стать 1 + 1*1 = 2
    expect(updated.A[0]).toBeCloseTo(2.0, 10);
    // b[0] = 0 + 1.0*1 = 1
    expect(updated.b[0]).toBeCloseTo(1.0, 10);
  });

  it('многократные обновления сходятся: θ → reward', () => {
    let arm = createLinUCBArm('a', 1);
    const x = [1.0];
    for (let i = 0; i < 200; i++) arm = updateLinUCBArm(arm, x, 0.8);
    // theta = A^{-1} b; при x=[1] → θ → 0.8
    const score = linUCBScore(arm, x, 0); // alpha=0 → score = θ^T x
    expect(score).toBeCloseTo(0.8, 1);
  });
});

describe('buildLinUCBFeatures', () => {
  it('возвращает вектор правильной размерности', () => {
    const features = buildLinUCBFeatures({ price: 500, orders30d: 20, weekOfYear: 10 });
    expect(features).toHaveLength(LINUCB_FEATURE_DIM);
    expect(features.every(v => Number.isFinite(v))).toBe(true);
  });

  it('log(price+1) и log(orders+1) монотонно растут', () => {
    const f1 = buildLinUCBFeatures({ price: 100, orders30d: 10, weekOfYear: 1 });
    const f2 = buildLinUCBFeatures({ price: 1000, orders30d: 100, weekOfYear: 1 });
    expect(f2[0]).toBeGreaterThan(f1[0]!);
    expect(f2[1]).toBeGreaterThan(f1[1]!);
  });

  it('нулевые и отрицательные входы не дают NaN/Inf', () => {
    const features = buildLinUCBFeatures({ price: 0, orders30d: 0, weekOfYear: 1 });
    expect(features.every(Number.isFinite)).toBe(true);
  });

  it('sincos недели — sin^2+cos^2 = 1', () => {
    const f = buildLinUCBFeatures({ price: 100, orders30d: 10, weekOfYear: 26 });
    const sin = f[2]!;
    const cos = f[3]!;
    expect(sin * sin + cos * cos).toBeCloseTo(1.0, 10);
  });

  it('LINUCB_DEFAULT_ALPHA — конечное число', () => {
    expect(Number.isFinite(LINUCB_DEFAULT_ALPHA)).toBe(true);
  });
});
