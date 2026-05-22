import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdCampaignsByAdvertIds: vi.fn(),
  wbGetAdSpendHistoryEntries: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {},
  withTenantContext: vi.fn(),
}));

vi.mock('@/lib/db/schema', () => ({
  rawApiOrders: {},
}));

vi.mock('@/lib/wb-api', () => ({
  wbApi: {
    getAdCampaignsByAdvertIds: mocks.getAdCampaignsByAdvertIds,
  },
}));

vi.mock('@/lib/wb-api/ads-balance', () => ({
  wbGetAdSpendHistoryEntries: mocks.wbGetAdSpendHistoryEntries,
}));

import { buildHistoricalAdCostRows, dedupeAdCostRows } from './ad-cost-history';

describe('historical ad cost rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps unallocated ad spend in the total PnL bucket', async () => {
    mocks.wbGetAdSpendHistoryEntries.mockResolvedValueOnce([
      {
        advertId: 123,
        updTime: '2026-04-15T12:00:00+03:00',
        updSum: 222,
        campName: 'Brand campaign',
      },
    ]);
    mocks.getAdCampaignsByAdvertIds.mockResolvedValueOnce([{ advertId: 123, nmIds: [] }]);

    const result = await buildHistoricalAdCostRows({
      tenantId: 'tenant-1',
      token: 'token',
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    });

    expect(result.rows).toEqual([
      expect.objectContaining({
        nmId: 0,
        amount: '222.00',
        type: 'history_upd_unallocated',
        placement: 'campaign:123',
      }),
    ]);
    expect(result.totalAmountRub).toBe(222);
    expect(result.unallocatedAmountRub).toBe(222);
  });

  it('sums duplicate campaign/date rows without dropping spend', () => {
    const rows = dedupeAdCostRows([
      {
        tenantId: 'tenant-1',
        nmId: 111,
        date: new Date('2026-04-01T00:00:00.000Z'),
        amount: '100.25',
        orderCount: 1,
        orderSum: '1000.00',
        type: 'history_upd',
        placement: 'campaign:1',
      },
      {
        tenantId: 'tenant-1',
        nmId: 111,
        date: new Date('2026-04-01T00:00:00.000Z'),
        amount: '50.10',
        orderCount: 2,
        orderSum: '1200.00',
        type: 'history_upd',
        placement: 'campaign:1',
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount: '150.35',
      orderCount: 2,
      orderSum: '1200.00',
    });
  });
});
