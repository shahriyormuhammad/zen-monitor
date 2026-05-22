import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiRoute } from '@/lib/api-response';
import {
  requireActiveTenant,
  requireTenantMatchesActive,
} from '@/lib/auth/tenant-access';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const updateAutoReplySchema = z.object({
  tenantId: z.string().min(1),
  enabled: z.boolean(),
});

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);

  const [tenant] = await db
    .select({
      enabled: tenants.reviewsAutoReplyEnabled,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  return NextResponse.json({
    enabled: Boolean(tenant?.enabled),
  });
});

export const POST = apiRoute(async (request: Request) => {
  const body = await request.json();
  const payload = updateAutoReplySchema.parse(body);

  await requireTenantMatchesActive(payload.tenantId, ['owner', 'admin']);

  const [updated] = await db
    .update(tenants)
    .set({
      reviewsAutoReplyEnabled: payload.enabled,
    })
    .where(eq(tenants.id, payload.tenantId))
    .returning({
      enabled: tenants.reviewsAutoReplyEnabled,
    });

  return NextResponse.json({
    ok: true,
    enabled: Boolean(updated?.enabled),
  });
});
