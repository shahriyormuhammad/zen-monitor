import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import {
  depositManual,
  getAdvertisingBalance,
  getAutoRefillSettings,
  upsertAutoRefillSettings,
} from '@/server/advertising/balance';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);

  const [balance, autoRefill] = await Promise.all([
    getAdvertisingBalance(tenantId),
    getAutoRefillSettings(tenantId),
  ]);

  return NextResponse.json({ balance, autoRefill });
});

export const POST = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const body = await request.json() as Record<string, unknown>;
  const action = body.action as string | undefined;

  if (action === 'deposit') {
    const campaignId = Number(body.campaignId);
    const amountRub = Number(body.amountRub);

    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      return NextResponse.json({ error: 'Некорректный campaignId' }, { status: 400 });
    }
    if (!Number.isFinite(amountRub) || amountRub <= 0) {
      return NextResponse.json({ error: 'Некорректная сумма' }, { status: 400 });
    }

    await depositManual(tenantId, campaignId, amountRub);
    return NextResponse.json({ ok: true });
  }

  if (action === 'configure-auto-refill') {
    const settings = {
      enabled: Boolean(body.enabled),
      campaignId: body.campaignId != null ? Number(body.campaignId) : null,
      thresholdRub: body.thresholdRub != null ? Number(body.thresholdRub) : undefined,
      topUpAmountRub: body.topUpAmountRub != null ? Number(body.topUpAmountRub) : undefined,
      dailyCapRub: body.dailyCapRub != null ? Number(body.dailyCapRub) : undefined,
    };

    const updated = await upsertAutoRefillSettings(tenantId, settings);
    return NextResponse.json({ ok: true, settings: updated });
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
});
