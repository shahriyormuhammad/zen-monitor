import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { listProcifryApprovals } from '@/server/agent/procifry-approvals';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { tenantId, access } = await requireActiveTenant(request);
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || null;
  const limitRaw = Number(searchParams.get('limit') ?? 100);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

  const result = await listProcifryApprovals(tenantId, { status, limit });

  return NextResponse.json({
    ...result,
    role: access.role,
    canDecide: access.role === 'owner' || access.role === 'admin',
  });
});
