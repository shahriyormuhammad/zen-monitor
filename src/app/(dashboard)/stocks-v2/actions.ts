'use server';

import { and, desc, eq, sql, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireTenantFeatureAccess } from '@/lib/auth/tenant-access';
import { db, withTenantContext } from '@/lib/db';
import {
  ownStockBatches,
  ownStockMovements,
  productionOrderLines,
  productionOrders,
  products,
} from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import {
  computeLandedCostPerUnit,
  distributeOverheadShare,
} from '@/server/analytics/stocks-v2/forecasting';
import {
  consumeOwnStockFifo,
  normalizeStockLocation,
} from '@/server/analytics/stocks-v2/own-stock-ledger';

export type StockLocation = 'own' | 'china';
export type MovementReason = 'receipt' | 'shipped_to_wb' | 'fbs_sale' | 'write_off' | 'inventory_adjust';

const BATCH_STATUSES = ['ordered', 'in_production', 'shipped', 'customs', 'delivered'] as const;
export type BatchStatus = typeof BATCH_STATUSES[number];
export type CreateBatchInitialStatus = Exclude<BatchStatus, 'delivered'>;

function isFiniteNumberValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export type BatchLineInput = {
  nmId: number;
  quantity: number;
  costPerUnit?: number | null;
  notes?: string | null;
};

export type ManualReceiptLineInput = {
  nmId: number;
  quantity: number;
  costPerUnit?: number | null;
  purchaseCostPerUnit?: number | null;
  fulfillmentDeliveryPerUnit?: number | null;
  notes?: string | null;
};

export type OwnStockCostBackfillInput = {
  nmId: number;
  purchaseCostPerUnit: number;
  fulfillmentDeliveryPerUnit?: number | null;
};

export type OwnStockShipmentLineInput = {
  nmId: number;
  quantity: number;
  notes?: string | null;
};

export type CreateBatchPayload = {
  initialStatus?: CreateBatchInitialStatus | null;
  title?: string | null;
  supplierName?: string | null;
  currency?: string | null;
  shippingCost?: number | null;
  customsCost?: number | null;
  trackingNumber?: string | null;
  estimatedDeliveryAt?: string | null;
  notes?: string | null;
  lines: BatchLineInput[];
};

