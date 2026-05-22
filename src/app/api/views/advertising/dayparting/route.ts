import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import {
  deleteDaypartingRule,
  getDaypartingRules,
  getTemplateSchedule,
  upsertDaypartingRule,
  type DaypartingTemplate,
} from '@/server/advertising/dayparting';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function isTemplateName(value: unknown): value is Exclude<DaypartingTemplate, 'custom'> {
  return value === 'workday' || value === 'evening_weekend' || value === 'always_on';
}

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const rules = await getDaypartingRules(tenantId);
  return NextResponse.json({ rules });
});

export const POST = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const body = await request.json() as Record<string, unknown>;

  const campaignId = Number(body.campaignId);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return NextResponse.json({ error: 'Некорректный campaignId' }, { status: 400 });
  }

  const template = body.template;
  const templateName = isTemplateName(template) ? template : undefined;
  let schedule: boolean[];

  if (templateName) {
    schedule = getTemplateSchedule(templateName);
  } else if (Array.isArray(body.schedule)) {
    schedule = body.schedule as boolean[];
    if (schedule.length !== 168) {
      return NextResponse.json(
        { error: 'schedule должен содержать ровно 168 значений' },
        { status: 400 },
      );
    }
  } else {
    return NextResponse.json(
      { error: 'Укажите template или schedule[168]' },
      { status: 400 },
    );
  }

  const enabled = body.enabled !== false;
  const rule = await upsertDaypartingRule(
    tenantId,
    campaignId,
    schedule,
    templateName,
    enabled,
  );

  return NextResponse.json({ rule });
});

export const DELETE = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const { searchParams } = new URL(request.url);
  const campaignId = Number(searchParams.get('campaignId'));

  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return NextResponse.json({ error: 'Некорректный campaignId' }, { status: 400 });
  }

  await deleteDaypartingRule(tenantId, campaignId);
  return NextResponse.json({ ok: true });
});
