import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadDashboardPayload: vi.fn(),
  withAdminContext: vi.fn(),
}));

vi.mock('@/server/analytics/dashboard-summary', () => ({
  loadDashboardPayload: mocks.loadDashboardPayload,
}));

vi.mock('@/lib/db', () => ({
  db: {},
  withAdminContext: mocks.withAdminContext,
  withTenantContext: vi.fn(),
}));

vi.mock('@/server/analytics/engine', () => ({
  AnalyticsEngine: {},
}));

import { buildAgentReport } from './reports';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function dashboardPayload(revenue: number, profit: number, ads: number, orders: number) {
  return {
    kpi: {
      revenue: { value: revenue },
      profit: { value: profit },
      ads: { value: ads },
      orders: { value: orders },
      margin: { value: revenue > 0 ? (profit / revenue) * 100 : 0 },
      buyoutRate: { value: 75 },
    },
    chart: null,
    products: {
      topSelling: [
        {
          nmId: revenue,
          vendorCode: `sku-${revenue}`,
          brand: 'Brand',
          soldQuantity: orders,
          grossRevenue: revenue,
          netProfit: profit,
          adSpend: ads,
        },
      ],
      leastSelling: [],
    },
    scope: { type: 'all', groupId: null },
  };
}

describe('buildAgentReport dashboard_summary', () => {
  beforeEach(() => {
    mocks.loadDashboardPayload.mockReset();
    mocks.withAdminContext.mockReset();
    mocks.withAdminContext.mockResolvedValue([
      { id: TENANT_A, name: 'Lavrov' },
      { id: TENANT_B, name: 'Berbeka' },
    ]);
    mocks.loadDashboardPayload.mockImplementation((tenantId: string) => {
      if (tenantId === TENANT_A) {
        return dashboardPayload(1000, 200, 50, 10);
      }
      if (tenantId === TENANT_B) {
        return dashboardPayload(3000, 900, 150, 30);
      }
      throw new Error(`Unexpected tenant ${tenantId}`);
    });
  });

  it('keeps an explicit one-day multi-tenant request as one day', async () => {
    const report = await buildAgentReport({
      tenantId: null,
      report: 'dashboard_summary',
      params: {
        tenantIds: [TENANT_A, TENANT_B],
        multi_tenant: true,
        dateFrom: '2026-05-09',
        dateTo: '2026-05-09',
      },
    });

    expect(report.range).toEqual({ from: '2026-05-09', to: '2026-05-09', days: 1 });
    expect(report.tenantIds).toEqual([TENANT_A, TENANT_B]);
    expect(report.summaryText).toContain('Сводка по 2 кабинетам за 2026-05-09');
    expect(report.summaryText).not.toContain('7 дн');
    expect(report.totals).toMatchObject({
      revenue: 4000,
      profit: 1100,
      ads: 200,
      orders: 40,
      tenantCount: 2,
    });
    expect((report.data.cabinets as unknown[])).toHaveLength(2);
  });
});
