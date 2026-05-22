import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsEngine } from '@/server/analytics/engine';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';

export const GET = apiRoute(async (req: NextRequest) => {
  const { tenantId, user, access } = await requireActiveTenant(req);
  const feed = await AnalyticsEngine.getSignalsFeed(tenantId, user.id, access.role);
  return NextResponse.json(feed);
});
