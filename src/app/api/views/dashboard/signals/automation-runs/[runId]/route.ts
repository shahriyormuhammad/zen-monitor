import { NextRequest, NextResponse } from 'next/server';

import { getErrorMessage, getErrorStatus, requireActiveTenant } from '@/lib/auth/tenant-access';
import { AnalyticsEngine } from '@/server/analytics/engine';
import { logger } from '@/lib/logger';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { tenantId } = await requireActiveTenant(req);
    const { runId } = await params;

    const details = await AnalyticsEngine.getSignalAutomationRunDetails(tenantId, runId);
    if (!details) {
      return NextResponse.json({ error: 'Automation run не найден' }, { status: 404 });
    }

    return NextResponse.json(details);
  } catch (error: unknown) {
    logger.error({ err: error }, 'Signal automation run fetch error');
    return NextResponse.json({ error: getErrorMessage(error) }, { status: getErrorStatus(error) });
  }
}
