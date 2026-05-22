/**
 * Bayesian A/B сравнение Thompson Sampling vs epsilon-greedy baseline (P72d).
 *
 * Сравниваем два «агента»:
 *   - Thompson: использует StrategyBanditState.arms (Beta или Normal posterior).
 *   - Baseline: использует StrategyLearningState.arms (runs/rewardSum → синтетическое Beta posterior).
 *
 * P(thompson > baseline) считается через Monte-Carlo:
 *   - На каждой итерации — sample best arm из каждого агента.
 *   - Доля итераций, где thompson's sample > baseline's sample = confidence.
 *
 * Пороговое значение: AB_CONFIDENCE_THRESHOLD = 0.95.
 * Минимальное число наблюдений для принятия решения: AB_MIN_OBSERVATIONS.
 *
 * Модуль чистый (no IO), детерминированный по seed.
 */

import {
  SELF_LEARNING_POSITION_ARMS,
  learningArmKey,
  type LearningArmKey,
  type StrategyBanditState,
  type StrategyLearningState,
} from '../self-learning';
import { createMulberry32, sampleBeta, sampleNormal } from './prng';
import { normalPosterior } from './thompson';

/** P(thompson > baseline) для принятия решения о смене политики. */
export const AB_CONFIDENCE_THRESHOLD = 0.95;

/**
 * Минимальное суммарное число наблюдений по всем arm-ам бандита
 * прежде чем сравнение имеет смысл.
 */
export const AB_MIN_OBSERVATIONS = 50;

export type ABCompareResult =
  | {
      decision: 'insufficient_data';
      thompsonObsTotal: number;
      baselineObsTotal: number;
    }
  | {
      decision: 'thompson_wins' | 'no_winner';
      confidence: number;
      thompsonBestArmKey: LearningArmKey;
      baselineBestArmKey: LearningArmKey;
      thompsonObsTotal: number;
      baselineObsTotal: number;
    };

function totalBanditObs(state: StrategyBanditState): number {
  let total = 0;
  for (const arm of SELF_LEARNING_POSITION_ARMS) {
    const key = learningArmKey(arm.from, arm.to);
    const entry = state.arms[key];
    if (!entry) continue;
    if (state.policy === 'thompson_beta') {
      const b = entry as { successes: number; failures: number };
      total += b.successes + b.failures;
    } else {
      const n = entry as { count: number; mean: number; m2: number };
      total += n.count;
    }
  }
  return total;
}

function totalBaselineObs(state: StrategyLearningState): number {
  let total = 0;
  for (const arm of SELF_LEARNING_POSITION_ARMS) {
    const key = learningArmKey(arm.from, arm.to);
    total += state.arms[key]?.runs ?? 0;
  }
  return total;
}

type ArmKeyedValue = { key: LearningArmKey; value: number };

function argmaxKey(entries: ArmKeyedValue[]): LearningArmKey {
  let best = entries[0]!;
  for (const e of entries) {
    if (e.value > best.value) best = e;
  }
  return best.key;
}

/**
 * Вычислить Bayesian confidence P(thompson > baseline).
 *
 * Работает только для `rewardKind = 'position_hit'` (Beta posterior).
 * Для `economic_delta` (Normal) — см. комментарий ниже.
 */
