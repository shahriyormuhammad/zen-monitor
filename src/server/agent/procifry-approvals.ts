import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { parseManualFieldsFromUnknown } from '@/components/economics/manual-fields-io';
import { invalidateDashboardCache } from '@/lib/analytics/dashboard-cache';
import { db, type DrizzleTransaction, withTenantContext } from '@/lib/db';
import {
  procifryAgentAuditLog,
  procifryApprovalRequests,
  procifryDraftSkus,
  procifryWorkerArtifacts,
  ownStockBatches,
  products,
  productionOrderLines,
  productionOrders,
  unitEconomicsConfigs,
  unitEconomicsManualInputs,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';

import {
  applyCostUpdateToManualFields,
  getCurrentCostValues,
  getProposedCostValues,
  parseCostUpdateItems,
  type CostUpdateItem,
  type CostValues,
} from './procifry-approval-cost';
import {
  applyWarehouseDeliveryCostUpdateToManualFields,
  executeWarehouseDeliveryCostUpdate,
  parseWarehouseDeliveryCostUpdateItems,
  writeWarehouseDeliveryExecutionAudit,
  type WarehouseDeliveryCostUpdateItem,
} from './procifry-warehouse-delivery';
import {
  executeFulfillmentStockUpdate,
  fulfillmentSkuKey,
  parseFulfillmentStockUpdatePayload,
  writeFulfillmentStockExecutionAudit,
  type FulfillmentSkuReference,
  type FulfillmentStockUpdatePayload,
} from './procifry-fulfillment';
import {
  executeUnitEconomicsIndicesUpdate,
  parseUnitEconomicsIndicesUpdatePayload,
  writeUnitEconomicsIndicesExecutionAudit,
  type UnitEconomicsIndicesUpdateItem,
} from './procifry-unit-economics-indices';

type ApprovalRow = typeof procifryApprovalRequests.$inferSelect;

export type ProcifryApprovalItemView = {
  nmId: number | null;
  draftSkuId: string | null;
  isNewProduct: boolean;
  externalSkuKey: string | null;
  supplierArticle: string | null;
  sourceArticle: string | null;
  variant: string | null;
  color: string | null;
  comment: string | null;
  linkedNmId: number | null;
  name: string | null;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  current: CostValues;
  proposed: CostValues;
  deltaTotal: number | null;
  indices: {
    current: {
      localityIndexPercent: number | null;
      irpPercent: number | null;
    };
    proposed: {
      localityIndexPercent: number | null;
      irpPercent: number | null;
    };
  } | null;
  fulfillment: {
    ownStock: {
      currentQty: number;
      proposedQty: number;
      deltaQty: number;
      receivedAt: string | null;
      notes: string | null;
    } | null;
    production: Array<{
      orderTitle: string;
      status: string;
      quantity: number;
      receivedQuantity: number;
      inTransitOrProductionQty: number;
      costPerUnit: number | null;
      totalCost: number | null;
      orderedAt: string | null;
      productionStartedAt: string | null;
      shippedAt: string | null;
      estimatedDeliveryAt: string | null;
      notes: string | null;
    }>;
    totals: {
      currentOwnStockQty: number;
      proposedOwnStockQty: number | null;
      currentProductionQty: number;
      proposedProductionQty: number;
      productionQuantity: number;
      receivedQuantity: number;
      purchaseAmount: number | null;
    };
  } | null;
};

export type ProcifryApprovalView = {
  id: string;
  tenantId: string;
  workerId: string;
  clientId: string;
  cabinetOid: string;
  actionType: string;
  title: string;
  description: string | null;
  source: string;
  sourceUpdatedAt: Date;
  periodFrom: Date;
  periodTo: Date;
  confidence: string;
  status: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  executedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  payload: Record<string, unknown>;
  artifact: {
    id: string;
    title: string;
    body: string | null;
    payload: Record<string, unknown>;
    createdAt: Date;
  } | null;
  itemCount: number;
  items: ProcifryApprovalItemView[];
  parseError: string | null;
  canExecute: boolean;
};

export type ProcifryApprovalsResponse = {
  tenantId: string;
  approvals: ProcifryApprovalView[];
};

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function hasWritableCostFields(item: CostUpdateItem) {
  return [
    item.purchasePrice,
    item.deliveryToFF,
    item.deliveryToWB,
    item.packaging,
    item.fulfillment,
  ].some((value) => value !== null);
}

function emptyCostValues(): CostValues {
  return {
    purchasePrice: null,
    deliveryToFF: null,
    deliveryToWB: null,
    packaging: null,
    fulfillment: null,
    totalCost: null,
  };
}

function emptyDraftSkuView() {
  return {
    draftSkuId: null,
    isNewProduct: false,
    externalSkuKey: null,
    supplierArticle: null,
    sourceArticle: null,
    variant: null,
    color: null,
    comment: null,
    linkedNmId: null,
  };
}

function fulfillmentNmIds(payload: FulfillmentStockUpdatePayload) {
  return [...new Set([
    ...payload.ownStockItems.map((item) => item.nmId),
    ...payload.productionOrders.flatMap((order) => order.lines.map((line) => line.nmId)),
  ].filter((value): value is number => value !== null))];
}

function fulfillmentRefs(payload: FulfillmentStockUpdatePayload) {
  const refs: FulfillmentSkuReference[] = [
    ...payload.ownStockItems,
    ...payload.productionOrders.flatMap((order) => order.lines),
  ];
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = fulfillmentSkuKey(ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dateToIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

async function loadFulfillmentQuantitiesByNmId(
  tx: DrizzleTransaction,
  tenantId: string,
  nmIds: number[],
) {
  const result = new Map<number, { ownStockQty: number; productionQty: number }>();
  for (const nmId of nmIds) {
    result.set(nmId, { ownStockQty: 0, productionQty: 0 });
  }
  if (nmIds.length === 0) return result;

  const [ownRows, productionRows] = await Promise.all([
    tx
      .select({
        nmId: ownStockBatches.nmId,
        qty: sql<number>`COALESCE(SUM(${ownStockBatches.remainingQuantity}), 0)::int`,
      })
      .from(ownStockBatches)
      .where(and(
        eq(ownStockBatches.tenantId, tenantId),
        inArray(ownStockBatches.nmId, nmIds),
      ))
      .groupBy(ownStockBatches.nmId),
    tx
      .select({
        nmId: productionOrderLines.nmId,
        qty: sql<number>`COALESCE(SUM(GREATEST(${productionOrderLines.quantity} - ${productionOrderLines.receivedQuantity}, 0)), 0)::int`,
      })
      .from(productionOrderLines)
      .innerJoin(productionOrders, and(
        eq(productionOrders.id, productionOrderLines.productionOrderId),
        eq(productionOrders.tenantId, productionOrderLines.tenantId),
      ))
      .where(and(
        eq(productionOrderLines.tenantId, tenantId),
        inArray(productionOrderLines.nmId, nmIds),
        sql`${productionOrders.status} <> 'delivered'`,
      ))
      .groupBy(productionOrderLines.nmId),
  ]);

  for (const row of ownRows) {
    const nmId = Number(row.nmId);
    const current = result.get(nmId) ?? { ownStockQty: 0, productionQty: 0 };
    current.ownStockQty = Number(row.qty ?? 0);
    result.set(nmId, current);
  }
  for (const row of productionRows) {
    const nmId = Number(row.nmId);
    const current = result.get(nmId) ?? { ownStockQty: 0, productionQty: 0 };
    current.productionQty = Number(row.qty ?? 0);
    result.set(nmId, current);
  }

  return result;
}

type DraftSkuLookup = {
  id: string;
  externalSkuKey: string | null;
  supplierArticle: string | null;
  sourceArticle: string | null;
  title: string;
  comment: string | null;
  variant: string | null;
  color: string | null;
  imageUrl: string | null;
  status: string;
  linkedNmId: number | null;
};

async function loadDraftSkusForFulfillmentRefs(
  tx: DrizzleTransaction,
  tenantId: string,
  sourceKey: string,
  refs: FulfillmentSkuReference[],
) {
  const result = new Map<string, DraftSkuLookup>();
  const rowsById = new Map<string, DraftSkuLookup>();
  const allRows: DraftSkuLookup[] = [];
  const draftIds = [...new Set(refs.map((ref) => ref.draftSkuId).filter((value): value is string => Boolean(value)))];
  const externalKeys = [...new Set(refs.map((ref) => ref.externalSkuKey).filter((value): value is string => Boolean(value)))];
  const articleKeys = [...new Set(refs.flatMap((ref) => [ref.supplierArticle, ref.sourceArticle]).filter((value): value is string => Boolean(value)))];

  if (draftIds.length > 0) {
    const rows = await tx
      .select({
        id: procifryDraftSkus.id,
        externalSkuKey: procifryDraftSkus.externalSkuKey,
        supplierArticle: procifryDraftSkus.supplierArticle,
        sourceArticle: procifryDraftSkus.sourceArticle,
        title: procifryDraftSkus.title,
        comment: procifryDraftSkus.comment,
        variant: procifryDraftSkus.variant,
        color: procifryDraftSkus.color,
        imageUrl: procifryDraftSkus.imageUrl,
        status: procifryDraftSkus.status,
        linkedNmId: procifryDraftSkus.linkedNmId,
      })
      .from(procifryDraftSkus)
      .where(and(
        eq(procifryDraftSkus.tenantId, tenantId),
        inArray(procifryDraftSkus.id, draftIds),
      ));
    allRows.push(...rows);
  }

  if (externalKeys.length > 0) {
    const rows = await tx
      .select({
        id: procifryDraftSkus.id,
        externalSkuKey: procifryDraftSkus.externalSkuKey,
        supplierArticle: procifryDraftSkus.supplierArticle,
        sourceArticle: procifryDraftSkus.sourceArticle,
        title: procifryDraftSkus.title,
        comment: procifryDraftSkus.comment,
        variant: procifryDraftSkus.variant,
        color: procifryDraftSkus.color,
        imageUrl: procifryDraftSkus.imageUrl,
        status: procifryDraftSkus.status,
        linkedNmId: procifryDraftSkus.linkedNmId,
      })
      .from(procifryDraftSkus)
      .where(and(
        eq(procifryDraftSkus.tenantId, tenantId),
        eq(procifryDraftSkus.sourceKey, sourceKey),
        inArray(procifryDraftSkus.externalSkuKey, externalKeys),
      ));
    allRows.push(...rows);
  }

  if (articleKeys.length > 0) {
    const rows = await tx
      .select({
        id: procifryDraftSkus.id,
        externalSkuKey: procifryDraftSkus.externalSkuKey,
        supplierArticle: procifryDraftSkus.supplierArticle,
        sourceArticle: procifryDraftSkus.sourceArticle,
        title: procifryDraftSkus.title,
        comment: procifryDraftSkus.comment,
        variant: procifryDraftSkus.variant,
        color: procifryDraftSkus.color,
        imageUrl: procifryDraftSkus.imageUrl,
        status: procifryDraftSkus.status,
        linkedNmId: procifryDraftSkus.linkedNmId,
      })
      .from(procifryDraftSkus)
      .where(and(
        eq(procifryDraftSkus.tenantId, tenantId),
        eq(procifryDraftSkus.sourceKey, sourceKey),
        sql`(${procifryDraftSkus.supplierArticle} IN (${sql.join(articleKeys.map((key) => sql`${key}`), sql`, `)}) OR ${procifryDraftSkus.sourceArticle} IN (${sql.join(articleKeys.map((key) => sql`${key}`), sql`, `)}))`,
      ));
    allRows.push(...rows);
  }

  for (const row of allRows) {
    rowsById.set(row.id, row);
  }

  const uniqueRows = [...rowsById.values()];
  for (const ref of refs) {
    const key = fulfillmentSkuKey(ref);
    const row = uniqueRows.find((candidate) => {
      if (ref.draftSkuId && candidate.id === ref.draftSkuId) return true;
      if (ref.externalSkuKey && candidate.externalSkuKey === ref.externalSkuKey) return true;
      if (ref.title && candidate.title !== ref.title) return false;
      if (ref.supplierArticle && candidate.supplierArticle === ref.supplierArticle) return true;
      if (ref.sourceArticle && candidate.sourceArticle === ref.sourceArticle) return true;
      return false;
    });
    if (row) {
      result.set(key, row);
    }
  }

  return result;
}

async function loadFulfillmentQuantitiesByRef(
  tx: DrizzleTransaction,
  tenantId: string,
  refs: FulfillmentSkuReference[],
  draftByRef: Map<string, DraftSkuLookup>,
) {
  const result = new Map<string, { ownStockQty: number; productionQty: number }>();
  for (const ref of refs) {
    result.set(fulfillmentSkuKey(ref), { ownStockQty: 0, productionQty: 0 });
  }
  if (refs.length === 0) return result;

  const nmIds = [...new Set(refs.map((ref) => ref.nmId).filter((value): value is number => value !== null))];
  const draftIdToKeys = new Map<string, string[]>();
  for (const ref of refs) {
    const key = fulfillmentSkuKey(ref);
    const draftId = ref.draftSkuId ?? draftByRef.get(key)?.id ?? null;
    if (!draftId) continue;
    draftIdToKeys.set(draftId, [...(draftIdToKeys.get(draftId) ?? []), key]);
  }
  const draftIds = [...draftIdToKeys.keys()];

  if (nmIds.length > 0) {
    const byNmId = await loadFulfillmentQuantitiesByNmId(tx, tenantId, nmIds);
    for (const ref of refs) {
      if (ref.nmId === null) continue;
      result.set(fulfillmentSkuKey(ref), byNmId.get(ref.nmId) ?? { ownStockQty: 0, productionQty: 0 });
    }
  }

  if (draftIds.length > 0) {
    const [ownRows, productionRows] = await Promise.all([
      tx
        .select({
          draftSkuId: ownStockBatches.draftSkuId,
          qty: sql<number>`COALESCE(SUM(${ownStockBatches.remainingQuantity}), 0)::int`,
        })
        .from(ownStockBatches)
        .where(and(
          eq(ownStockBatches.tenantId, tenantId),
          inArray(ownStockBatches.draftSkuId, draftIds),
        ))
        .groupBy(ownStockBatches.draftSkuId),
      tx
        .select({
          draftSkuId: productionOrderLines.draftSkuId,
          qty: sql<number>`COALESCE(SUM(GREATEST(${productionOrderLines.quantity} - ${productionOrderLines.receivedQuantity}, 0)), 0)::int`,
        })
        .from(productionOrderLines)
        .innerJoin(productionOrders, and(
          eq(productionOrders.id, productionOrderLines.productionOrderId),
          eq(productionOrders.tenantId, productionOrderLines.tenantId),
        ))
        .where(and(
          eq(productionOrderLines.tenantId, tenantId),
          inArray(productionOrderLines.draftSkuId, draftIds),
          sql`${productionOrders.status} <> 'delivered'`,
        ))
        .groupBy(productionOrderLines.draftSkuId),
    ]);

    for (const row of ownRows) {
      if (!row.draftSkuId) continue;
      for (const key of draftIdToKeys.get(row.draftSkuId) ?? []) {
        const current = result.get(key) ?? { ownStockQty: 0, productionQty: 0 };
        current.ownStockQty = Number(row.qty ?? 0);
        result.set(key, current);
      }
    }
    for (const row of productionRows) {
      if (!row.draftSkuId) continue;
      for (const key of draftIdToKeys.get(row.draftSkuId) ?? []) {
        const current = result.get(key) ?? { ownStockQty: 0, productionQty: 0 };
        current.productionQty = Number(row.qty ?? 0);
        result.set(key, current);
      }
    }
  }

  return result;
}

async function loadLatestCostPriceByNmId(
  tx: DrizzleTransaction,
  tenantId: string,
  nmIds: number[],
) {
  const result = new Map<number, number | null>();
  if (nmIds.length === 0) return result;

  const rows = await tx
    .select({
      nmId: unitEconomicsConfigs.nmId,
      costPrice: unitEconomicsConfigs.costPrice,
      effectiveFrom: unitEconomicsConfigs.effectiveFrom,
    })
    .from(unitEconomicsConfigs)
    .where(and(
      eq(unitEconomicsConfigs.tenantId, tenantId),
      inArray(unitEconomicsConfigs.nmId, nmIds),
    ))
    .orderBy(desc(unitEconomicsConfigs.effectiveFrom));

  for (const row of rows) {
    const nmId = Number(row.nmId);
    if (!result.has(nmId)) {
      result.set(nmId, toNumber(row.costPrice));
    }
  }

  return result;
}

async function loadManualFieldsByNmId(
  tx: DrizzleTransaction,
  tenantId: string,
  nmIds: number[],
) {
  const result = new Map<number, Record<string, unknown>>();
  if (nmIds.length === 0) return result;

  const rows = await tx
    .select({
      nmId: unitEconomicsManualInputs.nmId,
      manualFields: unitEconomicsManualInputs.manualFields,
    })
    .from(unitEconomicsManualInputs)
    .where(and(
      eq(unitEconomicsManualInputs.tenantId, tenantId),
      inArray(unitEconomicsManualInputs.nmId, nmIds),
    ));

  for (const row of rows) {
    result.set(Number(row.nmId), row.manualFields);
  }

  return result;
}

async function loadProductsByNmId(
  tx: DrizzleTransaction,
  tenantId: string,
  nmIds: number[],
) {
  const result = new Map<number, {
    vendorCode: string | null;
    brand: string | null;
    photoUrl: string | null;
  }>();
  if (nmIds.length === 0) return result;

  const rows = await tx
    .select({
      nmId: products.nmId,
      vendorCode: products.vendorCode,
      brand: products.brand,
      photoUrl: products.photoUrl,
    })
    .from(products)
    .where(and(
      eq(products.tenantId, tenantId),
      inArray(products.nmId, nmIds),
    ));

  for (const row of rows) {
    result.set(Number(row.nmId), {
      vendorCode: row.vendorCode ?? null,
      brand: row.brand ?? null,
      photoUrl: row.photoUrl ?? null,
    });
  }

  return result;
}

async function loadArtifact(
  tx: DrizzleTransaction,
  tenantId: string,
  approvalId: string,
) {
  const [artifact] = await tx
    .select({
      id: procifryWorkerArtifacts.id,
      title: procifryWorkerArtifacts.title,
      body: procifryWorkerArtifacts.body,
      payload: procifryWorkerArtifacts.payload,
      createdAt: procifryWorkerArtifacts.createdAt,
    })
    .from(procifryWorkerArtifacts)
    .where(and(
      eq(procifryWorkerArtifacts.tenantId, tenantId),
      eq(procifryWorkerArtifacts.approvalRequestId, approvalId),
    ))
    .orderBy(desc(procifryWorkerArtifacts.createdAt))
    .limit(1);

  return artifact ?? null;
}

async function buildApprovalView(
  tx: DrizzleTransaction,
  tenantId: string,
  approval: ApprovalRow,
): Promise<ProcifryApprovalView> {
  let costItems: CostUpdateItem[] = [];
  let warehouseItems: WarehouseDeliveryCostUpdateItem[] = [];
  let fulfillmentPayload: FulfillmentStockUpdatePayload | null = null;
  let indicesItems: UnitEconomicsIndicesUpdateItem[] = [];
  let parseError: string | null = null;

  try {
    if (approval.actionType === 'cost_update') {
      costItems = parseCostUpdateItems(approval.payload);
    } else if (approval.actionType === 'warehouse_delivery_cost_update') {
      warehouseItems = parseWarehouseDeliveryCostUpdateItems(approval.payload);
    } else if (approval.actionType === 'fulfillment_stock_update') {
      fulfillmentPayload = parseFulfillmentStockUpdatePayload(approval.payload);
    } else if (approval.actionType === 'unit_economics_indices_update') {
      const parsed = parseUnitEconomicsIndicesUpdatePayload(approval.payload);
      indicesItems = parsed.mode === 'items'
        ? parsed.items
        : [];
    }
  } catch (error) {
    parseError = error instanceof Error ? error.message : String(error);
  }

  const nmIds = [...new Set([
    ...costItems.map((item) => item.nmId),
    ...warehouseItems.map((item) => item.nmId),
    ...indicesItems.map((item) => item.nmId),
    ...(fulfillmentPayload ? fulfillmentNmIds(fulfillmentPayload) : []),
  ])];
  const fulfillmentItemRefs = fulfillmentPayload ? fulfillmentRefs(fulfillmentPayload) : [];
  const draftByRef = fulfillmentPayload
    ? await loadDraftSkusForFulfillmentRefs(tx, tenantId, fulfillmentPayload.sourceKey, fulfillmentItemRefs)
    : new Map<string, DraftSkuLookup>();
  const productNmIds = [...new Set([
    ...nmIds,
    ...[...draftByRef.values()].map((draft) => draft.linkedNmId).filter((value): value is number => value !== null),
  ])];
  const [manualByNmId, latestCostByNmId, productsByNmId, fulfillmentByRef, artifact] = await Promise.all([
    loadManualFieldsByNmId(tx, tenantId, nmIds),
    loadLatestCostPriceByNmId(tx, tenantId, nmIds),
    loadProductsByNmId(tx, tenantId, productNmIds),
    loadFulfillmentQuantitiesByRef(tx, tenantId, fulfillmentItemRefs, draftByRef),
    loadArtifact(tx, tenantId, approval.id),
  ]);

  const costApprovalItems: ProcifryApprovalItemView[] = costItems.map((item) => {
    const product = productsByNmId.get(item.nmId);
    const current = getCurrentCostValues(
      manualByNmId.get(item.nmId) ?? {},
      latestCostByNmId.get(item.nmId) ?? null,
    );
    const proposed = getProposedCostValues(item);
    const deltaTotal = current.totalCost !== null && proposed.totalCost !== null
      ? roundMoney(proposed.totalCost - current.totalCost)
      : null;

    return {
      nmId: item.nmId,
      ...emptyDraftSkuView(),
      name: item.name,
      vendorCode: product?.vendorCode ?? null,
      brand: product?.brand ?? null,
      photoUrl: product?.photoUrl ?? null,
      current,
      proposed,
      deltaTotal,
      indices: null,
      fulfillment: null,
    };
  });
  const warehouseApprovalItems: ProcifryApprovalItemView[] = warehouseItems.map((item) => {
    const product = productsByNmId.get(item.nmId);
    const currentManualFields = manualByNmId.get(item.nmId) ?? {};
    const current = getCurrentCostValues(
      currentManualFields,
      latestCostByNmId.get(item.nmId) ?? null,
    );
    const applied = applyWarehouseDeliveryCostUpdateToManualFields(currentManualFields, item);
    const deliveryToWB = applied.changed.unitEconomicsDeliveryToWb;
    const proposedTotal = current.totalCost !== null && current.deliveryToWB !== null && deliveryToWB !== null
      ? roundMoney(current.totalCost - current.deliveryToWB + deliveryToWB)
      : current.totalCost;
    const proposed = {
      ...current,
      deliveryToWB,
      totalCost: proposedTotal,
    };
    const deltaTotal = current.totalCost !== null && proposed.totalCost !== null
      ? roundMoney(proposed.totalCost - current.totalCost)
      : null;

    return {
      nmId: item.nmId,
      ...emptyDraftSkuView(),
      name: null,
      vendorCode: product?.vendorCode ?? null,
      brand: product?.brand ?? null,
      photoUrl: product?.photoUrl ?? null,
      current,
      proposed,
      deltaTotal,
      indices: null,
      fulfillment: null,
    };
  });
  const indicesApprovalItems: ProcifryApprovalItemView[] = indicesItems.map((item) => {
    const product = productsByNmId.get(item.nmId);
    const manualFields = parseManualFieldsFromUnknown(manualByNmId.get(item.nmId) ?? {});
    const currentIndices = {
      localityIndexPercent: toNumber(manualFields.localityIndexPercent),
      irpPercent: toNumber(manualFields.irpPercent),
    };
    const proposedIndices = {
      localityIndexPercent: item.localityIndexPercent ?? currentIndices.localityIndexPercent,
      irpPercent: item.irpPercent ?? currentIndices.irpPercent,
    };

    return {
      nmId: item.nmId,
      ...emptyDraftSkuView(),
      name: null,
      vendorCode: product?.vendorCode ?? null,
      brand: product?.brand ?? null,
      photoUrl: product?.photoUrl ?? null,
      current: emptyCostValues(),
      proposed: emptyCostValues(),
      deltaTotal: null,
      indices: {
        current: currentIndices,
        proposed: proposedIndices,
      },
      fulfillment: null,
    };
  });
  const fulfillmentApprovalItems: ProcifryApprovalItemView[] = fulfillmentPayload
    ? fulfillmentItemRefs.map((ref) => {
        const key = fulfillmentSkuKey(ref);
        const draft = draftByRef.get(key) ?? null;
        const nmId = ref.nmId ?? draft?.linkedNmId ?? null;
        const product = nmId !== null ? productsByNmId.get(nmId) : undefined;
        const currentQuantities = fulfillmentByRef.get(key) ?? { ownStockQty: 0, productionQty: 0 };
        const ownStockItems = fulfillmentPayload.ownStockItems.filter((item) => fulfillmentSkuKey(item) === key);
        const ownStockQuantity = ownStockItems.reduce((sum, item) => sum + item.quantity, 0);
        const ownStock = ownStockItems.length > 0
          ? {
              currentQty: currentQuantities.ownStockQty,
              proposedQty: fulfillmentPayload.replaceExisting
                ? ownStockQuantity
                : currentQuantities.ownStockQty + ownStockQuantity,
              deltaQty: fulfillmentPayload.replaceExisting
                ? ownStockQuantity - currentQuantities.ownStockQty
                : ownStockQuantity,
              receivedAt: dateToIso(ownStockItems[0]?.receivedAt ?? null),
              notes: ownStockItems.map((item) => item.notes).filter(Boolean).join(' | ') || null,
            }
          : null;
        const productionLines = fulfillmentPayload.productionOrders
          .flatMap((order) => order.lines
            .filter((line) => fulfillmentSkuKey(line) === key)
            .map((line) => {
              const inTransitOrProductionQty = Math.max(line.quantity - line.receivedQuantity, 0);
              return {
                orderTitle: order.title,
                status: order.status,
                quantity: line.quantity,
                receivedQuantity: line.receivedQuantity,
                inTransitOrProductionQty,
                costPerUnit: line.costPerUnit,
                totalCost: line.costPerUnit !== null
                  ? roundMoney(line.costPerUnit * line.quantity)
                  : null,
                orderedAt: dateToIso(order.orderedAt),
                productionStartedAt: dateToIso(order.productionStartedAt),
                shippedAt: dateToIso(order.shippedAt),
                estimatedDeliveryAt: dateToIso(order.estimatedDeliveryAt),
                notes: line.notes,
              };
            }));
        const productionQuantity = productionLines.reduce((sum, line) => sum + line.quantity, 0);
        const receivedQuantity = productionLines.reduce((sum, line) => sum + line.receivedQuantity, 0);
        const productionPendingQty = productionLines.reduce((sum, line) => sum + line.inTransitOrProductionQty, 0);
        const purchaseAmounts = productionLines
          .map((line) => line.totalCost)
          .filter((value): value is number => value !== null);
        const purchaseAmount = productionLines.length > 0 && purchaseAmounts.length === productionLines.length
          ? roundMoney(purchaseAmounts.reduce((sum, value) => sum + value, 0))
          : null;

        return {
          nmId,
          draftSkuId: ref.draftSkuId ?? draft?.id ?? null,
          isNewProduct: ref.isNewProduct || nmId === null || Boolean(draft),
          externalSkuKey: ref.externalSkuKey ?? draft?.externalSkuKey ?? null,
          supplierArticle: ref.supplierArticle ?? draft?.supplierArticle ?? null,
          sourceArticle: ref.sourceArticle ?? draft?.sourceArticle ?? null,
          variant: ref.variant ?? draft?.variant ?? null,
          color: ref.color ?? draft?.color ?? null,
          comment: ref.comment ?? draft?.comment ?? null,
          linkedNmId: draft?.linkedNmId ?? null,
          name: ownStockItems[0]?.title ?? fulfillmentPayload.productionOrders
            .flatMap((order) => order.lines)
            .find((line) => fulfillmentSkuKey(line) === key)?.title ?? draft?.title ?? null,
          vendorCode: product?.vendorCode ?? null,
          brand: product?.brand ?? null,
          photoUrl: product?.photoUrl ?? draft?.imageUrl ?? null,
          current: emptyCostValues(),
          proposed: emptyCostValues(),
          deltaTotal: null,
          indices: null,
          fulfillment: {
            ownStock,
            production: productionLines,
            totals: {
              currentOwnStockQty: currentQuantities.ownStockQty,
              proposedOwnStockQty: ownStock?.proposedQty ?? null,
              currentProductionQty: currentQuantities.productionQty,
              proposedProductionQty: currentQuantities.productionQty + productionPendingQty,
              productionQuantity,
              receivedQuantity,
              purchaseAmount,
            },
          },
        };
      })
    : [];
  const items = approval.actionType === 'warehouse_delivery_cost_update'
    ? warehouseApprovalItems
    : approval.actionType === 'unit_economics_indices_update'
      ? indicesApprovalItems
    : approval.actionType === 'fulfillment_stock_update'
      ? fulfillmentApprovalItems
      : costApprovalItems;

  return {
    id: approval.id,
    tenantId: approval.tenantId,
    workerId: approval.workerId,
    clientId: approval.clientId,
    cabinetOid: approval.cabinetOid,
    actionType: approval.actionType,
    title: approval.title,
    description: approval.description,
    source: approval.source,
    sourceUpdatedAt: approval.sourceUpdatedAt,
    periodFrom: approval.periodFrom,
    periodTo: approval.periodTo,
    confidence: approval.confidence,
    status: approval.status,
    decidedBy: approval.decidedBy,
    decidedAt: approval.decidedAt,
    executedAt: approval.executedAt,
    createdAt: approval.createdAt,
    updatedAt: approval.updatedAt,
    payload: approval.payload,
    artifact,
    itemCount: items.length,
    items,
    parseError,
    canExecute: approval.status === 'requested'
      && (
        approval.actionType === 'cost_update'
        || approval.actionType === 'warehouse_delivery_cost_update'
        || approval.actionType === 'unit_economics_indices_update'
        || approval.actionType === 'fulfillment_stock_update'
      )
      && parseError === null
      && items.length > 0,
  };
}

export async function listProcifryApprovals(
  tenantId: string,
  options: { status?: string | null; limit?: number } = {},
): Promise<ProcifryApprovalsResponse> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);

  return withTenantContext(db, tenantId, async (tx) => {
    const conditions = [eq(procifryApprovalRequests.tenantId, tenantId)];
    if (options.status) {
      conditions.push(eq(procifryApprovalRequests.status, options.status));
    }

    const rows = await tx
      .select()
      .from(procifryApprovalRequests)
      .where(and(...conditions))
      .orderBy(desc(procifryApprovalRequests.createdAt))
      .limit(limit);

    const approvals = await Promise.all(rows.map((approval) => buildApprovalView(tx, tenantId, approval)));
    return { tenantId, approvals };
  });
}

export async function getProcifryApproval(
  tenantId: string,
  approvalId: string,
): Promise<ProcifryApprovalView> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [approval] = await tx
      .select()
      .from(procifryApprovalRequests)
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ))
      .limit(1);

    if (!approval) {
      throw new AppError('Approval request not found', 404);
    }

    return buildApprovalView(tx, tenantId, approval);
  });
}

