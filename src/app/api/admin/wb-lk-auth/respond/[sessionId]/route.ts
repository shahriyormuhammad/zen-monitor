import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiRoute } from '@/lib/api-response';
import { parseRequestBody } from '@/lib/api-parse';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { AppError } from '@/lib/errors';
import { closeSession, getAuthSession, pushUserResponse } from '@/lib/wb-rpa/auth-channel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const bodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sms_code'), code: z.string().min(1).max(16) }),
  z.object({ type: z.literal('captcha_answer'), answer: z.string().min(1).max(64) }),
  z.object({ type: z.literal('cancel') }),
]);

export const POST = apiRoute(async (request, context) => {
  const { tenantId } = await requireActiveTenant(request, ['owner', 'admin']);
  const params = await context.params;
  const sessionId = params.sessionId;
  if (!sessionId) {
    throw new AppError('sessionId is required', 400);
  }
  const body = await parseRequestBody(request, bodySchema);

  const session = getAuthSession(sessionId);
  if (!session) {
    throw new AppError('Session not found', 404);
  }
  if (session.tenantId !== tenantId) {
    throw new AppError('Forbidden', 403);
  }

  if (body.type === 'cancel') {
    closeSession(sessionId, false, 'cancelled-by-user');
    return NextResponse.json({ ok: true, cancelled: true });
  }

  const ok = pushUserResponse(sessionId, body);
  if (!ok) {
    throw new AppError('Session is closed', 410);
  }

  return NextResponse.json({ ok: true });
});
