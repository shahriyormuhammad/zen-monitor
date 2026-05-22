import { describe, expect, it } from 'vitest';

import {
  PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID,
  applyCostUpdateToManualFields,
  formatManualDecimal,
  getCurrentCostValues,
  getProposedCostValues,
  parseCostUpdateItems,
} from './procifry-approval-cost';

describe('procifry approval cost helpers', () => {
  it('parses items[] payload from Procifry cost_update', () => {
    const items = parseCostUpdateItems({
      items: [
        {
          nmId: 183690497,
          name: 'Тапочки',
          purchasePrice: 115,
          deliveryToFF: 205,
          deliveryToWB: 22,
          packaging: 13,
          fulfillment: 28,
          totalCost: 383,
        },
      ],
    });

    expect(items).toEqual([
      {
        nmId: 183690497,
        name: 'Тапочки',
        purchasePrice: 115,
        deliveryToFF: 205,
        deliveryToWB: 22,
        packaging: 13,
        fulfillment: 28,
        totalCost: 383,
      },
    ]);
  });

  it('parses single-object payload and computes proposed total fallback', () => {
    const [item] = parseCostUpdateItems({
      nmId: 99849760,
      purchasePrice: '41',
      deliveryToFF: '26',
      deliveryToWB: '2,8',
      packaging: 0,
      fulfillment: 14,
    });

    expect(item?.nmId).toBe(99849760);
    expect(getProposedCostValues(item!).totalCost).toBe(83.8);
  });

  it('recovers nmId from product title when Procifry sends nmId as zero', () => {
    const [item] = parseCostUpdateItems({
      items: [
        {
          nmId: 0,
          title: 'Себестоимость — Браш-53 (144663672) | ИП Лавров',
          purchasePrice: 70,
        },
      ],
    });

    expect(item?.nmId).toBe(144663672);
    expect(item?.name).toBe('Себестоимость — Браш-53 (144663672) | ИП Лавров');
    expect(item?.purchasePrice).toBe(70);
  });

  it('applies Procifry cost fields to unit-economics manual fields', () => {
    const [item] = parseCostUpdateItems({
      nmId: 99849760,
      purchasePrice: 41,
      deliveryToFF: 26,
      deliveryToWB: 2.8,
      packaging: 0,
      fulfillment: 14,
    });

    const next = applyCostUpdateToManualFields({
      taxPercent: '6',
      selectedWarehouses: ['koledino'],
      warehouseCosts: { koledino: '9' },
    }, item!);

    expect(next.costPrice).toBe('41');
    expect(next.deliveryToFf).toBe('26');
    expect(next.packagingMaterial).toBe('0');
    expect(next.fulfillment).toBe('14');
    expect(next.taxPercent).toBe('6');
    expect(next.selectedWarehouses).toEqual([PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID]);
    expect(next.warehouseCosts[PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID]).toBe('2.8');
  });

  it('uses manual cost first and falls back to latest catalog cost', () => {
    expect(getCurrentCostValues({ costPrice: '12.5' }, 99).purchasePrice).toBe(12.5);
    expect(getCurrentCostValues({}, 99).purchasePrice).toBe(99);
  });

  it('formats numbers for manual input fields', () => {
    expect(formatManualDecimal(83.8)).toBe('83.8');
    expect(formatManualDecimal(83.805)).toBe('83.81');
    expect(formatManualDecimal(83)).toBe('83');
  });
});
