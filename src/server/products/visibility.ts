import { and, eq, inArray } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { products } from '@/lib/db/schema';

export function normalizeProductVisibilityNmIds(nmIds: unknown): number[] {
  const values = Array.isArray(nmIds) ? nmIds : [];
  return Array.from(
    new Set(
      values
        .map((nmId) => Number(nmId))
        .filter((nmId) => Number.isInteger(nmId) && nmId > 0),
    ),
  );
}

export async function setProductsVisibility(
  tenantId: string,
  nmIds: number[],
  isHidden: boolean,
) {
  const uniqueNmIds = normalizeProductVisibilityNmIds(nmIds);

  if (uniqueNmIds.length === 0) {
    return { success: true, count: 0 };
  }

  await withTenantContext(db, tenantId, async (tx) => {
    if (isHidden) {
      await tx.insert(products).values(
        uniqueNmIds.map((nmId) => ({
          tenantId,
          nmId,
          vendorCode: String(nmId),
          isHidden: true,
        })),
      ).onConflictDoUpdate({
        target: [products.tenantId, products.nmId],
        set: { isHidden: true },
      });
      return;
    }

    await tx.update(products)
      .set({ isHidden: false })
      .where(
        and(
          eq(products.tenantId, tenantId),
          inArray(products.nmId, uniqueNmIds),
        ),
      );
  });

  return { success: true, count: uniqueNmIds.length };
}
