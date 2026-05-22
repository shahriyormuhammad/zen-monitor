import { describe, expect, it } from 'vitest';
import {
  BIDDING_MODES,
  DEFAULT_TARGET_CPM_RUB,
  DEFAULT_TARGET_ROAS,
  computeBidPressure,
  computeCpm,
  normalizeBiddingMode,
  normalizeTargets,
  roasFromDrrPct,
  type BiddingMetrics,
  type BiddingTargets,
} from './strategies';

const DEFAULT_TARGETS: BiddingTargets = {
  targetDrrPct: 25,
  targetCpmRub: 200,
  targetRoas: 4,
};

function metrics(overrides: Partial<BiddingMetrics> = {}): BiddingMetrics {
  return {
    adSpend: 1000,
    views: 10_000,
    clicks: 100,
    orders: 10,
    cpcRub: 10,
    acosProxyPct: 20,
    ...overrides,
  };
}

describe('computeCpm', () => {
  it('возвращает spend/views*1000', () => {
    expect(computeCpm(500, 10_000)).toBeCloseTo(50);
  });
  it('null при нулевых показах', () => {
    expect(computeCpm(500, 0)).toBeNull();
  });
});

describe('roasFromDrrPct', () => {
  it('25% ДРР → 4 ROAS', () => {
    expect(roasFromDrrPct(25)).toBeCloseTo(4);
  });
  it('null при null/0', () => {
    expect(roasFromDrrPct(null)).toBeNull();
    expect(roasFromDrrPct(0)).toBeNull();
  });
});