function normalizePositiveInt(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function normalizeMoney(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  return value.toFixed(2);
}

function normalizeNonNegativeMoneyNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

function normalizePositiveMoneyNumber(value: number | null | undefined): number | null {
  const normalized = normalizeNonNegativeMoneyNumber(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}

function toPositiveMoney(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : null;
  return parsed !== null && Number.isFinite(parsed) && parsed > 0
    ? Math.round(parsed * 100) / 100
    : null;
}

function normalizeCreateBatchInitialStatus(value: unknown): CreateBatchInitialStatus {
  return value === 'ordered' || value === 'in_production' || value === 'shipped' || value === 'customs'
    ? value
    : 'ordered';
}

function buildInitialBatchTimestampFields(status: CreateBatchInitialStatus) {
  const now = new Date();
  if (status === 'customs') {
    return { productionStartedAt: now, shippedAt: now, customsAt: now };
  }
  if (status === 'shipped') {
    return { productionStartedAt: now, shippedAt: now };
  }
  if (status === 'in_production') {
    return { productionStartedAt: now };
  }
  return {};
}

function buildManualReceiptCost(input: ManualReceiptLineInput): {
  costPerUnit: number | null;
  notes: string | null;
} {
  const purchaseCost = normalizePositiveMoneyNumber(input.purchaseCostPerUnit ?? input.costPerUnit ?? null);
  if (purchaseCost === null) {
    const nmId = Number(input.nmId);
    const label = Number.isFinite(nmId) && nmId > 0 ? ` для SKU ${nmId}` : '';
    throw new Error(`Укажите закупку товара${label}`);
  }
  const fulfillmentDelivery = normalizeNonNegativeMoneyNumber(input.fulfillmentDeliveryPerUnit ?? null) ?? 0;
  const costPerUnit = purchaseCost + fulfillmentDelivery;

  const rawNotes = input.notes?.trim() || '';
  const costNote = `Закупка товара: ${purchaseCost} ₽/шт; доставка до фулфилмента: ${fulfillmentDelivery} ₽/шт`;

  return {
    costPerUnit: Math.round(costPerUnit * 100) / 100,
    notes: [rawNotes, costNote].filter(Boolean).join(' · ') || null,
  };
}

function normalizeShipmentLines(lines: OwnStockShipmentLineInput[]): Array<{
  nmId: number;
  quantity: number;
  notes: string | null;
}> {
  const grouped = new Map<number, { nmId: number; quantity: number; notes: string[] }>();

  for (const line of lines) {
    const nmId = Number(line.nmId);
    const quantity = normalizePositiveInt(line.quantity);
    if (!Number.isFinite(nmId) || nmId <= 0 || quantity <= 0) continue;

    const entry = grouped.get(nmId) ?? { nmId, quantity: 0, notes: [] };
    entry.quantity += quantity;
    const note = line.notes?.trim();
    if (note) entry.notes.push(note);
    grouped.set(nmId, entry);
  }

  return Array.from(grouped.values()).map((line) => ({
    nmId: line.nmId,
    quantity: line.quantity,
    notes: line.notes.length > 0 ? Array.from(new Set(line.notes)).join(' · ') : null,
  }));
}

/**
 * Список партий: header + items (с metadata SKU из products для отображения).
 * Возвращает все партии тенанта, отсортированные по orderedAt DESC.
 */
export async function listBatches(tenantId: string) {
  if (!tenantId) throw new Error('Missing tenantId');
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager', 'viewer']);

  return withTenantContext(db, tenantId, async (tx) => {
    const headers = await tx.select()
      .from(productionOrders)
      .where(eq(productionOrders.tenantId, tenantId))
      .orderBy(desc(productionOrders.orderedAt));

    if (headers.length === 0) return [];

    const headerIds = headers.map((h) => h.id);
    const lines = await tx.select()
      .from(productionOrderLines)
      .where(and(
        eq(productionOrderLines.tenantId, tenantId),
        inArray(productionOrderLines.productionOrderId, headerIds),
      ));

    const allNmIds = Array.from(new Set(lines.map((l) => l.nmId).filter(isFiniteNumberValue)));
    const skuMeta = allNmIds.length > 0
      ? await tx.select({
          nmId: products.nmId,
          vendorCode: products.vendorCode,
          brand: products.brand,
          photoUrl: products.photoUrl,
        })
          .from(products)
          .where(and(
            eq(products.tenantId, tenantId),
            inArray(products.nmId, allNmIds),
          ))
      : [];
    const skuByNm = new Map(skuMeta.map((s) => [Number(s.nmId), s]));

    const linesByOrder = new Map<string, typeof lines>();
    for (const line of lines) {
      if (!linesByOrder.has(line.productionOrderId)) {
        linesByOrder.set(line.productionOrderId, []);
      }
      linesByOrder.get(line.productionOrderId)!.push(line);
    }

    return headers.map((header) => {
      const headerLines = linesByOrder.get(header.id) ?? [];
      const totalQty = headerLines.reduce((sum, l) => sum + l.quantity, 0);
      const totalCost = headerLines.reduce((sum, l) => {
        const lineCost = l.totalCost ? Number(l.totalCost) : 0;
        return sum + (Number.isFinite(lineCost) ? lineCost : 0);
      }, 0);
      return {
        ...header,
        lines: headerLines.map((l) => ({
          ...l,
          sku: skuByNm.get(Number(l.nmId)) ?? null,
        })),
        totalQty,
        totalCost,
      };
    });
  });
}

/**
 * Создание партии: header + N lines в одной транзакции.
 *
 * `totalCost` для каждой line вычисляется как qty × costPerUnit (если cost задан).
 * Distribution shippingCost + customsCost на отдельные lines делается в момент
 * приёма (статус → delivered, в receiveDeliveredBatch).
 */
export async function createBatch(tenantId: string, payload: CreateBatchPayload) {
  if (!tenantId) throw new Error('Missing tenantId');
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    throw new Error('Партия должна содержать хотя бы один SKU');
  }
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager']);

  const validLines = payload.lines
    .map((l) => ({
      nmId: Number(l.nmId),
      quantity: normalizePositiveInt(l.quantity),
      costPerUnit: l.costPerUnit != null && Number.isFinite(l.costPerUnit) && l.costPerUnit > 0
        ? Number(l.costPerUnit)
        : null,
      notes: l.notes?.trim() || null,
    }))
    .filter((l) => Number.isFinite(l.nmId) && l.nmId > 0 && l.quantity > 0);
  if (validLines.length === 0) {
    throw new Error('Все строки партии — невалидны');
  }
  const initialStatus = normalizeCreateBatchInitialStatus(payload.initialStatus ?? null);

  const orderId = await withTenantContext(db, tenantId, async (tx) => {
    const [headerRow] = await tx.insert(productionOrders).values({
      tenantId,
      title: payload.title?.trim() || null,
      status: initialStatus,
      supplierName: payload.supplierName?.trim() || null,
      currency: payload.currency?.trim() || 'RUB',
      shippingCost: normalizeMoney(payload.shippingCost ?? 0) ?? '0',
      customsCost: normalizeMoney(payload.customsCost ?? 0) ?? '0',
      trackingNumber: payload.trackingNumber?.trim() || null,
      estimatedDeliveryAt: payload.estimatedDeliveryAt
        ? new Date(payload.estimatedDeliveryAt)
        : null,
      notes: payload.notes?.trim() || null,
      ...buildInitialBatchTimestampFields(initialStatus),
    }).returning({ id: productionOrders.id });
    const headerId = headerRow!.id;

    await tx.insert(productionOrderLines).values(validLines.map((l) => ({
      tenantId,
      productionOrderId: headerId,
      nmId: l.nmId,
      quantity: l.quantity,
      receivedQuantity: 0,
      costPerUnit: l.costPerUnit ? l.costPerUnit.toFixed(2) : null,
      totalCost: l.costPerUnit ? (l.costPerUnit * l.quantity).toFixed(2) : null,
      notes: l.notes,
    })));

    return headerId;
  });

  revalidatePath('/stocks-v2');
  revalidatePath('/stocks-v2/batches');
  revalidatePath('/stocks-v2/by-warehouse');
  revalidatePath('/stocks-v2/all-stock');
  return { success: true, id: orderId };
}

/**
 * Изменение статуса партии. Автоматически выставляет timestamp перехода
 * (orderedAt уже есть, остальные — productionStartedAt / shippedAt / customsAt
 * / deliveredAt).
 *
 * При переходе в `delivered`:
 *   1. Помечаем receivedQuantity на всех line items = quantity (full receipt).
 *   2. Создаём `own_stock_batches` записи (одна на каждый SKU в партии),
 *      cost-per-unit с учётом распределённого shipping/customs.
 *   3. Создаём `own_stock_movements` записи (reason=receipt) для audit trail.
 */
export async function updateBatchStatus(
  tenantId: string,
  batchId: string,
  newStatus: BatchStatus,
) {
  if (!tenantId || !batchId) throw new Error('Missing parameters');
  if (!BATCH_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager']);

  const tsField = {
    ordered: { orderedAt: sql`NOW()` },
    in_production: { productionStartedAt: sql`NOW()` },
    shipped: { shippedAt: sql`NOW()` },
    customs: { customsAt: sql`NOW()` },
    delivered: { deliveredAt: sql`NOW()` },
  }[newStatus];

  await withTenantContext(db, tenantId, async (tx) => {
    await tx.update(productionOrders)
      .set({
        status: newStatus,
        updatedAt: sql`NOW()`,
        ...tsField,
      })
      .where(and(
        eq(productionOrders.id, batchId),
        eq(productionOrders.tenantId, tenantId),
      ));

    if (newStatus === 'delivered') {
      // Pull header for shipping/customs costs and lines for distribution.
      const [header] = await tx.select()
        .from(productionOrders)
        .where(and(
          eq(productionOrders.id, batchId),
          eq(productionOrders.tenantId, tenantId),
        ));
      if (!header) return;

      const lines = await tx.select()
        .from(productionOrderLines)
        .where(and(
          eq(productionOrderLines.tenantId, tenantId),
          eq(productionOrderLines.productionOrderId, batchId),
        ));
      if (lines.length === 0) return;

      const shipping = Number(header.shippingCost ?? 0) || 0;
      const customs = Number(header.customsCost ?? 0) || 0;
      const overheadTotal = shipping + customs;
      const linesGoodsTotal = lines.reduce((sum, l) => {
        const lineTotal = l.totalCost ? Number(l.totalCost) : 0;
        return sum + (Number.isFinite(lineTotal) ? lineTotal : 0);
      }, 0);
      const allLinesQty = lines.reduce((s, l) => s + l.quantity, 0);

      for (const line of lines) {
        // Mark line as fully received.
        await tx.update(productionOrderLines)
          .set({
            receivedQuantity: line.quantity,
            updatedAt: sql`NOW()`,
          })
          .where(eq(productionOrderLines.id, line.id));

        const lineGoodsTotal = line.totalCost ? Number(line.totalCost) : 0;
        const overheadShare = distributeOverheadShare(
          lineGoodsTotal,
          linesGoodsTotal,
          line.quantity,
          allLinesQty,
          overheadTotal,
        );
        const costPerUnit = computeLandedCostPerUnit(lineGoodsTotal, line.quantity, overheadShare);

        const [batch] = await tx.insert(ownStockBatches).values({
          tenantId,
          nmId: line.nmId,
          stockLocation: 'own',
          receivedQuantity: line.quantity,
          remainingQuantity: line.quantity,
          costPerUnit: costPerUnit > 0 ? costPerUnit.toFixed(2) : null,
          sourceType: 'production_order',
          sourceProductionOrderId: batchId,
          notes: line.notes,
        }).returning({ id: ownStockBatches.id });

        await tx.insert(ownStockMovements).values({
          tenantId,
          batchId: batch!.id,
          nmId: line.nmId,
          stockLocation: 'own',
          deltaQuantity: line.quantity,
          reason: 'receipt',
          notes: `Партия #${batchId.slice(0, 8)} принята`,
        });
      }
    }
  });

  logger.info({ tenantId, batchId, newStatus }, '[stocks-v2] batch status updated');
  revalidatePath('/stocks-v2');
  revalidatePath('/stocks-v2/batches');
  revalidatePath('/stocks-v2/by-warehouse');
  revalidatePath('/stocks-v2/all-stock');
  return { success: true };
}

export async function revertDeliveredBatch(tenantId: string, batchId: string) {
  if (!tenantId || !batchId) throw new Error('Missing parameters');
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager']);

  await withTenantContext(db, tenantId, async (tx) => {
    const [header] = await tx.select()
      .from(productionOrders)
      .where(and(
        eq(productionOrders.id, batchId),
        eq(productionOrders.tenantId, tenantId),
      ));
    if (!header) throw new Error('Партия не найдена');
    if (header.status !== 'delivered') {
      throw new Error('Откат доступен только для принятой партии.');
    }

    const batches = await tx.select()
      .from(ownStockBatches)
      .where(and(
        eq(ownStockBatches.tenantId, tenantId),
        eq(ownStockBatches.sourceProductionOrderId, batchId),
      ));
    const consumedBatch = batches.find((batch) => batch.remainingQuantity !== batch.receivedQuantity);
    if (consumedBatch) {
      throw new Error('Нельзя откатить принятие: из партии уже были списания.');
    }

    const batchIds = batches.map((batch) => batch.id);
    if (batchIds.length > 0) {
      const nonReceiptMovements = await tx.select({ id: ownStockMovements.id })
        .from(ownStockMovements)
        .where(and(
          eq(ownStockMovements.tenantId, tenantId),
          inArray(ownStockMovements.batchId, batchIds),
          sql`${ownStockMovements.reason} <> 'receipt'`,
        ))
        .limit(1);
      if (nonReceiptMovements.length > 0) {
        throw new Error('Нельзя откатить принятие: по партии есть расходные движения.');
      }

      await tx.delete(ownStockMovements)
        .where(and(
          eq(ownStockMovements.tenantId, tenantId),
          inArray(ownStockMovements.batchId, batchIds),
        ));
      await tx.delete(ownStockBatches)
        .where(and(
          eq(ownStockBatches.tenantId, tenantId),
          inArray(ownStockBatches.id, batchIds),
        ));
    }

    await tx.update(productionOrderLines)
      .set({ receivedQuantity: 0, updatedAt: sql`NOW()` })
      .where(and(
        eq(productionOrderLines.tenantId, tenantId),
        eq(productionOrderLines.productionOrderId, batchId),
      ));

    const previousStatus: BatchStatus = header.customsAt
      ? 'customs'
      : header.shippedAt
        ? 'shipped'
        : header.productionStartedAt
          ? 'in_production'
          : 'ordered';

    await tx.update(productionOrders)
      .set({
        status: previousStatus,
        deliveredAt: null,
        updatedAt: sql`NOW()`,
      })
      .where(and(
        eq(productionOrders.id, batchId),
        eq(productionOrders.tenantId, tenantId),
      ));
  });

  logger.info({ tenantId, batchId }, '[stocks-v2] delivered batch reverted');
  revalidatePath('/stocks-v2');
  revalidatePath('/stocks-v2/batches');
  revalidatePath('/stocks-v2/own-stock');
  revalidatePath('/stocks-v2/by-warehouse');
  revalidatePath('/stocks-v2/all-stock');
  return { success: true };
}

/**
 * Удаление партии (если ещё не доставлена). Cascading delete на lines.
 * Если партия уже delivered и из неё сделаны own_stock_batches — удаление
 * запрещаем (нужно отдельно обнулять собственный склад).
 */
export async function deleteBatch(tenantId: string, batchId: string) {
  if (!tenantId || !batchId) throw new Error('Missing parameters');
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager']);

  await withTenantContext(db, tenantId, async (tx) => {
    const [header] = await tx.select()
      .from(productionOrders)
      .where(and(
        eq(productionOrders.id, batchId),
        eq(productionOrders.tenantId, tenantId),
      ));
    if (!header) throw new Error('Партия не найдена');
    if (header.status === 'delivered') {
      throw new Error('Доставленную партию нельзя удалить — сначала спишите со своего склада.');
    }
    await tx.delete(productionOrders)
      .where(and(
        eq(productionOrders.id, batchId),
        eq(productionOrders.tenantId, tenantId),
      ));
  });

  revalidatePath('/stocks-v2');
  revalidatePath('/stocks-v2/batches');
  revalidatePath('/stocks-v2/by-warehouse');
  revalidatePath('/stocks-v2/all-stock');
  return { success: true };
}

// ─── OWN STOCK (свой склад) ─────────────────────────────────────────────
//
// Все операции изменения собственного склада идут через ownStockBatches +
// ownStockMovements. Списания (shipToWb / writeOff) применяют FIFO-стратегию:
// сначала разгружаем самые старые партии (received_at ASC), пока не наберём
// нужный qty. Каждое движение пишется в `own_stock_movements` для audit
// trail.

/**
 * Свод по собственному складу: один блок на SKU + раскрытие на партии
 * (только partition с remaining > 0). Возвращается отсортировано по
 * vendorCode для удобной навигации.
 */
export async function listOwnStock(tenantId: string, stockLocation: StockLocation = 'own') {
  if (!tenantId) throw new Error('Missing tenantId');
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager', 'viewer']);
  const location = normalizeStockLocation(stockLocation);

  return withTenantContext(db, tenantId, async (tx) => {
    const batches = await tx.select()
      .from(ownStockBatches)
      .where(and(
        eq(ownStockBatches.tenantId, tenantId),
        eq(ownStockBatches.stockLocation, location),
        sql`${ownStockBatches.remainingQuantity} > 0`,
      ))
      .orderBy(ownStockBatches.nmId, ownStockBatches.receivedAt);

    if (batches.length === 0) return [];

    const allNmIds = Array.from(new Set(batches.map((b) => b.nmId).filter(isFiniteNumberValue)));
    const skuMeta = await tx.select({
      nmId: products.nmId,
      vendorCode: products.vendorCode,
      brand: products.brand,
      photoUrl: products.photoUrl,
    })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.nmId, allNmIds)));
    const skuByNm = new Map(skuMeta.map((s) => [Number(s.nmId), s]));

    const grouped = new Map<number, {
      nmId: number;
      sku: { vendorCode: string | null; brand: string | null; photoUrl: string | null } | null;
      totalRemaining: number;
      totalCost: number;
      batches: typeof batches;
    }>();

    for (const batch of batches) {
      const nm = Number(batch.nmId);
      const remaining = batch.remainingQuantity;
      const costPerUnit = batch.costPerUnit ? Number(batch.costPerUnit) : 0;
      const entry = grouped.get(nm) ?? {
        nmId: nm,
        sku: skuByNm.get(nm) ?? null,
        totalRemaining: 0,
        totalCost: 0,
        batches: [],
      };
      entry.totalRemaining += remaining;
      entry.totalCost += remaining * (Number.isFinite(costPerUnit) ? costPerUnit : 0);
      entry.batches.push(batch);
      grouped.set(nm, entry);
    }

    return Array.from(grouped.values()).sort((a, b) => {
      const av = a.sku?.vendorCode ?? `nm ${a.nmId}`;
      const bv = b.sku?.vendorCode ?? `nm ${b.nmId}`;
      return av.localeCompare(bv, 'ru');
    });
  });
}

