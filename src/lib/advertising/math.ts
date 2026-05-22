function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function safe(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** ДРР = spend / revenue × 100, % */
export function calcDRR(spendRub: number, revenueRub: number): number | null {
  const s = safe(spendRub);
  const r = safe(revenueRub);
  if (r <= 0) return null;
  return round((s / r) * 100, 2);
}

/** ROAS = revenue / spend */
export function calcROAS(revenueRub: number, spendRub: number): number | null {
  const r = safe(revenueRub);
  const s = safe(spendRub);
  if (s <= 0) return null;
  return round(r / s, 2);
}

/** CPO = spend / orders, ₽/заказ */
export function calcCPO(spendRub: number, orders: number): number | null {
  const s = safe(spendRub);
  const o = safe(orders);
  if (o <= 0) return null;
  return round(s / o, 2);
}

/** CPC = spend / clicks, ₽/клик */
export function calcCPC(spendRub: number, clicks: number): number | null {
  const s = safe(spendRub);
  const c = safe(clicks);
  if (c <= 0) return null;
  return round(s / c, 2);
}

/** CTR = clicks / impressions × 100, % */
export function calcCTR(clicks: number, impressions: number): number | null {
  const c = safe(clicks);
  const i = safe(impressions);
  if (i <= 0) return null;
  return round((c / i) * 100, 4);
}

/** Оценка экономии на ставке за текущий интервал автопилота, ₽ */
export function estimateBidSavingsRub(
  previousBid: number,
  nextBid: number,
  clicks: number,
  options?: { lookbackDays?: number; intervalMinutes?: number },
): number {
  if (!Number.isFinite(previousBid) || !Number.isFinite(nextBid) || nextBid >= previousBid) {
    return 0;
  }
  const safeClicks = Math.max(0, safe(clicks));
  const lookbackDays = Math.max(1, Math.round(options?.lookbackDays ?? 1));
  const intervalMinutes = Math.max(1, Math.round(options?.intervalMinutes ?? 60));
  const lookbackMinutes = lookbackDays * 24 * 60;
  const intervalShare = Math.min(1, intervalMinutes / lookbackMinutes);
  const estimatedIntervalClicks = safeClicks * intervalShare;
  return round((previousBid - nextBid) * estimatedIntervalClicks, 2);
}

export type SelfLearningRow = {
  avgPos: number | null;
  clicks: number;
  orders: number;
  cpcRub: number | null;
  acosProxyPct: number | null;
};

/** Reward-сигнал для self-learning автопилота */
export function computeSelfLearningRunReward(
  rows: SelfLearningRow[],
  target: { from: number; to: number },
  targetAcosPct: number,
  maxCpcRub: number,
  minClicksForLearning: number,
): number {
  if (rows.length === 0) return 0;

  let reward = 0;
  for (const row of rows) {
    let clusterReward = 0;

    if (row.avgPos === null) {
      clusterReward -= 0.25;
    } else if (row.avgPos < target.from) {
      clusterReward -= Math.min(2.5, (target.from - row.avgPos) * 0.7);
    } else if (row.avgPos > target.to) {
      clusterReward -= Math.min(2.5, (row.avgPos - target.to) * 0.85);
    } else {
      clusterReward += 1.5;
    }

    if (row.orders > 0) {
      clusterReward += Math.min(2, row.orders * 0.25);
    } else if (row.clicks >= minClicksForLearning) {
      clusterReward -= 0.9;
    }

    if (row.cpcRub !== null) {
      const cpcOvershoot = Math.max(0, row.cpcRub - maxCpcRub);
      clusterReward -= (cpcOvershoot / Math.max(1, maxCpcRub)) * 1.4;
    }

    if (row.acosProxyPct !== null) {
      const acosOvershoot = Math.max(0, row.acosProxyPct - targetAcosPct);
      clusterReward -= (acosOvershoot / Math.max(1, targetAcosPct)) * 1.8;
    }

    reward += clusterReward;
  }

  return round(reward / rows.length, 6);
}

/**
 * Break-even CPM — максимально допустимая цена 1000 показов при нулевой прибыли.
 * Формула: (margin × conversionRate × avgOrderValue) / 10
 * @param margin - маржа, доля (0..1), например 0.25 = 25%
 * @param conversionRate - конверсия показ→заказ, доля (0..1)
 * @param avgOrderValue - средний чек, ₽
 * @returns ₽/1000 показов
 */
export function calcBreakevenCPM(params: {
  margin: number;
  conversionRate: number;
  avgOrderValue: number;
}): number {
  const margin = safe(params.margin);
  const cr = safe(params.conversionRate);
  const aov = safe(params.avgOrderValue);
  return round((margin * cr * aov) / 10, 2);
}

/**
 * Статус CPM относительно break-even.
 * safe  — currentCPM < 80% breakevenCPM
 * warning — 80%..100%
 * danger  — выше break-even
 */
export function calcBreakevenStatus(
  currentCPM: number,
  breakevenCPM: number,
): 'safe' | 'warning' | 'danger' {
  const cur = safe(currentCPM);
  const bev = safe(breakevenCPM);
  if (bev <= 0) return cur <= 0 ? 'safe' : 'danger';
  const ratio = cur / bev;
  if (ratio >= 1) return 'danger';
  if (ratio >= 0.8) return 'warning';
  return 'safe';
}

export type CampaignStatusMetrics = {
  /** Текущая ДРР, % (null = нет данных) */
  drrPct: number | null;
  /** Целевая ДРР, % (null = не задана) */
  targetDrrPct: number | null;
  /** Заказов за lookback-окно */
  orders: number;
  /** Расход за lookback-окно, ₽ */
  spendRub: number;
  /** Остаток на складе (null = нет данных) */
  stockQty: number | null;
};

/**
 * Светофор состояния кампании — агрегированная оценка для карточки товара.
 *
 * danger:
 *   - нет данных по ДРР (ни одного заказа) И есть расход > 0;
 *   - ДРР ≥ 2× target;
 *   - остаток товара = 0.
 * warning:
 *   - ДРР между 1.0× и 2.0× target;
 *   - остаток < 3 шт.;
 *   - расход > 0 при 0 заказов, но сумма небольшая (порог danger не достигнут).
 * good: всё в норме.
 *
 * При отсутствии target (null) используется эвристика:
 *   danger при ДРР > 50%, warning при ДРР > 30%, good иначе.
 */
export function calcCampaignStatus(metrics: CampaignStatusMetrics): 'good' | 'warning' | 'danger' {
  const stock = metrics.stockQty;
  const orders = safe(metrics.orders);
  const spend = safe(metrics.spendRub);
  const drr = metrics.drrPct;
  const target = metrics.targetDrrPct;

  if (stock !== null && stock <= 0 && spend > 0) {
    return 'danger';
  }

  if (orders === 0 && spend > 0) {
    if (spend >= 500) return 'danger';
    return 'warning';
  }

  if (drr === null) {
    return spend > 0 ? 'warning' : 'good';
  }

  if (target !== null && target > 0) {
    const ratio = drr / target;
    if (ratio >= 2) return 'danger';
    if (ratio >= 1) return 'warning';
  } else {
    if (drr > 50) return 'danger';
    if (drr > 30) return 'warning';
  }

  if (stock !== null && stock < 3) {
    return 'warning';
  }

  return 'good';
}
