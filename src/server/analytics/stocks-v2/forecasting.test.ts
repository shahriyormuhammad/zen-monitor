import { describe, it, expect } from 'vitest';

import {
  classifyAbc,
  computeDaysLeft,
  computeEwma,
  computeLandedCostPerUnit,
  computeRecommendQuantity,
  computeRop,
  computeSafetyStock,
  computeStdDev,
  computeStockStatus,
  distributeOverheadShare,
  getZScoreForAbc,
} from './forecasting';

describe('getZScoreForAbc', () => {
  it('returns 99% z-score for A bucket', () => {
    expect(getZScoreForAbc('A')).toBe(2.33);
  });
  it('returns 95% z-score for B and unrated', () => {
    expect(getZScoreForAbc('B')).toBe(1.65);
    expect(getZScoreForAbc('unrated')).toBe(1.65);
  });
  it('returns 90% z-score for C', () => {
    expect(getZScoreForAbc('C')).toBe(1.28);
  });
});

describe('computeEwma', () => {
  it('returns 0 for empty input', () => {
    expect(computeEwma([])).toBe(0);
  });
  it('returns the single value for length 1', () => {
    expect(computeEwma([5])).toBe(5);
  });
  it('weights recent values more heavily with high alpha', () => {
    // ряд [10,10,10,10,100] — последний день большой пик
    const lowAlpha = computeEwma([10, 10, 10, 10, 100], 0.1);
    const highAlpha = computeEwma([10, 10, 10, 10, 100], 0.9);
    expect(highAlpha).toBeGreaterThan(lowAlpha);
    // высокий α → ближе к последнему значению
    expect(highAlpha).toBeGreaterThan(80);
    // низкий α → ближе к старому среднему
    expect(lowAlpha).toBeLessThan(30);
  });
  it('handles non-finite values as 0', () => {
    // Step-by-step с α=0.5: ewma=10 → NaN→0: 0.5×0+0.5×10=5 → 10:
    // 0.5×10+0.5×5=7.5 → Inf→0: 0.5×0+0.5×7.5=3.75 → 10:
    // 0.5×10+0.5×3.75=6.875.
    expect(computeEwma([10, NaN, 10, Infinity, 10], 0.5)).toBeCloseTo(6.875, 3);
  });
  it('clamps alpha to [0, 1]', () => {
    expect(computeEwma([5, 10], 5)).toBe(10); // α≥1 → последнее значение
    expect(computeEwma([5, 10], -1)).toBe(5); // α≤0 → первое значение остаётся
  });
});

describe('computeStdDev', () => {
  it('returns 0 for fewer than 2 points', () => {
    expect(computeStdDev([])).toBe(0);
    expect(computeStdDev([5])).toBe(0);
  });
  it('returns 0 for constant series', () => {
    expect(computeStdDev([7, 7, 7, 7])).toBe(0);
  });
  it('matches sample std dev formula for known series', () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] — известный тестовый ряд (Wikipedia), sample
    // std dev = 2.138...
    expect(computeStdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });
  it('skips non-finite values', () => {
    expect(computeStdDev([2, 4, NaN, 4, Infinity, 5, 9])).toBeCloseTo(
      computeStdDev([2, 4, 4, 5, 9]),
      4,
    );
  });
});

describe('computeSafetyStock', () => {
  it('returns 0 for non-positive inputs', () => {
    expect(computeSafetyStock(0, 5, 10)).toBe(0);
    expect(computeSafetyStock(2, 0, 10)).toBe(0);
    expect(computeSafetyStock(2, 5, 0)).toBe(0);
  });
  it('rounds up to whole units', () => {
    // Z=1.65, σ=3, L=10 → 1.65 × 3 × √10 = 1.65 × 3 × 3.162 ≈ 15.65 → 16
    expect(computeSafetyStock(1.65, 3, 10)).toBe(16);
  });
  it('high Z gives larger buffer than low Z', () => {
    expect(computeSafetyStock(2.33, 3, 10)).toBeGreaterThan(computeSafetyStock(1.28, 3, 10));
  });
});

describe('computeRop', () => {
  it('= avg_daily × lead + safety', () => {
    // 5 шт/день × 14 дн + 16 буфер = 70 + 16 = 86
    expect(computeRop(5, 14, 16)).toBe(86);
  });
  it('handles zero safety stock', () => {
    expect(computeRop(5, 14, 0)).toBe(70);
  });
  it('returns 0 for negative input', () => {
    expect(computeRop(-1, 14, 0)).toBe(0);
  });
});

describe('computeDaysLeft', () => {
  it('returns Infinity when demand is 0 and stock > 0', () => {
    expect(computeDaysLeft(100, 0)).toBe(Number.POSITIVE_INFINITY);
  });
  it('returns 0 when stock is 0', () => {
    expect(computeDaysLeft(0, 5)).toBe(0);
  });
  it('returns total / demand otherwise', () => {
    expect(computeDaysLeft(100, 10)).toBe(10);
  });
});

describe('computeStockStatus', () => {
  // lead time 14 days throughout
  it('critical when stock = 0', () => {
    expect(computeStockStatus(0, 14, 0)).toBe('critical');
  });
  it('critical when daysLeft < lead time', () => {
    expect(computeStockStatus(7, 14, 100)).toBe('critical');
  });
  it('warning when daysLeft within lead+14', () => {
    expect(computeStockStatus(20, 14, 100)).toBe('warning');
  });
  it('ok when daysLeft > lead+14 but < 60+lead', () => {
    expect(computeStockStatus(40, 14, 100)).toBe('ok');
  });
  it('overstock when daysLeft > 60+lead', () => {
    expect(computeStockStatus(80, 14, 100)).toBe('overstock');
  });
  it('overstock when no demand but stock exists', () => {
    expect(computeStockStatus(Number.POSITIVE_INFINITY, 14, 100)).toBe('overstock');
  });
});

