import { describe, it, expect } from 'vitest';
import {
  SELF_LEARNING_POSITION_ARMS,
  DEFAULT_STRATEGY_AUTOPILOT_CONFIG,
  buildDeterministicSeed,
  createDefaultLearningState,
  createEmptyLearningArm,
  isPositionInRange,
  learningArmKey,
  mergeAutopilotConfigIntoSummary,
  mergeLearningStateIntoSummary,
  normalizeAutopilotConfig,
  pickSelfLearningTarget,
  readAutopilotConfigFromSummary,
  readLearningStateFromSummary,
  type StrategyAutopilotConfig,
} from './self-learning';

const STRATEGY_ID = '01234567-89ab-cdef-0123-456789abcdef';
const REF_DATE = new Date('2026-04-19T10:00:00Z');

function makeConfig(overrides: Partial<StrategyAutopilotConfig> = {}): StrategyAutopilotConfig {
  return normalizeAutopilotConfig({
    mode: 'self_learning',
    targetPositionFrom: 1,
    targetPositionTo: 2,
    explorationPct: 20,
    minClicksForLearning: 15,
    retestCooldownHours: 24,
    retestPercent: 10,
    maxRetestPerRun: 3,
    ...overrides,
  });
}

describe('learningArmKey', () => {
  it('округляет до целых', () => {
    expect(learningArmKey(1, 2)).toBe('1-2');
    expect(learningArmKey(1.4, 2.6)).toBe('1-3');
  });
});

describe('createEmptyLearningArm', () => {
  it('возвращает нулевой arm', () => {
    expect(createEmptyLearningArm()).toEqual({
      runs: 0,
      rewardSum: 0,
      spendSum: 0,
      ordersSum: 0,
      savingsSum: 0,
      avgPosSum: 0,
      avgPosSamples: 0,
    });
  });
});

describe('createDefaultLearningState', () => {
  it('создаёт нулевое состояние со всеми 4 arms', () => {
    const state = createDefaultLearningState();
    expect(state.version).toBe(1);
    expect(state.lastTarget).toBeNull();
    expect(state.totalRuns).toBe(0);
    expect(Object.keys(state.arms)).toHaveLength(SELF_LEARNING_POSITION_ARMS.length);
    for (const arm of SELF_LEARNING_POSITION_ARMS) {
      expect(state.arms[learningArmKey(arm.from, arm.to)]).toEqual(createEmptyLearningArm());
    }
  });
});

describe('normalizeAutopilotConfig', () => {
  it('возвращает defaults при пустом input', () => {
    const result = normalizeAutopilotConfig(null);
    expect(result.mode).toBe('classic');
    expect(result.targetPositionFrom).toBe(DEFAULT_STRATEGY_AUTOPILOT_CONFIG.targetPositionFrom);
    expect(result.targetPositionTo).toBe(DEFAULT_STRATEGY_AUTOPILOT_CONFIG.targetPositionTo);
    expect(result.explorationPct).toBe(DEFAULT_STRATEGY_AUTOPILOT_CONFIG.explorationPct);
  });

  it('ограничивает explorationPct до [0, 100]', () => {
    expect(normalizeAutopilotConfig({ explorationPct: -50 }).explorationPct).toBe(0);
    expect(normalizeAutopilotConfig({ explorationPct: 150 }).explorationPct).toBe(100);
    expect(normalizeAutopilotConfig({ explorationPct: 33.5 }).explorationPct).toBe(33.5);
  });

  it('гарантирует targetPositionTo ≥ targetPositionFrom', () => {
    const result = normalizeAutopilotConfig({ targetPositionFrom: 5, targetPositionTo: 2 });
    expect(result.targetPositionFrom).toBe(5);
    expect(result.targetPositionTo).toBe(5);
  });

  it('ограничивает targetPositionFrom до [1, 20]', () => {
    expect(normalizeAutopilotConfig({ targetPositionFrom: 0 }).targetPositionFrom).toBe(1);
    expect(normalizeAutopilotConfig({ targetPositionFrom: 99 }).targetPositionFrom).toBe(20);
  });

  it('принимает self_learning mode и classic по умолчанию', () => {
    expect(normalizeAutopilotConfig({ mode: 'self_learning' }).mode).toBe('self_learning');
    expect(normalizeAutopilotConfig({ mode: 'unknown' as 'classic' }).mode).toBe('classic');
  });
});

