import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiRoute } from '@/lib/api-response';
import { withIdempotencyKey } from '@/lib/idempotency';
import { withRateLimit } from '@/lib/rate-limit';
import { requireTenantMatchesActive } from '@/lib/auth/tenant-access';
import { publishWbReply } from '@/server/reviews-qa/wb-feedback';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const publishRequestSchema = z.object({
  tenantId: z.string().min(1),
  itemType: z.enum(['review', 'question']),
  itemId: z.string().trim().min(1).max(255),
  replyText: z.string().trim().min(2).max(4_000),
});

export const POST = withRateLimit(withIdempotencyKey(apiRoute(async (request: Request) => {
  const body = await request.json();
  const payload = publishRequestSchema.parse(body);

  await requireTenantMatchesActive(payload.tenantId, ['owner', 'admin']);

  await publishWbReply({
    tenantId: payload.tenantId,
    itemType: payload.itemType,
    itemId: payload.itemId,
    replyText: payload.replyText,
  });

  return NextResponse.json({
    ok: true,
    itemId: payload.itemId,
  });
})), { per: 'tenant', limit: 10, window: 60 });