async function approveProcifryCostUpdate(
  tenantId: string,
  approvalId: string,
  decidedBy: string,
) {
  const result = await withTenantContext(db, tenantId, async (tx) => {
    const [approval] = await tx
      .select()
      .from(procifryApprovalRequests)
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ))
      .limit(1);

    if (!approval) {
      throw new AppError('Approval request not found', 404);
    }
    if (approval.status !== 'requested') {
      throw new AppError(`Approval request is already ${approval.status}`, 409);
    }
    if (approval.actionType !== 'cost_update') {
      throw new AppError(`Unsupported approval action_type: ${approval.actionType}`, 400);
    }

    const items = parseCostUpdateItems(approval.payload);
    if (items.length === 0) {
      throw new AppError('cost_update payload has no items', 400);
    }
    const invalidItem = items.find((item) => !hasWritableCostFields(item));
    if (invalidItem) {
      throw new AppError(`cost_update item ${invalidItem.nmId} has no writable cost fields`, 400);
    }

    const nmIds = [...new Set(items.map((item) => item.nmId))];
    const [manualByNmId, latestCostByNmId] = await Promise.all([
      loadManualFieldsByNmId(tx, tenantId, nmIds),
      loadLatestCostPriceByNmId(tx, tenantId, nmIds),
    ]);
    const now = new Date();
    const effectiveDate = new Date();
    effectiveDate.setUTCHours(0, 0, 0, 0);
    const appliedItems = [];

    for (const item of items) {
      const currentManualFields = manualByNmId.get(item.nmId) ?? {};
      const current = getCurrentCostValues(
        currentManualFields,
        latestCostByNmId.get(item.nmId) ?? null,
      );
      const proposed = getProposedCostValues(item);
      const nextManualFields = applyCostUpdateToManualFields(currentManualFields, item);

      await tx
        .insert(unitEconomicsManualInputs)
        .values({
          tenantId,
          nmId: item.nmId,
          manualFields: nextManualFields,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [unitEconomicsManualInputs.tenantId, unitEconomicsManualInputs.nmId],
          set: {
            manualFields: nextManualFields,
            updatedAt: now,
          },
        });

      if (item.purchasePrice !== null) {
        await tx
          .insert(unitEconomicsConfigs)
          .values({
            tenantId,
            nmId: item.nmId,
            costPrice: item.purchasePrice.toString(),
            effectiveFrom: effectiveDate,
          })
          .onConflictDoUpdate({
            target: [
              unitEconomicsConfigs.tenantId,
              unitEconomicsConfigs.nmId,
              unitEconomicsConfigs.effectiveFrom,
            ],
            set: {
              costPrice: item.purchasePrice.toString(),
            },
          });
      }

      appliedItems.push({
        nmId: item.nmId,
        name: item.name,
        current,
        proposed,
      });
    }

    await tx
      .update(procifryApprovalRequests)
      .set({
        status: 'executed',
        decidedBy,
        decidedAt: now,
        executedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ));

    const [audit] = await tx
      .insert(procifryAgentAuditLog)
      .values({
        tenantId,
        tenantIds: [tenantId],
        multiTenant: false,
        workerId: 'procifry-action-executor',
        clientId: 'procifry-action-executor',
        cabinetOid: approval.cabinetOid,
        periodFrom: approval.periodFrom,
        periodTo: approval.periodTo,
        source: 'procifry_approval_executor',
        sourceUpdatedAt: now,
        confidence: approval.confidence,
        accessMode: 'executed',
        resourceType: 'external_action',
        actionType: approval.actionType,
        outcome: 'accepted',
        approvalRequestId: approval.id,
        requestPayload: {
          approvalId,
          decidedBy,
          originalWorkerId: approval.workerId,
          originalClientId: approval.clientId,
          itemCount: items.length,
        },
        responsePayload: {
          status: 'executed',
          appliedItems,
        },
      })
      .returning({ id: procifryAgentAuditLog.id });

    return {
      ok: true,
      approvalId,
      status: 'executed',
      auditId: audit?.id ?? null,
      appliedItems,
    };
  });

  invalidateDashboardCache(tenantId);
  revalidatePath('/approvals');
  revalidatePath('/economics');
  revalidatePath('/economics-v2');
  revalidatePath('/overview');

  return result;
}

