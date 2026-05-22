import { describe, it, expect } from 'vitest';
import {
  betaPosteriorMean,
  normalPosterior,
  pickThompsonBetaBernoulli,
  pickThompsonNormal,
  probabilityArmIsBest,
  sampleBetaBernoulli,
  sampleNormalArms,
  updateBetaArm,
  updateNormalArm,
  type BetaBernoulliArm,
  type NormalArm,
} from './thompson';
import { createMulberry32, sampleBeta, sampleNormal } from './prng';

const SEED = 42;

function beta(id: string, successes: number, failures: number): BetaBernoulliArm {
  return { id, successes, failures };
}

function normal(id: string, count: number, mean: number, m2: number): NormalArm {
  return { id, count, mean, m2 };
}

describe('betaPosteriorMean', () => {
  it('учитывает priors Beta(1, 1)', () => {
    expect(betaPosteriorMean(beta('a', 0, 0))).toBeCloseTo(0.5, 6);
    expect(betaPosteriorMean(beta('b', 7, 3))).toBeCloseTo(8 / 12, 6);
  });
});

describe('normalPosterior', () => {
  it('без данных возвращает prior', () => {
    const { mean, variance } = normalPosterior(normal('a', 0, 0, 0));
    expect(mean).toBe(0);
    expect(variance).toBe(1);
  });

  it('с большим количеством наблюдений сходится к наблюдённому mean', () => {
    const { mean, variance } = normalPosterior(normal('a', 500, 2.5, 500));
    expect(mean).toBeCloseTo(2.5, 2);
    expect(variance).toBeLessThan(0.01);
  });
});

describe('pickThompsonBetaBernoulli', () => {
  it('детерминирован по seed', () => {
    const arms = [beta('low', 1, 9), beta('mid', 5, 5), beta('high', 9, 1)];
    const a = pickThompsonBetaBernoulli(arms, SEED);
    const b = pickThompsonBetaBernoulli(arms, SEED);
    expect(a.arm.id).toBe(b.arm.id);
  });

  it('при явно доминирующем arm выбирает его в >80% запусков', () => {
    const arms = [beta('low', 1, 9), beta('mid', 5, 5), beta('high', 90, 10)];
    let highWins = 0;
    const total = 1_000;
    for (let seed = 1; seed <= total; seed += 1) {
      const pick = pickThompsonBetaBernoulli(arms, seed);
      if (pick.arm.id === 'high') highWins += 1;
    }
    expect(highWins / total).toBeGreaterThan(0.8);
  });

  it('на пустой posterior распределение выборов близко к равномерному', () => {
    const arms = [beta('a', 0, 0), beta('b', 0, 0), beta('c', 0, 0)];
    const counts = new Map<string, number>();
    const total = 2_000;
    for (let seed = 1; seed <= total; seed += 1) {
      const pick = pickThompsonBetaBernoulli(arms, seed);
      counts.set(pick.arm.id, (counts.get(pick.arm.id) ?? 0) + 1);
    }
    for (const arm of arms) {
      const share = (counts.get(arm.id) ?? 0) / total;
      expect(share).toBeGreaterThan(0.2);
      expect(share).toBeLessThan(0.5);
    }
  });

  it('возвращает по одному sample на каждый arm', () => {
    const arms = [beta('a', 2, 2), beta('b', 4, 1)];
    const pick = pickThompsonBetaBernoulli(arms, SEED);
    expect(pick.samples).toHaveLength(2);
    for (const sample of pick.samples) {
      expect(sample.sample).toBeGreaterThanOrEqual(0);
      expect(sample.sample).toBeLessThanOrEqual(1);
    }
  });
});

describe('pickThompsonNormal', () => {
  it('детерминирован по seed', () => {
    const arms = [normal('a', 10, 0.2, 1.0), normal('b', 10, 0.8, 1.0)];
    const a = pickThompsonNormal(arms, SEED);
    const b = pickThompsonNormal(arms, SEED);
    expect(a.arm.id).toBe(b.arm.id);
  });

  it('arm с большим mean и низкой variance выигрывает ≥80% прогонов', () => {
    const arms = [
      normal('low', 50, -0.5, 5),
      normal('high', 50, 1.5, 5),
    ];
    let highWins = 0;
    const total = 500;
    for (let seed = 1; seed <= total; seed += 1) {
      const pick = pickThompsonNormal(arms, seed);
      if (pick.arm.id === 'high') highWins += 1;
    }
    expect(highWins / total).toBeGreaterThan(0.8);
  });
});

describe('probabilityArmIsBest', () => {
  it('сумма вероятностей = 1', () => {
    const arms = [beta('a', 5, 5), beta('b', 8, 2)];
    const probs = probabilityArmIsBest(
      arms,
      (arm, prng) => sampleBeta(prng, arm.successes + 1, arm.failures + 1),
      SEED,
      1_000,
    );
    const sum = Array.from(probs.values()).reduce((acc, value) => acc + value, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('assigns >70% для явно доминирующего Normal arm', () => {
    const arms = [normal('low', 100, 0, 10), normal('high', 100, 3, 10)];
    const probs = probabilityArmIsBest(
      arms,
      (arm, prng) => {
        const { mean, variance } = normalPosterior(arm);
        return sampleNormal(prng, mean, Math.sqrt(variance));
      },
      SEED,
      1_000,
    );
    expect(probs.get('high') ?? 0).toBeGreaterThan(0.7);
  });
});

describe('updateBetaArm', () => {
  it('reward > 0 увеличивает successes', () => {
    expect(updateBetaArm(beta('a', 2, 3), 1)).toEqual(beta('a', 3, 3));
  });

  it('reward = 0 увеличивает failures', () => {
    expect(updateBetaArm(beta('a', 2, 3), 0)).toEqual(beta('a', 2, 4));
  });
});

describe('updateNormalArm', () => {
  it('конвергирует к истинному mean на последовательности наблюдений', () => {
    const prng = createMulberry32(SEED);
    const trueMean = 3.5;
    const trueStdDev = 1.0;
    let arm: NormalArm = normal('a', 0, 0, 0);
    for (let i = 0; i < 2_000; i += 1) {
      const reward = trueMean + trueStdDev * (prng() * 2 - 1) * Math.sqrt(3); // uniform с variance≈1
      arm = updateNormalArm(arm, reward);
    }
    expect(arm.count).toBe(2_000);
    expect(arm.mean).toBeCloseTo(trueMean, 1);
    expect(arm.m2 / (arm.count - 1)).toBeCloseTo(1, 0);
  });
});

describe('sampleBetaBernoulli / sampleNormalArms', () => {
  it('samples для Beta лежат в [0, 1]', () => {
    const prng = createMulberry32(SEED);
    const arms = [beta('a', 3, 7), beta('b', 7, 3)];
    const samples = sampleBetaBernoulli(arms, prng);
    expect(samples).toHaveLength(2);
    for (const sample of samples) {
      expect(sample.sample).toBeGreaterThanOrEqual(0);
      expect(sample.sample).toBeLessThanOrEqual(1);
    }
  });

  it('posteriorMean для Normal совпадает с normalPosterior().mean', () => {
    const prng = createMulberry32(SEED);
    const arms = [normal('a', 10, 1.0, 5.0)];
    const [sample] = sampleNormalArms(arms, prng);
    const posterior = normalPosterior(arms[0]!);
    expect(sample!.posteriorMean).toBeCloseTo(posterior.mean, 10);
  });
});
