import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import {
  deleteAdvertisingPacingRule,
  getAdvertisingPacingWorkspace,
  runAdvertisingPacingRuleNow,
  saveAdvertisingPacingRule,
  type SaveAdvertisingPacingRuleInput,
} from '@/server/advertising/pacing-portfolios';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const payload = await getAdvertisingPacingWorkspace(tenantId);
  return NextResponse.json(payload);
});

export const POST = apiRoute(async (request: Request) => {
  const body = await request.json() as
    | { action?: 'save'; rule?: SaveAdvertisingPacingRuleInput }
    | { action?: 'delete'; ruleId?: string }
    | { action?: 'run'; ruleId?: string };

  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin', 'manager']);
  const action = body.action;

  if (action === 'save') {
    const rule = (body as { rule?: SaveAdvertisingPacingRuleInput }).rule;
    if (!rule) {
      return NextResponse.json({ error: 'Не переданы параметры правила пейсинга' }, { status: 400 });
    }

    const saved = await saveAdvertisingPacingRule(tenantId, user.id, rule);
    return NextResponse.json({ ok: true, rule: saved });
  }

  if (action === 'delete') {
    const ruleId = String((body as { ruleId?: string }).ruleId ?? '').trim();
    if (!ruleId) {
      return NextResponse.json({ error: 'Не указан идентификатор правила' }, { status: 400 });
    }

    await deleteAdvertisingPacingRule(tenantId, ruleId);
    return NextResponse.json({ ok: true });
  }

  if (action === 'run') {
    const ruleId = String((body as { ruleId?: string }).ruleId ?? '').trim();
    if (!ruleId) {
      return NextResponse.json({ error: 'Не указан идентификатор правила' }, { status: 400 });
    }

    const runResult = await runAdvertisingPacingRuleNow(tenantId, ruleId, user.id);
    return NextResponse.json({ ok: true, run: runResult });
  }

  return NextResponse.json({ error: 'Некорректное действие' }, { status: 400 });
});
