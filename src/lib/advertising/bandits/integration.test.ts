import { describe, it, expect } from 'vitest';
import {
  SELF_LEARNING_POSITION_ARMS,
  learningArmKey,
  readLearningStateFromSummary,
  normalizeAutopilotConfig,
  type StrategyBanditState,
} from '../self-learning';
import {
  computeBanditReward,
  createEmptyBanditState,
  ensureBanditStateMatches,
  pickBanditShadow,
  updateBanditPosterior,
} from './integration';

const STRATEGY_ID = '01234567-89ab-cdef-0123-456789abcdef';
const REF_DATE = new Date('2026-04-19T12:00:00Z');

describe('createEmptyBanditState', () => {
  it('инициализирует все 4 arm-а нулями для thompson_beta', () => {
    const state = createEmptyBanditState('thompson_beta', 'position_hit');
    expect(state.policy).toBe('thompson_beta');
    expect(state.rewardKind).toBe('position_hit');
    expect(state.shadowDelta).toEqual({ matches: 0, mismatches: 0, total: 0 });
    expect(state.lastPick).toBeNull();
    expect(state.updatedAt).toBeNull();
    if (state.policy === 'thompson_beta') {
      for (const arm of SELF_LEARNING_POSITION_ARMS) {
        const key = learningArmKey(arm.from, arm.to);
        expect(state.arms[key]).toEqual({ successes: 0, failures: 0 });
      }
    }
  });

  it('инициализирует arm-ы для thompson_normal', () => {
    const state = createEmptyBanditState('thompson_normal', 'economic_delta');
    expect(state.policy).toBe('thompson_normal');
    expect(state.rewardKind).toBe('economic_delta');
    if (state.policy === 'thompson_normal') {
      for (const arm of SELF_LEARNING_POSITION_ARMS) {
        const key = learningArmKey(arm.from, arm.to);
        expect(state.arms[key]).toEqual({ count: 0, mean: 0, m2: 0 });
      }
    }
  });
});

describe('ensureBanditStateMatches', () => {
  it('возвращает новое state при пустом предыдущем', () => {
    const next = ensureBanditStateMatches(undefined, 'thompson_beta', 'position_hit');
    expect(next.policy).toBe('thompson_beta');
  });

  it('сбрасывает state при смене policy', () => {
    const old = createEmptyBanditState('thompson_beta', 'position_hit');
    const next = ensureBanditStateMatches(old, 'thompson_normal', 'position_hit');
    expect(next.policy).toBe('thompson_normal');
  });

  it('сбрасывает state при смене rewardKind', () => {
    const old = createEmptyBanditState('thompson_normal', 'position_hit');
    const next = ensureBanditStateMatches(old, 'thompson_normal', 'economic_delta');
    expect(next.rewardKind).toBe('economic_delta');
  });

  it('сохраняет state если policy и rewardKind совпадают', () => {
    const old = createEmptyBanditState('thompson_beta', 'position_hit');
    const next = ensureBanditStateMatches(old, 'thompson_beta', 'position_hit');
    expect(next).toBe(old);
  });
});

