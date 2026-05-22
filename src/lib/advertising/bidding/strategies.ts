/**
 * P73: гибридные режимы ставок — DRR / CPM / ROAS / Hybrid.
 *
 * Чистые функции, определяющие «давление» (direction + magnitude) для
 * adjuster-а стратегии в зависимости от выбранного режима. Возвращают
 * нормализованный pressure 0..1 — он умножается на stepUp/stepDown в
 * engine для получения итогового dбid-delta.
 *
 * Режимы:
 *   - `drr`    — целевая ДРР (spend/revenue*100). Legacy-поведение.
 *   - `cpm`    — целевая цена 1000 показов (spend/views*1000).
 *   - `roas`   — целевая выручка на ₽ расхода (revenue/spend).
 *   - `hybrid` — максимум давлений из drr/cpm/roas.
 */

export const BIDDING_MODES = ['drr', 'cpm', 'roas', 'hybrid'] as const;
export type BiddingMode = (typeof BIDDING_MODES)[number];

export const DEFAULT_BIDDING_MODE: BiddingMode = 'drr';
export const DEFAULT_TARGET_CPM_RUB = 200;
export const DEFAULT_TARGET_ROAS = 4;

/** Границы, за которые мы считаем метрику «сильно в минусе / в плюсе». */
const OVERSHOOT_CAP = 1; // нормализованный предел давления
const HEADROOM_MIN_RATIO = 0.75; // performance-above-target порог (≤75% таргета)

export type BiddingTargets = {
  /** Целевая ДРР, % (spend/revenue*100). Используется в `drr` и `hybrid`. */
  targetDrrPct: number;
  /** Целевая CPM, ₽ за 1000 показов. Используется в `cpm` и `hybrid`. */
  targetCpmRub: number;
  /** Целевой ROAS (revenue/spend). Используется в `roas` и `hybrid`. */
  targetRoas: number;
};

export type BiddingMetrics = {
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  cpcRub: number | null;
  /** ДРР proxy (spend/revenue*100). `null`, если нет выручки. */
  acosProxyPct: number | null;
};

export type BidPressureDirection = 'up' | 'down' | 'hold';

export type BidPressure = {
  direction: BidPressureDirection;
  /** Нормализованная сила давления, 0..1. 0 = целевая метрика в норме. */
  magnitude: number;
  /** Код причины для аудита / UI. */
  reason: string;
  /** Какой режим сработал (важно для `hybrid`). */
  contributingMode: BiddingMode;
};

function toFinite(value: number | null | undefined): number {
  return Number.isFinite(value as number) ? (value as number) : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > OVERSHOOT_CAP) return OVERSHOOT_CAP;
  return value;
}

/** CPM = spend / views * 1000. `null`, если нет показов. */
export function computeCpm(adSpend: number, views: number): number | null {
  const s = toFinite(adSpend);
  const v = toFinite(views);
  if (v <= 0) return null;
  return (s / v) * 1000;
}

/** ROAS = revenue / spend. Выводим из ДРР proxy: roas = 100 / drr. */
export function roasFromDrrPct(drrPct: number | null): number | null {
  if (drrPct === null || drrPct <= 0) return null;
  return 100 / drrPct;
}

export type BiddingModeInput = {
  mode: BiddingMode;
  metrics: BiddingMetrics;
  targets: BiddingTargets;
  /** Если расход > 0 но заказов 0 — считается «нулевой revenue». */
  treatZeroOrdersAsZeroRevenue?: boolean;
};

function computeDrrPressure(metrics: BiddingMetrics, targets: BiddingTargets): BidPressure {
  const target = Math.max(0.01, toFinite(targets.targetDrrPct));
  const drr = metrics.acosProxyPct;

  if (drr === null) {
    // Нет выручки. Если есть значимый расход — прижимаем ставку.
    if (metrics.adSpend > 0 && metrics.orders === 0) {
      return {
        direction: 'down',
        magnitude: 0.5,
        reason: 'drr_no_revenue_with_spend',
        contributingMode: 'drr',
      };
    }
    return {
      direction: 'hold',
      magnitude: 0,
      reason: 'drr_no_data',
      contributingMode: 'drr',
    };
  }

  if (drr > target) {
    const magnitude = clamp01((drr - target) / target);
    return {
      direction: 'down',
      magnitude,
      reason: 'drr_above_target',
      contributingMode: 'drr',
    };
  }

  if (drr <= target * HEADROOM_MIN_RATIO) {
    const magnitude = clamp01((target * HEADROOM_MIN_RATIO - drr) / Math.max(0.01, target));
    return {
      direction: 'up',
      magnitude,
      reason: 'drr_below_target',
      contributingMode: 'drr',
    };
  }

  return {
    direction: 'hold',
    magnitude: 0,
    reason: 'drr_in_target_band',
    contributingMode: 'drr',
  };
}

