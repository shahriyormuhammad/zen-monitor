import { NextRequest, NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { AnalyticsEngine } from '@/server/analytics/engine';
import { requireActiveTenant } from '@/lib/auth/tenant-access';

export const GET = apiRoute(async (req: NextRequest) => {
  const { tenantId, user } = await requireActiveTenant(req);
  const response = await AnalyticsEngine.getSignalNotifications(tenantId, user.id);
  return NextResponse.json(response);
});
