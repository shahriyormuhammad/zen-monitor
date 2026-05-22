/**
 * Self-learning автопилот стратегий рекламы.
 *
 * Чистые функции для выбора целевой позиции из нескольких arms
 * (explore/exploit pattern, deterministic seeding). Это будущий основной
 * кандидат для замены на полноценные Bayesian bandits (Thompson Sampling)
 * в рамках P72 — текущая реализация использует epsilon-greedy с
 * наименее-исследованным выбором на explore-шагах.
 *
 * Модуль не содержит зависимостей от DB/IO, что позволяет покрыть его
 * unit-тестами и в будущем менять алгоритм без регрессии в workspace.ts.
 */

export const SELF_LEARNING_POSITION_ARMS = [
  { from: 1, to: 2 },
  { from: 2, to: 3 },
  { from: 3, to: 5 },
  { from: 4, to: 6 },
] as const;

export const BANDIT_POLICIES = ['epsilon_greedy', 'thompson_beta', 'thompson_normal'] as const;
export type BanditPolicy = (typeof BANDIT_POLICIES)[number];

export const BANDIT_REWARD_KINDS = ['position_hit', 'economic_delta'] as const;
export type BanditRewardKind = (typeof BANDIT_REWARD_KINDS)[number];

export const DEFAULT_STRATEGY_AUTOPILOT_CONFIG = {
  mode: 'classic',
  targetPositionFrom: 1,
  targetPositionTo: 2,
  explorationPct: 20,
  minClicksForLearning: 15,
  retestCooldownHours: 24,
  retestPercent: 10,
  maxRetestPerRun: 3,
  // P72b: Thompson Sampling в shadow-mode — считаем параллельно с epsilon-greedy,
  // логируем delta, но применяем по-прежнему epsilon-greedy. Default — не ломает
  // поведение существующих стратегий.
  policy: 'epsilon_greedy',
  rewardKind: 'position_hit',
} as const;

export type StrategyControlMode = 'classic' | 'self_learning';

export type StrategyAutopilotConfig = {
  mode: StrategyControlMode;
  targetPositionFrom: number;
  targetPositionTo: number;
  explorationPct: number;
  minClicksForLearning: number;
  retestCooldownHours: number;
  retestPercent: number;
  maxRetestPerRun: number;
  policy: BanditPolicy;
  rewardKind: BanditRewardKind;
};

export type LearningArmKey = `${number}-${number}`;

export type LearningArmState = {
  runs: number;
  rewardSum: number;
  spendSum: number;
  ordersSum: number;
  savingsSum: number;
  avgPosSum: number;
  avgPosSamples: number;
};

export type BetaPosteriorArm = {
  successes: number;
  failures: number;
};

export type NormalPosteriorArm = {
  count: number;
  mean: number;
  m2: number;
};

export type StrategyBanditShadowDelta = {
  matches: number;
  mismatches: number;
  total: number;
};

export type StrategyBanditState =
  | {
    policy: 'thompson_beta';
    rewardKind: BanditRewardKind;
    arms: Record<LearningArmKey, BetaPosteriorArm>;
    shadowDelta: StrategyBanditShadowDelta;
    lastPick: { key: LearningArmKey; from: number; to: number } | null;
    updatedAt: string | null;
  }
  | {
    policy: 'thompson_normal';
    rewardKind: BanditRewardKind;
    arms: Record<LearningArmKey, NormalPosteriorArm>;
    shadowDelta: StrategyBanditShadowDelta;
    lastPick: { key: LearningArmKey; from: number; to: number } | null;
    updatedAt: string | null;
  };

export type StrategyLearningState = {
  version: number;
  lastTarget: {
    from: number;
    to: number;
  } | null;
  totalRuns: number;
  totalEstimatedSavingsRub: number;
  totalRetestedClusters: number;
  arms: Record<LearningArmKey, LearningArmState>;
  /**
   * P72b: posterior для Thompson Sampling. Обновляется параллельно с legacy
   * arms при runStatus ∈ {applied, skipped}. В shadow-mode выбор не влияет
   * на итоговый bid — это только «вторая голова» для сравнения.
   */
  bandit?: StrategyBanditState;
  updatedAt: string | null;
};

