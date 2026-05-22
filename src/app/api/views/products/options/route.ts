import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import { listObservedProductOptions } from '@/server/catalog/observed-products';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const rows = await listObservedProductOptions(tenantId);
  return NextResponse.json({
    data: rows.filter((row) => row.vendorCode.trim().length > 0),
  });
});
