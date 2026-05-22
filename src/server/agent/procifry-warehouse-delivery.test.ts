import { describe, expect, it } from 'vitest';

import {
  PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID,
  PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_LABEL,
} from './procifry-approval-cost';
import {
  applyWarehouseDeliveryCostUpdateToManualFields,
  parseWarehouseDeliveryCostUpdateItems,
} from './procifry-warehouse-delivery';

describe('procifry warehouse delivery helpers', () => {
  it('parses batch payloads with per-item warehouses', () => {
    const items = parseWarehouseDeliveryCostUpdateItems({
      cabinetOid: '996894',
      items: [
        {
          nmId: 861490951,
          unitsPerBox: 180,
          warehouses: [
            { warehouseName: 'Екатеринбург', deliveryToWbPerUnit: 3.83 },
            { warehouseName: 'Рязань', deliveryToWbPerUnit: 2.36 },
          ],
          calculation: { boxes: 10 },
        },
      ],
    });

    expect(items).toEqual([
      {
        nmId: 861490951,
        disableWarehouses: [],
        enableWarehouses: [
          { warehouseName: 'Екатеринбург', deliveryToWbPerUnit: 3.83 },
          { warehouseName: 'Рязань', deliveryToWbPerUnit: 2.36 },
        ],
        unitEconomicsDeliveryToWbMode: 'average_enabled_warehouses',
        calculation: { boxes: 10 },
      },
    ]);
  });

  it('disables legacy Procifry warehouse and enables real warehouses', () => {
    const [item] = parseWarehouseDeliveryCostUpdateItems({
      nmId: 861490951,
      disableWarehouses: [PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_LABEL],
      enableWarehouses: [
        { warehouseName: 'Екатеринбург', deliveryToWbPerUnit: 3.83 },
        { warehouseName: 'Рязань', deliveryToWbPerUnit: 2.36 },
        { warehouseName: 'Волгоград', deliveryToWbPerUnit: 3.24 },
        { warehouseName: 'Пенза', deliveryToWbPerUnit: 2.65 },
      ],
    });

    const applied = applyWarehouseDeliveryCostUpdateToManualFields({
      selectedWarehouses: [PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID],
      warehouseCosts: { [PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID]: '3' },
      customWarehouses: [
        {
          id: PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID,
          label: PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_LABEL,
        },
      ],
    }, item!);

    expect(applied.manualFields.selectedWarehouses).not.toContain(PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_ID);
    expect(applied.changed.disabled).toEqual([PROCIFRY_DELIVERY_TO_WB_WAREHOUSE_LABEL]);
    expect(applied.changed.enabled).toHaveLength(4);
    expect(applied.changed.unitEconomicsDeliveryToWb).toBe(3.02);
    expect(applied.manualFields.selectedWarehouses).toContain('ryazan');
    expect(applied.manualFields.warehouseCosts.ryazan).toBe('2.36');
  });
});
