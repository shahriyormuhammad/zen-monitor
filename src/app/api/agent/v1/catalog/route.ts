import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiRoute } from '@/lib/api-response';
import { requireAgentApiClient } from '@/lib/agent-api';
import { parseRequestQuery } from '@/lib/api-parse';
import { withRateLimit } from '@/lib/rate-limit';
import { buildAgentCatalog } from '@/server/agent/catalog';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  tenantId: z.string().uuid().optional(),
  tenant_id: z.string().uuid().optional(),
});

export const GET = withRateLimit(apiRoute(async (request: Request) => {
  const client = requireAgentApiClient(request);
  const query = parseRequestQuery(request, querySchema);
  const tenantId = query.tenantId ?? query.tenant_id ?? null;
  const catalog = await buildAgentCatalog(client, tenantId);

  return NextResponse.json({
    ok: true,
    clientId: client.id,
    workerId: client.workerId,
    ...catalog,
  });
}), { per: 'ip', limit: 180, window: 60 });
