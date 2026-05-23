import { describe, it, expect } from 'vitest';

import { EMPTY_MANUAL_FIELDS, DEFAULT_WAREHOUSES } from './constants';
import { parseManualFieldsPayload } from './manual-fields-io';
import { buildRowSummary, type BuildRowSummaryDeps } from './row-summary';
import type { ManualFields, UnitTemplateRow } from './types';
import { normalizeWarehouseKey, roundCurrency } from './helpers';
import type { AcceptanceTariffCandidate, ReturnTariffCandidate } from './tariff-helpers';

/**
 * Verification suite for buildRowSummary.
 *
 * Goal: confirm the extracted pure function reproduces the exact numerical
 * output of the legacy buildRowSummary callback (in
 * `src/components/dashboard/UnitEconomicsTemplateTable.tsx`). Any drift here
 * would silently corrupt P&L numbers across the Unit Economics screen.
 *
 * Strategy: hand-calculate expected values from the documented formulas and
 * assert exact equality (within roundCurrency precision = 2 decimals).
 */

const NO_TARIFFS: BuildRowSummaryDeps = {
  normalizedTariffMap: new Map(),
  normalizedReturnTariffMap: new Map(),
  globalWbDiscount: '',
  defaultTaxPercent: null,
};

function makeRow(overrides: Partial<UnitTemplateRow> = {}): UnitTemplateRow {
  return {
    nmId: 12345,
    soldQuantity: 0,
    grossRevenue: 0,
    costPrice: 0,
    commission: 0,
    logistics: 0,
    totalCost: 0,
    netProfit: 0,
    ...overrides,
  };
}

function makeManual(overrides: Partial<ManualFields> = {}): ManualFields {
  return parseManualFieldsPayload({ ...EMPTY_MANUAL_FIELDS, ...overrides });
}

describe('buildRowSummary — empty inputs', () => {
  it('returns zeroed-out summary when row and manual fields are empty', () => {
    const row = makeRow();
    const manual = makeManual();
    const result = buildRowSummary(row, manual, NO_TARIFFS);

    expect(result.soldQuantity).toBe(0);
    expect(result.grossRevenue).toBe(0);
    expect(result.fullCost).toBe(0);
    expect(result.projectedRevenue).toBe(0);
    expect(result.commission).toBe(0);
    expect(result.netProfit).toBe(0);
    expect(result.taxRub).toBe(0);
    expect(result.revenueAfterTax).toBe(0);
    expect(result.batchRevenue).toBe(0);
    expect(result.batchGrossProfit).toBe(0);
    expect(result.checkZero).toBe(0);
    // Active scenario defaults to 'average', tradeScheme defaults to 'fbw'
    expect(result.tradeScheme).toBe('fbw');
  });
});

