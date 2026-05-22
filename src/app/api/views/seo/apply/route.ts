import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseRequestBody } from '@/lib/api-parse';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { AppError } from '@/lib/errors';
import { withIdempotencyKey } from '@/lib/idempotency';
import { withRateLimit } from '@/lib/rate-limit';
import { applySeoCardPatch } from '@/server/seo/card-apply';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const bodySchema = z.object({
  nmId: z.number().int().positive(),
  title: z.string().max(120),
  description: z.string().max(5_500),
});

const APPLY_TIMEOUT_MS = 25_000;

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export const POST = withRateLimit(withIdempotencyKey(apiRoute(async (request: Request) => {
  const body = await parseRequestBody(request, bodySchema);
  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin', 'manager']);
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException('SEO card update timed out', 'TimeoutError'));
  }, APPLY_TIMEOUT_MS);

  try {
    const result = await applySeoCardPatch({
      tenantId,
      actorId: `dashboard:${user.id}`,
      nmId: body.nmId,
      title: body.title,
      description: body.description,
      signal: controller.signal,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (isAbortError(error)) {
      throw new AppError('WB Content API не ответил за 25 секунд. Правка не применена, попробуйте позже.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
})), { per: 'tenant', limit: 10, window: 60 });
