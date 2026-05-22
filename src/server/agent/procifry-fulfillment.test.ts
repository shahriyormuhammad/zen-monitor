import { describe, expect, it } from 'vitest';

import { parseFulfillmentStockUpdatePayload } from './procifry-fulfillment';

describe('procifry fulfillment stock helpers', () => {
  it('parses own stock and production orders', () => {
    const payload = parseFulfillmentStockUpdatePayload({
      sourceKey: 'lavrov-vasyan-2026-05-10',
      ownStockItems: [
        {
          nmId: 233650946,
          title: 'Малышки — черная',
          quantity: '2 441',
          snapshotAt: '2026-05-02',
        },
      ],
      productionOrders: [
        {
          title: 'Заказ 15.04.2026 — ETA 08.06',
          status: 'shipped',
          orderedAt: '2026-04-15',
          shippedAt: '2026-05-06',
          estimatedDeliveryAt: '2026-06-08',
          lines: [
            {
              nmId: 620789046,
              title: 'Кудри — бежевый',
              quantity: 2000,
            },
          ],
        },
      ],
    });

    expect(payload.sourceKey).toBe('lavrov-vasyan-2026-05-10');
    expect(payload.replaceExisting).toBe(true);
    expect(payload.ownStockItems[0]?.quantity).toBe(2441);
    expect(payload.ownStockItems[0]?.receivedAt?.toISOString()).toBe('2026-05-02T00:00:00.000Z');
    expect(payload.productionOrders[0]?.status).toBe('shipped');
    expect(payload.productionOrders[0]?.estimatedDeliveryAt?.toISOString()).toBe('2026-06-08T00:00:00.000Z');
    expect(payload.productionOrders[0]?.lines[0]?.quantity).toBe(2000);
  });

  it('rejects empty payloads', () => {
    expect(() => parseFulfillmentStockUpdatePayload({ ownStockItems: [], productionOrders: [] }))
      .toThrow(/no ownStockItems or productionOrders/);
  });

  it('does not replace own stock for production-only updates', () => {
    const payload = parseFulfillmentStockUpdatePayload({
      sourceKey: 'china-batch-only',
      productionOrders: [
        {
          title: 'Партия Китай',
          status: 'shipped',
          lines: [{ nmId: 620789046, quantity: 2000 }],
        },
      ],
    });

    expect(payload.replaceExisting).toBe(false);
  });

  it('accepts new production lines without nmId when draft SKU identifiers are present', () => {
    const payload = parseFulfillmentStockUpdatePayload({
      sourceKey: 'china-invoice-2026-05-18',
      productionOrders: [
        {
          title: 'КП Китай 18.05',
          status: 'in_production',
          lines: [
            {
              isNewProduct: true,
              externalSkuKey: 'FWL-2026-05-18-29144-pink',
              supplierArticle: '29144',
              title: 'Массажная расческа без точечек, розовая',
              quantity: 1000,
              costPerUnit: 28,
              currency: 'RUB',
              receivedQuantity: 0,
            },
          ],
        },
      ],
    });

    const line = payload.productionOrders[0]?.lines[0];
    expect(line?.nmId).toBeNull();
    expect(line?.isNewProduct).toBe(true);
    expect(line?.externalSkuKey).toBe('FWL-2026-05-18-29144-pink');
    expect(line?.supplierArticle).toBe('29144');
    expect(payload.productionOrders[0]?.currency).toBe('RUB');
  });

  it('rejects production lines without nmId when isNewProduct is not explicit', () => {
    expect(() => parseFulfillmentStockUpdatePayload({
      sourceKey: 'china-invoice-2026-05-18',
      productionOrders: [
        {
          title: 'КП Китай 18.05',
          lines: [
            {
              externalSkuKey: 'FWL-2026-05-18-29144-pink',
              supplierArticle: '29144',
              title: 'Массажная расческа без точечек, розовая',
              quantity: 1000,
            },
          ],
        },
      ],
    })).toThrow(/isNewProduct=true/);
  });

  it('rejects new production lines without any draft SKU key', () => {
    expect(() => parseFulfillmentStockUpdatePayload({
      sourceKey: 'china-invoice-2026-05-18',
      productionOrders: [
        {
          title: 'КП Китай 18.05',
          lines: [
            {
              isNewProduct: true,
              quantity: 1000,
            },
          ],
        },
      ],
    })).toThrow(/requires draftSkuId, externalSkuKey, or supplierArticle\/sourceArticle \+ title/);
  });

  it('rejects dangerous replaceExisting without ownStockItems', () => {
    expect(() => parseFulfillmentStockUpdatePayload({
      replaceExisting: true,
      ownStockItems: [],
      productionOrders: [
        {
          title: 'Партия Китай',
          lines: [{ nmId: 620789046, quantity: 2000 }],
        },
      ],
    })).toThrow(/replaceExisting=true when ownStockItems is empty/);
  });
});
