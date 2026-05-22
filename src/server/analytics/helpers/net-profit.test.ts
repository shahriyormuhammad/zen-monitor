import { describe, expect, it } from 'vitest';

import { calculateNetProfitFromOperating } from './net-profit';

describe('calculateNetProfitFromOperating', () => {
  it('uses single contour: profitBeforeTax = operatingProfit - adSpend', () => {
    const result = calculateNetProfitFromOperating({
      taxType: 'usn_income',
      taxRatePercent: 6,
      vatMode: 'none',
      vatRatePercent: 0,
      taxBaseRevenue: 1_000,
      operatingProfit: 300,
      adSpend: 50,
    });

    expect(result.profitBeforeTax).toBeCloseTo(250, 6);
    expect(result.taxAmount).toBeCloseTo(60, 6);
    expect(result.netProfit).toBeCloseTo(190, 6);
  });

  it('clamps invalid numerics to safe defaults', () => {
    const result = calculateNetProfitFromOperating({
      taxType: 'usn_income',
      taxRatePercent: 6,
      vatMode: 'none',
      vatRatePercent: 0,
      taxBaseRevenue: Number.NaN,
      operatingProfit: Number.NaN,
      adSpend: Number.NaN,
    });

    expect(result.profitBeforeTax).toBe(0);
    expect(result.taxAmount).toBe(0);
    expect(result.netProfit).toBe(0);
  });
});
