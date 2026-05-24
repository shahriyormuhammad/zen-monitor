'use server';

import { revalidatePath } from 'next/cache';

import { requireTenantFeatureAccess } from '@/lib/auth/tenant-access';
import { invalidateDashboardCache } from '@/lib/analytics/dashboard-cache';
import {
  archiveSalesPlan,
  createSimpleSalesPlan,
  getSalesPlanWorkspace,
  type CreateSimpleSalesPlanInput,
} from '@/server/sales-plan/service';
import { listSalesPlanArticles } from '@/server/sales-plan/articles';

export async function listSalesPlanArticlesAction(tenantId: string) {
  await requireTenantFeatureAccess(tenantId, 'salesPlan');
  return listSalesPlanArticles(tenantId);
}

export async function loadSalesPlanWorkspaceAction(tenantId: string) {
  await requireTenantFeatureAccess(tenantId, 'salesPlan');
  return getSalesPlanWorkspace(tenantId);
}

export async function createSalesPlanAction(tenantId: string, input: CreateSimpleSalesPlanInput) {
  await requireTenantFeatureAccess(tenantId, 'salesPlan', ['owner', 'admin', 'manager']);
  const result = await createSimpleSalesPlan(tenantId, input);

  invalidateDashboardCache(tenantId);
  revalidatePath('/sales-plan');
  revalidatePath('/overview');
  revalidatePath('/dynamics');
  revalidatePath('/stocks-v2');

  return result;
}

export async function archiveSalesPlanAction(tenantId: string, planId: string) {
  await requireTenantFeatureAccess(tenantId, 'salesPlan', ['owner', 'admin', 'manager']);
  const result = await archiveSalesPlan(tenantId, planId);

  invalidateDashboardCache(tenantId);
  revalidatePath('/sales-plan');
  revalidatePath('/overview');
  revalidatePath('/dynamics');
  revalidatePath('/stocks-v2');

  return result;
}