/**
 * Журнал движений: последние N записей с JOIN'ом на products.
 */
export async function listOwnStockMovements(
  tenantId: string,
  limit: number = 50,
  stockLocation: StockLocation = 'own',
) {
  if (!tenantId) throw new Error('Missing tenantId');
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager', 'viewer']);
  const location = normalizeStockLocation(stockLocation);

  return withTenantContext(db, tenantId, async (tx) => {
    const movements = await tx.select()
      .from(ownStockMovements)
      .where(and(
        eq(ownStockMovements.tenantId, tenantId),
        eq(ownStockMovements.stockLocation, location),
        sql`${ownStockMovements.reason} <> 'inventory_adjust'`,
      ))
      .orderBy(desc(ownStockMovements.createdAt))
      .limit(Math.max(1, Math.min(500, limit)));

    if (movements.length === 0) return [];

    const allNmIds = Array.from(new Set(movements.map((m) => m.nmId).filter(isFiniteNumberValue)));
    const skuMeta = await tx.select({
      nmId: products.nmId,
      vendorCode: products.vendorCode,
      photoUrl: products.photoUrl,
    })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.nmId, allNmIds)));
    const skuByNm = new Map(skuMeta.map((s) => [Number(s.nmId), s]));

    return movements.map((m) => ({
      ...m,
      sku: skuByNm.get(Number(m.nmId)) ?? null,
    }));
  });
}

