/**
 * Интеграция Thompson Sampling bandits со StrategyLearningState (P72b).
 *
 * Модуль — «мостик» между чистой математикой (thompson.ts) и существующим
 * self-learning (self-learning.ts). Shadow-mode: выбор не применяется
 * автоматически, но posterior обновляется и записывается в summary.bandit
 * для последующего сравнения с epsilon-greedy.
 *
 * Функции чистые, без IO. Детерминированы по (strategyId, referenceDate)
 * через тот же `buildDeterministicSeed`, что epsilon-greedy.
 */

import {
  SELF_LEARNING_POSITION_ARMS,
  buildDeterministicSeed,
  learningArmKey,
  type BanditPolicy,
  type BanditRewardKind,
  type BetaPosteriorArm,
  type LearningArmKey,
  type NormalPosteriorArm,
  type StrategyBanditShadowDelta,
  type StrategyBanditState,
} from '../self-learning';
import {
  pickThompsonBetaBernoulli,
  pickThompsonNormal,
  type BetaBernoulliArm,
  type NormalArm,
} from './thompson';

const BANDIT_SEED_SALT = 'bandit';
/** clip для economic reward: log-ratio ограничен, чтобы выбросы не искажали posterior. */
const ECONOMIC_REWARD_CLIP = 3;

export type BanditShadowPick = {
  policy: Exclude<BanditPolicy, 'epsilon_greedy'>;
  from: number;
  to: number;
  key: LearningArmKey;
  samples: Array<{ key: LearningArmKey; from: number; to: number; sample: number; posteriorMean: number }>;
};

export type BanditPickOutcome = {
  /** Выбор bandit-алгоритма. Для policy='epsilon_greedy' — null. */
  shadow: BanditShadowPick | null;
  /**
   * Совпал ли выбор bandit с фактическим (epsilon-greedy) решением. Нужно
   * для shadowDelta: matches растёт при совпадении, mismatches — при расхождении.
   */
  matchesApplied: boolean | null;
};

function emptyShadowDelta(): StrategyBanditShadowDelta {
  return { matches: 0, mismatches: 0, total: 0 };
}

function makeBetaArms(): Record<LearningArmKey, BetaPosteriorArm> {
  const arms: Record<LearningArmKey, BetaPosteriorArm> = {} as Record<LearningArmKey, BetaPosteriorArm>;
  for (const arm of SELF_LEARNING_POSITION_ARMS) {
    arms[learningArmKey(arm.from, arm.to)] = { successes: 0, failures: 0 };
  }
  return arms;
}

function makeNormalArms(): Record<LearningArmKey, NormalPosteriorArm> {
  const arms: Record<LearningArmKey, NormalPosteriorArm> = {} as Record<LearningArmKey, NormalPosteriorArm>;
  for (const arm of SELF_LEARNING_POSITION_ARMS) {
    arms[learningArmKey(arm.from, arm.to)] = { count: 0, mean: 0, m2: 0 };
  }
  return arms;
}

export function createEmptyBanditState(
  policy: Exclude<BanditPolicy, 'epsilon_greedy'>,
  rewardKind: BanditRewardKind,
): StrategyBanditState {
  if (policy === 'thompson_beta') {
    return {
      policy: 'thompson_beta',
      rewardKind,
      arms: makeBetaArms(),
      shadowDelta: emptyShadowDelta(),
      lastPick: null,
      updatedAt: null,
    };
  }
  return {
    policy: 'thompson_normal',
    rewardKind,
    arms: makeNormalArms(),
    shadowDelta: emptyShadowDelta(),
    lastPick: null,
    updatedAt: null,
  };
}

/**
 * Гарантирует соответствие banditState конфигу. Если policy сменился
 * (пользователь переключил thompson_beta → thompson_normal или наоборот),
 * или rewardKind — строим свежий posterior.
 */
export function ensureBanditStateMatches(
  banditState: StrategyBanditState | undefined,
  policy: Exclude<BanditPolicy, 'epsilon_greedy'>,
  rewardKind: BanditRewardKind,
): StrategyBanditState {
  if (!banditState || banditState.policy !== policy || banditState.rewardKind !== rewardKind) {
    return createEmptyBanditState(policy, rewardKind);
  }
  return banditState;
}

function toBetaArmsForSampler(
  arms: Record<LearningArmKey, BetaPosteriorArm>,
): Array<BetaBernoulliArm & { key: LearningArmKey; from: number; to: number }> {
  return SELF_LEARNING_POSITION_ARMS.map((arm) => {
    const key = learningArmKey(arm.from, arm.to);
    const posterior = arms[key] ?? { successes: 0, failures: 0 };
    return { id: key, key, from: arm.from, to: arm.to, successes: posterior.successes, failures: posterior.failures };
  });
}

function toNormalArmsForSampler(
  arms: Record<LearningArmKey, NormalPosteriorArm>,
): Array<NormalArm & { key: LearningArmKey; from: number; to: number }> {
  return SELF_LEARNING_POSITION_ARMS.map((arm) => {
    const key = learningArmKey(arm.from, arm.to);
    const posterior = arms[key] ?? { count: 0, mean: 0, m2: 0 };
    return {
      id: key,
      key,
      from: arm.from,
      to: arm.to,
      count: posterior.count,
      mean: posterior.mean,
      m2: posterior.m2,
    };
  });
}

