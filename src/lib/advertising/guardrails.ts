export type GuardrailTrigger =
  | 'kill_switch'
  | 'learning_period'
  | 'cooldown'
  | 'daily_cap'
  | 'low_stock'
  | 'high_drr'
  | 'spend_no_orders'
  | 'low_cr'
  | 'max_bid_delta'
  | 'max_bid';

export type GuardrailConfig = {
  /** Автопауза: мин. остаток nmId, шт. */
  minStockThreshold: number;
  /** Автопауза: макс. ДРР%, null = 1.5 × targetAcosPct */
  maxDRRPct: number | null;
  /** Автопауза: макс. расход без заказов за 24ч, ₽ */
  maxSpendWithoutOrdersRub: number;
  /** Автопауза: мин. CR за 7 дней, % */
  minCRPct: number;
  /** Дневной cap расхода, ₽ (null = отключён) */
  dailySpendCapRub: number | null;
  /** Hard limit: макс. изменение ставки за шаг, % */
  maxBidDeltaPct: number;
  /** Hard limit: макс. ставка в X× от рекомендованной WB */
  maxBidMultiplier: number;
  /** Cooldown между изменениями ставки, мин */
  bidCooldownMinutes: number;
  /** Learning period: первые N дней только Advisor */
  learningPeriodDays: number;
};

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  minStockThreshold: 3,
  maxDRRPct: null,
  maxSpendWithoutOrdersRub: 500,
  minCRPct: 0.1,
  dailySpendCapRub: null,
  maxBidDeltaPct: 20,
  maxBidMultiplier: 1.5,
  bidCooldownMinutes: 60,
  learningPeriodDays: 7,
};

export type GuardrailContext = {
  /** Kill switch: autopilot включён на уровне тенанта */
  autopilotEnabled: boolean;
  /** Дата старта стратегии (для learning period) */
  strategyStartedAt: Date;
  /** Последнее реальное изменение ставки (для cooldown) */
  lastBidChangedAt: Date | null;
  /** Текущий остаток nmId, null = нет данных (пропустить) */
  stockQty: number | null;
  /** ДРР (ACOS proxy) за lookback-окно, % */
  drrLookbackPct: number | null;
  /** Расход за 24ч, ₽ */
  spendRub24h: number;
  /** Заказов за 24ч */
  orders24h: number;
  /** CR за 7 дней, % (null = нет данных) */
  crPct7d: number | null;
  /** Суммарный расход стратегии сегодня (все кластеры), ₽ */
  spendTodayRubTotal: number;
  /** Текущая ставка кластера */
  currentBid: number;
  /** Предлагаемая ставка кластера */
  proposedBid: number;
  /** Рекомендованная ставка WB (null = нет данных) */
  wbRecommendedBid: number | null;
  /** targetAcosPct стратегии (для динамического maxDRR) */
  targetAcosPct: number;
  /** Для тестов: переопределить Date.now() */
  nowMs?: number;
};

export type GuardrailResult = {
  /** Прошли ли все guardrails */
  passed: boolean;
  /** true = learning period, bid-изменения не применяются, но логируются как advisory */
  advisorOnly: boolean;
  /** Первый сработавший триггер */
  blockedBy: GuardrailTrigger | null;
  /** Читаемое объяснение */
  reason: string;
};

export function normalizeGuardrailConfig(
  input: Partial<GuardrailConfig> | Record<string, unknown> | null | undefined,
): GuardrailConfig {
  const src = (input ?? {}) as Partial<GuardrailConfig>;
  return {
    minStockThreshold: Math.max(0, Number(src.minStockThreshold ?? DEFAULT_GUARDRAIL_CONFIG.minStockThreshold)),
    maxDRRPct: src.maxDRRPct != null ? Math.max(0, Number(src.maxDRRPct)) : null,
    maxSpendWithoutOrdersRub: Math.max(0, Number(src.maxSpendWithoutOrdersRub ?? DEFAULT_GUARDRAIL_CONFIG.maxSpendWithoutOrdersRub)),
    minCRPct: Math.max(0, Number(src.minCRPct ?? DEFAULT_GUARDRAIL_CONFIG.minCRPct)),
    dailySpendCapRub: src.dailySpendCapRub != null ? Math.max(0, Number(src.dailySpendCapRub)) : null,
    maxBidDeltaPct: Math.max(0, Number(src.maxBidDeltaPct ?? DEFAULT_GUARDRAIL_CONFIG.maxBidDeltaPct)),
    maxBidMultiplier: Math.max(1, Number(src.maxBidMultiplier ?? DEFAULT_GUARDRAIL_CONFIG.maxBidMultiplier)),
    bidCooldownMinutes: Math.max(0, Number(src.bidCooldownMinutes ?? DEFAULT_GUARDRAIL_CONFIG.bidCooldownMinutes)),
    learningPeriodDays: Math.max(0, Number(src.learningPeriodDays ?? DEFAULT_GUARDRAIL_CONFIG.learningPeriodDays)),
  };
}

