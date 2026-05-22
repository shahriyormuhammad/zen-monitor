import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { AppError, requireActiveTenant } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import { WbApiError } from '@/lib/wb-api/client';
import { fetchWbReviewsQaDashboardStats, ReviewsQaDashboardScope } from '@/server/reviews-qa/wb-feedback';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function parseScope(rawValue: string | null): ReviewsQaDashboardScope {
  if (rawValue === '24h' || rawValue === '7d' || rawValue === 'filter') {
    return rawValue;
  }
  return '24h';
}

function buildFallbackPeriodHours(scope: ReviewsQaDashboardScope, filterFrom: Date | null, filterTo: Date | null): number {
  if (scope === '7d') {
    return 7 * 24;
  }

  if (scope === 'filter' && filterFrom instanceof Date && filterTo instanceof Date) {
    const from = Date.UTC(filterFrom.getUTCFullYear(), filterFrom.getUTCMonth(), filterFrom.getUTCDate());
    const to = Date.UTC(filterTo.getUTCFullYear(), filterTo.getUTCMonth(), filterTo.getUTCDate());
    if (to >= from) {
      return Math.max(1, Math.round(((to + DAY_MS) - from) / HOUR_MS));
    }
  }

  return 24;
}

function isRecoverableWbError(error: unknown): boolean {
  if (error instanceof WbApiError) {
    return true;
  }

  if (error instanceof AppError && error.status === 400) {
    const message = error.message.toLowerCase();
    return message.includes('wb api token') || message.includes('токен');
  }

  return false;
}

function getRecoverableErrorMessage(error: unknown): string {
  if (error instanceof WbApiError) {
    if (error.status === 401 || error.status === 403) {
      return 'WB API отклонил токен кабинета. Проверьте токен в настройках.';
    }
    return `WB API временно недоступен (${error.status ?? 'network'}).`;
  }

  if (error instanceof AppError) {
    return error.message;
  }

  return 'Источник WB временно недоступен.';
}

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const scope = parseScope(searchParams.get('scope'));
  const filterFrom = parseApiDateParam(searchParams.get('from'));
  const filterTo = parseApiDateParam(searchParams.get('to'));

  try {
    const { tenantId } = await requireActiveTenant(request);
    const dashboard = await fetchWbReviewsQaDashboardStats(tenantId, {
      scope,
      filterFrom,
      filterTo,
    });

    return NextResponse.json(dashboard);
  } catch (error: unknown) {
    if (isRecoverableWbError(error)) {
      return NextResponse.json({
        daily: {
          periodHours: buildFallbackPeriodHours(scope, filterFrom, filterTo),
          processedReviews: 0,
          sentToWb: 0,
          approved: 0,
          rejected: 0,
          ratingDistribution: {
            five: 0,
            four: 0,
            three: 0,
            two: 0,
            one: 0,
          },
          exact: false,
        },
        generatedAt: new Date().toISOString(),
        externalError: getRecoverableErrorMessage(error),
        externalStatus: error instanceof WbApiError ? error.status ?? null : null,
      });
    }

    // Non-recoverable: rethrow so the apiRoute wrapper scrubs and logs it
    throw error;
  }
});