async function approveProcifryWarehouseDeliveryCostUpdate(
  tenantId: string,
  approvalId: string,
  decidedBy: string,
) {
  const result = await withTenantContext(db, tenantId, async (tx) => {
    const [approval] = await tx
      .select()
      .from(procifryApprovalRequests)
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ))
      .limit(1);

    if (!approval) {
      throw new AppError('Approval request not found', 404);
    }
    if (approval.status !== 'requested') {
      throw new AppError(`Approval request is already ${approval.status}`, 409);
    }
    if (approval.actionType !== 'warehouse_delivery_cost_update') {
      throw new AppError(`Unsupported approval action_type: ${approval.actionType}`, 400);
    }

    const now = new Date();
    const execution = await executeWarehouseDeliveryCostUpdate(tx, tenantId, approval.payload);

    await tx
      .update(procifryApprovalRequests)
      .set({
        status: 'executed',
        decidedBy,
        decidedAt: now,
        executedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ));

    const responsePayload = {
      status: 'executed',
      actionType: execution.actionType,
      itemCount: execution.itemCount,
      items: execution.items,
    };
    const auditId = await writeWarehouseDeliveryExecutionAudit({
      tx,
      tenantId,
      approvalId,
      cabinetOid: approval.cabinetOid,
      periodFrom: approval.periodFrom,
      periodTo: approval.periodTo,
      confidence: approval.confidence,
      decidedBy,
      originalWorkerId: approval.workerId,
      originalClientId: approval.clientId,
      responsePayload,
    });

    const single = execution.single;
    return {
      ok: true,
      approvalId,
      status: 'executed',
      auditId,
      actionType: execution.actionType,
      nmId: single?.nmId ?? null,
      changed: single
        ? single.changed
        : {
            items: execution.items,
          },
    };
  });

  invalidateDashboardCache(tenantId);
  revalidatePath('/approvals');
  revalidatePath('/economics');
  revalidatePath('/economics-v2');
  revalidatePath('/overview');

  return result;
}

