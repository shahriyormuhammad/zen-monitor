import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { getProcifryApproval } from '@/server/agent/procifry-approvals';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request, context) => {
  const { tenantId, access } = await requireActiveTenant(request);
  const approvalId = (await context.params).approvalId ?? '';
  const approval = await getProcifryApproval(tenantId, approvalId);

  return NextResponse.json({
    tenantId,
    role: access.role,
    canDecide: access.role === 'owner' || access.role === 'admin',
    approval,
  });
});
