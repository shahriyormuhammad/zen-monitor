import { NextRequest, NextResponse } from 'next/server';
import { db, withTenantContext } from '@/lib/db';
import { rawApiOrders, rawApiRealizationReports, rawApiAdCosts, rawApiFunnelStats, rawApiPrices } from '@/lib/db/schema';
import { and, eq, desc, sql } from 'drizzle-orm';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';

const EXPLORER_TYPES = ['orders', 'realizations', 'ads', 'funnel', 'prices'] as const;
type ExplorerType = (typeof EXPLORER_TYPES)[number];

function isExplorerType(value: string): value is ExplorerType {
  return (EXPLORER_TYPES as readonly string[]).includes(value);
}

export const GET = apiRoute(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'orders';
  const rawNmId = searchParams.get('nmId');
  const nmId = rawNmId ? Number(rawNmId) : null;
  const hasNmFilter = Number.isFinite(nmId) && nmId !== null && nmId > 0;

  if (!isExplorerType(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  const { tenantId } = await requireActiveTenant(req);

  const data = await withTenantContext(db, tenantId, async (tx) => {
    switch (type) {
      case 'orders':
        return tx
          .select()
          .from(rawApiOrders)
          .where(hasNmFilter ? and(eq(rawApiOrders.tenantId, tenantId), eq(rawApiOrders.nmId, nmId)) : eq(rawApiOrders.tenantId, tenantId))
          .orderBy(desc(rawApiOrders.date))
          .limit(100);
      case 'realizations':
        return tx
          .select()
          .from(rawApiRealizationReports)
          .where(hasNmFilter ? and(eq(rawApiRealizationReports.tenantId, tenantId), eq(rawApiRealizationReports.nmId, nmId)) : eq(rawApiRealizationReports.tenantId, tenantId))
          .orderBy(desc(sql`COALESCE(${rawApiRealizationReports.saleDt}, ${rawApiRealizationReports.dateFrom})`))
          .limit(100);
      case 'ads':
        return tx
          .select()
          .from(rawApiAdCosts)
          .where(hasNmFilter ? and(eq(rawApiAdCosts.tenantId, tenantId), eq(rawApiAdCosts.nmId, nmId)) : eq(rawApiAdCosts.tenantId, tenantId))
          .orderBy(desc(rawApiAdCosts.date))
          .limit(100);
      case 'funnel':
        return tx
          .select()
          .from(rawApiFunnelStats)
          .where(hasNmFilter ? and(eq(rawApiFunnelStats.tenantId, tenantId), eq(rawApiFunnelStats.nmId, nmId)) : eq(rawApiFunnelStats.tenantId, tenantId))
          .orderBy(desc(rawApiFunnelStats.date))
          .limit(100);
      case 'prices':
        return tx
          .select()
          .from(rawApiPrices)
          .where(hasNmFilter ? and(eq(rawApiPrices.tenantId, tenantId), eq(rawApiPrices.nmId, nmId)) : eq(rawApiPrices.tenantId, tenantId))
          .orderBy(desc(rawApiPrices.updatedAt))
          .limit(100);
    }
  });

  return NextResponse.json(data);
});
