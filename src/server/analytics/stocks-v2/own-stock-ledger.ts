import { and, eq, sql } from 'drizzle-orm';

import type { DrizzleTransaction } from '@/lib/db';
import { ownStockBatches, ownStockMovements } from '@/lib/db/schema';

export type StockLocation = 'own' | 'china';
export type MovementReason = 'receipt' | 'shipped_to_wb' | 'fbs_sale' | 'write_off' | 'inventory_adjust';

export function normalizeStockLocation(value: unknown): StockLocation {
  return value === 'china' ? 'china' : 'own';
}

export function getStockLocationLabel(stockLocation: StockLocation): string {
  return stockLocation === 'china' ? 'складе Китай' : 'своём складе';
}

/**
 * FIFO-списание qty единиц SKU со склада продавца.
 *
 * Берёт партии с `remaining > 0` по `received_at ASC`, уменьшает остатки и
 * пишет движения. Используется ручным UI и автоматикой WB-поставок.
 */
export async function consumeOwnStockFifo(
  tx: DrizzleTransaction,
  tenantId: string,
  nmId: number,
  qty: number,
  reason: Exclude<MovementReason, 'receipt' | 'inventory_adjust'>,
  notes: string | null,
  stockLocation: StockLocation = 'own',
): Promise<{ batchId: string; consumed: number }[]> {
  if (qty <= 0) throw new Error('Quantity must be > 0');
  const location = normalizeStockLocation(stockLocation);

  const batches = await tx.select()
    .from(ownStockBatches)
    .where(and(
      eq(ownStockBatches.tenantId, tenantId),
      eq(ownStockBatches.nmId, nmId),
      eq(ownStockBatches.stockLocation, location),
      sql`${ownStockBatches.remainingQuantity} > 0`,
    ))
    .orderBy(ownStockBatches.receivedAt);

  const totalAvailable = batches.reduce((sum, batch) => sum + batch.remainingQuantity, 0);
  if (totalAvailable < qty) {
    throw new Error(
      `На ${getStockLocationLabel(location)} только ${totalAvailable} шт SKU ${nmId} — невозможно списать ${qty}.`,
    );
  }

  const consumed: { batchId: string; consumed: number }[] = [];
  let remaining = qty;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.remainingQuantity);
    const newRemaining = batch.remainingQuantity - take;

    await tx.update(ownStockBatches)
      .set({ remainingQuantity: newRemaining, updatedAt: sql`NOW()` })
      .where(eq(ownStockBatches.id, batch.id));

    await tx.insert(ownStockMovements).values({
      tenantId,
      batchId: batch.id,
      nmId,
      stockLocation: location,
      deltaQuantity: -take,
      reason,
      notes,
    });

    consumed.push({ batchId: batch.id, consumed: take });
    remaining -= take;
  }

  return consumed;
}
