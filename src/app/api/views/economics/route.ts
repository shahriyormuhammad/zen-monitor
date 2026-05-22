import { NextResponse } from 'next/server';
import { AnalyticsEngine } from '@/server/analytics/engine';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

  const tableData = await AnalyticsEngine.getUnitEconomics(tenantId, parsedDateFrom, parsedDateTo, {
    recentActivityDays: 90,
    calculationMode: 'FACT_WB',
  });
  const signals = await AnalyticsEngine.getActiveSignals(tenantId);

  // Map signals to data rows
  const enrichedData = tableData.map((row) => ({
    ...row,
    activeSignals: signals.filter((signal) => signal.nmId === row.nmId)
  }));

  return NextResponse.json({ data: enrichedData, calculationMode: 'FACT_WB' });
});
