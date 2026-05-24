'use server';

import { requireTenantFeatureAccess } from '@/lib/auth/tenant-access';
import { listSalesPlanArticles } from '@/server/sales-plan/articles';
import {
  computeDistributionAction,
  type DistributionResult,
  type SupplyStrategy,
} from '@/server/supply/distribution';

export async function listSupplyArticlesAction(tenantId: string) {
  await requireTenantFeatureAccess(tenantId, 'supply');
  return listSalesPlanArticles(tenantId);
}

export async function computeArticleDistributionAction(
  tenantId: string,
  nmId: number,
  totalQty: number,
  strategy: SupplyStrategy,
): Promise<DistributionResult> {
  await requireTenantFeatureAccess(tenantId, 'supply');
  return computeDistributionAction(tenantId, nmId, totalQty, strategy);
}
