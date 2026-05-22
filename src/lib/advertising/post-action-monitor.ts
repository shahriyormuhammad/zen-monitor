export type AdvertisingPostActionDirection = 'raise' | 'lower';
export type AdvertisingPostActionOutcome = 'improved' | 'worse' | 'neutral' | 'insufficient_data';
export type AdvertisingPostActionRecommendation = 'keep' | 'rollback' | 'watch';
export type AdvertisingPostActionScopeType = 'sku' | 'group';

export type AdvertisingPostActionStats = {
  adSpend: number;
  revenue: number;
  orders: number;
  clicks: number;
  views: number;
  cpcRub: number | null;
  cpoRub: number | null;
  drrPct: number | null;
  roas: number | null;
  rows: number;
};

export type AdvertisingPostActionMonitorReport = {
  version: 1;
  checkedAt: string;
  changeId: string;
  horizonHours: number;
  direction: AdvertisingPostActionDirection;
  source: string;
  scope: {
    type: AdvertisingPostActionScopeType;
    nmIds: number[];
    groupId: string | null;
    groupName: string | null;
  };
  bid: {
    previous: number;
    next: number;
    delta: number;
    changePct: number;
  };
  before: AdvertisingPostActionStats;
  after: AdvertisingPostActionStats;
  delta: {
    adSpend: number;
    revenue: number;
    orders: number;
    clicks: number;
    drrPctPoints: number | null;
    roas: number | null;
  };
  outcome: AdvertisingPostActionOutcome;
  recommendation: AdvertisingPostActionRecommendation;
  autoRollbackEligible: boolean;
  autoRollbackAttempted: boolean;
  rollback: {
    status: 'not_needed' | 'skipped' | 'applied' | 'failed';
    reason: string | null;
    appliedAt?: string;
    error?: string;
  };
  summary: string;
  details: string[];
};

export type EvaluateAdvertisingPostActionInput = {
  changeId: string;
  checkedAt: Date;
  horizonHours: number;
  source: string;
  previousBid: number;
  nextBid: number;
  scope: AdvertisingPostActionMonitorReport['scope'];
  before: AdvertisingPostActionStats;
  after: AdvertisingPostActionStats;
  autoRollbackEligible: boolean;
};

function round(value: number, precision = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function ratio(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round(numerator / denominator, 2);
}

function pct(numerator: number, denominator: number) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round((numerator / denominator) * 100, 2);
}