describe('pickBanditShadow', () => {
  it('детерминированный выбор при повторном вызове с тем же strategyId и датой', () => {
    const state = createEmptyBanditState('thompson_beta', 'position_hit');
    const a = pickBanditShadow(state, STRATEGY_ID, REF_DATE);
    const b = pickBanditShadow(state, STRATEGY_ID, REF_DATE);
    expect(a.key).toBe(b.key);
  });

  it('возвращает samples на все 4 arm-а', () => {
    const state = createEmptyBanditState('thompson_beta', 'position_hit');
    const pick = pickBanditShadow(state, STRATEGY_ID, REF_DATE);
    expect(pick.samples).toHaveLength(SELF_LEARNING_POSITION_ARMS.length);
    for (const sample of pick.samples) {
      expect(sample.sample).toBeGreaterThanOrEqual(0);
      expect(sample.sample).toBeLessThanOrEqual(1);
    }
  });

  it('для thompson_normal samples — вещественные, не ограничены [0,1]', () => {
    let state = createEmptyBanditState('thompson_normal', 'economic_delta');
    // Накачаем один arm большим mean — sample из него будет > 1
    const targetKey = learningArmKey(1, 2);
    state = updateBanditPosterior(state, targetKey, 2.5, 1, 2, true, REF_DATE);
    state = updateBanditPosterior(state, targetKey, 2.5, 1, 2, true, REF_DATE);
    state = updateBanditPosterior(state, targetKey, 2.5, 1, 2, true, REF_DATE);
    const pick = pickBanditShadow(state, STRATEGY_ID, REF_DATE);
    const targetSample = pick.samples.find((s) => s.key === targetKey)!;
    expect(targetSample.posteriorMean).toBeCloseTo(2.5, 1);
  });

  it('после множества успехов на arm "1-2" выбирает его в >70% запусков', () => {
    let state = createEmptyBanditState('thompson_beta', 'position_hit');
    const winnerKey = learningArmKey(1, 2);
    for (let i = 0; i < 50; i += 1) {
      state = updateBanditPosterior(state, winnerKey, 1, 1, 2, true, REF_DATE);
    }
    // Остальные arm-ы — 50 провалов каждый
    for (const arm of SELF_LEARNING_POSITION_ARMS) {
      if (arm.from === 1 && arm.to === 2) continue;
      const key = learningArmKey(arm.from, arm.to);
      for (let i = 0; i < 50; i += 1) {
        state = updateBanditPosterior(state, key, 0, arm.from, arm.to, false, REF_DATE);
      }
    }
    let wins = 0;
    const total = 200;
    for (let minute = 0; minute < total; minute += 1) {
      const ref = new Date(Date.UTC(2026, 3, 19, 12, minute));
      const pick = pickBanditShadow(state, STRATEGY_ID, ref);
      if (pick.key === winnerKey) wins += 1;
    }
    expect(wins / total).toBeGreaterThan(0.7);
  });
});

describe('computeBanditReward', () => {
  it('position_hit: 1 если avgPos в диапазоне arm-а', () => {
    expect(computeBanditReward({
      rewardKind: 'position_hit',
      observedAvgPos: 1.5,
      targetFrom: 1,
      targetTo: 2,
      observedAcosPct: null,
      targetAcosPct: 30,
    })).toBe(1);
  });

  it('position_hit: 0 если avgPos вне диапазона', () => {
    expect(computeBanditReward({
      rewardKind: 'position_hit',
      observedAvgPos: 4,
      targetFrom: 1,
      targetTo: 2,
      observedAcosPct: null,
      targetAcosPct: 30,
    })).toBe(0);
  });

  it('position_hit: 0 при null observedAvgPos', () => {
    expect(computeBanditReward({
      rewardKind: 'position_hit',
      observedAvgPos: null,
      targetFrom: 1,
      targetTo: 2,
      observedAcosPct: null,
      targetAcosPct: 30,
    })).toBe(0);
  });

  it('economic_delta: положительный reward когда observedAcos < targetAcos', () => {
    const reward = computeBanditReward({
      rewardKind: 'economic_delta',
      observedAvgPos: null,
      targetFrom: 1,
      targetTo: 2,
      observedAcosPct: 20,
      targetAcosPct: 30,
    });
    expect(reward).toBeGreaterThan(0);
  });

  it('economic_delta: отрицательный reward когда observedAcos > targetAcos', () => {
    const reward = computeBanditReward({
      rewardKind: 'economic_delta',
      observedAvgPos: null,
      targetFrom: 1,
      targetTo: 2,
      observedAcosPct: 50,
      targetAcosPct: 30,
    });
    expect(reward).toBeLessThan(0);
  });

  it('economic_delta: clip [-3, 3]', () => {
    const extreme = computeBanditReward({
      rewardKind: 'economic_delta',
      observedAvgPos: null,
      targetFrom: 1,
      targetTo: 2,
      observedAcosPct: 10_000,
      targetAcosPct: 0.01,
    });
    expect(extreme).toBeGreaterThanOrEqual(-3);
    expect(extreme).toBeLessThanOrEqual(3);
  });

  it('economic_delta: 0 при невалидных данных', () => {
    expect(computeBanditReward({
      rewardKind: 'economic_delta',
      observedAvgPos: null,
      targetFrom: 1,
      targetTo: 2,
      observedAcosPct: null,
      targetAcosPct: 30,
    })).toBe(0);
    expect(computeBanditReward({
      rewardKind: 'economic_delta',
      observedAvgPos: null,
      targetFrom: 1,
      targetTo: 2,
      observedAcosPct: 0,
      targetAcosPct: 30,
    })).toBe(0);
  });
});

