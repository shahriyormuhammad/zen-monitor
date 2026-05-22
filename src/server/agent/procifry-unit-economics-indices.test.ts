import { describe, expect, it } from 'vitest';

import {
  applyUnitEconomicsIndicesUpdateToManualFields,
  parseUnitEconomicsIndicesUpdatePayload,
} from './procifry-unit-economics-indices';

describe('procifry unit economics indices helpers', () => {
  it('parses explicit sku items', () => {
    const parsed = parseUnitEconomicsIndicesUpdatePayload({
      items: [
        {
          nmId: 233650946,
          localityIndexPercent: 1.01,
          irpPercent: 0.31,
        },
      ],
    });

    expect(parsed).toEqual({
      mode: 'items',
      items: [
        {
          nmId: 233650946,
          localityIndexPercent: 1.01,
          irpPercent: 0.31,
        },
      ],
    });
  });

  it('parses all_active_skus values with alias keys', () => {
    const parsed = parseUnitEconomicsIndicesUpdatePayload({
      scope: 'all_active_skus',
      values: {
        localizationIndex: '1.01',
        salesDistributionIndex: '0.31',
      },
    });

    expect(parsed).toEqual({
      mode: 'all_active_skus',
      values: {
        localityIndexPercent: 1.01,
        irpPercent: 0.31,
      },
    });
  });

  it('writes locality and irp into manual fields', () => {
    const applied = applyUnitEconomicsIndicesUpdateToManualFields({
      localityIndexPercent: '0.5',
      irpPercent: '0.2',
      selectedWarehouses: ['kol'],
      warehouseCosts: { kol: '3.2' },
      customWarehouses: [{ id: 'kol', label: 'Kol' }],
    }, {
      nmId: 233650946,
      localityIndexPercent: 1.01,
      irpPercent: 0.31,
    });

    expect(applied.changed.current).toEqual({
      localityIndexPercent: 0.5,
      irpPercent: 0.2,
    });
    expect(applied.changed.proposed).toEqual({
      localityIndexPercent: 1.01,
      irpPercent: 0.31,
    });
    expect(applied.manualFields.localityIndexPercent).toBe('1.01');
    expect(applied.manualFields.irpPercent).toBe('0.31');
    expect(applied.manualFields.selectedWarehouses).toEqual(['kol']);
    expect(applied.manualFields.warehouseCosts).toEqual({ kol: '3.2' });
  });
});
