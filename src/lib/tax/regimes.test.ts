import { describe, expect, it } from 'vitest';

import { calculateTax } from './regimes';

describe('calculateTax', () => {
  it('keeps the legacy USN income result when VAT is disabled', () => {
    const result = calculateTax({
      taxType: 'usn_income',
      taxRatePercent: 6,
      revenue: 1000,
      profitBeforeTax: 500,
    });

    expect(result.vatAmount).toBe(0);
    expect(result.incomeTaxAmount).toBe(60);
    expect(result.taxAmount).toBe(60);
    expect(result.netProfit).toBe(440);
  });

  it('extracts USN 5% VAT from WB price before calculating USN income tax', () => {
    const result = calculateTax({
      taxType: 'usn_income',
      taxRatePercent: 6,
      vatMode: 'usn_5',
      vatRatePercent: 5,
      revenue: 1000,
      profitBeforeTax: 500,
    });

    expect(result.vatAmount).toBeCloseTo(47.619, 3);
    expect(result.incomeTaxBaseRevenue).toBeCloseTo(952.381, 3);
    expect(result.incomeTaxAmount).toBeCloseTo(57.143, 3);
    expect(result.taxAmount).toBeCloseTo(104.762, 3);
    expect(result.netProfit).toBeCloseTo(395.238, 3);
  });

  it('respects a manually entered reduced USN income rate', () => {
    const result = calculateTax({
      taxType: 'usn_income',
      taxRatePercent: 1,
      revenue: 1000,
      profitBeforeTax: 500,
    });

    expect(result.incomeTaxAmount).toBe(10);
    expect(result.taxAmount).toBe(10);
    expect(result.netProfit).toBe(490);
  });

  it('respects a manually entered reduced USN income-minus-expenses rate', () => {
    const result = calculateTax({
      taxType: 'usn_income_expenses',
      taxRatePercent: 5,
      revenue: 1000,
      profitBeforeTax: 500,
    });

    expect(result.minimumTaxAmount).toBe(10);
    expect(result.incomeTaxAmount).toBe(25);
    expect(result.taxAmount).toBe(25);
    expect(result.netProfit).toBe(475);
  });

  it('uses USN income-minus-expenses minimum tax after extracting VAT', () => {
    const result = calculateTax({
      taxType: 'usn_income_expenses',
      taxRatePercent: 15,
      vatMode: 'usn_5',
      vatRatePercent: 5,
      revenue: 1000,
      profitBeforeTax: 100,
    });

    expect(result.vatAmount).toBeCloseTo(47.619, 3);
    expect(result.profitBeforeIncomeTax).toBeCloseTo(52.381, 3);
    expect(result.minimumTaxAmount).toBeCloseTo(9.524, 3);
    expect(result.incomeTaxAmount).toBeCloseTo(9.524, 3);
    expect(result.taxAmount).toBeCloseTo(57.143, 3);
    expect(result.netProfit).toBeCloseTo(42.857, 3);
  });

  it('applies general 22% output VAT before company profit tax', () => {
    const result = calculateTax({
      taxType: 'osn_company',
      taxRatePercent: 25,
      vatMode: 'general_22',
      vatRatePercent: 22,
      revenue: 1220,
      profitBeforeTax: 300,
    });

    expect(result.vatAmount).toBeCloseTo(220, 3);
    expect(result.profitBeforeIncomeTax).toBeCloseTo(80, 3);
    expect(result.incomeTaxAmount).toBeCloseTo(20, 3);
    expect(result.taxAmount).toBeCloseTo(240, 3);
    expect(result.netProfit).toBeCloseTo(60, 3);
  });

  it('supports the general 10% VAT mode', () => {
    const result = calculateTax({
      taxType: 'usn_income',
      taxRatePercent: 6,
      vatMode: 'general_10',
      vatRatePercent: 10,
      revenue: 1100,
      profitBeforeTax: 600,
    });

    expect(result.vatAmount).toBeCloseTo(100, 3);
    expect(result.incomeTaxBaseRevenue).toBeCloseTo(1000, 3);
    expect(result.incomeTaxAmount).toBeCloseTo(60, 3);
    expect(result.taxAmount).toBeCloseTo(160, 3);
  });
});
