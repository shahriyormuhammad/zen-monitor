import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseRequestBody } from '@/lib/api-parse';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import { writeAuditEntry } from '@/server/advertising/audit';
import { upsertDaypartingRule } from '@/server/advertising/dayparting';
import { getHeatmapDaypartingRecommendation } from '@/server/advertising/dayparting-recommendation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const bodySchema = z.object({
  campaignId: z.number().int().positive(),
  nmId: z.number().int().positive().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  dryRun: z.boolean().optional(),
});

function parseDateRange(from: string | null, to: string | null) {
  const dateFrom = parseApiDateParam(from);
  const dateTo = parseApiDateParam(to);
  return dateFrom && dateTo ? { dateFrom, dateTo } : null;
}

function parsePositiveInt(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const range = parseDateRange(searchParams.get('from'), searchParams.get('to'));
  const campaignId = parsePositiveInt(searchParams.get('campaignId') ?? searchParams.get('advertId'));
  const nmId = parsePositiveInt(searchParams.get('nmId'));

  if (!range) {
    return NextResponse.json({ error: 'Некорректный диапазон дат' }, { status: 400 });
  }

  const { tenantId } = await requireActiveTenant(request);
  const recommendation = await getHeatmapDaypartingRecommendation(tenantId, range.dateFrom, range.dateTo, {
    advertId: campaignId,
    nmId,
  });
  return NextResponse.json({ recommendation });
});

export const POST = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request, ['owner', 'admin', 'manager']);
  const body = await parseRequestBody(request, bodySchema);
  const range = parseDateRange(body.from, body.to);

  if (!range) {
    return NextResponse.json({ error: 'Некорректный диапазон дат' }, { status: 400 });
  }

  const recommendation = await getHeatmapDaypartingRecommendation(tenantId, range.dateFrom, range.dateTo, {
    advertId: body.campaignId,
    nmId: body.nmId,
  });
  if (recommendation.status !== 'ready') {
    return NextResponse.json({ error: 'Недостаточно почасовых данных для heatmap-расписания', recommendation }, { status: 400 });
  }

  if (body.dryRun !== false) {
    return NextResponse.json({ ok: true, dryRun: true, recommendation });
  }

  const rule = await upsertDaypartingRule(
    tenantId,
    body.campaignId,
    recommendation.schedule,
    'heatmap_auto',
    true,
  );

  await writeAuditEntry({
    tenantId,
    campaignId: body.campaignId,
    actionType: 'dayparting_rule',
    objectType: 'campaign',
    valueAfter: {
      schedule: recommendation.schedule,
      activeHours: recommendation.activeHours,
      disabledHours: recommendation.disabledHours,
      disabledSlots: recommendation.disabledSlots,
      thresholds: recommendation.thresholds,
      scope: recommendation.scope,
    },
    reason: `Heatmap-расписание: выключено ${recommendation.disabledHours} из 168 часов.`,
    source: 'heatmap_dayparting',
  });

  return NextResponse.json({
    ok: true,
    dryRun: false,
    rule,
    recommendation,
  });
});