describe('computeBidPressure — DRR mode', () => {
  it('ДРР выше таргета → down', () => {
    const p = computeBidPressure({ mode: 'drr', metrics: metrics({ acosProxyPct: 50 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('down');
    expect(p.magnitude).toBeGreaterThan(0);
    expect(p.reason).toBe('drr_above_target');
    expect(p.contributingMode).toBe('drr');
  });

  it('ДРР заметно ниже таргета → up', () => {
    const p = computeBidPressure({ mode: 'drr', metrics: metrics({ acosProxyPct: 10 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('up');
    expect(p.reason).toBe('drr_below_target');
  });

  it('ДРР в band → hold', () => {
    const p = computeBidPressure({ mode: 'drr', metrics: metrics({ acosProxyPct: 22 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('hold');
  });

  it('нет выручки но есть расход → down', () => {
    const p = computeBidPressure({ mode: 'drr', metrics: metrics({ acosProxyPct: null, orders: 0, adSpend: 500 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('down');
    expect(p.reason).toBe('drr_no_revenue_with_spend');
  });

  it('нет данных вообще → hold', () => {
    const p = computeBidPressure({ mode: 'drr', metrics: metrics({ acosProxyPct: null, adSpend: 0, orders: 0 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('hold');
  });
});

describe('computeBidPressure — CPM mode', () => {
  it('CPM выше таргета → down', () => {
    const p = computeBidPressure({ mode: 'cpm', metrics: metrics({ adSpend: 5_000, views: 10_000 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('down');
    expect(p.reason).toBe('cpm_above_target');
    expect(p.magnitude).toBeGreaterThan(0);
  });

  it('CPM сильно ниже → up', () => {
    const p = computeBidPressure({ mode: 'cpm', metrics: metrics({ adSpend: 500, views: 10_000 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('up');
    expect(p.reason).toBe('cpm_below_target');
  });

  it('CPM в band → hold', () => {
    const p = computeBidPressure({ mode: 'cpm', metrics: metrics({ adSpend: 1_800, views: 10_000 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('hold');
  });

  it('нет показов но есть расход → down', () => {
    const p = computeBidPressure({ mode: 'cpm', metrics: metrics({ adSpend: 500, views: 0 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('down');
    expect(p.reason).toBe('cpm_no_views_with_spend');
  });
});

describe('computeBidPressure — ROAS mode', () => {
  it('ROAS ниже таргета → down', () => {
    // ДРР 50% → ROAS 2, target 4 → down
    const p = computeBidPressure({ mode: 'roas', metrics: metrics({ acosProxyPct: 50 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('down');
    expect(p.reason).toBe('roas_below_target');
  });

  it('ROAS выше headroom → up', () => {
    // ДРР 10% → ROAS 10, target 4, headroom порог ≈5.33 → up
    const p = computeBidPressure({ mode: 'roas', metrics: metrics({ acosProxyPct: 10 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('up');
    expect(p.reason).toBe('roas_above_target');
  });

  it('ROAS в band → hold', () => {
    // ДРР 22% → ROAS ~4.54, target 4, headroom ~5.33 → band
    const p = computeBidPressure({ mode: 'roas', metrics: metrics({ acosProxyPct: 22 }), targets: DEFAULT_TARGETS });
    expect(p.direction).toBe('hold');
  });
});

describe('computeBidPressure — hybrid mode', () => {
  it('любой down перекрывает up', () => {
    // CPM высокий (down), DRR в норме
    const p = computeBidPressure({
      mode: 'hybrid',
      metrics: metrics({ adSpend: 5_000, views: 10_000, acosProxyPct: 22 }),
      targets: DEFAULT_TARGETS,
    });
    expect(p.direction).toBe('down');
    expect(['cpm', 'drr', 'roas']).toContain(p.contributingMode);
  });

  it('все up → up с наименьшей magnitude', () => {
    const p = computeBidPressure({
      mode: 'hybrid',
      metrics: metrics({ adSpend: 500, views: 10_000, acosProxyPct: 10 }),
      targets: DEFAULT_TARGETS,
    });
    expect(p.direction).toBe('up');
  });

  it('всё в band → hold', () => {
    const p = computeBidPressure({
      mode: 'hybrid',
      metrics: metrics({ adSpend: 1_800, views: 10_000, acosProxyPct: 22 }),
      targets: DEFAULT_TARGETS,
    });
    expect(p.direction).toBe('hold');
  });

  it('выбирает самый сильный down при множественном давлении', () => {
    // DRR overshoot 100%, CPM overshoot ~900% (clamp to 1)
    const p = computeBidPressure({
      mode: 'hybrid',
      metrics: metrics({ adSpend: 20_000, views: 10_000, acosProxyPct: 50 }),
      targets: DEFAULT_TARGETS,
    });
    expect(p.direction).toBe('down');
    expect(p.magnitude).toBeGreaterThan(0);
  });
});

describe('normalizeBiddingMode', () => {
  it('принимает валидные значения', () => {
    for (const m of BIDDING_MODES) {
      expect(normalizeBiddingMode(m)).toBe(m);
    }
  });

  it('дефолт — drr', () => {
    expect(normalizeBiddingMode('unknown')).toBe('drr');
    expect(normalizeBiddingMode(null)).toBe('drr');
    expect(normalizeBiddingMode(undefined)).toBe('drr');
  });
});

describe('normalizeTargets', () => {
  it('подставляет дефолты для некорректных значений', () => {
    const t = normalizeTargets({ targetDrrPct: 25 });
    expect(t.targetCpmRub).toBe(DEFAULT_TARGET_CPM_RUB);
    expect(t.targetRoas).toBe(DEFAULT_TARGET_ROAS);
  });

  it('сохраняет валидные значения', () => {
    const t = normalizeTargets({ targetDrrPct: 20, targetCpmRub: 150, targetRoas: 5 });
    expect(t.targetDrrPct).toBe(20);
    expect(t.targetCpmRub).toBe(150);
    expect(t.targetRoas).toBe(5);
  });

  it('targetDrrPct минимум 0.01', () => {
    const t = normalizeTargets({ targetDrrPct: 0 });
    expect(t.targetDrrPct).toBeGreaterThan(0);
  });
});
