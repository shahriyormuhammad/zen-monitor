import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseRequestBody } from '@/lib/api-parse';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import { AppError } from '@/lib/errors';
import { withIdempotencyKey } from '@/lib/idempotency';
import { executeAdvertisingDecisionAction } from '@/server/advertising/decision-actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const bodySchema = z.object({
  decisionType: z.enum(['stop_now', 'lower_bid', 'raise_bid']),
  from: z.string().min(1),
  to: z.string().min(1),
  nmId: z.number().int().positive().optional(),
  dryRun: z.boolean().optional(),
  maxClusters: z.number().int().min(1).max(40).optional(),
  manualStepPct: z.number().min(1).max(80).optional(),
});

const ACTION_TIMEOUT_MS = 25_000;

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

export const POST = withIdempotencyKey(apiRoute(async (request: Request) => {
  const body = await parseRequestBody(request, bodySchema);
  const dateFrom = parseApiDateParam(body.from);
  const dateTo = parseApiDateParam(body.to);

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: 'Некорректный диапазон дат' }, { status: 400 });
  }

  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin', 'manager']);
  const dryRun = body.dryRun !== false;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new DOMException('Advertising action timed out', 'TimeoutError'));
  }, ACTION_TIMEOUT_MS);

  let result: Awaited<ReturnType<typeof executeAdvertisingDecisionAction>>;
  try {
    result = await executeAdvertisingDecisionAction({
      tenantId,
      actorId: `dashboard:${user.id}`,
      decisionType: body.decisionType,
      dateFrom,
      dateTo,
      nmId: body.nmId,
      dryRun,
      maxClusters: body.maxClusters,
      manualStepPct: body.manualStepPct,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new AppError('WB-реклама не ответила за 25 секунд. Действие не применено, попробуйте позже.', 504);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  return NextResponse.json({
    ok: true,
    decisionType: body.decisionType,
    dryRun,
    result,
  });
}));
