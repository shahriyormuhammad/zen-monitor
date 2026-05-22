import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseRequestBody } from '@/lib/api-parse';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { rejectProcifryApproval } from '@/server/agent/procifry-approvals';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const rejectBodySchema = z.object({
  reason: z.string().trim().max(1000).optional().nullable(),
});

export const POST = apiRoute(async (request: Request, context) => {
  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin']);
  const approvalId = (await context.params).approvalId ?? '';
  const body = await parseRequestBody(request, rejectBodySchema);
  const decidedBy = user.email ?? user.id;
  const result = await rejectProcifryApproval(tenantId, approvalId, decidedBy, body.reason?.trim() || null);

  return NextResponse.json(result);
});
