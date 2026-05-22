import { NextRequest, NextResponse } from 'next/server';
import { AnalyticsEngine } from '@/server/analytics/engine';
import { getErrorMessage, getErrorStatus, requireActiveTenant } from '@/lib/auth/tenant-access';
import { logger } from '@/lib/logger';
import { resolveSignalReviewSource } from '@/lib/operator-signal-timeline';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ signalId: string }> }
) {
  try {
    const { tenantId, user, access } = await requireActiveTenant(req);
    const { signalId } = await params;
    const openedFrom = resolveSignalReviewSource(req.nextUrl.searchParams.get('openedFrom')) ?? 'overview';

    const details = await AnalyticsEngine.getSignalDetails(tenantId, signalId, {
      viewer: {
        userId: user.id,
        actorEmail: user.email ?? user.id,
        actorRole: access.role,
        openedFrom,
      },
    });
    if (!details) {
      return NextResponse.json({ error: 'Сигнал не найден' }, { status: 404 });
    }

    return NextResponse.json(details);
  } catch (error: unknown) {
    logger.error({ err: error }, 'Signal details fetch error');
    return NextResponse.json({ error: getErrorMessage(error) }, { status: getErrorStatus(error) });
  }
}