describe('updateBanditPosterior', () => {
  it('beta: reward>0 увеличивает successes; reward=0 увеличивает failures', () => {
    let state: StrategyBanditState = createEmptyBanditState('thompson_beta', 'position_hit');
    const key = learningArmKey(1, 2);
    state = updateBanditPosterior(state, key, 1, 1, 2, true, REF_DATE);
    state = updateBanditPosterior(state, key, 0, 1, 2, false, REF_DATE);
    if (state.policy !== 'thompson_beta') throw new Error('policy mismatch');
    expect(state.arms[key]).toEqual({ successes: 1, failures: 1 });
  });

  it('normal: Welford-обновление сходится к истинному mean', () => {
    let state: StrategyBanditState = createEmptyBanditState('thompson_normal', 'economic_delta');
    const key = learningArmKey(1, 2);
    const rewards = [1.0, 1.2, 0.9, 1.1, 1.05, 0.95];
    for (const reward of rewards) {
      state = updateBanditPosterior(state, key, reward, 1, 2, true, REF_DATE);
    }
    if (state.policy !== 'thompson_normal') throw new Error('policy mismatch');
    expect(state.arms[key]!.count).toBe(6);
    const expectedMean = rewards.reduce((a, b) => a + b, 0) / rewards.length;
    expect(state.arms[key]!.mean).toBeCloseTo(expectedMean, 4);
  });

  it('shadowDelta инкрементится: matches при совпадении, mismatches при расхождении', () => {
    let state: StrategyBanditState = createEmptyBanditState('thompson_beta', 'position_hit');
    const key = learningArmKey(1, 2);
    state = updateBanditPosterior(state, key, 1, 1, 2, true, REF_DATE);
    state = updateBanditPosterior(state, key, 1, 1, 2, false, REF_DATE);
    state = updateBanditPosterior(state, key, 0, 1, 2, true, REF_DATE);
    expect(state.shadowDelta).toEqual({ matches: 2, mismatches: 1, total: 3 });
  });

  it('lastPick отражает последний arm', () => {
    let state: StrategyBanditState = createEmptyBanditState('thompson_beta', 'position_hit');
    state = updateBanditPosterior(state, learningArmKey(1, 2), 1, 1, 2, true, REF_DATE);
    state = updateBanditPosterior(state, learningArmKey(3, 5), 0, 3, 5, false, REF_DATE);
    expect(state.lastPick).toEqual({ key: '3-5', from: 3, to: 5 });
  });

  it('updatedAt устанавливается в ISO-строку', () => {
    let state: StrategyBanditState = createEmptyBanditState('thompson_beta', 'position_hit');
    state = updateBanditPosterior(state, learningArmKey(1, 2), 1, 1, 2, true, REF_DATE);
    expect(state.updatedAt).toBe(REF_DATE.toISOString());
  });
});

