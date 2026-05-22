import { describe, it, expect } from 'vitest';
import {
  calcDRR,
  calcROAS,
  calcCPO,
  calcCPC,
  calcCTR,
  estimateBidSavingsRub,
  computeSelfLearningRunReward,
  calcBreakevenCPM,
  calcBreakevenStatus,
  calcCampaignStatus,
} from './math';

describe('calcDRR', () => {
  it('возвращает корректный %', () => {
    expect(calcDRR(1000, 10000)).toBe(10);
  });
  it('null при нулевой выручке', () => {
    expect(calcDRR(500, 0)).toBeNull();
  });
  it('null при отрицательной выручке', () => {
    expect(calcDRR(500, -100)).toBeNull();
  });
});

describe('calcROAS', () => {
  it('корректный ROAS', () => {
    expect(calcROAS(10000, 1000)).toBe(10);
  });
  it('null при нулевых расходах', () => {
    expect(calcROAS(5000, 0)).toBeNull();
  });
});

describe('calcCPO', () => {
  it('корректный CPO', () => {
    expect(calcCPO(2000, 10)).toBe(200);
  });
  it('null при нулевых заказах', () => {
    expect(calcCPO(2000, 0)).toBeNull();
  });
});

describe('calcCPC', () => {
  it('корректный CPC', () => {
    expect(calcCPC(1000, 200)).toBe(5);
  });
  it('null при нулевых кликах', () => {
    expect(calcCPC(1000, 0)).toBeNull();
  });
});

describe('calcCTR', () => {
  it('корректный CTR', () => {
    expect(calcCTR(100, 10000)).toBe(1);
  });
  it('null при нулевых показах', () => {
    expect(calcCTR(50, 0)).toBeNull();
  });
  it('0 кликов при ненулевых показах', () => {
    expect(calcCTR(0, 1000)).toBe(0);
  });
});

describe('estimateBidSavingsRub', () => {
  it('считает экономию', () => {
    // 100 кликов за 1 день, интервал 60 мин = 1/24 дня
    const result = estimateBidSavingsRub(50, 40, 100, { lookbackDays: 1, intervalMinutes: 60 });
    expect(result).toBeCloseTo((50 - 40) * 100 * (60 / 1440), 2);
  });
  it('0 если следующая ставка >= текущей', () => {
    expect(estimateBidSavingsRub(40, 50, 100)).toBe(0);
  });
  it('0 при нулевых кликах', () => {
    expect(estimateBidSavingsRub(50, 40, 0)).toBe(0);
  });
});

describe('computeSelfLearningRunReward', () => {
  it('0 для пустого массива', () => {
    expect(computeSelfLearningRunReward([], { from: 1, to: 3 }, 30, 100, 5)).toBe(0);
  });

  it('положительный reward при позиции в цели и заказах', () => {
    const rows = [{ avgPos: 2, clicks: 10, orders: 3, cpcRub: 50, acosProxyPct: 20 }];
    const reward = computeSelfLearningRunReward(rows, { from: 1, to: 3 }, 30, 100, 5);
    expect(reward).toBeGreaterThan(0);
  });

  it('отрицательный reward при позиции вне цели и без заказов', () => {
    const rows = [{ avgPos: 10, clicks: 10, orders: 0, cpcRub: 50, acosProxyPct: 20 }];
    const reward = computeSelfLearningRunReward(rows, { from: 1, to: 3 }, 30, 100, 5);
    expect(reward).toBeLessThan(0);
  });
});

describe('calcBreakevenCPM', () => {
  it('корректное значение break-even CPM', () => {
    // margin=0.3, CR=0.01, AOV=5000 → (0.3×0.01×5000)/10 = 1.5
    expect(calcBreakevenCPM({ margin: 0.3, conversionRate: 0.01, avgOrderValue: 5000 })).toBe(1.5);
  });

  it('0 при нулевой конверсии', () => {
    expect(calcBreakevenCPM({ margin: 0.3, conversionRate: 0, avgOrderValue: 5000 })).toBe(0);
  });

  it('0 при нулевой марже', () => {
    expect(calcBreakevenCPM({ margin: 0, conversionRate: 0.01, avgOrderValue: 5000 })).toBe(0);
  });

  it('0 при нулевом среднем чеке', () => {
    expect(calcBreakevenCPM({ margin: 0.3, conversionRate: 0.01, avgOrderValue: 0 })).toBe(0);
  });
});