describe('readAutopilotConfigFromSummary', () => {
  it('возвращает normalized config даже при невалидных данных', () => {
    const config = readAutopilotConfigFromSummary({
      autopilotConfig: {
        mode: 'self_learning',
        explorationPct: 'abc',
        targetPositionFrom: -5,
      },
    });
    expect(config.mode).toBe('self_learning');
    expect(config.explorationPct).toBe(DEFAULT_STRATEGY_AUTOPILOT_CONFIG.explorationPct);
    expect(config.targetPositionFrom).toBe(1);
  });

  it('обрабатывает пустой summary', () => {
    expect(readAutopilotConfigFromSummary(null).mode).toBe('classic');
    expect(readAutopilotConfigFromSummary({}).mode).toBe('classic');
  });
});

describe('mergeAutopilotConfigIntoSummary / mergeLearningStateIntoSummary', () => {
  it('внедряет autopilotConfig не теряя остальных полей summary', () => {
    const config = makeConfig();
    const summary = mergeAutopilotConfigIntoSummary({ other: 'kept', foo: 1 }, config);
    expect(summary.other).toBe('kept');
    expect(summary.foo).toBe(1);
    expect(summary.autopilotConfig).toEqual(config);
  });

  it('внедряет learningState не теряя autopilotConfig', () => {
    const state = createDefaultLearningState();
    const merged = mergeLearningStateIntoSummary({ autopilotConfig: { mode: 'classic' } }, state);
    expect(merged.autopilotConfig).toEqual({ mode: 'classic' });
    expect(merged.learningState).toBe(state);
  });
});

describe('readLearningStateFromSummary', () => {
  it('возвращает default state при пустом summary', () => {
    const state = readLearningStateFromSummary(null);
    expect(state.version).toBe(1);
    expect(state.totalRuns).toBe(0);
    expect(Object.keys(state.arms)).toHaveLength(SELF_LEARNING_POSITION_ARMS.length);
  });

  it('читает существующие arms с round-trip', () => {
    const originalArm = {
      runs: 10,
      rewardSum: 5.5,
      spendSum: 1234.56,
      ordersSum: 15,
      savingsSum: 200.75,
      avgPosSum: 23.4,
      avgPosSamples: 10,
    };
    const summary = {
      learningState: {
        version: 2,
        totalRuns: 42,
        lastTarget: { from: 3, to: 5 },
        arms: {
          '1-2': originalArm,
        },
      },
    };
    const state = readLearningStateFromSummary(summary);
    expect(state.version).toBe(2);
    expect(state.totalRuns).toBe(42);
    expect(state.lastTarget).toEqual({ from: 3, to: 5 });
    expect(state.arms['1-2']).toEqual(originalArm);
  });

  it('санирует невалидные arm поля', () => {
    const summary = {
      learningState: {
        arms: {
          '1-2': {
            runs: -5,
            rewardSum: 'abc',
            ordersSum: -3,
          },
        },
      },
    };
    const state = readLearningStateFromSummary(summary);
    expect(state.arms['1-2']!.runs).toBe(0);
    expect(state.arms['1-2']!.rewardSum).toBe(0);
    expect(state.arms['1-2']!.ordersSum).toBe(0);
  });

  it('отбрасывает невалидный lastTarget (from > to)', () => {
    const state = readLearningStateFromSummary({
      learningState: { lastTarget: { from: 5, to: 2 } },
    });
    expect(state.lastTarget).toBeNull();
  });
});

describe('buildDeterministicSeed', () => {
  it('возвращает одинаковое значение для одинаковых input', () => {
    const a = buildDeterministicSeed(STRATEGY_ID, REF_DATE);
    const b = buildDeterministicSeed(STRATEGY_ID, REF_DATE);
    expect(a).toBe(b);
  });

  it('разные strategyId дают разные seed', () => {
    const a = buildDeterministicSeed(STRATEGY_ID, REF_DATE);
    const b = buildDeterministicSeed('fedcba98-7654-3210-fedc-ba9876543210', REF_DATE);
    expect(a).not.toBe(b);
  });

  it('игнорирует секунды внутри минуты', () => {
    const a = buildDeterministicSeed(STRATEGY_ID, new Date('2026-04-19T10:00:00Z'));
    const b = buildDeterministicSeed(STRATEGY_ID, new Date('2026-04-19T10:00:59Z'));
    expect(a).toBe(b);
  });

  it('следующая минута даёт другой seed', () => {
    const a = buildDeterministicSeed(STRATEGY_ID, new Date('2026-04-19T10:00:00Z'));
    const b = buildDeterministicSeed(STRATEGY_ID, new Date('2026-04-19T10:01:00Z'));
    expect(a).not.toBe(b);
  });
});

