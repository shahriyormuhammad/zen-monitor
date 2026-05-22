import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant, requireGroupAccess } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import { loadDashboardPayload } from '@/server/analytics/dashboard-summary';

export const revalidate = 60;

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get('from');
  const dateTo = searchParams.get('to');
  const rawGroupId = searchParams.get('groupId');
  const groupId = rawGroupId && rawGroupId.trim().length > 0 ? rawGroupId.trim() : null;

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'Missing req parameters' }, { status: 400 });
  }

  const parsedDateFrom = parseApiDateParam(dateFrom);
  const parsedDateTo = parseApiDateParam(dateTo);
  if (!parsedDateFrom || !parsedDateTo) {
    return NextResponse.json({ error: 'Invalid date parameters' }, { status: 400 });
  }

  const { tenantId } = await requireActiveTenant(request);
  const groupAccess = groupId ? await requireGroupAccess(groupId) : null;
  if (groupAccess && groupAccess.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Group does not belong to active tenant' }, { status: 403 });
  }

  const payload = await loadDashboardPayload(
    tenantId,
    parsedDateFrom.toISOString(),
    parsedDateTo.toISOString(),
    groupId,
  );

  return NextResponse.json({
    ...payload,
    scope: {
      ...payload.scope,
      groupName: groupAccess?.group.name ?? null,
    },
  });
});
