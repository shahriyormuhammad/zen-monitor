import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import {
  getAdvertisingClusterControl,
  toggleAdvertisingCluster,
} from '@/server/advertising/clusters';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const nmId = Number(searchParams.get('nmId'));
  const cluster = searchParams.get('cluster') ?? '';

  if (!Number.isFinite(nmId) || nmId <= 0 || !cluster.trim()) {
    return NextResponse.json({ error: 'Некорректный nmId или кластер' }, { status: 400 });
  }

  const { tenantId } = await requireActiveTenant(request);
  const payload = await getAdvertisingClusterControl(tenantId, nmId, cluster);
  return NextResponse.json(payload);
});

export const POST = apiRoute(async (request: Request) => {
  const body = await request.json() as {
    advertId?: number;
    nmId?: number;
    cluster?: string;
    mode?: 'exclude' | 'include';
  };

  const advertId = Number(body.advertId);
  const nmId = Number(body.nmId);
  const cluster = String(body.cluster ?? '').trim();
  const mode = body.mode;

  if (!Number.isFinite(advertId) || advertId <= 0) {
    return NextResponse.json({ error: 'Некорректный advertId' }, { status: 400 });
  }

  if (!Number.isFinite(nmId) || nmId <= 0 || !cluster) {
    return NextResponse.json({ error: 'Некорректный nmId или кластер' }, { status: 400 });
  }

  if (mode !== 'exclude' && mode !== 'include') {
    return NextResponse.json({ error: 'Некорректный режим действия' }, { status: 400 });
  }

  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin', 'manager']);
  const payload = await toggleAdvertisingCluster({
    tenantId,
    userId: user.id,
    advertId,
    nmId,
    cluster,
    mode,
  });

  return NextResponse.json(payload);
});
