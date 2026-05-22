import { describe, expect, it } from 'vitest';

import { EMPTY_MANUAL_FIELDS } from '@/components/economics/constants';
import { parseManualFieldsPayload } from '@/components/economics/manual-fields-io';
import type { ManualFields, UnitTemplateRow } from '@/components/economics/types';
import {
  computeCostTotal,
  copyCostFieldsToManualFields,
  isCostComplete,
  resolvePurchaseCost,
} from './costing-helpers';

function makeRow(overrides: Partial<UnitTemplateRow> = {}): UnitTemplateRow {
  return {
    nmId: 123,
    purchasePrice: 0,
    costPrice: 0,
    ...overrides,
  };
}

function makeManual(overrides: Partial<ManualFields> = {}): ManualFields {
  return parseManualFieldsPayload({ ...EMPTY_MANUAL_FIELDS, ...overrides });
}

describe('costing helpers', () => {
  it('uses purchasePrice as the purchase fallback before costPrice', () => {
    const row = makeRow({ purchasePrice: 100, costPrice: 160 });
    const manual = makeManual({
      deliveryToFf: '20',
      packagingMaterial: '10',
      fulfillment: '5',
    });

    expect(resolvePurchaseCost(row, manual)).toBe(100);
    expect(computeCostTotal(row, manual)).toBe(135);
    expect(isCostComplete(row, manual)).toBe(true);
  });

  it('does not treat full cost fallback as purchase when detailed cost fields exist', () => {
    const row = makeRow({ purchasePrice: 0, costPrice: 160 });
    const manual = makeManual({
      deliveryToFf: '20',
      packagingMaterial: '10',
      fulfillment: '5',
    });

    expect(resolvePurchaseCost(row, manual)).toBe(0);
    expect(computeCostTotal(row, manual)).toBe(35);
    expect(isCostComplete(row, manual)).toBe(false);
  });

  it('copies only cost fields into a target manual payload', () => {
    const source = makeManual({
      costPrice: '100',
      deliveryToFf: '20',
      packagingMaterial: '5',
      fulfillment: '7',
      selectedWarehouses: ['koledino'],
      warehouseCosts: { koledino: '11' },
      customWarehouses: [{ id: 'custom-msk', label: 'Москва' }],
      purchaseQtyTotal: '999',
      marketingInternal: '123',
    });
    const target = makeManual({
      costPrice: '1',
      purchaseQtyTotal: '50',
      marketingInternal: '77',
      irpPercent: '3',
      taxPercent: '6',
    });

    const copied = copyCostFieldsToManualFields(source, target);

    expect(copied.costPrice).toBe('100');
    expect(copied.deliveryToFf).toBe('20');
    expect(copied.packagingMaterial).toBe('5');
    expect(copied.fulfillment).toBe('7');
    expect(copied.selectedWarehouses).toEqual(['koledino']);
    expect(copied.warehouseCosts).toEqual({ koledino: '11' });
    expect(copied.customWarehouses).toEqual([{ id: 'custom-msk', label: 'Москва' }]);

    expect(copied.purchaseQtyTotal).toBe('50');
    expect(copied.marketingInternal).toBe('77');
    expect(copied.irpPercent).toBe('3');
    expect(copied.taxPercent).toBe('6');
  });
});