/**
 * Ручной приход на свой склад (не из production_order). Например, продавец
 * докупил товар сам или нашёл забытое в коробке.
 */
export async function createManualReceipt(
  tenantId: string,
  payload: ManualReceiptLineInput,
) {
  if (!tenantId) throw new Error('Missing tenantId');
  return createManualReceipts(tenantId, { lines: [payload] });
}

export async function createManualReceipts(
  tenantId: string,
  payload: { lines: ManualReceiptLineInput[]; stockLocation?: StockLocation | null },
) {
  if (!tenantId) throw new Error('Missing tenantId');
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    throw new Error('Добавьте хотя бы один SKU');
  }
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager']);
  const stockLocation = normalizeStockLocation(payload.stockLocation);

  const normalizedLines = payload.lines
    .map((line) => ({
      line,
      nmId: Number(line.nmId),
      quantity: normalizePositiveInt(line.quantity),
    }))
    .filter(({ nmId, quantity }) => Number.isFinite(nmId) && nmId > 0 && quantity > 0);

  if (normalizedLines.length === 0) {
    throw new Error('Укажите SKU и количество > 0');
  }

  const validLines = normalizedLines
    .map(({ line, nmId, quantity }) => {
      const cost = buildManualReceiptCost({ ...line, nmId, quantity });
      return {
        nmId,
        quantity,
        costPerUnit: cost.costPerUnit,
        notes: cost.notes,
      };
    });

  await withTenantContext(db, tenantId, async (tx) => {
    for (const line of validLines) {
      const [batch] = await tx.insert(ownStockBatches).values({
        tenantId,
        nmId: line.nmId,
        stockLocation,
        receivedQuantity: line.quantity,
        remainingQuantity: line.quantity,
        costPerUnit: line.costPerUnit !== null ? line.costPerUnit.toFixed(2) : null,
        sourceType: 'manual',
        sourceProductionOrderId: null,
        notes: line.notes,
      }).returning({ id: ownStockBatches.id });

      await tx.insert(ownStockMovements).values({
        tenantId,
        batchId: batch!.id,
        nmId: line.nmId,
        stockLocation,
        deltaQuantity: line.quantity,
        reason: 'receipt',
        notes: line.notes || 'Ручной приход',
      });
    }
  });

  revalidatePath('/stocks-v2');
  revalidatePath('/stocks-v2/own-stock');
  revalidatePath('/stocks-v2/china-stock');
  revalidatePath('/stocks-v2/by-warehouse');
  revalidatePath('/stocks-v2/all-stock');
  return { success: true, rowsCreated: validLines.length };
}

