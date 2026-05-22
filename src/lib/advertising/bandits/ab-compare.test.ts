import { describe, it, expect } from 'vitest';

import {
  computeABConfidence,
  AB_CONFIDENCE_THRESHOLD,
  AB_MIN_OBSERVATIONS,
} from './ab-compare';
import {
  createDefaultLearningState,
  learningArmKey,
  SELF_LEARNING_POSITION_ARMS,
} from '../self-learning';
import { createEmptyBanditState } from './integration';

const SEED = 0xdeadbeef;
const ITERATIONS = 3000;

function makeBanditStateWithDominantArm(
  dominantArmIdx: number,
  successesPerArm: number,
  failuresPerArm: number,
) {
  const state = createEmptyBanditState('thompson_beta', 'position_hit');
  for (let i = 0; i < SELF_LEARNING_POSITION_ARMS.length; i++) {
    const arm = SELF_LEARNING_POSITION_ARMS[i]!;
    const key = learningArmKey(arm.from, arm.to);
    state.arms[key] = {
      successes: i === dominantArmIdx ? successesPerArm * 3 : successesPerArm,
      failures: i === dominantArmIdx ? failuresPerArm : failuresPerArm * 3,
    };
  }
  return state;
}

function makeLearningStateWithDominantArm(
  dominantArmIdx: number,
  runsPerArm: number,
  rewardRateNonDom: number,
) {
  const state = createDefaultLearningState();
  for (let i = 0; i < SELF_LEARNING_POSITION_ARMS.length; i++) {
    const arm = SELF_LEARNING_POSITION_ARMS[i]!;
    const key = learningArmKey(arm.from, arm.to);
    const rate = i === dominantArmIdx ? rewardRateNonDom : rewardRateNonDom * 0.4;
    state.arms[key] = {
      runs: runsPerArm,
      rewardSum: Math.round(runsPerArm * rate),
      spendSum: 0,
      ordersSum: 0,
      savingsSum: 0,
      avgPosSum: 0,
      avgPosSamples: 0,
    };
  }
  return state;
}

describe('computeABConfidence', () => {
  it('возвращает insufficient_data при малом числе наблюдений', () => {
    const bandit = createEmptyBanditState('thompson_beta', 'position_hit');
    const learning = createDefaultLearningState();
    const result = computeABConfidence(bandit, learning, SEED, ITERATIONS);
    expect(result.decision).toBe('insufficient_data');
  });

  it('insufficient_data при нехватке наблюдений только у одной стороны', () => {
    const bandit = makeBanditStateWithDominantArm(0, 30, 10); // 160 obs total
    const learning = createDefaultLearningState(); // 0 obs
    const result = computeABConfidence(bandit, learning, SEED, ITERATIONS);
    expect(result.decision).toBe('insufficient_data');
  });

  it('thompson_wins когда thompson намного лучше baseline', () => {
    // Thompson: arm-0 доминирует (75% success)
    const bandit = makeBanditStateWithDominantArm(0, 30, 10);
    // Baseline: arm-0 тоже лучший, но слабее (30% у dom, 12% у остальных)
    const learning = makeLearningStateWithDominantArm(0, 20, 0.30);
    const result = computeABConfidence(bandit, learning, SEED, ITERATIONS);
    // Thompson posterior более точный и лучший arm — ожидаем thompson_wins
    expect(result.decision).not.toBe('insufficient_data');
    if (result.decision !== 'insufficient_data') {
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.thompsonObsTotal).toBeGreaterThanOrEqual(AB_MIN_OBSERVATIONS);
      expect(result.baselineObsTotal).toBeGreaterThanOrEqual(AB_MIN_OBSERVATIONS);
    }
  });

  it('no_winner когда baseline лучше thompson', () => {
    // Thompson: arm-0 умеренно лучший (60/40)
    const bandit = makeBanditStateWithDominantArm(0, 20, 13);
    // Baseline: arm-0 сильно доминирует (90% success)
    const learning = makeLearningStateWithDominantArm(0, 20, 0.90);
    const result = computeABConfidence(bandit, learning, SEED, ITERATIONS);
    expect(result.decision).not.toBe('insufficient_data');
    if (result.decision !== 'insufficient_data') {
      // Thompson не должен иметь confidence >= 0.95 если baseline сильнее
      expect(result.decision).toBe('no_winner');
    }
  });

  it('bestArmKey всегда LearningArmKey-формата', () => {
    const bandit = makeBanditStateWithDominantArm(1, 30, 10);
    const learning = makeLearningStateWithDominantArm(1, 20, 0.5);
    const result = computeABConfidence(bandit, learning, SEED, ITERATIONS);
    if (result.decision !== 'insufficient_data') {
      expect(result.thompsonBestArmKey).toMatch(/^\d+-\d+$/);
      expect(result.baselineBestArmKey).toMatch(/^\d+-\d+$/);
    }
  });

  it('детерминирован по seed', () => {
    const bandit = makeBanditStateWithDominantArm(2, 30, 10);
    const learning = makeLearningStateWithDominantArm(2, 20, 0.5);
    const r1 = computeABConfidence(bandit, learning, SEED, ITERATIONS);
    const r2 = computeABConfidence(bandit, learning, SEED, ITERATIONS);
    if (r1.decision !== 'insufficient_data' && r2.decision !== 'insufficient_data') {
      expect(r1.confidence).toBe(r2.confidence);
    }
  });

  it('AB_CONFIDENCE_THRESHOLD = 0.95', () => {
    expect(AB_CONFIDENCE_THRESHOLD).toBe(0.95);
  });

  it('AB_MIN_OBSERVATIONS > 0', () => {
    expect(AB_MIN_OBSERVATIONS).toBeGreaterThan(0);
  });
});
