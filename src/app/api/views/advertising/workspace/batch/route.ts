import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import { executeExcludeHighRiskClusters } from '@/server/advertising/workspace';

type ClusterRiskLevel = 'high' | 'medium' | 'low' | 'none';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const POST = apiRoute(async (request: Request) => {
  const body = await request.json() as {
    from?: string;
    to?: string;
    riskLevels?: ClusterRiskLevel[];
    dryRun?: boolean;
    confirmed?: boolean;
    maxClusters?: number;
  };

  const dateFrom = body.from ? parseApiDateParam(body.from) : null;
  const dateTo = body.to ? parseApiDateParam(body.to) : null;

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'Некорректный диапазон дат' }, { status: 400 });
  }

  const riskLevels: ClusterRiskLevel[] = Array.isArray(body.riskLevels)
    ? body.riskLevels.filter((item): item is ClusterRiskLevel => (
      item === 'high' || item === 'medium' || item === 'low' || item === 'none'
    ))
    : ['high'];

  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin', 'manager']);
  const payload = await executeExcludeHighRiskClusters(tenantId, {
    userId: user.id,
    dateFrom,
    dateTo,
    riskLevels: riskLevels.length > 0 ? riskLevels : (['high'] as ClusterRiskLevel[]),
    dryRun: body.dryRun !== false,
    confirmed: body.confirmed === true,
    maxClusters: Number.isFinite(Number(body.maxClusters)) ? Number(body.maxClusters) : undefined,
  });

  return NextResponse.json(payload);
});
