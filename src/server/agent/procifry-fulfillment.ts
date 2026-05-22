import { and, eq, inArray, sql } from 'drizzle-orm';

import type {
  AgentApiClient,
  ProcifryConfidence,
  ProcifryWorkerId,
} from '@/lib/agent-api';
import { invalidateDashboardCache } from '@/lib/analytics/dashboard-cache';
import { db, type DrizzleTransaction, withTenantContext } from '@/lib/db';
import {
  ownStockBatches,
  ownStockMovements,
  procifryAgentAuditLog,
  procifryDraftSkus,
  productionOrderLines,
  productionOrders,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { createProcifryRecord } from '@/server/agent/procifry';

export const PROCIFRY_FULFILLMENT_ACTION_TYPES = [
  'fulfillment_stock_update',
] as const;

export type ProcifryFulfillmentActionType = (typeof PROCIFRY_FULFILLMENT_ACTION_TYPES)[number];

export type FulfillmentSkuReference = {
  nmId: number | null;
  draftSkuId: string | null;
  isNewProduct: boolean;
  externalSkuKey: string | null;
  supplierArticle: string | null;
  sourceArticle: string | null;
  title: string | null;
  comment: string | null;
  variant: string | null;
  color: string | null;
  imageUrl: string | null;
  attachmentUrl: string | null;
};

export type FulfillmentOwnStockItem = FulfillmentSkuReference & {
  title: string | null;
  quantity: number;
  receivedAt: Date | null;
  notes: string | null;
};

export type FulfillmentProductionOrderLine = FulfillmentSkuReference & {
  title: string | null;
  quantity: number;
  receivedQuantity: number;
  costPerUnit: number | null;
  notes: string | null;
};

export type FulfillmentProductionOrder = {
  title: string;
  status: 'ordered' | 'in_production' | 'shipped' | 'customs' | 'delivered';
  orderedAt: Date | null;
  productionStartedAt: Date | null;
  shippedAt: Date | null;
  customsAt: Date | null;
  deliveredAt: Date | null;
  estimatedDeliveryAt: Date | null;
  trackingNumber: string | null;
  supplierName: string | null;
  currency: string;
  shippingCost: number;
  customsCost: number;
  notes: string | null;
  lines: FulfillmentProductionOrderLine[];
};

export type FulfillmentStockUpdatePayload = {
  sourceKey: string;
  sourceKeyExplicit: boolean;
  replaceExisting: boolean;
  ownStockItems: FulfillmentOwnStockItem[];
  productionOrders: FulfillmentProductionOrder[];
};

export type ProcifryFulfillmentActionRequest = {
  workerId: ProcifryWorkerId;
  tenantId: string;
  tenantIds: string[];
  cabinetOid: string;
  multiTenant: boolean;
  periodFrom: Date;
  periodTo: Date;
  source: string;
  sourceUpdatedAt: Date;
  confidence: ProcifryConfidence;
  actionType: ProcifryFulfillmentActionType;
  payload: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toOptionalPositiveInt(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  return toPositiveInt(value, field);
}

function toPositiveInt(value: unknown, field: string): number {
  const parsed = toNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${field} must be a positive integer`, 400);
  }
  return parsed;
}

function toNonNegativeInt(value: unknown, field: string): number {
  const parsed = toNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0) {
    throw new AppError(`${field} must be a non-negative integer`, 400);
  }
  return parsed;
}

function toMoney(value: unknown, fallback = 0): number {
  const parsed = toNumber(value);
  if (parsed === null || parsed < 0) return fallback;
  return Math.round(parsed * 100) / 100;
}

function toDate(value: unknown): Date | null {
  const text = toText(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`Invalid date: ${text}`, 400);
  }
  return date;
}

function toUuid(value: unknown, field: string): string | null {
  const text = toText(value);
  if (!text) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new AppError(`${field} must be a UUID`, 400);
  }
  return text;
}

function parseSkuReference(raw: Record<string, unknown>, fieldPrefix: string): FulfillmentSkuReference {
  const nmId = toOptionalPositiveInt(raw.nmId ?? raw.nm_id, `${fieldPrefix}.nmId`);
  const draftSkuId = toUuid(raw.draftSkuId ?? raw.draft_sku_id, `${fieldPrefix}.draftSkuId`);
  const externalSkuKey = toText(raw.externalSkuKey ?? raw.external_sku_key);
  const supplierArticle = toText(raw.supplierArticle ?? raw.supplier_article);
  const sourceArticle = toText(raw.sourceArticle ?? raw.source_article ?? raw.article);
  const title = toText(raw.title ?? raw.name ?? raw.vendorCode ?? raw.vendor_code);
  const isNewProduct = toBoolean(raw.isNewProduct ?? raw.is_new_product);

  if (nmId === null) {
    if (!isNewProduct) {
      throw new AppError(`${fieldPrefix}.nmId is required unless isNewProduct=true`, 400);
    }
    if (!draftSkuId && !externalSkuKey && !((supplierArticle || sourceArticle) && title)) {
      throw new AppError(`${fieldPrefix} without nmId requires draftSkuId, externalSkuKey, or supplierArticle/sourceArticle + title`, 400);
    }
  }

  return {
    nmId,
    draftSkuId,
    isNewProduct: nmId === null || isNewProduct,
    externalSkuKey,
    supplierArticle,
    sourceArticle,
    title,
    comment: toText(raw.comment ?? raw.notes),
    variant: toText(raw.variant),
    color: toText(raw.color),
    imageUrl: toText(raw.imageUrl ?? raw.image_url),
    attachmentUrl: toText(raw.attachmentUrl ?? raw.attachment_url ?? raw.attachment),
  };
}

export function fulfillmentSkuKey(ref: FulfillmentSkuReference) {
  if (ref.nmId !== null) return `nm:${ref.nmId}`;
  if (ref.draftSkuId) return `draft:${ref.draftSkuId}`;
  if (ref.externalSkuKey) return `external:${ref.externalSkuKey}`;
  return `source:${ref.supplierArticle ?? ref.sourceArticle ?? 'unknown'}:${ref.title ?? 'untitled'}`;
}

function parseOwnStockItem(raw: unknown, index: number): FulfillmentOwnStockItem {
  if (!isRecord(raw)) {
    throw new AppError(`ownStockItems[${index}] must be an object`, 400);
  }
  const sku = parseSkuReference(raw, `ownStockItems[${index}]`);
  return {
    ...sku,
    title: sku.title,
    quantity: toPositiveInt(raw.quantity ?? raw.qty, `ownStockItems[${index}].quantity`),
    receivedAt: toDate(raw.receivedAt ?? raw.received_at ?? raw.snapshotAt ?? raw.snapshot_at),
    notes: toText(raw.notes),
  };
}

function parseProductionOrderLine(raw: unknown, orderIndex: number, lineIndex: number): FulfillmentProductionOrderLine {
  if (!isRecord(raw)) {
    throw new AppError(`productionOrders[${orderIndex}].lines[${lineIndex}] must be an object`, 400);
  }
  const quantity = toPositiveInt(raw.quantity ?? raw.qty, `productionOrders[${orderIndex}].lines[${lineIndex}].quantity`);
  const receivedQuantity = toNonNegativeInt(raw.receivedQuantity ?? raw.received_quantity ?? 0, `productionOrders[${orderIndex}].lines[${lineIndex}].receivedQuantity`);
  if (receivedQuantity > quantity) {
    throw new AppError(`productionOrders[${orderIndex}].lines[${lineIndex}].receivedQuantity cannot exceed quantity`, 400);
  }
  const costPerUnit = toNumber(raw.costPerUnit ?? raw.cost_per_unit);
  const sku = parseSkuReference(raw, `productionOrders[${orderIndex}].lines[${lineIndex}]`);
  return {
    ...sku,
    title: sku.title,
    quantity,
    receivedQuantity,
    costPerUnit: costPerUnit !== null && costPerUnit > 0 ? Math.round(costPerUnit * 100) / 100 : null,
    notes: toText(raw.notes),
  };
}

const ORDER_STATUSES = ['ordered', 'in_production', 'shipped', 'customs', 'delivered'] as const;

function parseProductionOrder(raw: unknown, index: number): FulfillmentProductionOrder {
  if (!isRecord(raw)) {
    throw new AppError(`productionOrders[${index}] must be an object`, 400);
  }
  const status = toText(raw.status) ?? 'ordered';
  if (!ORDER_STATUSES.includes(status as FulfillmentProductionOrder['status'])) {
    throw new AppError(`productionOrders[${index}].status is invalid`, 400);
  }
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  if (rawLines.length === 0) {
    throw new AppError(`productionOrders[${index}].lines must contain at least one item`, 400);
  }
  const lines = rawLines.map((line, lineIndex) => parseProductionOrderLine(line, index, lineIndex));
  const firstLineCurrency = isRecord(rawLines[0]) ? toText(rawLines[0].currency) : null;
  return {
    title: toText(raw.title) ?? `Production order ${index + 1}`,
    status: status as FulfillmentProductionOrder['status'],
    orderedAt: toDate(raw.orderedAt ?? raw.ordered_at),
    productionStartedAt: toDate(raw.productionStartedAt ?? raw.production_started_at),
    shippedAt: toDate(raw.shippedAt ?? raw.shipped_at),
    customsAt: toDate(raw.customsAt ?? raw.customs_at),
    deliveredAt: toDate(raw.deliveredAt ?? raw.delivered_at),
    estimatedDeliveryAt: toDate(raw.estimatedDeliveryAt ?? raw.estimated_delivery_at ?? raw.eta),
    trackingNumber: toText(raw.trackingNumber ?? raw.tracking_number),
    supplierName: toText(raw.supplierName ?? raw.supplier_name),
    currency: toText(raw.currency) ?? firstLineCurrency ?? 'RUB',
    shippingCost: toMoney(raw.shippingCost ?? raw.shipping_cost),
    customsCost: toMoney(raw.customsCost ?? raw.customs_cost),
    notes: toText(raw.notes),
    lines,
  };
}

export function parseFulfillmentStockUpdatePayload(payload: unknown): FulfillmentStockUpdatePayload {
  if (!isRecord(payload)) {
    throw new AppError('fulfillment_stock_update payload must be an object', 400);
  }
  const ownStockItems = Array.isArray(payload.ownStockItems)
    ? payload.ownStockItems.map(parseOwnStockItem)
    : [];
  const productionOrders = Array.isArray(payload.productionOrders)
    ? payload.productionOrders.map(parseProductionOrder)
    : [];
  if (ownStockItems.length === 0 && productionOrders.length === 0) {
    throw new AppError('fulfillment_stock_update payload has no ownStockItems or productionOrders', 400);
  }
  if (ownStockItems.length === 0 && payload.replaceExisting === true) {
    throw new AppError('fulfillment_stock_update cannot use replaceExisting=true when ownStockItems is empty', 400);
  }
  const explicitSourceKey = toText(payload.sourceKey ?? payload.source_key);
  const sourceKey = explicitSourceKey ?? 'procifry-agent-fulfillment-stock-update';
  return {
    sourceKey,
    sourceKeyExplicit: explicitSourceKey !== null,
    replaceExisting: ownStockItems.length > 0 && payload.replaceExisting !== false,
    ownStockItems,
    productionOrders,
  };
}

function sourceMarker(sourceKey: string) {
  return `sourceKey=${sourceKey}`;
}

async function clearExistingImport(tx: DrizzleTransaction, tenantId: string, sourceKey: string) {
  const marker = `%${sourceMarker(sourceKey)}%`;
  const existingBatches = await tx
    .select({ id: ownStockBatches.id })
    .from(ownStockBatches)
    .where(and(
      sql`${ownStockBatches.tenantId} = ${tenantId}`,
      sql`${ownStockBatches.notes} LIKE ${marker}`,
    ));

  const batchIds = existingBatches.map((item) => item.id);
  if (batchIds.length > 0) {
    await tx
      .delete(ownStockMovements)
      .where(and(
        sql`${ownStockMovements.tenantId} = ${tenantId}`,
        inArray(ownStockMovements.batchId, batchIds),
      ));
    await tx
      .delete(ownStockBatches)
      .where(and(
        sql`${ownStockBatches.tenantId} = ${tenantId}`,
        inArray(ownStockBatches.id, batchIds),
      ));
  }

  await tx
    .delete(productionOrders)
    .where(and(
      sql`${productionOrders.tenantId} = ${tenantId}`,
      sql`${productionOrders.notes} LIKE ${marker}`,
    ));
}

async function clearExistingProductionImport(tx: DrizzleTransaction, tenantId: string, sourceKey: string) {
  const marker = `%${sourceMarker(sourceKey)}%`;
  await tx
    .delete(productionOrders)
    .where(and(
      sql`${productionOrders.tenantId} = ${tenantId}`,
      sql`${productionOrders.notes} LIKE ${marker}`,
    ));
}

function appendSourceNote(notes: string | null, sourceKey: string, extra?: string | null) {
  return [
    notes,
    extra,
    sourceMarker(sourceKey),
    'createdBy=procifry-agent',
  ].filter(Boolean).join(' | ');
}

function titleForDraftSku(ref: FulfillmentSkuReference) {
  return ref.title
    ?? ref.externalSkuKey
    ?? ref.supplierArticle
    ?? ref.sourceArticle
    ?? 'Новый товар без WB nmId';
}

type ResolvedSkuReference = {
  nmId: number | null;
  draftSkuId: string | null;
  isNewProduct: boolean;
  linkedNmId: number | null;
};

async function resolveDraftSku(
  tx: DrizzleTransaction,
  tenantId: string,
  cabinetOid: string | null,
  sourceKey: string,
  ref: FulfillmentSkuReference,
): Promise<ResolvedSkuReference> {
  if (ref.nmId !== null) {
    return { nmId: ref.nmId, draftSkuId: null, isNewProduct: false, linkedNmId: null };
  }

  const now = new Date();
  let existing: typeof procifryDraftSkus.$inferSelect | undefined;

  if (ref.draftSkuId) {
    [existing] = await tx
      .select()
      .from(procifryDraftSkus)
      .where(and(
        eq(procifryDraftSkus.tenantId, tenantId),
        eq(procifryDraftSkus.id, ref.draftSkuId),
      ))
      .limit(1);
  }

  if (!existing && ref.externalSkuKey) {
    [existing] = await tx
      .select()
      .from(procifryDraftSkus)
      .where(and(
        eq(procifryDraftSkus.tenantId, tenantId),
        eq(procifryDraftSkus.sourceKey, sourceKey),
        eq(procifryDraftSkus.externalSkuKey, ref.externalSkuKey),
      ))
      .limit(1);
  }

  if (!existing && (ref.supplierArticle || ref.sourceArticle) && ref.title) {
    [existing] = await tx
      .select()
      .from(procifryDraftSkus)
      .where(and(
        eq(procifryDraftSkus.tenantId, tenantId),
        eq(procifryDraftSkus.sourceKey, sourceKey),
        ref.supplierArticle
          ? eq(procifryDraftSkus.supplierArticle, ref.supplierArticle)
          : eq(procifryDraftSkus.sourceArticle, ref.sourceArticle!),
        eq(procifryDraftSkus.title, ref.title),
      ))
      .limit(1);
  }

  const updatePatch = {
    cabinetOid,
    source: 'procifry-agent',
    sourceKey,
    externalSkuKey: ref.externalSkuKey,
    supplierArticle: ref.supplierArticle,
    sourceArticle: ref.sourceArticle,
    title: titleForDraftSku(ref),
    comment: ref.comment,
    variant: ref.variant,
    color: ref.color,
    imageUrl: ref.imageUrl,
    attachmentUrl: ref.attachmentUrl,
    payload: {
      externalSkuKey: ref.externalSkuKey,
      supplierArticle: ref.supplierArticle,
      sourceArticle: ref.sourceArticle,
      title: ref.title,
      comment: ref.comment,
      variant: ref.variant,
      color: ref.color,
    },
    updatedAt: now,
  };

  if (existing) {
    const [updated] = await tx
      .update(procifryDraftSkus)
      .set({
        cabinetOid: updatePatch.cabinetOid ?? existing.cabinetOid,
        source: updatePatch.source,
        sourceKey: updatePatch.sourceKey,
        externalSkuKey: updatePatch.externalSkuKey ?? existing.externalSkuKey,
        supplierArticle: updatePatch.supplierArticle ?? existing.supplierArticle,
        sourceArticle: updatePatch.sourceArticle ?? existing.sourceArticle,
        title: ref.title ?? existing.title,
        comment: updatePatch.comment ?? existing.comment,
        variant: updatePatch.variant ?? existing.variant,
        color: updatePatch.color ?? existing.color,
        imageUrl: updatePatch.imageUrl ?? existing.imageUrl,
        attachmentUrl: updatePatch.attachmentUrl ?? existing.attachmentUrl,
        payload: updatePatch.payload,
        updatedAt: now,
      })
      .where(and(
        eq(procifryDraftSkus.tenantId, tenantId),
        eq(procifryDraftSkus.id, existing.id),
      ))
      .returning({
        id: procifryDraftSkus.id,
        status: procifryDraftSkus.status,
        linkedNmId: procifryDraftSkus.linkedNmId,
      });
    return {
      nmId: updated?.linkedNmId ?? null,
      draftSkuId: updated?.id ?? existing.id,
      isNewProduct: true,
      linkedNmId: updated?.linkedNmId ?? null,
    };
  }

  const [created] = await tx
    .insert(procifryDraftSkus)
    .values({
      ...(ref.draftSkuId ? { id: ref.draftSkuId } : {}),
      tenantId,
      ...updatePatch,
      status: 'draft',
      linkedNmId: null,
    })
    .returning({
      id: procifryDraftSkus.id,
      linkedNmId: procifryDraftSkus.linkedNmId,
    });

  if (!created) {
    throw new AppError('Failed to create draft SKU', 500);
  }

  return {
    nmId: created.linkedNmId ?? null,
    draftSkuId: created.id,
    isNewProduct: true,
    linkedNmId: created.linkedNmId ?? null,
  };
}

export async function createFulfillmentStockApprovalRequest(
  client: AgentApiClient,
  request: ProcifryFulfillmentActionRequest,
) {
  const parsed = parseFulfillmentStockUpdatePayload(request.payload);
  const itemCount = parsed.ownStockItems.length
    + parsed.productionOrders.reduce((sum, order) => sum + order.lines.length, 0);

  const result = await createProcifryRecord(client, {
    workerId: request.workerId,
    tenantId: request.tenantId,
    tenantIds: request.tenantIds,
    cabinetOid: request.cabinetOid,
    multiTenant: request.multiTenant,
    periodFrom: request.periodFrom,
    periodTo: request.periodTo,
    source: request.source,
    sourceUpdatedAt: request.sourceUpdatedAt,
    confidence: request.confidence,
    accessMode: 'approval_required',
    resourceType: 'approval_request',
    actionType: request.actionType,
    title: `Обновить ФФ и Китай для ${itemCount} SKU-строк`,
    body: 'Update own fulfillment stock and production/in-transit batches.',
    payload: {
      tenantId: request.tenantId,
      cabinetOid: request.cabinetOid,
      actionType: request.actionType,
      sourceKey: parsed.sourceKey,
      sourceKeyExplicit: parsed.sourceKeyExplicit,
      replaceExisting: parsed.replaceExisting,
      ownStockItems: parsed.ownStockItems.map((item) => ({
        ...item,
        receivedAt: item.receivedAt?.toISOString() ?? null,
      })),
      productionOrders: parsed.productionOrders.map((order) => ({
        ...order,
        orderedAt: order.orderedAt?.toISOString() ?? null,
        productionStartedAt: order.productionStartedAt?.toISOString() ?? null,
        shippedAt: order.shippedAt?.toISOString() ?? null,
        customsAt: order.customsAt?.toISOString() ?? null,
        deliveredAt: order.deliveredAt?.toISOString() ?? null,
        estimatedDeliveryAt: order.estimatedDeliveryAt?.toISOString() ?? null,
      })),
    },
    tags: ['stocks-v2', 'fulfillment', 'production-orders', 'approval-required'],
    approvalId: null,
  });

  return {
    ok: true,
    actionType: request.actionType,
    approvalRequired: true,
    approvalRequestId: result.approvalRequestId,
    status: result.approvalStatus ?? 'requested',
    itemCount,
    ownStockItemCount: parsed.ownStockItems.length,
    productionOrderCount: parsed.productionOrders.length,
  };
}

export async function executeFulfillmentStockUpdate(
  tx: DrizzleTransaction,
  tenantId: string,
  payload: unknown,
) {
  const parsed = parseFulfillmentStockUpdatePayload(payload);
  const cabinetOid = isRecord(payload) ? toText(payload.cabinetOid ?? payload.cabinet_oid) : null;
  if (parsed.replaceExisting) {
    await clearExistingImport(tx, tenantId, parsed.sourceKey);
  } else if (parsed.sourceKeyExplicit && parsed.productionOrders.length > 0) {
    await clearExistingProductionImport(tx, tenantId, parsed.sourceKey);
  }

  const now = new Date();
  const ownStockApplied = [];
  for (const item of parsed.ownStockItems) {
    const sku = await resolveDraftSku(tx, tenantId, cabinetOid, parsed.sourceKey, item);
    const [batch] = await tx
      .insert(ownStockBatches)
      .values({
        tenantId,
        nmId: sku.nmId,
        draftSkuId: sku.draftSkuId,
        receivedQuantity: item.quantity,
        remainingQuantity: item.quantity,
        costPerUnit: null,
        sourceType: 'manual',
        receivedAt: item.receivedAt ?? now,
        notes: appendSourceNote(item.notes, parsed.sourceKey, item.title),
      })
      .returning({ id: ownStockBatches.id });

    await tx.insert(ownStockMovements).values({
      tenantId,
      batchId: batch!.id,
      nmId: sku.nmId,
      draftSkuId: sku.draftSkuId,
      deltaQuantity: item.quantity,
      reason: 'receipt',
      notes: appendSourceNote('Ручной остаток ФФ', parsed.sourceKey, item.title),
    });

    ownStockApplied.push({
      nmId: sku.nmId,
      draftSkuId: sku.draftSkuId,
      isNewProduct: sku.isNewProduct,
      linkedNmId: sku.linkedNmId,
      quantity: item.quantity,
      batchId: batch!.id,
    });
  }

  const productionOrdersApplied = [];
  for (const order of parsed.productionOrders) {
    const [header] = await tx
      .insert(productionOrders)
      .values({
        tenantId,
        title: order.title,
        status: order.status,
        orderedAt: order.orderedAt ?? now,
        productionStartedAt: order.productionStartedAt,
        shippedAt: order.shippedAt,
        customsAt: order.customsAt,
        deliveredAt: order.deliveredAt,
        estimatedDeliveryAt: order.estimatedDeliveryAt,
        trackingNumber: order.trackingNumber,
        supplierName: order.supplierName,
        currency: order.currency,
        shippingCost: order.shippingCost.toFixed(2),
        customsCost: order.customsCost.toFixed(2),
        notes: appendSourceNote(order.notes, parsed.sourceKey),
      })
      .returning({ id: productionOrders.id });

    const resolvedLines = [];
    for (const line of order.lines) {
      const sku = await resolveDraftSku(tx, tenantId, cabinetOid, parsed.sourceKey, line);
      resolvedLines.push({ line, sku });
    }

    await tx.insert(productionOrderLines).values(resolvedLines.map(({ line, sku }) => ({
      tenantId,
      productionOrderId: header!.id,
      nmId: sku.nmId,
      draftSkuId: sku.draftSkuId,
      quantity: line.quantity,
      receivedQuantity: line.receivedQuantity,
      costPerUnit: line.costPerUnit !== null ? line.costPerUnit.toFixed(2) : null,
      totalCost: line.costPerUnit !== null ? (line.costPerUnit * line.quantity).toFixed(2) : null,
      notes: appendSourceNote(line.notes, parsed.sourceKey, line.title),
    })));

    productionOrdersApplied.push({
      id: header!.id,
      title: order.title,
      status: order.status,
      itemCount: order.lines.length,
      quantity: order.lines.reduce((sum, line) => sum + line.quantity, 0),
      lines: resolvedLines.map(({ line, sku }) => ({
        nmId: sku.nmId,
        draftSkuId: sku.draftSkuId,
        isNewProduct: sku.isNewProduct,
        linkedNmId: sku.linkedNmId,
        quantity: line.quantity,
        receivedQuantity: line.receivedQuantity,
      })),
    });
  }

  return {
    actionType: 'fulfillment_stock_update' as const,
    ownStockItemCount: ownStockApplied.length,
    productionOrderCount: productionOrdersApplied.length,
    itemCount: ownStockApplied.length
      + productionOrdersApplied.reduce((sum, order) => sum + order.itemCount, 0),
    ownStockItems: ownStockApplied,
    productionOrders: productionOrdersApplied,
  };
}

export async function linkProcifryDraftSkuToNmId(args: {
  tenantId: string;
  draftSkuId: string;
  nmId: number;
  linkedBy: string;
}) {
  const result = await withTenantContext(db, args.tenantId, async (tx) => {
    const [draft] = await tx
      .select()
      .from(procifryDraftSkus)
      .where(and(
        eq(procifryDraftSkus.tenantId, args.tenantId),
        eq(procifryDraftSkus.id, args.draftSkuId),
      ))
      .limit(1);

    if (!draft) {
      throw new AppError('Draft SKU not found', 404);
    }
    if (draft.status === 'linked' && draft.linkedNmId !== null && draft.linkedNmId !== args.nmId) {
      throw new AppError(`Draft SKU already linked to nmId ${draft.linkedNmId}`, 409);
    }

    const now = new Date();
    await tx
      .update(procifryDraftSkus)
      .set({
        status: 'linked',
        linkedNmId: args.nmId,
        updatedAt: now,
      })
      .where(and(
        eq(procifryDraftSkus.tenantId, args.tenantId),
        eq(procifryDraftSkus.id, args.draftSkuId),
      ));

    const productionRows = await tx
      .update(productionOrderLines)
      .set({ nmId: args.nmId, updatedAt: now })
      .where(and(
        eq(productionOrderLines.tenantId, args.tenantId),
        eq(productionOrderLines.draftSkuId, args.draftSkuId),
      ))
      .returning({ id: productionOrderLines.id });

    const batchRows = await tx
      .update(ownStockBatches)
      .set({ nmId: args.nmId, updatedAt: now })
      .where(and(
        eq(ownStockBatches.tenantId, args.tenantId),
        eq(ownStockBatches.draftSkuId, args.draftSkuId),
      ))
      .returning({ id: ownStockBatches.id });

    const movementRows = await tx
      .update(ownStockMovements)
      .set({ nmId: args.nmId })
      .where(and(
        eq(ownStockMovements.tenantId, args.tenantId),
        eq(ownStockMovements.draftSkuId, args.draftSkuId),
      ))
      .returning({ id: ownStockMovements.id });

    await tx.insert(procifryAgentAuditLog).values({
      tenantId: args.tenantId,
      tenantIds: [args.tenantId],
      multiTenant: false,
      workerId: 'procifry-action-executor',
      clientId: 'procifry-ui',
      cabinetOid: draft.cabinetOid ?? '',
      periodFrom: now,
      periodTo: now,
      source: 'procifry_ui',
      sourceUpdatedAt: now,
      confidence: 'confirmed',
      accessMode: 'executed',
      resourceType: 'external_action',
      actionType: 'draft_sku_link',
      outcome: 'accepted',
      requestPayload: {
        draftSkuId: args.draftSkuId,
        nmId: args.nmId,
        linkedBy: args.linkedBy,
      },
      responsePayload: {
        productionLinesUpdated: productionRows.length,
        ownStockBatchesUpdated: batchRows.length,
        ownStockMovementsUpdated: movementRows.length,
      },
    });

    return {
      ok: true,
      draftSkuId: args.draftSkuId,
      nmId: args.nmId,
      status: 'linked',
      changed: {
        productionLines: productionRows.length,
        ownStockBatches: batchRows.length,
        ownStockMovements: movementRows.length,
      },
    };
  });

  invalidateDashboardCache(args.tenantId);
  return result;
}

export async function writeFulfillmentStockExecutionAudit(args: {
  tx: DrizzleTransaction;
  tenantId: string;
  approvalId: string;
  cabinetOid: string;
  periodFrom: Date;
  periodTo: Date;
  confidence: string;
  decidedBy: string;
  originalWorkerId: string;
  originalClientId: string;
  responsePayload: Record<string, unknown>;
}) {
  const now = new Date();
  const [audit] = await args.tx
    .insert(procifryAgentAuditLog)
    .values({
      tenantId: args.tenantId,
      tenantIds: [args.tenantId],
      multiTenant: false,
      workerId: 'procifry-action-executor',
      clientId: 'procifry-action-executor',
      cabinetOid: args.cabinetOid,
      periodFrom: args.periodFrom,
      periodTo: args.periodTo,
      source: 'procifry_approval_executor',
      sourceUpdatedAt: now,
      confidence: args.confidence,
      accessMode: 'executed',
      resourceType: 'external_action',
      actionType: 'fulfillment_stock_update',
      outcome: 'accepted',
      approvalRequestId: args.approvalId,
      requestPayload: {
        approvalId: args.approvalId,
        decidedBy: args.decidedBy,
        originalWorkerId: args.originalWorkerId,
        originalClientId: args.originalClientId,
      },
      responsePayload: args.responsePayload,
    })
    .returning({ id: procifryAgentAuditLog.id });

  return audit?.id ?? null;
}

export async function loadFulfillmentSourceCoverage(tenantId: string) {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      MIN(created_at) AS "from",
      MAX(updated_at) AS "to",
      MAX(updated_at) AS "sourceUpdatedAt"
    FROM production_orders
    WHERE tenant_id = ${tenantId}
  `));
  return (rows as unknown as Array<{
    from: Date | string | null;
    to: Date | string | null;
    sourceUpdatedAt: Date | string | null;
  }>)[0] ?? null;
}