async function approveProcifryUnitEconomicsIndicesUpdate(
  tenantId: string,
  approvalId: string,
  decidedBy: string,
) {
  const result = await withTenantContext(db, tenantId, async (tx) => {
    const [approval] = await tx
      .select()
      .from(procifryApprovalRequests)
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ))
      .limit(1);

    if (!approval) {
      throw new AppError('Approval request not found', 404);
    }
    if (approval.status !== 'requested') {
      throw new AppError(`Approval request is already ${approval.status}`, 409);
    }
    if (approval.actionType !== 'unit_economics_indices_update') {
      throw new AppError(`Unsupported approval action_type: ${approval.actionType}`, 400);
    }

    const now = new Date();
    const execution = await executeUnitEconomicsIndicesUpdate(tx, tenantId, approval.payload);

    await tx
      .update(procifryApprovalRequests)
      .set({
        status: 'executed',
        decidedBy,
        decidedAt: now,
        executedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ));

    const responsePayload = {
      status: 'executed',
      actionType: execution.actionType,
      itemCount: execution.itemCount,
      items: execution.items,
    };
    const auditId = await writeUnitEconomicsIndicesExecutionAudit({
      tx,
      tenantId,
      approvalId,
      cabinetOid: approval.cabinetOid,
      periodFrom: approval.periodFrom,
      periodTo: approval.periodTo,
      confidence: approval.confidence,
      decidedBy,
      originalWorkerId: approval.workerId,
      originalClientId: approval.clientId,
      responsePayload,
    });

    const single = execution.single;
    return {
      ok: true,
      approvalId,
      status: 'executed',
      auditId,
      actionType: execution.actionType,
      nmId: single?.nmId ?? null,
      changed: single
        ? single.changed
        : {
            items: execution.items,
          },
    };
  });

  invalidateDashboardCache(tenantId);
  revalidatePath('/approvals');
  revalidatePath('/economics');
  revalidatePath('/economics-v2');
  revalidatePath('/overview');

  return result;
}

