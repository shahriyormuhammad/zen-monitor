import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsEngine } from '@/server/analytics/engine';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import { parseRequestQuery } from '@/lib/api-parse';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const querySchema = z.object({
  from: z.string().min(1, 'from is required'),
  to: z.string().min(1, 'to is required'),
  groupId: z.string().optional(),
});

export const GET = apiRoute(async (req: NextRequest) => {
  const { from, to, groupId } = parseRequestQuery(req, querySchema);

  const parsedFrom = parseApiDateParam(from);
  const parsedTo = parseApiDateParam(to);
  if (!parsedFrom || !parsedTo) {
    throw new AppError('Invalid date parameters', 400);
  }

  if (!groupId) {
    return NextResponse.json({ days: [], group: {}, skus: {} });
  }

  const { tenantId } = await requireActiveTenant(req);
  const data = await AnalyticsEngine.getGroupDynamics(
    tenantId,
    groupId,
    parsedFrom,
    parsedTo,
    { calculationMode: 'FACT_WB', includeOperationalTail: true },
  );
  return NextResponse.json(data);
});