export async function backfillOwnStockCostsFromEconomics(
  tenantId: string,
  lines: OwnStockCostBackfillInput[],
) {
  if (!tenantId) throw new Error('Missing tenantId');
  if (!Array.isArray(lines) || lines.length === 0) {
    return { success: true, updatedRows: 0 };
  }
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager']);

  const costsByNm = new Map<number, { costPerUnit: number; note: string }>();
  for (const line of lines) {
    const nmId = Number(line.nmId);
    const purchaseCost = normalizePositiveMoneyNumber(line.purchaseCostPerUnit);
    if (!Number.isFinite(nmId) || nmId <= 0 || purchaseCost === null) continue;
    const fulfillmentDelivery = normalizeNonNegativeMoneyNumber(line.fulfillmentDeliveryPerUnit ?? null) ?? 0;
    const costPerUnit = Math.round((purchaseCost + fulfillmentDelivery) * 100) / 100;
    costsByNm.set(nmId, {
      costPerUnit,
      note: `Закупка товара: ${purchaseCost} ₽/шт; доставка до фулфилмента: ${fulfillmentDelivery} ₽/шт`,
    });
  }

  if (costsByNm.size === 0) {
    return { success: true, updatedRows: 0 };
  }

  let updatedRows = 0;
  await withTenantContext(db, tenantId, async (tx) => {
    for (const [nmId, cost] of costsByNm.entries()) {
      const updated = await tx.update(ownStockBatches)
        .set({
          costPerUnit: cost.costPerUnit.toFixed(2),
          notes: sql`
            CASE
              WHEN ${ownStockBatches.notes} ILIKE '%Закупка товара:%' THEN ${ownStockBatches.notes}
              ELSE CONCAT_WS(' · ', NULLIF(${ownStockBatches.notes}, ''), ${cost.note}::text)
            END
          `,
          updatedAt: sql`NOW()`,
        })
        .where(and(
          eq(ownStockBatches.tenantId, tenantId),
          eq(ownStockBatches.nmId, nmId),
          eq(ownStockBatches.sourceType, 'manual'),
          sql`(${ownStockBatches.costPerUnit} IS NULL OR ${ownStockBatches.costPerUnit} <= 0)`,
        ))
        .returning({ id: ownStockBatches.id });
      updatedRows += updated.length;
    }
  });

  if (updatedRows > 0) {
    revalidatePath('/stocks-v2');
    revalidatePath('/stocks-v2/own-stock');
    revalidatePath('/stocks-v2/china-stock');
    revalidatePath('/stocks-v2/by-warehouse');
    revalidatePath('/stocks-v2/all-stock');
  }

  return { success: true, updatedRows };
}