async function approveProcifryFulfillmentStockUpdate(
  tenantId: string,
  approvalId: string,
  decidedBy: string,
) {
  const result = await withTenantContext(db, tenantId, async (tx) => {
    const [approval] = await tx
      .select()
      .from(procifryApprovalRequests)
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ))
      .limit(1);

    if (!approval) {
      throw new AppError('Approval request not found', 404);
    }
    if (approval.status !== 'requested') {
      throw new AppError(`Approval request is already ${approval.status}`, 409);
    }
    if (approval.actionType !== 'fulfillment_stock_update') {
      throw new AppError(`Unsupported approval action_type: ${approval.actionType}`, 400);
    }

    const now = new Date();
    const execution = await executeFulfillmentStockUpdate(tx, tenantId, approval.payload);

    await tx
      .update(procifryApprovalRequests)
      .set({
        status: 'executed',
        decidedBy,
        decidedAt: now,
        executedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ));

    const responsePayload = {
      status: 'executed',
      actionType: execution.actionType,
      itemCount: execution.itemCount,
      ownStockItemCount: execution.ownStockItemCount,
      productionOrderCount: execution.productionOrderCount,
      ownStockItems: execution.ownStockItems,
      productionOrders: execution.productionOrders,
    };
    const auditId = await writeFulfillmentStockExecutionAudit({
      tx,
      tenantId,
      approvalId,
      cabinetOid: approval.cabinetOid,
      periodFrom: approval.periodFrom,
      periodTo: approval.periodTo,
      confidence: approval.confidence,
      decidedBy,
      originalWorkerId: approval.workerId,
      originalClientId: approval.clientId,
      responsePayload,
    });

    return {
      ok: true,
      approvalId,
      status: 'executed',
      auditId,
      actionType: execution.actionType,
      itemCount: execution.itemCount,
      ownStockItemCount: execution.ownStockItemCount,
      productionOrderCount: execution.productionOrderCount,
    };
  });

  invalidateDashboardCache(tenantId);
  revalidatePath('/approvals');
  revalidatePath('/stocks-v2');
  revalidatePath('/stocks-v2/batches');
  revalidatePath('/stocks-v2/by-warehouse');
  revalidatePath('/overview');

  return result;
}