function banditSeed(strategyId: string, referenceDate: Date): number {
  return buildDeterministicSeed(`${strategyId}:${BANDIT_SEED_SALT}`, referenceDate);
}

export function pickBanditShadow(
  banditState: StrategyBanditState,
  strategyId: string,
  referenceDate: Date,
): BanditShadowPick {
  const seed = banditSeed(strategyId, referenceDate);
  if (banditState.policy === 'thompson_beta') {
    const arms = toBetaArmsForSampler(banditState.arms);
    const pick = pickThompsonBetaBernoulli(arms, seed);
    return {
      policy: 'thompson_beta',
      from: pick.arm.from,
      to: pick.arm.to,
      key: pick.arm.key,
      samples: pick.samples.map((sample) => ({
        key: sample.arm.key,
        from: sample.arm.from,
        to: sample.arm.to,
        sample: sample.sample,
        posteriorMean: sample.posteriorMean,
      })),
    };
  }
  const arms = toNormalArmsForSampler(banditState.arms);
  const pick = pickThompsonNormal(arms, seed);
  return {
    policy: 'thompson_normal',
    from: pick.arm.from,
    to: pick.arm.to,
    key: pick.arm.key,
    samples: pick.samples.map((sample) => ({
      key: sample.arm.key,
      from: sample.arm.from,
      to: sample.arm.to,
      sample: sample.sample,
      posteriorMean: sample.posteriorMean,
    })),
  };
}

export type BanditRewardInput = {
  rewardKind: BanditRewardKind;
  /** avg позиция за окно; null — нет данных. */
  observedAvgPos: number | null;
  /** диапазон целевой позиции arm'а, на который идёт обновление. */
  targetFrom: number;
  targetTo: number;
  /** ACOS = adSpend / revenue × 100 за окно. null — нет данных. */
  observedAcosPct: number | null;
  /** целевой ACOS из стратегии. */
  targetAcosPct: number;
};

/**
 * Reward в единицах:
 *   position_hit → {0, 1}
 *   economic_delta → log(targetAcos / observedAcos), clipped [-3, 3].
 *     Хорошая стратегия (observedAcos < targetAcos) → positive reward.
 *     null observed → 0 (нейтрально).
 */
export function computeBanditReward(input: BanditRewardInput): number {
  if (input.rewardKind === 'position_hit') {
    if (input.observedAvgPos === null || !Number.isFinite(input.observedAvgPos)) {
      return 0;
    }
    return input.observedAvgPos >= input.targetFrom && input.observedAvgPos <= input.targetTo ? 1 : 0;
  }
  // economic_delta
  if (
    input.observedAcosPct === null
    || !Number.isFinite(input.observedAcosPct)
    || input.observedAcosPct <= 0
    || input.targetAcosPct <= 0
  ) {
    return 0;
  }
  const raw = Math.log(input.targetAcosPct / input.observedAcosPct);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(-ECONOMIC_REWARD_CLIP, Math.min(ECONOMIC_REWARD_CLIP, raw));
}

function roundPrecise(value: number, precision = 6): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function updateBanditPosterior(
  banditState: StrategyBanditState,
  armKey: LearningArmKey,
  reward: number,
  pickFrom: number,
  pickTo: number,
  matchedApplied: boolean,
  now: Date,
): StrategyBanditState {
  const nowIso = now.toISOString();
  if (banditState.policy === 'thompson_beta') {
    const current = banditState.arms[armKey] ?? { successes: 0, failures: 0 };
    const isSuccess = reward > 0;
    const nextArms: Record<LearningArmKey, BetaPosteriorArm> = {
      ...banditState.arms,
      [armKey]: {
        successes: current.successes + (isSuccess ? 1 : 0),
        failures: current.failures + (isSuccess ? 0 : 1),
      },
    };
    return {
      policy: 'thompson_beta',
      rewardKind: banditState.rewardKind,
      arms: nextArms,
      shadowDelta: applyShadowDelta(banditState.shadowDelta, matchedApplied),
      lastPick: { key: armKey, from: pickFrom, to: pickTo },
      updatedAt: nowIso,
    };
  }
  const current = banditState.arms[armKey] ?? { count: 0, mean: 0, m2: 0 };
  const count = current.count + 1;
  const delta = reward - current.mean;
  const mean = current.mean + delta / count;
  const delta2 = reward - mean;
  const m2 = current.m2 + delta * delta2;
  const nextArms: Record<LearningArmKey, NormalPosteriorArm> = {
    ...banditState.arms,
    [armKey]: {
      count,
      mean: roundPrecise(mean, 6),
      m2: roundPrecise(m2, 6),
    },
  };
  return {
    policy: 'thompson_normal',
    rewardKind: banditState.rewardKind,
    arms: nextArms,
    shadowDelta: applyShadowDelta(banditState.shadowDelta, matchedApplied),
    lastPick: { key: armKey, from: pickFrom, to: pickTo },
    updatedAt: nowIso,
  };
}

function applyShadowDelta(
  current: StrategyBanditShadowDelta,
  matched: boolean,
): StrategyBanditShadowDelta {
  return {
    total: current.total + 1,
    matches: current.matches + (matched ? 1 : 0),
    mismatches: current.mismatches + (matched ? 0 : 1),
  };
}