export type SelfLearningPick = {
  from: number;
  to: number;
  key: LearningArmKey;
  exploration: boolean;
  reason: 'exploration' | 'configured_target' | 'best_reward';
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toInt(value: unknown): number {
  return Math.round(toNumber(value));
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function clampInt(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, Math.round(value)));
}

function clampNumber(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

function asFiniteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toPlainObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function learningArmKey(from: number, to: number): LearningArmKey {
  return `${Math.round(from)}-${Math.round(to)}`;
}

export function createEmptyLearningArm(): LearningArmState {
  return {
    runs: 0,
    rewardSum: 0,
    spendSum: 0,
    ordersSum: 0,
    savingsSum: 0,
    avgPosSum: 0,
    avgPosSamples: 0,
  };
}

export function createDefaultLearningState(): StrategyLearningState {
  const arms: Record<LearningArmKey, LearningArmState> = {} as Record<LearningArmKey, LearningArmState>;
  for (const arm of SELF_LEARNING_POSITION_ARMS) {
    arms[learningArmKey(arm.from, arm.to)] = createEmptyLearningArm();
  }
  return {
    version: 1,
    lastTarget: null,
    totalRuns: 0,
    totalEstimatedSavingsRub: 0,
    totalRetestedClusters: 0,
    arms,
    updatedAt: null,
  };
}

function normalizeBanditPolicy(value: unknown): BanditPolicy {
  return BANDIT_POLICIES.includes(value as BanditPolicy)
    ? (value as BanditPolicy)
    : 'epsilon_greedy';
}

function normalizeBanditRewardKind(value: unknown): BanditRewardKind {
  return BANDIT_REWARD_KINDS.includes(value as BanditRewardKind)
    ? (value as BanditRewardKind)
    : 'position_hit';
}

export function normalizeAutopilotConfig(
  input: Partial<StrategyAutopilotConfig> | null | undefined,
): StrategyAutopilotConfig {
  const mode = input?.mode === 'self_learning' ? 'self_learning' : 'classic';
  const targetPositionFrom = clampInt(
    Number(input?.targetPositionFrom ?? DEFAULT_STRATEGY_AUTOPILOT_CONFIG.targetPositionFrom),
    1,
    20,
  );
  const targetPositionToRaw = clampInt(
    Number(input?.targetPositionTo ?? DEFAULT_STRATEGY_AUTOPILOT_CONFIG.targetPositionTo),
    targetPositionFrom,
    30,
  );
  const targetPositionTo = Math.max(targetPositionFrom, targetPositionToRaw);

  return {
    mode,
    targetPositionFrom,
    targetPositionTo,
    explorationPct: round(clampNumber(
      Number(input?.explorationPct ?? DEFAULT_STRATEGY_AUTOPILOT_CONFIG.explorationPct),
      0,
      100,
    ), 2),
    minClicksForLearning: clampInt(
      Number(input?.minClicksForLearning ?? DEFAULT_STRATEGY_AUTOPILOT_CONFIG.minClicksForLearning),
      1,
      2_000,
    ),
    retestCooldownHours: clampInt(
      Number(input?.retestCooldownHours ?? DEFAULT_STRATEGY_AUTOPILOT_CONFIG.retestCooldownHours),
      1,
      24 * 30,
    ),
    retestPercent: round(clampNumber(
      Number(input?.retestPercent ?? DEFAULT_STRATEGY_AUTOPILOT_CONFIG.retestPercent),
      0,
      100,
    ), 2),
    maxRetestPerRun: clampInt(
      Number(input?.maxRetestPerRun ?? DEFAULT_STRATEGY_AUTOPILOT_CONFIG.maxRetestPerRun),
      0,
      50,
    ),
    policy: normalizeBanditPolicy(input?.policy ?? DEFAULT_STRATEGY_AUTOPILOT_CONFIG.policy),
    rewardKind: normalizeBanditRewardKind(
      input?.rewardKind ?? DEFAULT_STRATEGY_AUTOPILOT_CONFIG.rewardKind,
    ),
  };
}

export function readAutopilotConfigFromSummary(summaryValue: unknown): StrategyAutopilotConfig {
  const summary = toPlainObject(summaryValue);
  const configCandidate = toPlainObject(summary.autopilotConfig);
  return normalizeAutopilotConfig({
    mode: configCandidate.mode === 'self_learning' ? 'self_learning' : 'classic',
    targetPositionFrom: asFiniteNumber(configCandidate.targetPositionFrom),
    targetPositionTo: asFiniteNumber(configCandidate.targetPositionTo),
    explorationPct: asFiniteNumber(configCandidate.explorationPct),
    minClicksForLearning: asFiniteNumber(configCandidate.minClicksForLearning),
    retestCooldownHours: asFiniteNumber(configCandidate.retestCooldownHours),
    retestPercent: asFiniteNumber(configCandidate.retestPercent),
    maxRetestPerRun: asFiniteNumber(configCandidate.maxRetestPerRun),
    policy: normalizeBanditPolicy(configCandidate.policy),
    rewardKind: normalizeBanditRewardKind(configCandidate.rewardKind),
  });
}

export function mergeAutopilotConfigIntoSummary(
  summaryValue: unknown,
  config: StrategyAutopilotConfig,
): Record<string, unknown> {
  const summary = toPlainObject(summaryValue);
  return {
    ...summary,
    autopilotConfig: config,
  };
}

function readBanditStateRaw(rawBandit: unknown): StrategyBanditState | undefined {
  const raw = toPlainObject(rawBandit);
  if (raw.policy !== 'thompson_beta' && raw.policy !== 'thompson_normal') {
    return undefined;
  }
  const rewardKind = raw.rewardKind === 'economic_delta' ? 'economic_delta' : 'position_hit';
  const rawArms = toPlainObject(raw.arms);
  const shadowRaw = toPlainObject(raw.shadowDelta);
  const shadowDelta: StrategyBanditShadowDelta = {
    matches: Math.max(0, toInt(shadowRaw.matches)),
    mismatches: Math.max(0, toInt(shadowRaw.mismatches)),
    total: Math.max(0, toInt(shadowRaw.total)),
  };
  const lastPickRaw = toPlainObject(raw.lastPick);
  const lastPickFrom = toInt(lastPickRaw.from);
  const lastPickTo = toInt(lastPickRaw.to);
  const lastPick =
    lastPickFrom > 0 && lastPickTo >= lastPickFrom
      ? { key: learningArmKey(lastPickFrom, lastPickTo), from: lastPickFrom, to: lastPickTo }
      : null;
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;

  if (raw.policy === 'thompson_beta') {
    const arms: Record<LearningArmKey, BetaPosteriorArm> = {} as Record<LearningArmKey, BetaPosteriorArm>;
    for (const arm of SELF_LEARNING_POSITION_ARMS) {
      const key = learningArmKey(arm.from, arm.to);
      const candidate = toPlainObject(rawArms[key]);
      arms[key] = {
        successes: Math.max(0, toInt(candidate.successes)),
        failures: Math.max(0, toInt(candidate.failures)),
      };
    }
    return {
      policy: 'thompson_beta',
      rewardKind,
      arms,
      shadowDelta,
      lastPick,
      updatedAt,
    };
  }

  const arms: Record<LearningArmKey, NormalPosteriorArm> = {} as Record<LearningArmKey, NormalPosteriorArm>;
  for (const arm of SELF_LEARNING_POSITION_ARMS) {
    const key = learningArmKey(arm.from, arm.to);
    const candidate = toPlainObject(rawArms[key]);
    arms[key] = {
      count: Math.max(0, toInt(candidate.count)),
      mean: round(toNumber(candidate.mean), 6),
      m2: Math.max(0, round(toNumber(candidate.m2), 6)),
    };
  }
  return {
    policy: 'thompson_normal',
    rewardKind,
    arms,
    shadowDelta,
    lastPick,
    updatedAt,
  };
}

export function readLearningStateFromSummary(summaryValue: unknown): StrategyLearningState {
  const summary = toPlainObject(summaryValue);
  const raw = toPlainObject(summary.learningState);
  const defaultState = createDefaultLearningState();
  const rawArms = toPlainObject(raw.arms);
  const nextArms: Record<LearningArmKey, LearningArmState> = {} as Record<LearningArmKey, LearningArmState>;

  for (const arm of SELF_LEARNING_POSITION_ARMS) {
    const key = learningArmKey(arm.from, arm.to);
    const candidate = toPlainObject(rawArms[key]);
    nextArms[key] = {
      runs: Math.max(0, toInt(candidate.runs)),
      rewardSum: round(toNumber(candidate.rewardSum), 6),
      spendSum: round(toNumber(candidate.spendSum), 2),
      ordersSum: Math.max(0, toInt(candidate.ordersSum)),
      savingsSum: round(toNumber(candidate.savingsSum), 2),
      avgPosSum: round(toNumber(candidate.avgPosSum), 6),
      avgPosSamples: Math.max(0, toInt(candidate.avgPosSamples)),
    };
  }

  const lastTargetRaw = toPlainObject(raw.lastTarget);
  const lastTargetFrom = toInt(lastTargetRaw.from);
  const lastTargetTo = toInt(lastTargetRaw.to);

  const bandit = readBanditStateRaw(raw.bandit);

  return {
    ...defaultState,
    version: Math.max(1, toInt(raw.version) || 1),
    lastTarget: lastTargetFrom > 0 && lastTargetTo >= lastTargetFrom
      ? { from: lastTargetFrom, to: lastTargetTo }
      : null,
    totalRuns: Math.max(0, toInt(raw.totalRuns)),
    totalEstimatedSavingsRub: round(toNumber(raw.totalEstimatedSavingsRub), 2),
    totalRetestedClusters: Math.max(0, toInt(raw.totalRetestedClusters)),
    arms: nextArms,
    ...(bandit ? { bandit } : {}),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  };
}

export function mergeLearningStateIntoSummary(
  summaryValue: unknown,
  learningState: StrategyLearningState,
): Record<string, unknown> {
  const summary = toPlainObject(summaryValue);
  return {
    ...summary,
    learningState,
  };
}

export function buildDeterministicSeed(strategyId: string, referenceDate: Date): number {
  const source = `${strategyId}:${referenceDate.toISOString().slice(0, 16)}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/**
 * Выбирает следующую позицию-arm для стратегии self_learning.
 *
 * Алгоритм: epsilon-greedy с детерминированной псевдослучайностью по
 * (strategyId, referenceDate). При попадании в explore-окно выбирается
 * arm с наименьшим числом runs; при tie-breaking — arm с лучшим средним
 * reward. В exploit-фазе выбирается arm с максимальным средним reward,
 * при пустой истории — configured target.
 */
export function pickSelfLearningTarget(
  config: StrategyAutopilotConfig,
  learningState: StrategyLearningState,
  strategyId: string,
  referenceDate: Date,
): SelfLearningPick {
  const desiredKey = learningArmKey(config.targetPositionFrom, config.targetPositionTo);
  const arms = SELF_LEARNING_POSITION_ARMS.map((arm) => {
    const key = learningArmKey(arm.from, arm.to);
    const stats = learningState.arms[key] ?? createEmptyLearningArm();
    const avgReward = stats.runs > 0 ? stats.rewardSum / stats.runs : Number.NEGATIVE_INFINITY;
    return { ...arm, key, stats, avgReward };
  });

  const seed = buildDeterministicSeed(strategyId, referenceDate);
  const exploreThreshold = seed % 100;
  const shouldExplore = exploreThreshold < config.explorationPct;

  if (shouldExplore) {
    let leastRuns = Number.POSITIVE_INFINITY;
    let selected = arms[0]!;
    for (const arm of arms) {
      if (arm.stats.runs < leastRuns) {
        selected = arm;
        leastRuns = arm.stats.runs;
      } else if (arm.stats.runs === leastRuns && arm.avgReward > selected.avgReward) {
        selected = arm;
      }
    }
    return {
      from: selected.from,
      to: selected.to,
      key: selected.key,
      exploration: true,
      reason: 'exploration',
    };
  }

  let selected = arms.find((arm) => arm.key === desiredKey) ?? arms[0]!;
  for (const arm of arms) {
    if (arm.avgReward > selected.avgReward) {
      selected = arm;
    }
  }

  return {
    from: selected.from,
    to: selected.to,
    key: selected.key,
    exploration: false,
    reason: selected.key === desiredKey ? 'configured_target' : 'best_reward',
  };
}

export function isPositionInRange(avgPos: number | null, from: number, to: number): boolean {
  if (avgPos === null || !Number.isFinite(avgPos)) {
    return false;
  }
  return avgPos >= from && avgPos <= to;
}