/**
 * FIFO-списание qty единиц SKU со собственного склада.
 *
 * Берёт партии с `remaining > 0` отсортированные по `received_at ASC` и
 * списывает их одну за другой пока не спишет всё `qty`. Возвращает массив
 * затронутых батчей или бросает если qty > totalAvailable.
 */
async function consumeFifo(
  tx: Parameters<Parameters<typeof withTenantContext>[2]>[0],
  tenantId: string,
  nmId: number,
  qty: number,
  reason: MovementReason,
  notes: string | null,
  stockLocation: StockLocation = 'own',
): Promise<{ batchId: string; consumed: number }[]> {
  if (reason === 'receipt' || reason === 'inventory_adjust') {
    throw new Error(`Unsupported FIFO consume reason: ${reason}`);
  }
  return consumeOwnStockFifo(tx, tenantId, nmId, qty, reason, notes, stockLocation);
}

/**
 * Списание со своего склада с указанием reason'а.
 * `shipped_to_wb` — отгрузил на WB, `fbs_sale` — продал по FBS,
 * `write_off` — брак.
 */
export async function consumeOwnStock(
  tenantId: string,
  payload: {
    nmId: number;
    quantity: number;
    reason: 'shipped_to_wb' | 'fbs_sale' | 'write_off';
    stockLocation?: StockLocation | null;
    notes?: string | null;
  },
) {
  if (!tenantId) throw new Error('Missing tenantId');
  const nmId = Number(payload.nmId);
  const quantity = normalizePositiveInt(payload.quantity);
  if (!Number.isFinite(nmId) || nmId <= 0 || quantity <= 0) {
    throw new Error('Укажите SKU и количество > 0');
  }
  if (!['shipped_to_wb', 'fbs_sale', 'write_off'].includes(payload.reason)) {
    throw new Error(`Unknown reason: ${payload.reason}`);
  }
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager']);
  const stockLocation = normalizeStockLocation(payload.stockLocation);

  const consumed = await withTenantContext(db, tenantId, (tx) =>
    consumeFifo(tx, tenantId, nmId, quantity, payload.reason, payload.notes?.trim() || null, stockLocation),
  );

  logger.info({ tenantId, nmId, quantity, reason: payload.reason, consumed }, '[stocks-v2] consume own stock');
  revalidatePath('/stocks-v2');
  revalidatePath('/stocks-v2/own-stock');
  revalidatePath('/stocks-v2/china-stock');
  revalidatePath('/stocks-v2/by-warehouse');
  revalidatePath('/stocks-v2/all-stock');
  return { success: true, batchesAffected: consumed.length };
}

