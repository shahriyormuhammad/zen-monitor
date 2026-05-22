import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

import { apiRoute } from '@/lib/api-response';
import { invalidateDashboardCache } from '@/lib/analytics/dashboard-cache';
import { AppError, requireActiveTenant } from '@/lib/auth/tenant-access';
import { logger } from '@/lib/logger';
import {
  normalizeProductVisibilityNmIds,
  setProductsVisibility,
} from '@/server/products/visibility';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const POST = apiRoute(async (request: Request) => {
  const { tenantId, user } = await requireActiveTenant(request, ['owner', 'admin']);
  const body = await request.json().catch(() => null);

  if (!body || typeof body !== 'object') {
    throw new AppError('Некорректный запрос на изменение видимости SKU', 400);
  }

  const payload = body as { nmIds?: unknown; isHidden?: unknown };
  const nmIds = normalizeProductVisibilityNmIds(payload.nmIds);
  const isHidden = payload.isHidden === true;

  if (nmIds.length === 0) {
    return NextResponse.json({ success: true, count: 0 });
  }

  try {
    const result = await setProductsVisibility(tenantId, nmIds, isHidden);

    revalidatePath('/costs');
    revalidatePath('/economics');
    revalidatePath('/economics-v2');
    revalidatePath('/overview');
    invalidateDashboardCache(tenantId);

    return NextResponse.json(result);
  } catch (err) {
    logger.error(
      {
        err,
        tenantId,
        userId: user.id,
        isHidden,
        nmIdCount: nmIds.length,
        sampleNmIds: nmIds.slice(0, 10),
      },
      '[costs.visibility] failed to update product visibility',
    );
    throw err;
  }
});
