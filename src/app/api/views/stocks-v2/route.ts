import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { getStocksV2 } from '@/server/analytics/stocks-v2/service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);

  const targetDays = parsePositiveInt(searchParams.get('targetDays'), 30);
  const leadTimeDays = parsePositiveInt(searchParams.get('leadTimeDays'), 46);
  const demandPeriodDays = parsePositiveInt(searchParams.get('demandPeriodDays'), 30);

  const { tenantId } = await requireActiveTenant(request);
  const payload = await getStocksV2(tenantId, { targetDays, leadTimeDays, demandPeriodDays });

  return NextResponse.json(payload);
});