export async function approveProcifryApproval(
  tenantId: string,
  approvalId: string,
  decidedBy: string,
) {
  const [approval] = await withTenantContext(db, tenantId, async (tx) =>
    tx
      .select({ actionType: procifryApprovalRequests.actionType })
      .from(procifryApprovalRequests)
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ))
      .limit(1),
  );

  if (!approval) {
    throw new AppError('Approval request not found', 404);
  }

  if (approval.actionType === 'cost_update') {
    return approveProcifryCostUpdate(tenantId, approvalId, decidedBy);
  }
  if (approval.actionType === 'warehouse_delivery_cost_update') {
    return approveProcifryWarehouseDeliveryCostUpdate(tenantId, approvalId, decidedBy);
  }
  if (approval.actionType === 'unit_economics_indices_update') {
    return approveProcifryUnitEconomicsIndicesUpdate(tenantId, approvalId, decidedBy);
  }
  if (approval.actionType === 'fulfillment_stock_update') {
    return approveProcifryFulfillmentStockUpdate(tenantId, approvalId, decidedBy);
  }

  throw new AppError(`Unsupported approval action_type: ${approval.actionType}`, 400);
}

export async function rejectProcifryApproval(
  tenantId: string,
  approvalId: string,
  decidedBy: string,
  reason: string | null,
) {
  const result = await withTenantContext(db, tenantId, async (tx) => {
    const [approval] = await tx
      .select()
      .from(procifryApprovalRequests)
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ))
      .limit(1);

    if (!approval) {
      throw new AppError('Approval request not found', 404);
    }
    if (approval.status !== 'requested') {
      throw new AppError(`Approval request is already ${approval.status}`, 409);
    }

    const now = new Date();
    await tx
      .update(procifryApprovalRequests)
      .set({
        status: 'rejected',
        decidedBy,
        decidedAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(procifryApprovalRequests.tenantId, tenantId),
        eq(procifryApprovalRequests.id, approvalId),
      ));

    const [audit] = await tx
      .insert(procifryAgentAuditLog)
      .values({
        tenantId,
        tenantIds: [tenantId],
        multiTenant: false,
        workerId: 'procifry-action-executor',
        clientId: 'procifry-action-executor',
        cabinetOid: approval.cabinetOid,
        periodFrom: approval.periodFrom,
        periodTo: approval.periodTo,
        source: 'procifry_approval_executor',
        sourceUpdatedAt: now,
        confidence: approval.confidence,
        accessMode: 'approval_required',
        resourceType: 'approval_request',
        actionType: approval.actionType,
        outcome: 'rejected',
        approvalRequestId: approval.id,
        requestPayload: {
          approvalId,
          decidedBy,
          reason,
          originalWorkerId: approval.workerId,
          originalClientId: approval.clientId,
        },
        responsePayload: {
          status: 'rejected',
        },
      })
      .returning({ id: procifryAgentAuditLog.id });

    return {
      ok: true,
      approvalId,
      status: 'rejected',
      auditId: audit?.id ?? null,
    };
  });

  revalidatePath('/approvals');
  return result;
}