export function computeABConfidence(
  banditState: StrategyBanditState,
  learningState: StrategyLearningState,
  seed: number,
  iterations: number,
): ABCompareResult {
  const thompsonObsTotal = totalBanditObs(banditState);
  const baselineObsTotal = totalBaselineObs(learningState);

  if (thompsonObsTotal < AB_MIN_OBSERVATIONS || baselineObsTotal < AB_MIN_OBSERVATIONS) {
    return { decision: 'insufficient_data', thompsonObsTotal, baselineObsTotal };
  }

  const prng = createMulberry32(seed);

  // --- Подготовка arm-ов ---

  // Thompson arms
  type ThompsonArmEntry =
    | { kind: 'beta'; key: LearningArmKey; alpha: number; beta: number }
    | { kind: 'normal'; key: LearningArmKey; mean: number; stdDev: number };

  const thompsonArms: ThompsonArmEntry[] = SELF_LEARNING_POSITION_ARMS.map(arm => {
    const key = learningArmKey(arm.from, arm.to);
    if (banditState.policy === 'thompson_beta') {
      const entry = banditState.arms[key] as { successes: number; failures: number } | undefined;
      return {
        kind: 'beta' as const,
        key,
        alpha: (entry?.successes ?? 0) + 1,
        beta: (entry?.failures ?? 0) + 1,
      };
    }
    const entry = banditState.arms[key] as { count: number; mean: number; m2: number } | undefined;
    const fakeNormal = { id: key, count: entry?.count ?? 0, mean: entry?.mean ?? 0, m2: entry?.m2 ?? 0 };
    const { mean, variance } = normalPosterior(fakeNormal);
    return {
      kind: 'normal' as const,
      key,
      mean,
      stdDev: Math.sqrt(Math.max(variance, 1e-4)),
    };
  });

  // Baseline arms: конвертируем runs/rewardSum → синтетическое Beta(α, β).
  // position_hit: rewardSum ∈ [0, runs] → successes=rewardSum, failures=runs-rewardSum.
  // economic_delta: нет прямого Beta-эквивалента, используем нормализованный mean.
  type BaselineArmEntry = { kind: 'beta'; key: LearningArmKey; alpha: number; beta: number };

  const baselineArms: BaselineArmEntry[] = SELF_LEARNING_POSITION_ARMS.map(arm => {
    const key = learningArmKey(arm.from, arm.to);
    const entry = learningState.arms[key];
    const runs = entry?.runs ?? 0;
    const rewardSum = entry?.rewardSum ?? 0;
    // Клипируем на [0, runs] и применяем Laplace-сглаживание (prior Beta(1,1))
    const successes = Math.max(0, Math.min(runs, Math.round(rewardSum)));
    return { kind: 'beta' as const, key, alpha: successes + 1, beta: runs - successes + 1 };
  });

  // --- Monte-Carlo ---
  let thompsonWins = 0;

  // Используем один PRNG и чередуем для thompson и baseline
  for (let iter = 0; iter < iterations; iter++) {
    // Sample thompson best
    const thompsonSamples: ArmKeyedValue[] = thompsonArms.map(arm => {
      if (arm.kind === 'beta') return { key: arm.key, value: sampleBeta(prng, arm.alpha, arm.beta) };
      return { key: arm.key, value: sampleNormal(prng, arm.mean, arm.stdDev) };
    });
    const thompsonBest = Math.max(...thompsonSamples.map(s => s.value));

    // Sample baseline best
    const baselineSamples: ArmKeyedValue[] = baselineArms.map(arm => ({
      key: arm.key,
      value: sampleBeta(prng, arm.alpha, arm.beta),
    }));
    const baselineBest = Math.max(...baselineSamples.map(s => s.value));

    if (thompsonBest > baselineBest) thompsonWins++;
  }

  const confidence = thompsonWins / Math.max(1, iterations);

  // Лучший arm каждого агента по posteriorMean
  const thompsonBestArmKey = argmaxKey(
    thompsonArms.map(arm => ({
      key: arm.key,
      value: arm.kind === 'beta' ? arm.alpha / (arm.alpha + arm.beta) : arm.mean,
    })),
  );

  const baselineBestArmKey = argmaxKey(
    baselineArms.map(arm => ({ key: arm.key, value: arm.alpha / (arm.alpha + arm.beta) })),
  );

  return {
    decision: confidence >= AB_CONFIDENCE_THRESHOLD ? 'thompson_wins' : 'no_winner',
    confidence,
    thompsonBestArmKey,
    baselineBestArmKey,
    thompsonObsTotal,
    baselineObsTotal,
  };
}