describe('buildRowSummary — realistic FBW scenario (no warehouse tariffs)', () => {
  // Inputs we'll use across this scenario
  const row = makeRow({
    nmId: 100200,
    soldQuantity: 50,
    grossRevenue: 50_000,
    costPrice: 200,
    commission: 5_000,
    totalCost: 18_000,
    netProfit: 12_000,
    categoryCommissionPercentFbw: 25, // overrides fallbackCommissionPercent
    buyoutPercentFact: 80,
    buyoutOrderCountFact: 100,
    buyoutCountFact: 80,
    buyoutCancelCountFact: 20,
    buyoutHistoryDaysFact: 30,
  });

  const manual = makeManual({
    costPrice: '250',
    deliveryToFf: '20',
    packagingMaterial: '10',
    fulfillment: '15',
    localityIndexPercent: '1.2',
    irpPercent: '5',
    purchaseQtyTotal: '100',
    taxPercent: '6',
    turnoverDays: '30',
    marketingInternal: '500',
    marketingExternal: '300',
    contentCost: '100',
    otherCosts: '50',
    activePriceScenarioId: 'average',
    tradeScheme: 'fbw',
    priceScenarios: {
      excellent: { sellerPriceBeforeDiscount: '1500', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '' },
      good: { sellerPriceBeforeDiscount: '1300', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '' },
      average: { sellerPriceBeforeDiscount: '1200', sellerDiscount: '10', wbDiscount: '20', buyoutPercent: '' },
      poor: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '' },
    },
  });

  const summary = buildRowSummary(row, manual, NO_TARIFFS);

  // --- Cost structure ---
  // fullCost = costPrice + deliveryToFf + packagingMaterial + fulfillment + deliveryToMarketplace(=0 no warehouses)
  it('computes fullCost = sum of all per-unit cost components', () => {
    expect(summary.fullCost).toBe(roundCurrency(250 + 20 + 10 + 15 + 0));
  });

  it('uses categoryCommissionPercentFbw, not historical fallback', () => {
    expect(summary.commissionPercent).toBe(25);
  });

  // --- Active price scenario: 'average' with priceBefore=1200, sellerDiscount=10%, wbDiscount=20% ---
  // priceBeforeWbDiscount = 1200 * (1 - 10/100) = 1080
  // priceAfterWb = 1080 * (1 - 20/100) = 864
  it('applies seller and WB discounts in series', () => {
    expect(summary.sellerPriceBeforeDiscount).toBe(1200);
    expect(summary.priceBeforeWbDiscount).toBeCloseTo(1080, 6);
    expect(summary.priceAfterWb).toBeCloseTo(864, 6);
    expect(summary.projectedRevenue).toBe(roundCurrency(1080));
  });

  // SKU has 30+ days of history, so effective buyout comes from WB fact.
  it('uses row buyoutPercentFact when SKU has enough history', () => {
    expect(summary.buyoutPercent).toBe(80);
    expect(summary.buyoutAutoPercent).toBe(80);
    expect(summary.buyoutSource).toBe('auto');
  });

  // commission = projectedRevenue * (commissionPercent / 100) = 1080 * 0.25 = 270
  it('computes commission rub from projectedRevenue × commissionPercent', () => {
    expect(summary.commission).toBe(roundCurrency(1080 * 0.25));
  });

  // Per WB 2026-03-23: ИРП is a separate surcharge = priceBeforeWbDiscount × ИРП %.
  // With manual irpPercent=5 and priceBeforeWbDiscount=1080, ИРП-add = 54.
  // No warehouses → avg forward=0; logistics total is normalized by buyout.
  it('applies ИРП surcharge from price when irpPercent set manually', () => {
    expect(summary.irpSurcharge).toBe(54);
    expect(summary.logisticsTotalComputed).toBe(roundCurrency(54 / 0.8));
  });

  // acquiring = priceBeforeWbDiscount * 0.03 = 1080 * 0.03 = 32.4
  it('computes acquiring 3% on priceBeforeWbDiscount', () => {
    expect(summary.acquiring).toBe(roundCurrency(1080 * 0.03));
  });

  // marketplacePlusStorageTotal = commission + logisticsTotal + storageTotal + acquiring
  // = 270 + (54 / 0.8) (ИРП-надбавка, normalized by buyout) + 0 + 32.4 = 369.9
  it('aggregates marketplace + storage + acquiring', () => {
    expect(summary.marketplacePlusStorageTotal).toBe(roundCurrency(270 + roundCurrency(54 / 0.8) + 0 + roundCurrency(1080 * 0.03)));
  });

  // toSettlementAccount = projectedRevenue - marketplacePlusStorageTotal = 1080 - 369.9 = 710.1
  it('computes toSettlementAccount = projectedRevenue - mp+storage', () => {
    expect(summary.toSettlementAccount).toBe(roundCurrency(1080 - summary.marketplacePlusStorageTotal));
  });

  // taxBasePerUnit = priceAfterWb (rounded) = 864; taxRub = 864 * 6/100 = 51.84
  it('uses priceAfterWb as tax base when scheme=fbw and priceAfterWb>0', () => {
    expect(summary.taxRub).toBeCloseTo(roundCurrency(864 * 0.06), 4);
  });

  // revenueAfterTax = toSettlementAccount - taxRub
  it('computes revenueAfterTax', () => {
    expect(summary.revenueAfterTax).toBe(roundCurrency(summary.toSettlementAccount - summary.taxRub));
  });

  // netProfit = revenueAfterTax - fullCost = 668.16 - 295 = 373.16
  it('computes netProfit per unit', () => {
    expect(summary.netProfit).toBe(roundCurrency(summary.revenueAfterTax - summary.fullCost));
  });

  // checkZero = revenueAfterTax - (netProfit + fullCost) = 0 (sanity).
  // Use Math.abs to treat -0 and +0 as identical — JS arithmetic can produce
  // signed zero from `0 - 0`, but that's not a formula bug.
  it('checkZero stays at 0 (P&L identity)', () => {
    expect(Math.abs(summary.checkZero)).toBe(0);
  });

  // --- Batch totals (purchaseQtyTotal=100) ---
  // plannedOrders = purchaseQtyTotal / (buyout/100) = 100 / 0.8 = 125
  it('computes plannedOrders from purchaseQtyTotal / buyoutRate', () => {
    const expectedPlanned = 100 / (80 / 100);
    expect(summary.batchRevenueInOrders).toBe(roundCurrency(1080 * expectedPlanned));
  });

  // batchRevenue = projectedRevenue * purchaseQtyTotal = 1080 * 100 = 108000
  it('computes batchRevenue = projectedRevenue × purchaseQty', () => {
    expect(summary.batchRevenue).toBe(roundCurrency(1080 * 100));
  });

  // batchCostPriceTotal = costPrice * 100 = 25000
  it('computes batchCostPriceTotal = manualCost × purchaseQty', () => {
    expect(summary.batchCostPriceTotal).toBe(roundCurrency(250 * 100));
  });

  // batchOperatingExpensesBeforeMarketing = batchCostPriceTotal + batchDeliveryToFfTotal + batchPackagingTotal + batchFulfillmentTotal + batchDeliveryToMarketplaceTotal
  // = 25000 + 2000 + 1000 + 1500 + 0 = 29500
  it('computes batchOperatingExpensesBeforeMarketing correctly', () => {
    expect(summary.batchCostTotal).toBe(roundCurrency(295 * 100));
  });

  // marketingTotal = 500 + 300 + 100 + 50 = 950
  // batchMarginalProfit = batchRevenueAfterTax - batchOpExpBeforeMarketing
  // batchGrossProfit = batchMarginalProfit - marketingTotal
  it('subtracts marketing from marginalProfit to get grossProfit', () => {
    const expectedMarketing = 500 + 300 + 100 + 50;
    expect(summary.batchGrossProfit).toBe(roundCurrency(summary.batchMarginalProfit - expectedMarketing));
  });

  // drrPercent = marketingInternal / batchRevenueInOrders * 100
  it('computes drrPercent over revenueInOrders (not batchRevenue)', () => {
    const plannedOrders = 100 / 0.8;
    const expectedRevInOrders = roundCurrency(1080 * plannedOrders);
    expect(summary.drrPercent).toBeCloseTo((500 / expectedRevInOrders) * 100, 6);
  });

  // cpoPlan = marketingInternal / plannedOrders = 500 / 125 = 4
  it('computes cpoPlan = marketingInternal / plannedOrders', () => {
    expect(summary.cpoPlan).toBe(roundCurrency(500 / 125));
  });

  // cpsPlan = marketingInternal / purchaseQtyTotal = 500 / 100 = 5
  it('computes cpsPlan = marketingInternal / purchaseQty', () => {
    expect(summary.cpsPlan).toBe(roundCurrency(500 / 100));
  });

  // batchProfitabilityPercent = batchGrossProfit / batchCostTotal × 100
  // batchCostTotal = fullCost × purchaseQtyTotal (NOT batchCostPriceTotal)
  it('computes batchProfitabilityPercent against batchCostTotal (full cost batch)', () => {
    expect(summary.batchProfitabilityPercent)
      .toBeCloseTo((summary.batchGrossProfit / summary.batchCostTotal) * 100, 6);
  });
});

