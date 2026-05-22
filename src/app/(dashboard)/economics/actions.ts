'use server'

import { and, eq, sql } from "drizzle-orm";
import { db, withTenantContext } from "@/lib/db";
import { products, unitEconomicsConfigs, unitEconomicsManualInputs } from "@/lib/db/schema";
import { revalidatePath } from "next/cache";
import { requireTenantFeatureAccess } from "@/lib/auth/tenant-access";
import { invalidateDashboardCache } from "@/lib/analytics/dashboard-cache";
import { logger } from "@/lib/logger";

export async function updateCostPrice(
  tenantId: string,
  nmId: number,
  costPrice: number,
) {
  if (!tenantId || !nmId) throw new Error("Missing parameters");
  await requireTenantFeatureAccess(tenantId, 'economics', ['owner', 'admin', 'manager']);

  const effectiveDate = new Date();
  effectiveDate.setUTCHours(0, 0, 0, 0);

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.insert(unitEconomicsConfigs).values({
      tenantId,
      nmId,
      costPrice: costPrice.toString(),
      effectiveFrom: effectiveDate,
    }).onConflictDoUpdate({
      target: [unitEconomicsConfigs.tenantId, unitEconomicsConfigs.nmId, unitEconomicsConfigs.effectiveFrom],
      set: { costPrice: costPrice.toString() },
    });
  });

  revalidatePath('/costs');
  revalidatePath('/economics');
  revalidatePath('/economics-v2');
  revalidatePath('/overview');
  return { success: true };
}

export async function recalculateCostPriceEverywhere(tenantId: string) {
  if (!tenantId) throw new Error('Missing tenantId');
  await requireTenantFeatureAccess(tenantId, 'economics', ['owner', 'admin', 'manager']);

  revalidatePath('/overview');
  revalidatePath('/costs');
  revalidatePath('/economics');
  revalidatePath('/economics-v2');
  revalidatePath('/dynamics');
  revalidatePath('/explorer');
  return { success: true };
}

export async function saveUnitEconomicsManualFields(
  tenantId: string,
  nmId: number,
  manualFields: unknown,
) {
  if (!tenantId || !nmId) {
    logger.warn({ tenantId, nmId }, '[saveUnitEconomicsManualFields] missing params');
    throw new Error('Missing parameters');
  }

  try {
    await requireTenantFeatureAccess(tenantId, 'economics');
  } catch (err) {
    logger.error({ tenantId, nmId, err }, '[saveUnitEconomicsManualFields] requireTenantAccess FAILED');
    throw err;
  }

  const payload = (manualFields && typeof manualFields === 'object' && !Array.isArray(manualFields))
    ? (manualFields as Record<string, unknown>)
    : {};

  try {
    await withTenantContext(db, tenantId, async (tx) => {
      await tx.insert(unitEconomicsManualInputs).values({
        tenantId,
        nmId,
        manualFields: payload,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [unitEconomicsManualInputs.tenantId, unitEconomicsManualInputs.nmId],
        set: {
          manualFields: payload,
          updatedAt: new Date(),
        },
      });
    });
  } catch (err) {
    logger.error({ tenantId, nmId, err }, '[saveUnitEconomicsManualFields] DB write failed');
    throw err;
  }

  return { success: true };
}

export async function saveUnitEconomicsManualFieldsBulk(
  tenantId: string,
  inputs: Array<{ nmId: number; manualFields: unknown }>,
) {
  if (!tenantId) throw new Error('Missing tenantId');

  try {
    await requireTenantFeatureAccess(tenantId, 'economics');
  } catch (err) {
    logger.error({ tenantId, err }, '[saveUnitEconomicsManualFieldsBulk] requireTenantAccess FAILED');
    throw err;
  }

  const rows = Array.from(
    new Map(
      inputs
        .map((input) => {
          const nmId = Number(input?.nmId);
          const manualFields = input?.manualFields;
          const payload = manualFields && typeof manualFields === 'object' && !Array.isArray(manualFields)
            ? manualFields as Record<string, unknown>
            : {};
          return Number.isInteger(nmId) && nmId > 0
            ? [nmId, { nmId, manualFields: payload }] as const
            : null;
        })
        .filter((item): item is readonly [number, { nmId: number; manualFields: Record<string, unknown> }] => item !== null),
    ).values(),
  );

  if (rows.length === 0) {
    return { success: true, count: 0 };
  }

  const updatedAt = new Date();

  try {
    await withTenantContext(db, tenantId, async (tx) => {
      await tx.insert(unitEconomicsManualInputs).values(
        rows.map((row) => ({
          tenantId,
          nmId: row.nmId,
          manualFields: row.manualFields,
          updatedAt,
        })),
      ).onConflictDoUpdate({
        target: [unitEconomicsManualInputs.tenantId, unitEconomicsManualInputs.nmId],
        set: {
          manualFields: sql`excluded.manual_fields`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    });
  } catch (err) {
    logger.error({ tenantId, count: rows.length, err }, '[saveUnitEconomicsManualFieldsBulk] DB write failed');
    throw err;
  }

  revalidatePath('/costs');
  revalidatePath('/economics');
  revalidatePath('/economics-v2');
  revalidatePath('/overview');
  invalidateDashboardCache(tenantId);

  return { success: true, count: rows.length };
}

export async function getHiddenProducts(tenantId: string) {
  if (!tenantId) return [];
  await requireTenantFeatureAccess(tenantId, 'economics', ['owner', 'admin', 'manager', 'viewer']);

  const rows = await withTenantContext(db, tenantId, async (tx) =>
    tx.select({
      nmId: products.nmId,
      vendorCode: products.vendorCode,
      brand: products.brand,
      photoUrl: products.photoUrl,
    })
      .from(products)
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.isHidden, true),
        ),
      ),
  );

  return rows.map((r) => ({
    nmId: Number(r.nmId),
    vendorCode: r.vendorCode ?? null,
    brand: r.brand ?? null,
    photoUrl: r.photoUrl ?? null,
  }));
}

export async function restoreHiddenProduct(tenantId: string, nmId: number) {
  if (!tenantId || !nmId) throw new Error("Missing parameters");
  await requireTenantFeatureAccess(tenantId, 'economics', ['owner', 'admin', 'manager']);

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.update(products)
      .set({ isHidden: false })
      .where(
        and(
          eq(products.tenantId, tenantId),
          eq(products.nmId, nmId),
        ),
      );
  });

  revalidatePath('/economics');
  revalidatePath('/economics-v2');
  revalidatePath('/overview');
  invalidateDashboardCache(tenantId);
  return { success: true };
}
