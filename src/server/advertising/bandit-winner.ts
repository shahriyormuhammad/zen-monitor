/**
 * Проверка Bayesian A/B результата и авто-выбор победителя (P72d).
 *
 * Вызывается из workspace.ts после обновления bandit posterior.
 * Если P(thompson > baseline) >= 95%, переключает policy стратегии
 * на winning algorithm и отправляет Telegram-алерт `ab_test_won`.
 *
 * DB-запись происходит вне этого хелпера: caller получает флаг
 * `shouldSwitch` и самостоятельно применяет изменение autopilotConfig.
 */

import { logger } from '@/lib/logger';
import {
  computeABConfidence,
} from '@/lib/advertising/bandits/ab-compare';
import type { StrategyBanditState, StrategyLearningState } from '@/lib/advertising/self-learning';
import { sendAdAlert } from './send-alert';

const AB_MC_SEED_SALT = 0x72ab72ab;
const AB_MC_ITERATIONS = 3000;

export type BanditWinnerCheck =
  | { shouldSwitch: false }
  | {
      shouldSwitch: true;
      winnerPolicy: 'thompson_beta' | 'thompson_normal';
      confidence: number;
      thompsonObsTotal: number;
    };

/**
 * Оценить A/B результат. Возвращает рекомендацию без мутации состояния.
 *
 * Caller должен:
 *   1. При `shouldSwitch = true` — обновить `autopilotConfig.policy` в summary.
 *   2. Вызвать `notifyBanditWinner` для отправки алерта.
 */
export function checkBanditWinner(
  banditState: StrategyBanditState,
  learningState: StrategyLearningState,
  strategySeed: number,
): BanditWinnerCheck {
  const result = computeABConfidence(
    banditState,
    learningState,
    (strategySeed ^ AB_MC_SEED_SALT) >>> 0,
    AB_MC_ITERATIONS,
  );

  if (result.decision !== 'thompson_wins') {
    return { shouldSwitch: false };
  }

  return {
    shouldSwitch: true,
    winnerPolicy: banditState.policy,
    confidence: result.confidence,
    thompsonObsTotal: result.thompsonObsTotal,
  };
}

/**
 * Отправить Telegram-алерт о победителе A/B теста.
 * Throttle = 7 дней per (tenantId, strategyId).
 */
export async function notifyBanditWinner(
  tenantId: string,
  strategyId: string,
  strategyName: string,
  winnerPolicy: 'thompson_beta' | 'thompson_normal',
  confidence: number,
  obsCount: number,
): Promise<void> {
  const result = await sendAdAlert(
    tenantId,
    {
      type: 'ab_test_won',
      strategyName,
      winnerPolicy,
      confidence,
      obsCount,
    },
    { subkey: strategyId },
  );

  if (result.status === 'sent') {
    logger.info(
      { tenantId, strategyId, winnerPolicy, confidence },
      '[banditWinner] ab_test_won alert sent',
    );
  } else {
    logger.debug(
      { tenantId, strategyId, reason: result.reason },
      '[banditWinner] ab_test_won alert skipped',
    );
  }
}

/**
 * Seed из strategyId для детерминированного MC-сравнения.
 * Простой djb2-хэш, достаточен для этой цели.
 */
export function strategyIdToSeed(strategyId: string): number {
  let hash = 5381;
  for (let i = 0; i < strategyId.length; i++) {
    hash = ((hash << 5) + hash + strategyId.charCodeAt(i)) & 0xffffffff;
  }
  return hash >>> 0;
}
