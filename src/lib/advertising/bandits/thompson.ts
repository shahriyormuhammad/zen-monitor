/**
 * Thompson Sampling для выбора arm'а в автопилоте ставок (P72).
 *
 * Реализованы две posterior-модели:
 *   - Beta-Bernoulli для бинарного reward (target попал в позиционный диапазон);
 *   - Normal-Normal для continuous reward (например, log(ROAS/target)).
 *
 * Алгоритм:
 *   1) Для каждого arm'а семплируется ожидаемый reward из posterior.
 *   2) Возвращается arm с максимальным sample — это и есть arg-max.
 *
 * Все функции чистые: принимают PRNG из prng.ts, posterior-статистику,
 * возвращают выбранный arm и вектор samples для UI-объяснения.
 *
 * Интеграция с существующим epsilon-greedy self-learning (self-learning.ts)
 * — в отдельном slice P72b. Этот модуль не имеет IO и DB-зависимостей.
 */

import {
  createMulberry32,
  sampleBeta,
  sampleNormal,
  type Prng,
} from './prng';

export type ThompsonArmId = string;

export type BetaBernoulliArm = {
  id: ThompsonArmId;
  successes: number;
  failures: number;
};

export type NormalArm = {
  id: ThompsonArmId;
  /** Количество наблюдений. */
  count: number;
  /** Среднее наблюдённого reward. */
  mean: number;
  /** Сумма (xᵢ − mean)² — sufficient statistic для variance. */
  m2: number;
};

export type ThompsonSample<Arm> = {
  arm: Arm;
  /** Значение, вытянутое из posterior этого arm'а. */
  sample: number;
  /** Среднее posterior (для UI: «текущая оценка»). */
  posteriorMean: number;
};

export type ThompsonPick<Arm> = {
  arm: Arm;
  samples: ReadonlyArray<ThompsonSample<Arm>>;
  /**
   * Доля samples, где выбранный arm оказался победителем на этой итерации.
   * Для одного прогона всегда 1 (он выиграл 1 из 1). Осмысленное значение
   * появляется при повторных семплах — см. `probabilityArmIsBest`.
   */
  chosenProbability: number;
};

const BETA_PRIOR_ALPHA = 1;
const BETA_PRIOR_BETA = 1;
const NORMAL_PRIOR_MEAN = 0;
const NORMAL_PRIOR_VAR = 1;
/** Нижняя граница variance чтобы семплы не схлопнулись в точку. */
const NORMAL_MIN_VAR = 1e-4;

export function betaPosteriorMean(arm: BetaBernoulliArm): number {
  const alpha = arm.successes + BETA_PRIOR_ALPHA;
  const beta = arm.failures + BETA_PRIOR_BETA;
  return alpha / (alpha + beta);
}

export function normalPosterior(arm: NormalArm): { mean: number; variance: number } {
  if (arm.count <= 0) {
    return { mean: NORMAL_PRIOR_MEAN, variance: NORMAL_PRIOR_VAR };
  }
  const priorPrecision = 1 / NORMAL_PRIOR_VAR;
  const sampleVariance = arm.count > 1 ? Math.max(arm.m2 / (arm.count - 1), NORMAL_MIN_VAR) : NORMAL_PRIOR_VAR;
  const dataPrecision = arm.count / sampleVariance;
  const posteriorPrecision = priorPrecision + dataPrecision;
  const posteriorMean = (priorPrecision * NORMAL_PRIOR_MEAN + dataPrecision * arm.mean) / posteriorPrecision;
  return { mean: posteriorMean, variance: 1 / posteriorPrecision };
}

export function sampleBetaBernoulli<Arm extends BetaBernoulliArm>(
  arms: ReadonlyArray<Arm>,
  prng: Prng,
): ThompsonSample<Arm>[] {
  return arms.map((arm) => {
    const alpha = arm.successes + BETA_PRIOR_ALPHA;
    const beta = arm.failures + BETA_PRIOR_BETA;
    return {
      arm,
      sample: sampleBeta(prng, alpha, beta),
      posteriorMean: betaPosteriorMean(arm),
    };
  });
}