describe('readLearningStateFromSummary — bandit serde', () => {
  it('читает thompson_beta posterior round-trip', () => {
    const original = createEmptyBanditState('thompson_beta', 'position_hit');
    let updated = updateBanditPosterior(original, learningArmKey(1, 2), 1, 1, 2, true, REF_DATE);
    updated = updateBanditPosterior(updated, learningArmKey(1, 2), 0, 1, 2, false, REF_DATE);
    const summary = { learningState: { bandit: JSON.parse(JSON.stringify(updated)) } };
    const parsed = readLearningStateFromSummary(summary);
    expect(parsed.bandit).toBeDefined();
    if (parsed.bandit?.policy !== 'thompson_beta') throw new Error('policy mismatch');
    expect(parsed.bandit.arms[learningArmKey(1, 2)]).toEqual({ successes: 1, failures: 1 });
    expect(parsed.bandit.shadowDelta).toEqual({ matches: 1, mismatches: 1, total: 2 });
    expect(parsed.bandit.lastPick).toEqual({ key: '1-2', from: 1, to: 2 });
  });

  it('читает thompson_normal posterior round-trip', () => {
    let state: StrategyBanditState = createEmptyBanditState('thompson_normal', 'economic_delta');
    for (const reward of [0.5, 0.7, 0.9]) {
      state = updateBanditPosterior(state, learningArmKey(1, 2), reward, 1, 2, true, REF_DATE);
    }
    const summary = { learningState: { bandit: JSON.parse(JSON.stringify(state)) } };
    const parsed = readLearningStateFromSummary(summary);
    if (parsed.bandit?.policy !== 'thompson_normal') throw new Error('policy mismatch');
    expect(parsed.bandit.arms[learningArmKey(1, 2)]!.count).toBe(3);
    expect(parsed.bandit.arms[learningArmKey(1, 2)]!.mean).toBeCloseTo(0.7, 3);
  });

  it('возвращает bandit=undefined при невалидных данных', () => {
    const summary = { learningState: { bandit: { policy: 'unknown', arms: {} } } };
    const parsed = readLearningStateFromSummary(summary);
    expect(parsed.bandit).toBeUndefined();
  });

  it('санирует отрицательные successes/failures в 0', () => {
    const summary = {
      learningState: {
        bandit: {
          policy: 'thompson_beta',
          rewardKind: 'position_hit',
          arms: { '1-2': { successes: -5, failures: -3 } },
          shadowDelta: { matches: -1, mismatches: -2, total: -3 },
        },
      },
    };
    const parsed = readLearningStateFromSummary(summary);
    if (parsed.bandit?.policy !== 'thompson_beta') throw new Error('policy mismatch');
    expect(parsed.bandit.arms[learningArmKey(1, 2)]).toEqual({ successes: 0, failures: 0 });
    expect(parsed.bandit.shadowDelta).toEqual({ matches: 0, mismatches: 0, total: 0 });
  });
});

describe('normalizeAutopilotConfig — policy and rewardKind', () => {
  it('default policy=epsilon_greedy и rewardKind=position_hit', () => {
    const config = normalizeAutopilotConfig({});
    expect(config.policy).toBe('epsilon_greedy');
    expect(config.rewardKind).toBe('position_hit');
  });

  it('принимает все валидные policy и rewardKind', () => {
    expect(normalizeAutopilotConfig({ policy: 'thompson_beta' }).policy).toBe('thompson_beta');
    expect(normalizeAutopilotConfig({ policy: 'thompson_normal' }).policy).toBe('thompson_normal');
    expect(normalizeAutopilotConfig({ rewardKind: 'economic_delta' }).rewardKind).toBe('economic_delta');
  });

  it('fallback на default при невалидных значениях', () => {
    // @ts-expect-error runtime-санитаризация невалидного policy из legacy summary
    expect(normalizeAutopilotConfig({ policy: 'bogus' }).policy).toBe('epsilon_greedy');
    // @ts-expect-error runtime-санитаризация невалидного rewardKind из legacy summary
    expect(normalizeAutopilotConfig({ rewardKind: 'bogus' }).rewardKind).toBe('position_hit');
  });
});