export async function shipOwnStockToWb(
  tenantId: string,
  payload: { lines: OwnStockShipmentLineInput[]; stockLocation?: StockLocation | null },
) {
  if (!tenantId) throw new Error('Missing tenantId');
  if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
    throw new Error('Добавьте хотя бы один SKU для отгрузки');
  }
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager']);

  const validLines = normalizeShipmentLines(payload.lines);
  if (validLines.length === 0) {
    throw new Error('Укажите SKU и количество > 0');
  }
  const stockLocation = normalizeStockLocation(payload.stockLocation);

  const consumed = await withTenantContext(db, tenantId, async (tx) => {
    const result: Array<{ nmId: number; quantity: number; batchesAffected: number }> = [];
    for (const line of validLines) {
      const notePrefix = stockLocation === 'china' ? 'Отгрузка на WB со склада Китай' : 'Отгрузка на WB';
      const note = line.notes ? `${notePrefix} · ${line.notes}` : notePrefix;
      const batches = await consumeFifo(
        tx,
        tenantId,
        line.nmId,
        line.quantity,
        'shipped_to_wb',
        note,
        stockLocation,
      );
      result.push({ nmId: line.nmId, quantity: line.quantity, batchesAffected: batches.length });
    }
    return result;
  });

  logger.info({ tenantId, consumed }, '[stocks-v2] bulk ship own stock to wb');
  revalidatePath('/stocks-v2');
  revalidatePath('/stocks-v2/own-stock');
  revalidatePath('/stocks-v2/china-stock');
  revalidatePath('/stocks-v2/by-warehouse');
  revalidatePath('/stocks-v2/all-stock');
  return { success: true, rowsShipped: consumed.length, consumed };
}

/**
 * Тихая корректировка одной партии: поставить ровно N единиц remaining
 * без отдельной записи в журнале движений.
 */
export async function adjustBatchInventory(
  tenantId: string,
  payload: { batchId: string; newQuantity: number; notes?: string | null },
) {
  if (!tenantId || !payload.batchId) throw new Error('Missing parameters');
  const newQty = normalizePositiveInt(payload.newQuantity);
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager']);

  await withTenantContext(db, tenantId, async (tx) => {
    const [batch] = await tx.select()
      .from(ownStockBatches)
      .where(and(
        eq(ownStockBatches.id, payload.batchId),
        eq(ownStockBatches.tenantId, tenantId),
      ));
    if (!batch) throw new Error('Партия не найдена');

    const delta = newQty - batch.remainingQuantity;
    if (delta === 0) return;
    if (newQty > batch.receivedQuantity) {
      throw new Error(`Нельзя выставить больше чем поступило (${batch.receivedQuantity}).`);
    }

    await tx.update(ownStockBatches)
      .set({ remainingQuantity: newQty, updatedAt: sql`NOW()` })
      .where(eq(ownStockBatches.id, batch.id));
  });

  revalidatePath('/stocks-v2');
  revalidatePath('/stocks-v2/own-stock');
  revalidatePath('/stocks-v2/china-stock');
  revalidatePath('/stocks-v2/by-warehouse');
  revalidatePath('/stocks-v2/all-stock');
  return { success: true };
}

