import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiRoute } from '@/lib/api-response';
import { parseRequestBody } from '@/lib/api-parse';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { logger } from '@/lib/logger';
import { createAuthSession } from '@/lib/wb-rpa/auth-channel';
import { runInteractiveWbLkLogin } from '@/lib/wb-rpa/wb-lk-interactive-login';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const bodySchema = z.object({
  phone: z.string().min(10, 'phone must be at least 10 chars').max(32),
});

export const POST = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request, ['owner', 'admin']);
  const { phone } = await parseRequestBody(request, bodySchema);

  const sessionId = createAuthSession(tenantId);

  // Запускаем background — не ждём, юзер подпишется на SSE.
  runInteractiveWbLkLogin({ sessionId, tenantId, phone })
    .catch((error) => {
      logger.error({ err: error, sessionId, tenantId }, '[wb-lk-auth] background login flow crashed');
    });

  return NextResponse.json({ sessionId });
});
