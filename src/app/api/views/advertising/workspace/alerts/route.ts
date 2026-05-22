import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import { getAdvertisingAlerts } from '@/server/advertising/workspace';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get('from');
  const dateTo = searchParams.get('to');

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'Не передан диапазон дат' }, { status: 400 });
  }

  const parsedDateFrom = parseApiDateParam(dateFrom);
  const parsedDateTo = parseApiDateParam(dateTo);
  if (!parsedDateFrom || !parsedDateTo) {
    return NextResponse.json({ error: 'Некорректный диапазон дат' }, { status: 400 });
  }

  const { tenantId } = await requireActiveTenant(request);
  const payload = await getAdvertisingAlerts(tenantId, parsedDateFrom, parsedDateTo);

  return NextResponse.json(payload);
});