export function isInLearningPeriod(
  strategyStartedAt: Date,
  learningPeriodDays: number,
  now: Date = new Date(),
): boolean {
  if (learningPeriodDays <= 0) return false;
  const ageDays = (now.getTime() - strategyStartedAt.getTime()) / 86_400_000;
  return ageDays < learningPeriodDays;
}

function block(trigger: GuardrailTrigger, reason: string): GuardrailResult {
  return { passed: false, advisorOnly: false, blockedBy: trigger, reason };
}

/**
 * Проверяет все guardrails для одного предложения bid-изменения.
 * Порядок проверок — от «глобальных» к «точечным».
 */
export function checkGuardrails(ctx: GuardrailContext, config: GuardrailConfig): GuardrailResult {
  const now = new Date(ctx.nowMs ?? Date.now());

  // 1. Kill switch
  if (!ctx.autopilotEnabled) {
    return block('kill_switch', 'Автопилот отключён на уровне кабинета.');
  }

  // 2. Learning period → advisor only
  if (isInLearningPeriod(ctx.strategyStartedAt, config.learningPeriodDays, now)) {
    return {
      passed: false,
      advisorOnly: true,
      blockedBy: 'learning_period',
      reason: `Период обучения (первые ${config.learningPeriodDays} дн.) — только режим советника.`,
    };
  }

  // 3. Cooldown
  if (config.bidCooldownMinutes > 0 && ctx.lastBidChangedAt !== null) {
    const elapsedMin = (now.getTime() - ctx.lastBidChangedAt.getTime()) / 60_000;
    if (elapsedMin < config.bidCooldownMinutes) {
      const remaining = Math.ceil(config.bidCooldownMinutes - elapsedMin);
      return block('cooldown', `Cooldown: следующее изменение через ${remaining} мин.`);
    }
  }

  // 4. Daily cap
  if (config.dailySpendCapRub !== null && ctx.spendTodayRubTotal >= config.dailySpendCapRub) {
    return block('daily_cap', `Дневной лимит ${config.dailySpendCapRub} ₽ достигнут (${ctx.spendTodayRubTotal.toFixed(0)} ₽ потрачено).`);
  }

  // 5. Low stock
  if (ctx.stockQty !== null && ctx.stockQty < config.minStockThreshold) {
    return block('low_stock', `Остаток ${ctx.stockQty} шт. ниже порога ${config.minStockThreshold} шт.`);
  }

  // 6. High DRR
  const effectiveMaxDRR = config.maxDRRPct !== null
    ? config.maxDRRPct
    : ctx.targetAcosPct * 1.5;
  if (ctx.drrLookbackPct !== null && effectiveMaxDRR > 0 && ctx.drrLookbackPct > effectiveMaxDRR) {
    return block('high_drr', `ДРР ${ctx.drrLookbackPct.toFixed(1)}% выше лимита ${effectiveMaxDRR.toFixed(1)}%.`);
  }

  // 7. Spend without orders
  if (ctx.orders24h === 0 && ctx.spendRub24h > config.maxSpendWithoutOrdersRub) {
    return block('spend_no_orders', `Расход ${ctx.spendRub24h.toFixed(0)} ₽ за 24ч без заказов (лимит ${config.maxSpendWithoutOrdersRub} ₽).`);
  }

  // 8. Low CR
  if (ctx.crPct7d !== null && ctx.crPct7d < config.minCRPct) {
    return block('low_cr', `CR ${ctx.crPct7d.toFixed(3)}% ниже минимума ${config.minCRPct}% за 7 дней.`);
  }

  // 9. Max bid delta
  if (ctx.currentBid > 0 && config.maxBidDeltaPct > 0) {
    const deltaPct = Math.abs(ctx.proposedBid - ctx.currentBid) / ctx.currentBid * 100;
    if (deltaPct > config.maxBidDeltaPct) {
      return block('max_bid_delta', `Изменение ставки ${deltaPct.toFixed(1)}% превышает лимит ${config.maxBidDeltaPct}% за шаг.`);
    }
  }

  // 10. Max bid vs WB recommended
  if (ctx.wbRecommendedBid !== null && ctx.wbRecommendedBid > 0) {
    const maxAllowed = Math.round(ctx.wbRecommendedBid * config.maxBidMultiplier);
    if (ctx.proposedBid > maxAllowed) {
      return block('max_bid', `Ставка ${ctx.proposedBid} ₽ выше ${config.maxBidMultiplier}× рекомендованной WB (лимит ${maxAllowed} ₽).`);
    }
  }

  return { passed: true, advisorOnly: false, blockedBy: null, reason: 'ok' };
}
