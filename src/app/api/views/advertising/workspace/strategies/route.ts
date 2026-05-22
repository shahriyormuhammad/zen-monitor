import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import {
  deleteAdvertisingAutoBidStrategy,
  getAdvertisingAutoBidWorkspace,
  runAdvertisingAutoBidStrategyNow,
  saveAdvertisingAutoBidStrategy,
  type SaveAdvertisingAutoBidStrategyInput,
} from '@/server/advertising/workspace';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const payload = await getAdvertisingAutoBidWorkspace(tenantId);
  return NextResponse.json(payload);
});

export const POST = apiRoute(async (request: Request) => {
  const body = await request.json() as
    | { action?: 'save'; strategy?: SaveAdvertisingAutoBidStrategyInput }
    | { action?: 'delete'; strategyId?: string }
    | { action?: 'run'; strategyId?: string };

  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin', 'manager']);
  const action = body.action;

  if (action === 'save') {
    const strategy = (body as { strategy?: SaveAdvertisingAutoBidStrategyInput }).strategy;
    if (!strategy) {
      return NextResponse.json({ error: 'Не переданы параметры стратегии' }, { status: 400 });
    }

    const saved = await saveAdvertisingAutoBidStrategy(tenantId, user.id, strategy);
    return NextResponse.json({ ok: true, strategy: saved });
  }

  if (action === 'delete') {
    const strategyId = String((body as { strategyId?: string }).strategyId ?? '').trim();
    if (!strategyId) {
      return NextResponse.json({ error: 'Не указан идентификатор стратегии' }, { status: 400 });
    }

    await deleteAdvertisingAutoBidStrategy(tenantId, strategyId);
    return NextResponse.json({ ok: true });
  }

  if (action === 'run') {
    const strategyId = String((body as { strategyId?: string }).strategyId ?? '').trim();
    if (!strategyId) {
      return NextResponse.json({ error: 'Не указан идентификатор стратегии' }, { status: 400 });
    }

    const runResult = await runAdvertisingAutoBidStrategyNow(tenantId, strategyId, user.id);
    return NextResponse.json({ ok: true, run: runResult });
  }

  return NextResponse.json({ error: 'Некорректное действие' }, { status: 400 });
});
