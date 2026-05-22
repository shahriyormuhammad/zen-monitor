import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { withIdempotencyKey } from '@/lib/idempotency';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import {
  executeBulkBidUpdate,
  getAdvertisingBidWorkspace,
  type AdvertisingBidBulkMode,
} from '@/server/advertising/workspace';

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
  const payload = await getAdvertisingBidWorkspace(tenantId, {
    advertId,
    nmId,
    dateFrom: parsedDateFrom,
    dateTo: parsedDateTo,
  });

  return NextResponse.json(payload);
});

export const POST = withIdempotencyKey(apiRoute(async (request: Request) => {
  const body = await request.json() as {
    advertId?: number;
    nmId?: number;
    from?: string;
    to?: string;
    mode?: AdvertisingBidBulkMode;
    value?: number;
    clusters?: string[];
    minBid?: number;
    maxBid?: number;
    dryRun?: boolean;
    confirmed?: boolean;
    guardrail?: {
      enabled?: boolean;
      maxAcosPct?: number;
      maxCpoRub?: number;
      minClicksWithoutOrders?: number;
      preventIncreaseWithoutOrders?: boolean;
    };
  };

  const advertId = Number(body.advertId);
  const nmId = Number(body.nmId);
  const dateFrom = body.from ? parseApiDateParam(body.from) : null;
  const dateTo = body.to ? parseApiDateParam(body.to) : null;
  const mode = body.mode;
  const value = Number(body.value);

  if (!Number.isFinite(advertId) || advertId <= 0) {
    return NextResponse.json({ error: 'Некорректный advertId' }, { status: 400 });
  }
  if (!Number.isFinite(nmId) || nmId <= 0) {
    return NextResponse.json({ error: 'Некорректный nmId' }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'Некорректный диапазон дат' }, { status: 400 });
  }
  if (mode !== 'set' && mode !== 'delta_abs' && mode !== 'delta_pct') {
    return NextResponse.json({ error: 'Некорректный режим изменения ставки' }, { status: 400 });
  }
  if (!Number.isFinite(value)) {
    return NextResponse.json({ error: 'Некорректное значение изменения ставки' }, { status: 400 });
  }

  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin', 'manager']);
  const payload = await executeBulkBidUpdate(tenantId, {
    userId: user.id,
    advertId,
    nmId,
    dateFrom,
    dateTo,
    mode,
    value,
    clusters: Array.isArray(body.clusters) ? body.clusters : undefined,
    minBid: Number.isFinite(Number(body.minBid)) ? Number(body.minBid) : undefined,
    maxBid: Number.isFinite(Number(body.maxBid)) ? Number(body.maxBid) : undefined,
    dryRun: body.dryRun !== false,
    confirmed: body.confirmed === true,
    guardrail: body.guardrail,
    source: 'manual',
  });

  return NextResponse.json(payload);
}));