function formatRub(value: number) {
  const rounded = Math.round(Math.abs(value));
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${rounded.toLocaleString('ru-RU')} ₽`;
}

function formatPlainRub(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function formatPct(value: number | null) {
  return value === null ? 'н/д' : `${value.toFixed(1)}%`;
}

function formatDelta(value: number, noun: string) {
  const sign = value > 0 ? '+' : '';
  return noun ? `${sign}${value} ${noun}` : `${sign}${value}`;
}

function scopeLabel(scope: AdvertisingPostActionMonitorReport['scope']) {
  if (scope.type === 'group') {
    return `склейка «${scope.groupName ?? 'без названия'}»`;
  }
  return scope.nmIds[0] ? `nmId ${scope.nmIds[0]}` : 'SKU';
}

function hasSignal(stats: AdvertisingPostActionStats) {
  return stats.adSpend >= 50 || stats.clicks >= 5 || stats.orders > 0 || stats.revenue > 0;
}

function revenueDropPct(before: AdvertisingPostActionStats, after: AdvertisingPostActionStats) {
  if (before.revenue <= 0) {
    return after.revenue < before.revenue ? 100 : 0;
  }
  return round(((before.revenue - after.revenue) / before.revenue) * 100, 2);
}

function revenueGrowthPct(before: AdvertisingPostActionStats, after: AdvertisingPostActionStats) {
  if (before.revenue <= 0) {
    return after.revenue > 0 ? 100 : 0;
  }
  return round(((after.revenue - before.revenue) / before.revenue) * 100, 2);
}

function drrWorse(before: AdvertisingPostActionStats, after: AdvertisingPostActionStats) {
  if (before.drrPct === null || after.drrPct === null) {
    return false;
  }
  return after.drrPct - before.drrPct >= 5 && after.drrPct >= before.drrPct * 1.25;
}

function spendMateriallyUp(before: AdvertisingPostActionStats, after: AdvertisingPostActionStats) {
  const delta = after.adSpend - before.adSpend;
  return delta >= 100 && (before.adSpend <= 0 || delta >= before.adSpend * 0.15);
}

function buildStatsLine(label: string, stats: AdvertisingPostActionStats) {
  return `${label}: расход ${formatPlainRub(stats.adSpend)}, заказы ${stats.orders}, выручка ${formatPlainRub(stats.revenue)}, ДРР ${formatPct(stats.drrPct)}, CPC ${stats.cpcRub === null ? 'н/д' : formatPlainRub(stats.cpcRub)}.`;
}

function buildSummary(input: {
  direction: AdvertisingPostActionDirection;
  outcome: AdvertisingPostActionOutcome;
  recommendation: AdvertisingPostActionRecommendation;
  before: AdvertisingPostActionStats;
  after: AdvertisingPostActionStats;
  delta: AdvertisingPostActionMonitorReport['delta'];
  scope: AdvertisingPostActionMonitorReport['scope'];
}) {
  const object = scopeLabel(input.scope);
  if (input.outcome === 'insufficient_data') {
    return `После изменения ставки по ${object} пока мало данных: наблюдаем дальше.`;
  }

  if (input.direction === 'lower') {
    if (input.outcome === 'improved') {
      return `Ставку снизили: экономия ${formatPlainRub(-input.delta.adSpend)}, заказы ${input.before.orders} → ${input.after.orders}, ${object}.`;
    }
    if (input.outcome === 'worse') {
      return `Снижение ставки ухудшило результат: ${formatDelta(input.delta.orders, 'заказов')}, выручка ${formatRub(input.delta.revenue)}, ${object}.`;
    }
    return `Снижение ставки без явного эффекта: заказы ${input.before.orders} → ${input.after.orders}, расход ${formatRub(input.delta.adSpend)}, ${object}.`;
  }

  if (input.outcome === 'improved') {
    return `Ставку подняли: ${formatDelta(input.delta.orders, 'заказов')}, выручка ${formatRub(input.delta.revenue)}, расход ${formatRub(input.delta.adSpend)}, ${object}.`;
  }
  if (input.outcome === 'worse') {
    return `Повышение ставки не окупилось: расход ${formatRub(input.delta.adSpend)}, заказы ${input.before.orders} → ${input.after.orders}, ${object}.`;
  }
  return `Повышение ставки пока без явного эффекта: заказы ${input.before.orders} → ${input.after.orders}, расход ${formatRub(input.delta.adSpend)}, ${object}.`;
}

export function normalizeAdvertisingPostActionStats(input: Omit<AdvertisingPostActionStats, 'cpcRub' | 'cpoRub' | 'drrPct' | 'roas'> & Partial<AdvertisingPostActionStats>): AdvertisingPostActionStats {
  const adSpend = round(input.adSpend);
  const revenue = round(input.revenue);
  const orders = Math.max(0, Math.round(input.orders));
  const clicks = Math.max(0, Math.round(input.clicks));
  const views = Math.max(0, Math.round(input.views));
  return {
    adSpend,
    revenue,
    orders,
    clicks,
    views,
    cpcRub: input.cpcRub ?? ratio(adSpend, clicks),
    cpoRub: input.cpoRub ?? ratio(adSpend, orders),
    drrPct: input.drrPct ?? pct(adSpend, revenue),
    roas: input.roas ?? ratio(revenue, adSpend),
    rows: Math.max(0, Math.round(input.rows)),
  };
}

export function evaluateAdvertisingPostAction(input: EvaluateAdvertisingPostActionInput): AdvertisingPostActionMonitorReport {
  const previousBid = Math.max(0, Math.round(input.previousBid));
  const nextBid = Math.max(0, Math.round(input.nextBid));
  const direction: AdvertisingPostActionDirection = nextBid >= previousBid ? 'raise' : 'lower';
  const before = normalizeAdvertisingPostActionStats(input.before);
  const after = normalizeAdvertisingPostActionStats(input.after);
  const delta = {
    adSpend: round(after.adSpend - before.adSpend),
    revenue: round(after.revenue - before.revenue),
    orders: after.orders - before.orders,
    clicks: after.clicks - before.clicks,
    drrPctPoints: before.drrPct === null || after.drrPct === null ? null : round(after.drrPct - before.drrPct, 2),
    roas: before.roas === null || after.roas === null ? null : round(after.roas - before.roas, 2),
  };

  let outcome: AdvertisingPostActionOutcome = 'neutral';
  let recommendation: AdvertisingPostActionRecommendation = 'watch';

  if (!hasSignal(before) && !hasSignal(after)) {
    outcome = 'insufficient_data';
    recommendation = 'watch';
  } else if (direction === 'lower') {
    const saved = before.adSpend - after.adSpend;
    const severeOrderDrop = delta.orders <= -2 || (before.orders >= 3 && after.orders / Math.max(1, before.orders) < 0.7);
    const severeRevenueDrop = revenueDropPct(before, after) >= 20 && before.revenue - after.revenue > Math.max(300, saved * 1.5);

    if (saved >= 50 && delta.orders >= 0) {
      outcome = 'improved';
      recommendation = 'keep';
    } else if (severeOrderDrop || severeRevenueDrop) {
      outcome = 'worse';
      recommendation = 'rollback';
    }
  } else {
    const revenueGrowth = revenueGrowthPct(before, after);
    const improvedVolume = delta.orders > 0 || (delta.revenue >= 500 && revenueGrowth >= 10);
    const expensiveNoGrowth = spendMateriallyUp(before, after) && delta.orders <= 0 && delta.revenue <= 0;
    const degradedEfficiency = drrWorse(before, after) && delta.orders <= 0;

    if (improvedVolume && !drrWorse(before, after)) {
      outcome = 'improved';
      recommendation = 'keep';
    } else if (expensiveNoGrowth || degradedEfficiency) {
      outcome = 'worse';
      recommendation = 'rollback';
    }
  }

  const summary = buildSummary({
    direction,
    outcome,
    recommendation,
    before,
    after,
    delta,
    scope: input.scope,
  });

  return {
    version: 1,
    checkedAt: input.checkedAt.toISOString(),
    changeId: input.changeId,
    horizonHours: input.horizonHours,
    direction,
    source: input.source,
    scope: input.scope,
    bid: {
      previous: previousBid,
      next: nextBid,
      delta: nextBid - previousBid,
      changePct: previousBid > 0 ? round(((nextBid - previousBid) / previousBid) * 100, 2) : 0,
    },
    before,
    after,
    delta,
    outcome,
    recommendation,
    autoRollbackEligible: input.autoRollbackEligible,
    autoRollbackAttempted: false,
    rollback: {
      status: recommendation === 'rollback' ? 'skipped' : 'not_needed',
      reason: recommendation === 'rollback' ? 'manual_or_waiting_mode' : null,
    },
    summary,
    details: [
      `Окно анализа: ${input.horizonHours} ч до изменения против ${input.horizonHours} ч после.`,
      buildStatsLine('До', before),
      buildStatsLine('После', after),
      `Дельта: расход ${formatRub(delta.adSpend)}, заказы ${formatDelta(delta.orders, '')}, выручка ${formatRub(delta.revenue)}, ДРР ${delta.drrPctPoints === null ? 'н/д' : `${delta.drrPctPoints > 0 ? '+' : ''}${delta.drrPctPoints.toFixed(1)} п.п.`}.`,
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readAdvertisingPostActionMonitor(metrics: Record<string, unknown> | null | undefined): AdvertisingPostActionMonitorReport | null {
  if (!isRecord(metrics)) {
    return null;
  }
  const value = metrics.postActionMonitor;
  if (!isRecord(value)) {
    return null;
  }
  if (value.version !== 1 || typeof value.summary !== 'string') {
    return null;
  }
  if (!isRecord(value.rollback) || typeof value.recommendation !== 'string') {
    return null;
  }
  return value as AdvertisingPostActionMonitorReport;
}

export function formatAdvertisingPostActionSummary(report: AdvertisingPostActionMonitorReport | null) {
  if (!report) {
    return null;
  }
  if (report.rollback.status === 'applied') {
    return `${report.summary} Итог: откат уже применён.`;
  }
  if (report.rollback.status === 'failed') {
    return `${report.summary} Итог: автооткат не прошёл.`;
  }
  const recommendation = report.recommendation === 'rollback'
    ? 'рекомендован откат'
    : report.recommendation === 'keep'
      ? 'оставляем'
      : 'наблюдаем';
  return `${report.summary} Итог: ${recommendation}.`;
}
