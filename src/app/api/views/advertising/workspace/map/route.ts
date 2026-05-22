import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import { getAdvertisingClusterMap } from '@/server/advertising/workspace';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const advertId = Number(searchParams.get('advertId'));
  const nmId = Number(searchParams.get('nmId'));
  const dateFrom = searchParams.get('from');
  const dateTo = searchParams.get('to');

  if (!Number.isFinite(advertId) || advertId <= 0) {
    return NextResponse.json({ error: 'Некорректный advertId' }, { status: 400 });
  }
  if (!Number.isFinite(nmId) || nmId <= 0) {
    return NextResponse.json({ error: 'Некорректный nmId' }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'Не передан диапазон дат' }, { status: 400 });
  }

  const parsedDateFrom = parseApiDateParam(dateFrom);
  const parsedDateTo = parseApiDateParam(dateTo);
  if (!parsedDateFrom || !parsedDateTo) {
    return NextResponse.json({ error: 'Некорректный диапазон дат' }, { status: 400 });
  }

  const { tenantId } = await requireActiveTenant(request);
  const payload = await getAdvertisingClusterMap(tenantId, {
    advertId,
    nmId,
    dateFrom: parsedDateFrom,
    dateTo: parsedDateTo,
  });

  return NextResponse.json(payload);
});
