import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseRequestBody } from '@/lib/api-parse';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { linkProcifryDraftSkuToNmId } from '@/server/agent/procifry-fulfillment';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const bodySchema = z.object({
  nmId: z.number().int().positive(),
});

export const POST = apiRoute(async (request: Request, context) => {
  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin']);
  const draftSkuId = (await context.params).draftSkuId ?? '';
  const body = await parseRequestBody(request, bodySchema);
  const result = await linkProcifryDraftSkuToNmId({
    tenantId,
    draftSkuId,
    nmId: body.nmId,
    linkedBy: user.email ?? user.id,
  });

  return NextResponse.json(result);
});
