import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import {
  deleteAdvertisingPortfolio,
  getAdvertisingPortfolioWorkspace,
  runAdvertisingPortfolioNow,
  saveAdvertisingPortfolio,
  type SaveAdvertisingPortfolioInput,
} from '@/server/advertising/pacing-portfolios';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const payload = await getAdvertisingPortfolioWorkspace(tenantId);
  return NextResponse.json(payload);
});

export const POST = apiRoute(async (request: Request) => {
  const body = await request.json() as
    | { action?: 'save'; portfolio?: SaveAdvertisingPortfolioInput }
    | { action?: 'delete'; portfolioId?: string }
    | { action?: 'run'; portfolioId?: string };

  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin', 'manager']);
  const action = body.action;

  if (action === 'save') {
    const portfolio = (body as { portfolio?: SaveAdvertisingPortfolioInput }).portfolio;
    if (!portfolio) {
      return NextResponse.json({ error: 'Не переданы параметры портфеля' }, { status: 400 });
    }

    const saved = await saveAdvertisingPortfolio(tenantId, user.id, portfolio);
    return NextResponse.json({ ok: true, portfolio: saved });
  }

  if (action === 'delete') {
    const portfolioId = String((body as { portfolioId?: string }).portfolioId ?? '').trim();
    if (!portfolioId) {
      return NextResponse.json({ error: 'Не указан идентификатор портфеля' }, { status: 400 });
    }

    await deleteAdvertisingPortfolio(tenantId, portfolioId);
    return NextResponse.json({ ok: true });
  }

  if (action === 'run') {
    const portfolioId = String((body as { portfolioId?: string }).portfolioId ?? '').trim();
    if (!portfolioId) {
      return NextResponse.json({ error: 'Не указан идентификатор портфеля' }, { status: 400 });
    }

    const runResult = await runAdvertisingPortfolioNow(tenantId, portfolioId, user.id);
    return NextResponse.json({ ok: true, run: runResult });
  }

  return NextResponse.json({ error: 'Некорректное действие' }, { status: 400 });
});
