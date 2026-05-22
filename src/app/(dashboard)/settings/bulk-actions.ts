'use server';

import { db, withTenantContext } from '@/lib/db';
import { unitEconomicsConfigs } from '@/lib/db/schema';
import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { requireTenantFeatureAccess } from '@/lib/auth/tenant-access';
import { logger } from '@/lib/logger';

export async function bulkUpsertCosts(
  tenantId: string,
  items: { nmId: number, costPrice: number, effectiveFrom?: string }[]
) {
  if (!tenantId || items.length === 0) return { success: false, error: 'No data provided' };

  try {
    await requireTenantFeatureAccess(tenantId, 'costs', ['owner', 'admin', 'manager']);

    await withTenantContext(db, tenantId, async (tx) => {
      for (const item of items) {
        const effectiveDate = new Date();
        effectiveDate.setUTCHours(0, 0, 0, 0);

        await tx.insert(unitEconomicsConfigs).values({
          tenantId,
          nmId: item.nmId,
          costPrice: item.costPrice.toString(),
          effectiveFrom: effectiveDate,
        }).onConflictDoUpdate({
          target: [unitEconomicsConfigs.tenantId, unitEconomicsConfigs.nmId, unitEconomicsConfigs.effectiveFrom],
          set: { costPrice: sql`EXCLUDED.cost_price` },
        });
      }
    });

    revalidatePath('/settings');
    revalidatePath('/costs');
    revalidatePath('/economics');
    revalidatePath('/economics-v2');
    revalidatePath('/overview');
    revalidatePath('/');
    return { success: true, count: items.length };
  } catch (error) {
    logger.error({ err: error, tenantId, itemCount: items.length }, 'Bulk upsert failed');
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update database',
    };
  }
}