function computeCpmPressure(metrics: BiddingMetrics, targets: BiddingTargets): BidPressure {
  const target = Math.max(0.01, toFinite(targets.targetCpmRub));
  const cpm = computeCpm(metrics.adSpend, metrics.views);

  if (cpm === null) {
    if (metrics.adSpend > 0) {
      return {
        direction: 'down',
        magnitude: 0.35,
        reason: 'cpm_no_views_with_spend',
        contributingMode: 'cpm',
      };
    }
    return {
      direction: 'hold',
      magnitude: 0,
      reason: 'cpm_no_data',
      contributingMode: 'cpm',
    };
  }

  if (cpm > target) {
    const magnitude = clamp01((cpm - target) / target);
    return {
      direction: 'down',
      magnitude,
      reason: 'cpm_above_target',
      contributingMode: 'cpm',
    };
  }

  if (cpm <= target * HEADROOM_MIN_RATIO) {
    const magnitude = clamp01((target * HEADROOM_MIN_RATIO - cpm) / target);
    return {
      direction: 'up',
      magnitude,
      reason: 'cpm_below_target',
      contributingMode: 'cpm',
    };
  }

  return {
    direction: 'hold',
    magnitude: 0,
    reason: 'cpm_in_target_band',
    contributingMode: 'cpm',
  };
}

function computeRoasPressure(metrics: BiddingMetrics, targets: BiddingTargets): BidPressure {
  const target = Math.max(0.01, toFinite(targets.targetRoas));
  const roas = roasFromDrrPct(metrics.acosProxyPct);

  if (roas === null) {
    if (metrics.adSpend > 0 && metrics.orders === 0) {
      return {
        direction: 'down',
        magnitude: 0.5,
        reason: 'roas_no_revenue_with_spend',
        contributingMode: 'roas',
      };
    }
    return {
      direction: 'hold',
      magnitude: 0,
      reason: 'roas_no_data',
      contributingMode: 'roas',
    };
  }

  if (roas < target) {
    const magnitude = clamp01((target - roas) / target);
    return {
      direction: 'down',
      magnitude,
      reason: 'roas_below_target',
      contributingMode: 'roas',
    };
  }

  // ROAS headroom: если заметно выше таргета — можем поднимать ставку.
  const headroomThreshold = target * (1 / HEADROOM_MIN_RATIO);
  if (roas >= headroomThreshold) {
    const magnitude = clamp01((roas - headroomThreshold) / headroomThreshold);
    return {
      direction: 'up',
      magnitude,
      reason: 'roas_above_target',
      contributingMode: 'roas',
    };
  }

  return {
    direction: 'hold',
    magnitude: 0,
    reason: 'roas_in_target_band',
    contributingMode: 'roas',
  };
}

function pickHybrid(parts: BidPressure[]): BidPressure {
  // Любое «down» перекрывает «up» — безопасность расхода важнее разгона.
  const downs = parts.filter((p) => p.direction === 'down');
  if (downs.length > 0) {
    return downs.reduce((best, cur) => (cur.magnitude > best.magnitude ? cur : best));
  }
  const ups = parts.filter((p) => p.direction === 'up');
  if (ups.length > 0) {
    // Самое уверенное разрешение поднимать — минимальное давление разгона,
    // чтобы не «гонять ставку вверх» когда хотя бы один режим сомневается.
    return ups.reduce((best, cur) => (cur.magnitude < best.magnitude ? cur : best));
  }
  return { direction: 'hold', magnitude: 0, reason: 'hybrid_in_target_band', contributingMode: 'hybrid' };
}

/**
 * Возвращает давление для выбранного режима.
 *
 * Использование в engine: умножить stepDownPct/stepUpPct на magnitude,
 * чтобы получить финальный процент изменения ставки.
 */
export function computeBidPressure(input: BiddingModeInput): BidPressure {
  const { mode, metrics, targets } = input;

  switch (mode) {
    case 'drr':
      return computeDrrPressure(metrics, targets);
    case 'cpm':
      return computeCpmPressure(metrics, targets);
    case 'roas':
      return computeRoasPressure(metrics, targets);
    case 'hybrid': {
      const parts = [
        computeDrrPressure(metrics, targets),
        computeCpmPressure(metrics, targets),
        computeRoasPressure(metrics, targets),
      ];
      const picked = pickHybrid(parts);
      return { ...picked, contributingMode: picked.contributingMode === 'hybrid' ? 'hybrid' : picked.contributingMode };
    }
    default: {
      const _exhaustive: never = mode;
      void _exhaustive;
      return { direction: 'hold', magnitude: 0, reason: 'unknown_mode', contributingMode: 'drr' };
    }
  }
}

export function normalizeBiddingMode(value: unknown): BiddingMode {
  return BIDDING_MODES.includes(value as BiddingMode) ? (value as BiddingMode) : DEFAULT_BIDDING_MODE;
}

export function normalizeTargets(input: Partial<BiddingTargets> & { targetDrrPct: number }): BiddingTargets {
  const targetDrrPct = Math.max(0.01, toFinite(input.targetDrrPct));
  const rawCpm = Number(input.targetCpmRub);
  const targetCpmRub = Number.isFinite(rawCpm) && rawCpm > 0 ? rawCpm : DEFAULT_TARGET_CPM_RUB;
  const rawRoas = Number(input.targetRoas);
  const targetRoas = Number.isFinite(rawRoas) && rawRoas > 0 ? rawRoas : DEFAULT_TARGET_ROAS;
  return { targetDrrPct, targetCpmRub, targetRoas };
}