describe('computeRecommendQuantity', () => {
  it('= target × demand + safety - available', () => {
    // target 30, demand 5, safety 20, available 50 → 30*5 + 20 - 50 = 120
    expect(computeRecommendQuantity(30, 5, 20, 50)).toBe(120);
  });
  it('returns 0 when already covered', () => {
    expect(computeRecommendQuantity(30, 5, 20, 1000)).toBe(0);
  });
  it('rounds the demand × days up', () => {
    // 30 × 1.5 = 45 (exact)
    expect(computeRecommendQuantity(30, 1.5, 0, 0)).toBe(45);
    // 30 × 1.7 = 51 (rounded up from 51.0001)
    expect(computeRecommendQuantity(30, 1.7, 0, 0)).toBe(51);
  });
  it('handles negative / NaN inputs gracefully', () => {
    expect(computeRecommendQuantity(NaN, 5, 0, 0)).toBe(0);
    expect(computeRecommendQuantity(30, -5, 0, 0)).toBe(0);
  });
});

describe('classifyAbc', () => {
  it('returns empty map for empty input', () => {
    expect(classifyAbc([])).toEqual(new Map());
  });
  it('classifies a top-heavy series correctly with default thresholds', () => {
    // total = 100. Top 80% in A, 80-95% in B, остальное C.
    const items = [
      { nmId: 1, revenue: 50 },
      { nmId: 2, revenue: 30 }, // cumulative 80 → A
      { nmId: 3, revenue: 12 }, // cumulative 92 → B
      { nmId: 4, revenue: 5 },  // cumulative 97 → C
      { nmId: 5, revenue: 3 },  // cumulative 100 → C
    ];
    const result = classifyAbc(items);
    expect(result.get(1)).toBe('A');
    expect(result.get(2)).toBe('A');
    expect(result.get(3)).toBe('B');
    expect(result.get(4)).toBe('C');
    expect(result.get(5)).toBe('C');
  });
  it('marks zero-revenue items as unrated', () => {
    const items = [
      { nmId: 1, revenue: 100 },
      { nmId: 2, revenue: 0 },
    ];
    const result = classifyAbc(items);
    expect(result.get(1)).toBe('A');
    expect(result.get(2)).toBe('unrated');
  });
  it('marks all as unrated when no positive revenue exists', () => {
    const items = [
      { nmId: 1, revenue: 0 },
      { nmId: 2, revenue: 0 },
    ];
    const result = classifyAbc(items);
    expect(result.get(1)).toBe('unrated');
    expect(result.get(2)).toBe('unrated');
  });
});

describe('distributeOverheadShare', () => {
  it('returns 0 when overhead is 0', () => {
    expect(distributeOverheadShare(100, 200, 5, 10, 0)).toBe(0);
  });
  it('returns 0 when overhead is negative or NaN', () => {
    expect(distributeOverheadShare(100, 200, 5, 10, -50)).toBe(0);
    expect(distributeOverheadShare(100, 200, 5, 10, NaN)).toBe(0);
  });
  it('distributes pro-rata by goods value when totals are positive', () => {
    // line is 100/400 = 25% of goods → gets 25% × 1000 = 250 of overhead
    expect(distributeOverheadShare(100, 400, 5, 20, 1000)).toBe(250);
  });
  it('falls back to qty share when all goods totals are 0', () => {
    // no costs entered: line is 5/20 = 25% of qty → gets 250 of 1000
    expect(distributeOverheadShare(0, 0, 5, 20, 1000)).toBe(250);
  });
  it('returns 0 when both goods total and qty total are 0', () => {
    expect(distributeOverheadShare(0, 0, 0, 0, 1000)).toBe(0);
  });
  it('handles single-line batch (gets 100% of overhead)', () => {
    expect(distributeOverheadShare(500, 500, 10, 10, 200)).toBe(200);
    // even without goods cost, single qty group still gets 100%
    expect(distributeOverheadShare(0, 0, 10, 10, 200)).toBe(200);
  });
});

describe('computeLandedCostPerUnit', () => {
  it('combines goods + overhead and divides by qty', () => {
    // 1000 ₽ goods + 250 ₽ overhead share, 10 шт → 125 ₽/шт
    expect(computeLandedCostPerUnit(1000, 10, 250)).toBe(125);
  });
  it('returns 0 for zero or invalid qty', () => {
    expect(computeLandedCostPerUnit(1000, 0, 100)).toBe(0);
    expect(computeLandedCostPerUnit(1000, -5, 100)).toBe(0);
    expect(computeLandedCostPerUnit(1000, NaN, 100)).toBe(0);
  });
  it('treats negative goods/overhead as 0', () => {
    expect(computeLandedCostPerUnit(-500, 10, 100)).toBe(10);
    expect(computeLandedCostPerUnit(500, 10, -100)).toBe(50);
  });
  it('works with zero overhead (just goods cost / qty)', () => {
    expect(computeLandedCostPerUnit(1000, 10, 0)).toBe(100);
  });
});