describe('calcBreakevenStatus', () => {
  it('safe при CPM значительно ниже break-even', () => {
    expect(calcBreakevenStatus(1, 10)).toBe('safe');
  });

  it('warning при CPM 85% от break-even', () => {
    expect(calcBreakevenStatus(8.5, 10)).toBe('warning');
  });

  it('danger при CPM равном break-even', () => {
    expect(calcBreakevenStatus(10, 10)).toBe('danger');
  });

  it('danger при CPM выше break-even', () => {
    expect(calcBreakevenStatus(15, 10)).toBe('danger');
  });

  it('safe при нулевом CPM и нулевом break-even', () => {
    expect(calcBreakevenStatus(0, 0)).toBe('safe');
  });

  it('danger при положительном CPM и нулевом break-even', () => {
    expect(calcBreakevenStatus(5, 0)).toBe('danger');
  });
});

describe('calcCampaignStatus', () => {
  const base = {
    drrPct: 20,
    targetDrrPct: 30,
    orders: 10,
    spendRub: 1000,
    stockQty: 50,
  };

  it('good при всех метриках в норме', () => {
    expect(calcCampaignStatus(base)).toBe('good');
  });

  it('danger при нулевом остатке и ненулевом расходе', () => {
    expect(calcCampaignStatus({ ...base, stockQty: 0 })).toBe('danger');
  });

  it('warning при нулевом остатке и нулевом расходе (кампания не идёт, но товар кончился)', () => {
    expect(calcCampaignStatus({ ...base, stockQty: 0, spendRub: 0, orders: 0 })).toBe('warning');
  });

  it('danger при расходе ≥500 ₽ и 0 заказов', () => {
    expect(calcCampaignStatus({ ...base, orders: 0, spendRub: 800 })).toBe('danger');
  });

  it('warning при расходе <500 ₽ и 0 заказов', () => {
    expect(calcCampaignStatus({ ...base, orders: 0, spendRub: 300 })).toBe('warning');
  });

  it('danger при ДРР ≥ 2× target', () => {
    expect(calcCampaignStatus({ ...base, drrPct: 60, targetDrrPct: 30 })).toBe('danger');
  });

  it('warning при ДРР между 1× и 2× target', () => {
    expect(calcCampaignStatus({ ...base, drrPct: 45, targetDrrPct: 30 })).toBe('warning');
  });

  it('good при ДРР ниже target', () => {
    expect(calcCampaignStatus({ ...base, drrPct: 15, targetDrrPct: 30 })).toBe('good');
  });

  it('warning при остатке < 3 шт (при нормальной ДРР)', () => {
    expect(calcCampaignStatus({ ...base, stockQty: 2 })).toBe('warning');
  });

  it('без target: danger при ДРР > 50%', () => {
    expect(calcCampaignStatus({ ...base, drrPct: 65, targetDrrPct: null })).toBe('danger');
  });

  it('без target: warning при ДРР 30..50%', () => {
    expect(calcCampaignStatus({ ...base, drrPct: 40, targetDrrPct: null })).toBe('warning');
  });

  it('без target: good при ДРР ≤ 30%', () => {
    expect(calcCampaignStatus({ ...base, drrPct: 25, targetDrrPct: null })).toBe('good');
  });

  it('нет данных по ДРР при нулевом расходе → good', () => {
    expect(
      calcCampaignStatus({ drrPct: null, targetDrrPct: 30, orders: 0, spendRub: 0, stockQty: 50 }),
    ).toBe('good');
  });

  it('нет данных по остатку → игнорируется', () => {
    expect(calcCampaignStatus({ ...base, stockQty: null })).toBe('good');
  });

  it('target = 0 → используется эвристика без target', () => {
    expect(calcCampaignStatus({ ...base, drrPct: 40, targetDrrPct: 0 })).toBe('warning');
  });
});