describe('pickSelfLearningTarget', () => {
  it('при explorationPct=0 и пустой истории возвращает configured target (no exploit data yet)', () => {
    const config = makeConfig({ explorationPct: 0, targetPositionFrom: 3, targetPositionTo: 5 });
    const state = createDefaultLearningState();
    const result = pickSelfLearningTarget(config, state, STRATEGY_ID, REF_DATE);
    expect(result.from).toBe(3);
    expect(result.to).toBe(5);
    expect(result.exploration).toBe(false);
    expect(result.reason).toBe('configured_target');
  });

  it('при explorationPct=100 всегда exploration', () => {
    const config = makeConfig({ explorationPct: 100 });
    const state = createDefaultLearningState();
    const result = pickSelfLearningTarget(config, state, STRATEGY_ID, REF_DATE);
    expect(result.exploration).toBe(true);
    expect(result.reason).toBe('exploration');
  });

  it('в explore-фазе выбирает arm с наименьшим числом runs', () => {
    const config = makeConfig({ explorationPct: 100 });
    const state = createDefaultLearningState();
    // Все arms кроме 3-5 имеют по 5 runs; 3-5 имеет 0 runs
    for (const arm of SELF_LEARNING_POSITION_ARMS) {
      if (arm.from !== 3 || arm.to !== 5) {
        state.arms[learningArmKey(arm.from, arm.to)] = {
          ...createEmptyLearningArm(),
          runs: 5,
        };
      }
    }
    const result = pickSelfLearningTarget(config, state, STRATEGY_ID, REF_DATE);
    expect(result.key).toBe('3-5');
    expect(result.exploration).toBe(true);
  });

  it('в exploit-фазе выбирает arm с лучшим средним reward', () => {
    const config = makeConfig({ explorationPct: 0 });
    const state = createDefaultLearningState();
    state.arms['1-2'] = { ...createEmptyLearningArm(), runs: 10, rewardSum: 5 };   // avg 0.5
    state.arms['2-3'] = { ...createEmptyLearningArm(), runs: 10, rewardSum: 25 };  // avg 2.5 — победитель
    state.arms['3-5'] = { ...createEmptyLearningArm(), runs: 10, rewardSum: 10 };  // avg 1.0
    state.arms['4-6'] = { ...createEmptyLearningArm(), runs: 10, rewardSum: 8 };   // avg 0.8

    const result = pickSelfLearningTarget(config, state, STRATEGY_ID, REF_DATE);
    expect(result.key).toBe('2-3');
    expect(result.reason).toBe('best_reward');
    expect(result.exploration).toBe(false);
  });

  it('возвращает configured target когда он совпадает с best reward', () => {
    const config = makeConfig({ explorationPct: 0, targetPositionFrom: 1, targetPositionTo: 2 });
    const state = createDefaultLearningState();
    state.arms['1-2'] = { ...createEmptyLearningArm(), runs: 10, rewardSum: 30 }; // avg 3 — best
    state.arms['2-3'] = { ...createEmptyLearningArm(), runs: 10, rewardSum: 5 };

    const result = pickSelfLearningTarget(config, state, STRATEGY_ID, REF_DATE);
    expect(result.key).toBe('1-2');
    expect(result.reason).toBe('configured_target');
  });
});

describe('isPositionInRange', () => {
  it('возвращает false при null/NaN', () => {
    expect(isPositionInRange(null, 1, 3)).toBe(false);
    expect(isPositionInRange(Number.NaN, 1, 3)).toBe(false);
  });

  it('inclusive границы', () => {
    expect(isPositionInRange(1, 1, 3)).toBe(true);
    expect(isPositionInRange(3, 1, 3)).toBe(true);
    expect(isPositionInRange(2, 1, 3)).toBe(true);
    expect(isPositionInRange(0.9, 1, 3)).toBe(false);
    expect(isPositionInRange(3.1, 1, 3)).toBe(false);
  });
});