describe('buildRowSummary — manual DRR in orders drives internal marketing', () => {
  it('derives marketingInternal from manual drrPercent and revenue in orders', () => {
    const row = makeRow({ soldQuantity: 10, grossRevenue: 10_000, buyoutPercentFact: 80 });
    const manual = makeManual({
      drrPercent: '10',
      marketingInternal: '111',
      marketingExternal: '300',
      contentCost: '100',
      otherCosts: '50',
      purchaseQtyTotal: '100',
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '80' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });

    const result = buildRowSummary(row, manual, NO_TARIFFS);

    expect(result.batchRevenueInOrders).toBe(roundCurrency(1000 * 125));
    expect(result.drrPercent).toBe(10);
    expect(result.marketingInternal).toBe(roundCurrency(result.batchRevenueInOrders * 0.1));
    expect(result.drrPercentBuyouts).toBeCloseTo((result.marketingInternal / result.batchRevenue) * 100, 6);
    expect(result.cpoPlan).toBe(roundCurrency(result.marketingInternal / 125));
    expect(result.cpsPlan).toBe(roundCurrency(result.marketingInternal / 100));
    expect(result.batchGrossProfit).toBe(roundCurrency(
      result.batchMarginalProfit
      - (result.marketingInternal + 300 + 100 + 50),
    ));
  });
});

