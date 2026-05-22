import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { parseRequestBody } from '@/lib/api-parse';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const modeSchema = z.enum(['advisor', 'semi_auto', 'auto']);

const patchSchema = z.object({
  mode: modeSchema,
});

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const [tenant] = await db
    .select({
      mode: tenants.advertisingAutopilotMode,
      autopilotEnabled: tenants.advertisingAutopilotEnabled,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  return NextResponse.json({
    mode: modeSchema.catch('advisor').parse(tenant?.mode),
    autopilotEnabled: tenant?.autopilotEnabled ?? true,
  });
});

export const PATCH = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request, ['owner', 'admin', 'manager']);
  const body = await parseRequestBody(request, patchSchema);

  const [tenant] = await db
    .update(tenants)
    .set({
      advertisingAutopilotMode: body.mode,
    })
    .where(eq(tenants.id, tenantId))
    .returning({
      mode: tenants.advertisingAutopilotMode,
      autopilotEnabled: tenants.advertisingAutopilotEnabled,
    });

  return NextResponse.json({
    ok: true,
    mode: tenant?.mode ?? body.mode,
    autopilotEnabled: tenant?.autopilotEnabled ?? body.mode !== 'advisor',
  });
});
