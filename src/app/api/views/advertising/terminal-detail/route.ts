import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import { getAdvertisingTerminalDetail } from '@/server/analytics/advertising-terminal-detail';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get('from');
  const dateTo = searchParams.get('to');
  const advertIdParam = searchParams.get('advertId');
  const nmIdParam = searchParams.get('nmId');

  const advertId = Number(advertIdParam);
  const nmId = nmIdParam ? Number(nmIdParam) : null;

  if (!dateFrom || !dateTo || !Number.isFinite(advertId) || advertId <= 0) {
    return NextResponse.json({ error: 'Не переданы обязательные параметры' }, { status: 400 });
  }

  if (nmId !== null && (!Number.isFinite(nmId) || nmId <= 0)) {
    return NextResponse.json({ error: 'Некорректный nmId' }, { status: 400 });
  }

  const parsedDateFrom = parseApiDateParam(dateFrom);
  const parsedDateTo = parseApiDateParam(dateTo);
  if (!parsedDateFrom || !parsedDateTo) {
    return NextResponse.json({ error: 'Некорректный диапазон дат' }, { status: 400 });
  }

  const { tenantId } = await requireActiveTenant(request);
  const payload = await getAdvertisingTerminalDetail(tenantId, {
    advertId: Math.trunc(advertId),
    nmId: nmId === null ? null : Math.trunc(nmId),
    dateFrom: parsedDateFrom,
    dateTo: parsedDateTo,
  });
  return NextResponse.json(payload);
});