describe('buildRowSummary — buyout auto/manual source', () => {
  it('uses manual buyout while SKU has less than 30 days of history', () => {
    const row = makeRow({
      buyoutPercentFact: 80,
      buyoutOrderCountFact: 130,
      buyoutCountFact: 80,
      buyoutCancelCountFact: 30,
      buyoutHistoryDaysFact: 12,
    });
    const manual = makeManual({
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '65' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });

    const result = buildRowSummary(row, manual, NO_TARIFFS);

    expect(result.buyoutPercent).toBe(65);
    expect(result.buyoutAutoPercent).toBe(80);
    expect(result.buyoutManualPercent).toBe(65);
    expect(result.buyoutHistoryDays).toBe(12);
    expect(result.buyoutSource).toBe('manual');
  });

  it('uses WB auto buyout over manual fallback when SKU has 30+ days of history', () => {
    const row = makeRow({
      buyoutPercentFact: 80,
      buyoutOrderCountFact: 130,
      buyoutCountFact: 80,
      buyoutCancelCountFact: 30,
      buyoutHistoryDaysFact: 30,
    });
    const manual = makeManual({
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '65' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });

    const result = buildRowSummary(row, manual, NO_TARIFFS);

    expect(result.buyoutPercent).toBe(80);
    expect(result.buyoutAutoPercent).toBe(80);
    expect(result.buyoutManualPercent).toBe(65);
    expect(result.buyoutHistoryDays).toBe(30);
    expect(result.buyoutSource).toBe('auto');
  });

  it('falls back to manual when closed WB base is too small', () => {
    const row = makeRow({
      buyoutPercentFact: 100,
      buyoutOrderCountFact: 3,
      buyoutCountFact: 3,
      buyoutCancelCountFact: 0,
      buyoutHistoryDaysFact: 45,
    });
    const manual = makeManual({
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '65' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });

    const result = buildRowSummary(row, manual, NO_TARIFFS);

    expect(result.buyoutSource).toBe('manual');
    expect(result.buyoutPercent).toBe(65);
    expect(result.buyoutAutoReason).toBe('low_closed_base');
    expect(result.buyoutAutoWarning).toContain('мало закрытых заказов');
  });

  it('falls back to manual when too many WB orders are still open', () => {
    const row = makeRow({
      buyoutPercentFact: 85,
      buyoutOrderCountFact: 200,
      buyoutCountFact: 60,
      buyoutCancelCountFact: 50,
      buyoutHistoryDaysFact: 45,
    });
    const manual = makeManual({
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '65' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });

    const result = buildRowSummary(row, manual, NO_TARIFFS);

    expect(result.buyoutSource).toBe('manual');
    expect(result.buyoutPercent).toBe(65);
    expect(result.buyoutAutoReason).toBe('high_open_share');
    expect(result.buyoutAutoWarning).toContain('незакрытых заказов');
  });
});

describe('buildRowSummary — FBS scheme zeroes ИРП and ИЛ', () => {
  it('zeroes both ИРП and ИЛ when tradeScheme=fbs even if values are set', () => {
    const row = makeRow({
      soldQuantity: 10,
      grossRevenue: 10_000,
      categoryCommissionPercentFbs: 20,
      localizationPercent: 5, // would auto-derive ИЛ=1.8 in FBW
    });
    const manual = makeManual({
      irpPercent: '10',
      localityIndexPercent: '7', // legacy +7% value, normalized to ИЛ=1.07 in FBW
      tradeScheme: 'fbs',
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '90' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.tradeScheme).toBe('fbs');
    expect(result.irpPercent).toBe(0);
    expect(result.irpSurcharge).toBe(0);
    expect(result.localityIndexPercent).toBe(0);
    expect(result.localityIndexSource).toBe('none');
    // commissionPercent uses Fbs override
    expect(result.commissionPercent).toBe(20);
  });
});

describe('buildRowSummary — ИЛ (locality index) auto from WB localizationPercent', () => {
  // Per WB 2026-03-23 rules, the localization grid drives ИЛ (Индекс Локализации,
  // multiplier on forward) — NOT ИРП (Индекс Распределения Продаж, surcharge from
  // price). ИРП uses a separate grid over the same WB localizationPercent.
  function makeAutoLocalityRow(localization: number) {
    return makeRow({
      soldQuantity: 1,
      grossRevenue: 1000,
      localizationPercent: localization,
      categoryCommissionPercentFbw: 25,
    });
  }
  function makeAutoLocalityManual() {
    return makeManual({
      activePriceScenarioId: 'average',
      tradeScheme: 'fbw',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '70' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });
  }

  it('localizationPercent ≥ 60 → ИЛ auto = 1.0, source = "auto"', () => {
    const result = buildRowSummary(makeAutoLocalityRow(62), makeAutoLocalityManual(), NO_TARIFFS);
    expect(result.localizationPercent).toBe(62);
    expect(result.localityIndexPercent).toBe(1);
    expect(result.localityIndexSource).toBe('auto');
  });

  it('localizationPercent < 5 → ИЛ auto = 2.0, source = "auto"', () => {
    const result = buildRowSummary(makeAutoLocalityRow(3), makeAutoLocalityManual(), NO_TARIFFS);
    expect(result.localizationPercent).toBe(3);
    expect(result.localityIndexPercent).toBe(2);
    expect(result.localityIndexSource).toBe('auto');
  });

  it('localizationPercent in 25..29 → ИЛ auto = 1.55', () => {
    const result = buildRowSummary(makeAutoLocalityRow(28), makeAutoLocalityManual(), NO_TARIFFS);
    expect(result.localityIndexPercent).toBe(1.55);
    expect(result.localityIndexSource).toBe('auto');
  });

  it('localizationPercent ≥ 95 → ИЛ auto = 0.5, логистика дешевле вдвое', () => {
    const result = buildRowSummary(makeAutoLocalityRow(96), makeAutoLocalityManual(), NO_TARIFFS);
    expect(result.localityIndexPercent).toBe(0.5);
    expect(result.localityIndexSource).toBe('auto');
  });

  it('localizationPercent in 80..84 → ИЛ auto = 0.8', () => {
    const result = buildRowSummary(makeAutoLocalityRow(82), makeAutoLocalityManual(), NO_TARIFFS);
    expect(result.localityIndexPercent).toBe(0.8);
    expect(result.localityIndexSource).toBe('auto');
  });

  it('manual localityIndexPercent overrides auto from localization', () => {
    const row = makeAutoLocalityRow(10); // would auto-derive 2.45
    const manual = makeManual({
      ...makeAutoLocalityManual(),
      localityIndexPercent: '1.5', // user override
    });
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.localizationPercent).toBe(10);
    expect(result.localityIndexPercent).toBe(1.5);
    expect(result.localityIndexSource).toBe('manual');
  });

  it('normalizes legacy manual locality percent-delta values to WB coefficient', () => {
    const row = makeAutoLocalityRow(10);
    const manual = makeManual({
      ...makeAutoLocalityManual(),
      localityIndexPercent: '55',
    });
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.localityIndexPercent).toBe(1.55);
    expect(result.localityIndexSource).toBe('manual');
  });

  it('FBS scheme zeros auto ИЛ even with low localization', () => {
    const row = makeAutoLocalityRow(5);
    const manual = makeManual({
      ...makeAutoLocalityManual(),
      tradeScheme: 'fbs',
    });
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.localizationPercent).toBe(5);
    expect(result.localityIndexPercent).toBe(0);
    expect(result.localityIndexSource).toBe('none');
  });

  it('localizationPercent = 0 → treats as worst tier, ИЛ auto = 2.0', () => {
    const result = buildRowSummary(makeAutoLocalityRow(0), makeAutoLocalityManual(), NO_TARIFFS);
    expect(result.localizationPercent).toBe(0);
    expect(result.localityIndexPercent).toBe(2);
    expect(result.localityIndexSource).toBe('auto');
  });

  it('null localizationPercent (no WB funnel data yet) → neutral ИЛ fallback, source = "none"', () => {
    const row = makeRow({
      soldQuantity: 1,
      grossRevenue: 1000,
      localizationPercent: null,
      categoryCommissionPercentFbw: 25,
    });
    const result = buildRowSummary(row, makeAutoLocalityManual(), NO_TARIFFS);
    expect(result.localizationPercent).toBeNull();
    expect(result.localityIndexPercent).toBe(1);
    expect(result.localityIndexSource).toBe('none');
  });
});