export function sampleNormalArms<Arm extends NormalArm>(
  arms: ReadonlyArray<Arm>,
  prng: Prng,
): ThompsonSample<Arm>[] {
  return arms.map((arm) => {
    const { mean, variance } = normalPosterior(arm);
    const stdDev = Math.sqrt(Math.max(variance, NORMAL_MIN_VAR));
    return {
      arm,
      sample: sampleNormal(prng, mean, stdDev),
      posteriorMean: mean,
    };
  });
}

function pickBest<Arm>(samples: ReadonlyArray<ThompsonSample<Arm>>): ThompsonSample<Arm> {
  if (samples.length === 0) {
    throw new Error('thompson.pickBest: arms list must not be empty');
  }
  let best = samples[0]!;
  for (const current of samples) {
    if (current.sample > best.sample) {
      best = current;
    }
  }
  return best;
}

export function pickThompsonBetaBernoulli<Arm extends BetaBernoulliArm>(
  arms: ReadonlyArray<Arm>,
  seed: number,
): ThompsonPick<Arm> {
  const prng = createMulberry32(seed);
  const samples = sampleBetaBernoulli(arms, prng);
  const winner = pickBest(samples);
  return { arm: winner.arm, samples, chosenProbability: 1 };
}

export function pickThompsonNormal<Arm extends NormalArm>(
  arms: ReadonlyArray<Arm>,
  seed: number,
): ThompsonPick<Arm> {
  const prng = createMulberry32(seed);
  const samples = sampleNormalArms(arms, prng);
  const winner = pickBest(samples);
  return { arm: winner.arm, samples, chosenProbability: 1 };
}

/**
 * Monte-Carlo оценка вероятности того, что каждый arm — лучший.
 * Используется для UI-подсказок «arm X оптимален с вероятностью Y%».
 */
export function probabilityArmIsBest<Arm extends { id: ThompsonArmId }>(
  arms: ReadonlyArray<Arm>,
  sampler: (arm: Arm, prng: Prng) => number,
  seed: number,
  iterations: number,
): Map<ThompsonArmId, number> {
  const prng = createMulberry32(seed);
  const wins = new Map<ThompsonArmId, number>();
  for (const arm of arms) {
    wins.set(arm.id, 0);
  }
  const total = Math.max(1, Math.floor(iterations));
  for (let iter = 0; iter < total; iter += 1) {
    let bestId = arms[0]!.id;
    let bestValue = Number.NEGATIVE_INFINITY;
    for (const arm of arms) {
      const value = sampler(arm, prng);
      if (value > bestValue) {
        bestValue = value;
        bestId = arm.id;
      }
    }
    wins.set(bestId, (wins.get(bestId) ?? 0) + 1);
  }
  const probabilities = new Map<ThompsonArmId, number>();
  for (const [id, count] of wins) {
    probabilities.set(id, count / total);
  }
  return probabilities;
}

export function updateBetaArm(arm: BetaBernoulliArm, reward: number): BetaBernoulliArm {
  const isSuccess = reward > 0;
  return {
    id: arm.id,
    successes: arm.successes + (isSuccess ? 1 : 0),
    failures: arm.failures + (isSuccess ? 0 : 1),
  };
}

/**
 * Онлайн-обновление Normal arm по Welford (single-pass стабильная формула).
 */
export function updateNormalArm(arm: NormalArm, reward: number): NormalArm {
  const count = arm.count + 1;
  const delta = reward - arm.mean;
  const mean = arm.mean + delta / count;
  const delta2 = reward - mean;
  const m2 = arm.m2 + delta * delta2;
  return { id: arm.id, count, mean, m2 };
}
