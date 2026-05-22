import { NextResponse } from 'next/server';
import { AnalyticsEngine } from '@/server/analytics/engine';
import type { DashboardDataTrustAudit } from '@/server/analytics/engine';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import {
  createTenantDashboardCache,
  getDashboardDataTrustCacheTag,
} from '@/lib/analytics/dashboard-cache';

export const revalidate = 60;

async function buildDataTrustPayload(
  tenantId: string,
  fromIso: string,
  toIso: string,
): Promise<DashboardDataTrustAudit> {
  return AnalyticsEngine.getDashboardDataTrust(
    tenantId,
    new Date(fromIso),
    new Date(toIso),
    { calculationMode: 'FACT_WB' },
  );
}

const loadDataTrustPayload = createTenantDashboardCache(
  'dashboard-data-trust',
  getDashboardDataTrustCacheTag,
  buildDataTrustPayload,
);

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get('from');
  const dateTo = searchParams.get('to');

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'Missing req parameters' }, { status: 400 });
  }

  const parsedDateFrom = parseApiDateParam(dateFrom);
  const parsedDateTo = parseApiDateParam(dateTo);
  if (!parsedDateFrom || !parsedDateTo) {
    return NextResponse.json({ error: 'Invalid date parameters' }, { status: 400 });
  }

  const { tenantId } = await requireActiveTenant(request);
  const payload = await loadDataTrustPayload(
    tenantId,
    parsedDateFrom.toISOString(),
    parsedDateTo.toISOString(),
  );

  return NextResponse.json({ dataTrust: payload });
});