describe('buildRowSummary — ИРП (sales distribution surcharge)', () => {
  it('uses the same cabinet ИЛ/ИРП for every SKU when provided', () => {
    const row = makeRow({
      soldQuantity: 1,
      grossRevenue: 1000,
      categoryCommissionPercentFbw: 25,
      localizationPercent: 95,
      cabinetLocalityIndex: 1.12,
      cabinetIrpPercent: 0.83,
    });
    const manual = makeManual({
      localityIndexPercent: '0.5',
      irpPercent: '5',
      activePriceScenarioId: 'average',
      tradeScheme: 'fbw',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '90' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.localityIndexPercent).toBe(1.12);
    expect(result.localityIndexSource).toBe('cabinet');
    expect(result.irpPercent).toBe(0.83);
    expect(result.irpDisplayPercent).toBe(0.83);
    expect(result.irpSource).toBe('cabinet');
    expect(result.irpSurcharge).toBe(8.3);
  });

  it('auto-derives ИРП from WB localizationPercent when manual value is empty', () => {
    const row = makeRow({
      soldQuantity: 1,
      grossRevenue: 1000,
      categoryCommissionPercentFbw: 25,
      localizationPercent: 10,
    });
    const manual = makeManual({
      activePriceScenarioId: 'average',
      tradeScheme: 'fbw',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '90' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.irpPercent).toBe(2.35);
    expect(result.irpDisplayPercent).toBe(2.35);
    expect(result.irpSource).toBe('auto');
    expect(result.irpSurcharge).toBe(23.5);
  });

  it('manual irpPercent yields surcharge = priceBeforeWbDiscount × ИРП %', () => {
    const row = makeRow({ soldQuantity: 1, grossRevenue: 1000, categoryCommissionPercentFbw: 25, localizationPercent: 10 });
    const manual = makeManual({
      irpPercent: '5', // 5%
      activePriceScenarioId: 'average',
      tradeScheme: 'fbw',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        // priceBeforeWbDiscount = 1000 × (1 − 0/100) = 1000 → projected = 1000
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '90' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.irpPercent).toBe(5);
    expect(result.irpDisplayPercent).toBe(5);
    expect(result.irpSource).toBe('manual');
    // priceBeforeWbDiscount = 1000 → surcharge = 1000 × 5/100 = 50
    expect(result.irpSurcharge).toBe(50);
  });

  it('does not apply ИРП when active ИЛ is 1 or lower', () => {
    const row = makeRow({ soldQuantity: 1, grossRevenue: 1000, categoryCommissionPercentFbw: 25, localizationPercent: 10 });
    const manual = makeManual({
      localityIndexPercent: '0.83',
      irpPercent: '0.83',
      activePriceScenarioId: 'average',
      tradeScheme: 'fbw',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '90' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.localityIndexPercent).toBe(0.83);
    expect(result.irpPercent).toBe(0);
    expect(result.irpDisplayPercent).toBe(0.83);
    expect(result.irpSource).toBe('none');
    expect(result.irpSurcharge).toBe(0);
  });

  it('FBS scheme zeros ИРП even with manual value', () => {
    const row = makeRow({ soldQuantity: 1, grossRevenue: 1000, categoryCommissionPercentFbs: 20 });
    const manual = makeManual({
      irpPercent: '5',
      tradeScheme: 'fbs',
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '90' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.irpPercent).toBe(0);
    expect(result.irpDisplayPercent).toBe(0);
    expect(result.irpSource).toBe('none');
    expect(result.irpSurcharge).toBe(0);
  });
});

describe('buildRowSummary — defaultTaxPercent overrides manual taxPercent', () => {
  it('uses tenant defaultTaxPercent and ignores manual taxPercent', () => {
    const row = makeRow({ soldQuantity: 1, grossRevenue: 1000 });
    const manual = makeManual({
      taxPercent: '15', // manual says 15%
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '50' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });
    const result = buildRowSummary(row, manual, { ...NO_TARIFFS, defaultTaxPercent: 6 });
    // taxPercent = 6 (from default, not 15 from manual), taxBase=1000, taxRub=60
    expect(result.taxPercent).toBe(6);
    expect(result.taxRub).toBe(60);
  });
});

describe('buildRowSummary — global WB discount fallback', () => {
  it('uses globalWbDiscount when scenario wbDiscount is empty', () => {
    const row = makeRow({ soldQuantity: 1, grossRevenue: 1000 });
    const manual = makeManual({
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        // wbDiscount empty here -> should fall back to global
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '', buyoutPercent: '50' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });
    const result = buildRowSummary(row, manual, { ...NO_TARIFFS, globalWbDiscount: '15' });
    expect(result.wbDiscountPercent).toBe(15);
    // priceAfterWb = 1000 * (1 - 0/100) * (1 - 15/100) = 850
    expect(result.priceAfterWb).toBeCloseTo(850, 4);
  });
});

describe('buildRowSummary — WB reverse logistics after 2026-03-20', () => {
  it('logistics with manual buyout 0% adds one reverse leg', () => {
    // Set up one warehouse with non-zero forward + reverse rates
    const acceptance = new Map<string, AcceptanceTariffCandidate>();
    const koledino = DEFAULT_WAREHOUSES.find((w) => w.id === 'koledino')!;
    acceptance.set(normalizeWarehouseKey(koledino.label), {
      warehouseName: koledino.label,
      boxTypeId: 2,
      allowUnload: true,
      coefficient: 0,
      deliveryCoef: 100, // multiplier 1.0 once parsed
      storageCoef: 100,
      deliveryBaseLiter: 0,
      deliveryAdditionalLiter: 0,
      storageBaseLiter: 0,
      storageAdditionalLiter: 0,
      date: '2026-04-01',
    });

    const row = makeRow({
      soldQuantity: 1,
      grossRevenue: 1000,
      wbVolumeLiters: 0.5, // up-to-one-liter tier (WB-side fact only)
    });
    const manual = makeManual({
      selectedWarehouses: ['koledino'],
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '0' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });

    const result = buildRowSummary(row, manual, {
      normalizedTariffMap: acceptance,
      normalizedReturnTariffMap: new Map<string, ReturnTariffCandidate>(),
      globalWbDiscount: '',
      defaultTaxPercent: null,
    });

    // Volume 0.5L → forward base tier 0.4-0.6 = 29; deliveryCoef multiplier = 1
    // wbLogisticsPerUnit per warehouse = 29 * 1 = 29; only one warehouse → avg = 29
    // ИРП not set → localityMultiplier = 1 → logisticsPerUnit = 29 × 1 = 29
    expect(result.logisticsPerUnit).toBe(29);
    // Reverse is the same WB tier by volume and has no warehouse coef/ИЛ/ИРП.
    expect(result.reverseLogisticsPerUnit).toBe(29);
    expect(result.logisticsTotalComputed).toBe(0);
  });

  it('does not add reverse leg when buyout source is missing', () => {
    const acceptance = new Map<string, AcceptanceTariffCandidate>();
    const koledino = DEFAULT_WAREHOUSES.find((w) => w.id === 'koledino')!;
    acceptance.set(normalizeWarehouseKey(koledino.label), {
      warehouseName: koledino.label,
      boxTypeId: 2,
      allowUnload: true,
      coefficient: 0,
      deliveryCoef: 100,
      storageCoef: 100,
      deliveryBaseLiter: 0,
      deliveryAdditionalLiter: 0,
      storageBaseLiter: 0,
      storageAdditionalLiter: 0,
      date: '2026-04-01',
    });

    const row = makeRow({ soldQuantity: 1, grossRevenue: 1000, wbVolumeLiters: 0.5 });
    const manual = makeManual({
      selectedWarehouses: ['koledino'],
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });

    const result = buildRowSummary(row, manual, {
      normalizedTariffMap: acceptance,
      normalizedReturnTariffMap: new Map<string, ReturnTariffCandidate>(),
      globalWbDiscount: '',
      defaultTaxPercent: null,
    });

    expect(result.buyoutSource).toBe('none');
    expect(result.logisticsTotalComputed).toBe(29);
  });

  it('logistics with buyout 50% adds half a reverse leg per unit', () => {
    const acceptance = new Map<string, AcceptanceTariffCandidate>();
    const koledino = DEFAULT_WAREHOUSES.find((w) => w.id === 'koledino')!;
    acceptance.set(normalizeWarehouseKey(koledino.label), {
      warehouseName: koledino.label,
      boxTypeId: 2,
      allowUnload: true,
      coefficient: 0,
      deliveryCoef: 100,
      storageCoef: 100,
      deliveryBaseLiter: 0,
      deliveryAdditionalLiter: 0,
      storageBaseLiter: 0,
      storageAdditionalLiter: 0,
      date: '2026-04-01',
    });

    const row = makeRow({ soldQuantity: 1, grossRevenue: 1000, wbVolumeLiters: 0.5 });
    const manual = makeManual({
      selectedWarehouses: ['koledino'],
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '50' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });

    const result = buildRowSummary(row, manual, {
      normalizedTariffMap: acceptance,
      normalizedReturnTariffMap: new Map<string, ReturnTariffCandidate>(),
      globalWbDiscount: '',
      defaultTaxPercent: null,
    });

    // Formula: (forward + (1 - buyout) × reverse) / buyout
    // forward = 29 (deliveryCoef=1.0, ИЛ=1.0, no extra liters)
    // reverse base = 29 (same tier as forward at 0.5 л)
    // итог = 29 + 0.5 × 29 = 43.5
    expect(result.logisticsTotalComputed).toBe(roundCurrency(43.5 / 0.5));
  });

  it('does not multiply >1L WB tariff base by warehouse coefficient twice', () => {
    const acceptance = new Map<string, AcceptanceTariffCandidate>();
    const koledino = DEFAULT_WAREHOUSES.find((w) => w.id === 'koledino')!;
    acceptance.set(normalizeWarehouseKey(koledino.label), {
      warehouseName: koledino.label,
      boxTypeId: 2,
      allowUnload: true,
      coefficient: 0,
      deliveryCoef: 200,
      storageCoef: 100,
      // These WB endpoint values are already coefficient-applied:
      // 46 * 2 = 92 and 14 * 2 = 28.
      deliveryBaseLiter: 92,
      deliveryAdditionalLiter: 28,
      storageBaseLiter: 0,
      storageAdditionalLiter: 0,
      date: '2026-04-01',
    });

    const row = makeRow({ soldQuantity: 1, grossRevenue: 1000, wbVolumeLiters: 1.5 });
    const manual = makeManual({
      selectedWarehouses: ['koledino'],
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '100' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });

    const result = buildRowSummary(row, manual, {
      normalizedTariffMap: acceptance,
      normalizedReturnTariffMap: new Map<string, ReturnTariffCandidate>(),
      globalWbDiscount: '',
      defaultTaxPercent: null,
    });

    expect(result.logisticsPerUnit).toBe(roundCurrency(92 + 28 * 0.5));
    expect(result.logisticsTotalComputed).toBe(roundCurrency(106));
  });

  it('ignores tariffs/box reverse base/liter for >1L buyer return leg', () => {
    const acceptance = new Map<string, AcceptanceTariffCandidate>();
    const koledino = DEFAULT_WAREHOUSES.find((w) => w.id === 'koledino')!;
    acceptance.set(normalizeWarehouseKey(koledino.label), {
      warehouseName: koledino.label,
      boxTypeId: 2,
      allowUnload: true,
      coefficient: 0,
      deliveryCoef: 200,
      storageCoef: 100,
      deliveryBaseLiter: 92,
      deliveryAdditionalLiter: 28,
      storageBaseLiter: 0,
      storageAdditionalLiter: 0,
      reverseBaseLiter: 40,
      reverseAdditionalLiter: 11,
      reverseCoef: 125,
      date: '2026-04-01',
    });

    const row = makeRow({ soldQuantity: 1, grossRevenue: 1000, wbVolumeLiters: 2.5 });
    const manual = makeManual({
      selectedWarehouses: ['koledino'],
      activePriceScenarioId: 'average',
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        good: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '50' },
        poor: { sellerPriceBeforeDiscount: '', sellerDiscount: '', wbDiscount: '', buyoutPercent: '' },
      },
    });

    const result = buildRowSummary(row, manual, {
      normalizedTariffMap: acceptance,
      normalizedReturnTariffMap: new Map<string, ReturnTariffCandidate>(),
      globalWbDiscount: '',
      defaultTaxPercent: null,
    });

    const forward = 92 + 28 * 1.5;
    const reverse = 46 + 14 * 1.5;
    expect(result.reverseLogisticsPerUnit).toBe(roundCurrency(reverse));
    expect(result.logisticsTotalComputed).toBe(roundCurrency((forward + 0.5 * reverse) / 0.5));
  });
});

describe('buildRowSummary — averagePrice falls back to historical when scenario empty', () => {
  it('uses gross/sold when scenario has no sellerPrice', () => {
    const row = makeRow({ soldQuantity: 10, grossRevenue: 8000 });
    const manual = makeManual();
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.averagePrice).toBe(800); // 8000 / 10
    expect(result.priceAfterWb).toBe(0);
    expect(result.projectedRevenue).toBe(0);
  });
});

describe('buildRowSummary — scenarioOverrideId picks a specific scenario', () => {
  it('lets caller force a non-active scenario for projections', () => {
    const row = makeRow({ soldQuantity: 1, grossRevenue: 1000 });
    const manual = makeManual({
      activePriceScenarioId: 'average', // active = average
      priceScenarios: {
        excellent: { sellerPriceBeforeDiscount: '2000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '90' },
        good: { sellerPriceBeforeDiscount: '1500', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '90' },
        average: { sellerPriceBeforeDiscount: '1000', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '90' },
        poor: { sellerPriceBeforeDiscount: '500', sellerDiscount: '0', wbDiscount: '0', buyoutPercent: '90' },
      },
    });
    const overrideExcellent = buildRowSummary(row, manual, NO_TARIFFS, 'excellent');
    expect(overrideExcellent.sellerPriceBeforeDiscount).toBe(2000);
    expect(overrideExcellent.priceBeforeWbDiscount).toBe(2000);
    expect(overrideExcellent.projectedRevenue).toBe(roundCurrency(2000));

    const overridePoor = buildRowSummary(row, manual, NO_TARIFFS, 'poor');
    expect(overridePoor.sellerPriceBeforeDiscount).toBe(500);
    expect(overridePoor.projectedRevenue).toBe(roundCurrency(500));
  });
});

describe('buildRowSummary — purchase cost source priority', () => {
  it('uses manual.costPrice when > 0', () => {
    const row = makeRow({ purchasePrice: 180, costPrice: 100, totalCost: 999, soldQuantity: 5 });
    const manual = makeManual({ costPrice: '250' });
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.fullCost).toBe(roundCurrency(250));
  });

  it('uses row.purchasePrice before legacy row.costPrice', () => {
    const row = makeRow({ purchasePrice: 180, costPrice: 100, totalCost: 999, soldQuantity: 5 });
    const manual = makeManual();
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.fullCost).toBe(roundCurrency(180));
  });

  it('falls back to legacy row.costPrice when manual and purchasePrice are empty', () => {
    const row = makeRow({ purchasePrice: 0, costPrice: 100, totalCost: 999, soldQuantity: 5 });
    const manual = makeManual();
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.fullCost).toBe(roundCurrency(100));
  });

  it('falls back to row.totalCost / row.soldQuantity when neither manual nor row.costPrice set', () => {
    const row = makeRow({ costPrice: 0, totalCost: 1000, soldQuantity: 4 });
    const manual = makeManual();
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.fullCost).toBe(roundCurrency(250));
  });

  it('does not treat legacy full cost as purchase when detailed costs exist', () => {
    const row = makeRow({ purchasePrice: 0, costPrice: 160, totalCost: 1000, soldQuantity: 4 });
    const manual = makeManual({ deliveryToFf: '20', packagingMaterial: '10', fulfillment: '5' });
    const result = buildRowSummary(row, manual, NO_TARIFFS);
    expect(result.fullCost).toBe(roundCurrency(35));
    expect(result.batchCostPriceTotal).toBe(0);
  });
});
