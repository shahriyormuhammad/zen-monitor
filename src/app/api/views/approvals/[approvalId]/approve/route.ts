import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { approveProcifryApproval } from '@/server/agent/procifry-approvals';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const POST = apiRoute(async (request: Request, context) => {
  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin']);
  const approvalId = (await context.params).approvalId ?? '';
  const decidedBy = user.email ?? user.id;
  const result = await approveProcifryApproval(tenantId, approvalId, decidedBy);

  return NextResponse.json(result);
});
