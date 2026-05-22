import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import { getAdvertisingHeatmap } from '@/server/analytics/advertising-heatmap';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parsePositiveInt(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const dateFrom = parseApiDateParam(searchParams.get('from'));
  const dateTo = parseApiDateParam(searchParams.get('to'));
  const advertId = parsePositiveInt(searchParams.get('advertId') ?? searchParams.get('campaignId'));
  const nmId = parsePositiveInt(searchParams.get('nmId'));

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'Некорректный диапазон дат' }, { status: 400 });
  }

  const { tenantId } = await requireActiveTenant(request);
  const payload = await getAdvertisingHeatmap(tenantId, dateFrom, dateTo, {
    advertId,
    nmId,
  });
  return NextResponse.json(payload);
});
