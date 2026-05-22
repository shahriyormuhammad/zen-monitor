import { describe, expect, it } from 'vitest';

import { buildWarehouseOptions, resolveWarehouseOptionId } from './warehouse-options';

describe('resolveWarehouseOptionId', () => {
  it('reuses built-in ids when WB label matches a default warehouse', () => {
    expect(resolveWarehouseOptionId('Коледино')).toBe('koledino');
  });

  it('creates stable ids for WB-only warehouse names', () => {
    expect(resolveWarehouseOptionId('Склад Электросталь')).toBe('wb-складэлектросталь');
    expect(resolveWarehouseOptionId('Склад Электросталь')).toBe(resolveWarehouseOptionId('Склад Электросталь'));
  });
});

describe('buildWarehouseOptions', () => {
  it('uses WB names when they are available', () => {
    const options = buildWarehouseOptions(['Склад Электросталь', 'Коледино'], []);

    expect(options).toEqual(
      expect.arrayContaining([
        { id: 'wb-складэлектросталь', label: 'Склад Электросталь', source: 'wb' },
        { id: 'koledino', label: 'Коледино', source: 'wb' },
      ]),
    );
  });

  it('preserves WB order for the quick top-12 list', () => {
    const options = buildWarehouseOptions(['Склад B', 'Склад A', 'Коледино'], []);

    expect(options.map((option) => option.label)).toEqual(['Склад B', 'Склад A', 'Коледино']);
  });

  it('keeps saved warehouses so old selected rows remain editable', () => {
    const options = buildWarehouseOptions([], [{ id: 'custom-old', label: 'Старый склад' }]);

    expect(options).toEqual(
      expect.arrayContaining([
        { id: 'custom-old', label: 'Старый склад', source: 'saved' },
      ]),
    );
  });
});