export async function undoOwnStockReceipt(tenantId: string, batchId: string) {
  if (!tenantId || !batchId) throw new Error('Missing parameters');
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager']);

  await withTenantContext(db, tenantId, async (tx) => {
    const [batch] = await tx.select()
      .from(ownStockBatches)
      .where(and(
        eq(ownStockBatches.id, batchId),
        eq(ownStockBatches.tenantId, tenantId),
      ));
    if (!batch) throw new Error('Партия не найдена');
    if (batch.remainingQuantity !== batch.receivedQuantity) {
      throw new Error('Нельзя отменить приход: из этой партии уже были списания.');
    }

    const nonReceiptMovements = await tx.select({ id: ownStockMovements.id })
      .from(ownStockMovements)
      .where(and(
        eq(ownStockMovements.tenantId, tenantId),
        eq(ownStockMovements.batchId, batch.id),
        sql`${ownStockMovements.reason} <> 'receipt'`,
      ))
      .limit(1);
    if (nonReceiptMovements.length > 0) {
      throw new Error('Нельзя отменить приход: по партии есть расходные движения.');
    }

    await tx.delete(ownStockMovements)
      .where(and(
        eq(ownStockMovements.tenantId, tenantId),
        eq(ownStockMovements.batchId, batch.id),
      ));
    await tx.delete(ownStockBatches)
      .where(and(
        eq(ownStockBatches.tenantId, tenantId),
        eq(ownStockBatches.id, batch.id),
      ));

    if (batch.sourceProductionOrderId) {
      const lineIdentity = batch.draftSkuId
        ? eq(productionOrderLines.draftSkuId, batch.draftSkuId)
        : batch.nmId
          ? eq(productionOrderLines.nmId, batch.nmId)
          : sql`FALSE`;

      await tx.update(productionOrderLines)
        .set({
          receivedQuantity: sql`GREATEST(${productionOrderLines.receivedQuantity} - ${batch.receivedQuantity}, 0)`,
          updatedAt: sql`NOW()`,
        })
        .where(and(
          eq(productionOrderLines.tenantId, tenantId),
          eq(productionOrderLines.productionOrderId, batch.sourceProductionOrderId),
          lineIdentity,
        ));
    }
  });

  logger.info({ tenantId, batchId }, '[stocks-v2] own stock receipt undone');
  revalidatePath('/stocks-v2');
  revalidatePath('/stocks-v2/own-stock');
  revalidatePath('/stocks-v2/china-stock');
  revalidatePath('/stocks-v2/batches');
  revalidatePath('/stocks-v2/by-warehouse');
  revalidatePath('/stocks-v2/all-stock');
  return { success: true };
}

// ─── /OWN STOCK ──────────────────────────────────────────────────────────

/**
 * Список SKU тенанта для select-комбобокса при создании партии. Возвращает
 * только активные (не архив, не скрытые).
 */
export async function listSkusForBatchForm(tenantId: string) {
  if (!tenantId) throw new Error('Missing tenantId');
  await requireTenantFeatureAccess(tenantId, 'stocks', ['owner', 'admin', 'manager', 'viewer']);

  return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx.execute(sql`
      WITH sku_costs AS (
        SELECT
          p.nm_id,
          COALESCE(
            CASE
              WHEN COALESCE(manual_cost.value, 0) > 0 THEN manual_cost.value
              ELSE NULL
            END,
            uec.cost_price
          ) AS purchase_cost_per_unit,
          CASE
            WHEN COALESCE(delivery_to_ff.value, 0) > 0 THEN delivery_to_ff.value
            ELSE NULL
          END AS fulfillment_delivery_per_unit
        FROM products p
        LEFT JOIN LATERAL (
          SELECT cost_price
          FROM unit_economics_configs
          WHERE tenant_id = p.tenant_id AND nm_id = p.nm_id
          ORDER BY effective_from DESC NULLS LAST
          LIMIT 1
        ) uec ON TRUE
        LEFT JOIN unit_economics_manual_inputs uemi
          ON uemi.tenant_id = p.tenant_id AND uemi.nm_id = p.nm_id
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN NULLIF(TRIM(uemi.manual_fields ->> 'costPrice'), '') ~ '^-?[0-9]+([,.][0-9]+)?$'
              THEN REPLACE(TRIM(uemi.manual_fields ->> 'costPrice'), ',', '.')::numeric
            ELSE NULL
          END AS value
        ) manual_cost ON TRUE
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN NULLIF(TRIM(uemi.manual_fields ->> 'deliveryToFf'), '') ~ '^-?[0-9]+([,.][0-9]+)?$'
              THEN REPLACE(TRIM(uemi.manual_fields ->> 'deliveryToFf'), ',', '.')::numeric
            ELSE NULL
          END AS value
        ) delivery_to_ff ON TRUE
        WHERE p.tenant_id = ${tenantId}
      )
      SELECT
        p.nm_id AS "nmId",
        p.vendor_code AS "vendorCode",
        p.brand,
        p.photo_url AS "photoUrl",
        sc.purchase_cost_per_unit AS "purchaseCostPerUnit",
        sc.fulfillment_delivery_per_unit AS "fulfillmentDeliveryPerUnit"
      FROM products p
      LEFT JOIN sku_costs sc ON sc.nm_id = p.nm_id
      WHERE p.tenant_id = ${tenantId}
        AND p.is_archived = FALSE
        AND p.is_hidden = FALSE
      ORDER BY p.vendor_code
    `);

    return rows.map((row) => ({
      nmId: Number(row.nmId),
      vendorCode: typeof row.vendorCode === 'string' ? row.vendorCode : null,
      brand: typeof row.brand === 'string' ? row.brand : null,
      photoUrl: typeof row.photoUrl === 'string' ? row.photoUrl : null,
      purchaseCostPerUnit: toPositiveMoney(row.purchaseCostPerUnit),
      fulfillmentDeliveryPerUnit: toPositiveMoney(row.fulfillmentDeliveryPerUnit),
    }));
  });
}
