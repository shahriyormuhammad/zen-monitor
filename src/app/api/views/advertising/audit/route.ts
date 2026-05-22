import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { getAuditLog, rollbackBidChange } from '@/server/advertising/audit';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const { searchParams } = new URL(request.url);

  const actionType = searchParams.get('actionType') ?? undefined;
  const campaignIdRaw = searchParams.get('campaignId');
  const campaignId = campaignIdRaw ? Number(campaignIdRaw) : undefined;
  const dateFrom = searchParams.get('dateFrom') ? new Date(searchParams.get('dateFrom')!) : undefined;
  const dateTo = searchParams.get('dateTo') ? new Date(searchParams.get('dateTo')!) : undefined;
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500);
  const offset = Number(searchParams.get('offset') ?? 0);

  const entries = await getAuditLog({
    tenantId,
    actionType,
    campaignId,
    dateFrom,
    dateTo,
    limit,
    offset,
  });

  return NextResponse.json({ entries });
});

export const POST = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const body = await request.json() as Record<string, unknown>;

  if (body.action !== 'rollback') {
    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
  }

  const auditEntryId = body.auditEntryId as string | undefined;
  if (!auditEntryId) {
    return NextResponse.json({ error: 'Укажите auditEntryId' }, { status: 400 });
  }

  const rollbackTarget = await rollbackBidChange(tenantId, auditEntryId);

  // Retrieve tenant token and restore previous bid via WB API
  const { db } = await import('@/lib/db');
  const { tenants } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');
  const { wbApi } = await import('@/lib/wb-api');

  const [tenant] = await db
    .select({ wbApiToken: tenants.wbApiToken })
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  if (!tenant?.wbApiToken) {
    return NextResponse.json({ error: 'WB API токен не настроен' }, { status: 500 });
  }

  await wbApi.setSearchClusterBids(tenant.wbApiToken, rollbackTarget.bids);

  return NextResponse.json({ ok: true, rolledBack: rollbackTarget });
});
