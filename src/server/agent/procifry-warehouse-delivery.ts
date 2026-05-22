import { and, eq, inArray, sql } from 'drizzle-orm';

import { DEFAULT_WAREHOUSES } from '@/components/economics/constants';
import { formatManualDecimal } from '@/server/agent/procifry-approval-cost';
import { normalizeWarehouseKey } from '@/components/economics/helpers';
import { parseManualFieldsFromUnknown } from '@/components/economics/manual-fields-io';
import { resolveWarehouseOptionId } from '@/components/economics/warehouse-options';
import type { ManualFields } from '@/components/economics/types';
import type {
  AgentApiClient,
  ProcifryConfidence,
  ProcifryWorkerId,
} from '@/lib/agent-api';
import { db, type DrizzleTransaction, withTenantContext } from '@/lib/db';
import {
  procifryAgentAuditLog,
  products,
  unitEconomicsManualInputs,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { createProcifryRecord } from '@/server/agent/procifry';
import type { AgentReportParams, AgentReportResult } from '@/server/agent/reports';

export const PROCIFRY_WAREHOUSE_DELIVERY_ACTION_TYPES = [
  'warehouse_delivery_cost_update',
] as const;

export type ProcifryWarehouseDeliveryActionType = (typeof PROCIFRY_WAREHOUSE_DELIVERY_ACTION_TYPES)[number];

export type WarehouseDeliveryCostUpdateWarehouse = {
  warehouseName: string;
  deliveryToWbPerUnit: number;
};

export type WarehouseDeliveryCostUpdateItem = {
  nmId: number;
  disableWarehouses: string[];
  enableWarehouses: WarehouseDeliveryCostUpdateWarehouse[];
  unitEconomicsDeliveryToWbMode: 'average_enabled_warehouses';
  calculation: Record<string, unknown> | null;
};

export type ProcifryWarehouseDeliveryActionRequest = {
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
  actionType: ProcifryWarehouseDeliveryActionType;
  payload: Record<string, unknown>;
};

type WarehouseConfigItem = {
  nmId: number;
  vendorCode: string | null;
  warehouses: Array<{
    warehouseId: string;
    warehouseName: string;
    enabled: boolean;
    deliveryToWbPerUnit: number | null;
  }>;
  unitEconomicsDeliveryToWbMode: 'average_enabled_warehouses';
  unitEconomicsDeliveryToWb: number | null;
  localityIndexPercent: number | null;
  irpPercent: number | null;
  updatedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function parseWarehouseItem(raw: unknown, index: number): WarehouseDeliveryCostUpdateWarehouse {
  if (!isRecord(raw)) {
    throw new AppError(`items[${index}].warehouses[] must be an object`, 400);
  }

  const warehouseName = toText(raw.warehouseName ?? raw.name ?? raw.label);
  if (!warehouseName) {
    throw new AppError(`items[${index}].warehouseName is required`, 400);
  }

  const deliveryToWbPerUnit = toNumber(raw.deliveryToWbPerUnit ?? raw.deliveryToWB ?? raw.delivery_to_wb);
  if (deliveryToWbPerUnit === null || deliveryToWbPerUnit < 0) {
    throw new AppError(`items[${index}].deliveryToWbPerUnit must be >= 0`, 400);
  }

  return {
    warehouseName,
    deliveryToWbPerUnit: roundMoney(deliveryToWbPerUnit),
  };
}

function assertMode(value: unknown): 'average_enabled_warehouses' {
  const mode = toText(value) ?? 'average_enabled_warehouses';
  if (mode !== 'average_enabled_warehouses') {
    throw new AppError('unitEconomicsDeliveryToWbMode must be average_enabled_warehouses', 400);
  }
  return mode;
}

function normalizeUpdateItem(
  raw: Record<string, unknown>,
  index: number,
  parent: Record<string, unknown>,
): WarehouseDeliveryCostUpdateItem {
  const nmId = toNumber(raw.nmId ?? raw.nm_id);
  if (nmId === null || !Number.isInteger(nmId) || nmId <= 0) {
    throw new AppError(`items[${index}].nmId must be a positive integer`, 400);
  }

  const rawEnableWarehouses = Array.isArray(raw.enableWarehouses)
    ? raw.enableWarehouses
    : Array.isArray(raw.warehouses)
      ? raw.warehouses
      : Array.isArray(parent.enableWarehouses)
        ? parent.enableWarehouses
        : [];
  const enableWarehouses = rawEnableWarehouses.map((item, warehouseIndex) =>
    parseWarehouseItem(item, warehouseIndex),
  );
  if (enableWarehouses.length === 0) {
    throw new AppError(`items[${index}].warehouses must contain at least one warehouse`, 400);
  }

  return {
    nmId,
    disableWarehouses: [...new Set(raw === parent
      ? stringArray(raw.disableWarehouses)
      : [
          ...stringArray(parent.disableWarehouses),
          ...stringArray(raw.disableWarehouses),
        ])],
    enableWarehouses,
    unitEconomicsDeliveryToWbMode: assertMode(raw.unitEconomicsDeliveryToWbMode ?? parent.unitEconomicsDeliveryToWbMode),
    calculation: isRecord(raw.calculation)
      ? raw.calculation
      : isRecord(parent.calculation)
        ? parent.calculation
        : null,
  };
}

export function parseWarehouseDeliveryCostUpdateItems(payload: unknown): WarehouseDeliveryCostUpdateItem[] {
  if (!isRecord(payload)) {
    throw new AppError('warehouse_delivery_cost_update payload must be an object', 400);
  }

  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : [payload];
  if (rawItems.length === 0) {
    throw new AppError('warehouse_delivery_cost_update payload has no items', 400);
  }

  return rawItems.map((item, index) => {
    if (!isRecord(item)) {
      throw new AppError(`items[${index}] must be an object`, 400);
    }
    return normalizeUpdateItem(item, index, payload);
  });
}

function getWarehouseOptions(manualFields: ManualFields) {
  const result = new Map<string, string>();
  for (const warehouse of DEFAULT_WAREHOUSES) {
    result.set(warehouse.id, warehouse.label);
  }
  for (const warehouse of manualFields.customWarehouses) {
    result.set(warehouse.id, warehouse.label);
  }
  return result;
}

function findWarehouseId(manualFields: ManualFields, warehouseRef: string): string | null {
  const normalizedRef = normalizeWarehouseKey(warehouseRef);
  const options = getWarehouseOptions(manualFields);
  if (options.has(warehouseRef)) {
    return warehouseRef;
  }

  for (const [id, label] of options) {
    if (normalizeWarehouseKey(id) === normalizedRef || normalizeWarehouseKey(label) === normalizedRef) {
      return id;
    }
  }

  return null;
}

function ensureWarehouseOption(manualFields: ManualFields, warehouseName: string) {
  const existingId = findWarehouseId(manualFields, warehouseName);
  if (existingId) {
    return existingId;
  }

  const warehouseId = resolveWarehouseOptionId(warehouseName);
  const isDefault = DEFAULT_WAREHOUSES.some((warehouse) => warehouse.id === warehouseId);
  if (!isDefault && !manualFields.customWarehouses.some((warehouse) => warehouse.id === warehouseId)) {
    manualFields.customWarehouses.push({ id: warehouseId, label: warehouseName });
  }
  return warehouseId;
}

function computeDeliveryToWb(manualFields: ManualFields) {
  const costs = manualFields.selectedWarehouses
    .map((warehouseId) => toNumber(manualFields.warehouseCosts[warehouseId]))
    .filter((value): value is number => value !== null);
  if (costs.length === 0) return null;
  return roundMoney(costs.reduce((sum, value) => sum + value, 0) / costs.length);
}

function cloneManualFields(manualFields: ManualFields): ManualFields {
  return {
    ...manualFields,
    selectedWarehouses: [...manualFields.selectedWarehouses],
    warehouseCosts: { ...manualFields.warehouseCosts },
    customWarehouses: manualFields.customWarehouses.map((warehouse) => ({ ...warehouse })),
    priceScenarios: {
      excellent: { ...manualFields.priceScenarios.excellent },
      good: { ...manualFields.priceScenarios.good },
      average: { ...manualFields.priceScenarios.average },
      poor: { ...manualFields.priceScenarios.poor },
    },
  };
}

export function applyWarehouseDeliveryCostUpdateToManualFields(
  manualPayload: unknown,
  item: WarehouseDeliveryCostUpdateItem,
): {
  manualFields: ManualFields;
  changed: {
    disabled: string[];
    enabled: WarehouseDeliveryCostUpdateWarehouse[];
    unitEconomicsDeliveryToWb: number | null;
  };
} {
  const next = cloneManualFields(parseManualFieldsFromUnknown(manualPayload));
  const disabled: string[] = [];

  for (const warehouseRef of item.disableWarehouses) {
    const warehouseId = findWarehouseId(next, warehouseRef);
    if (!warehouseId) continue;
    const label = getWarehouseOptions(next).get(warehouseId) ?? warehouseRef;
    next.selectedWarehouses = next.selectedWarehouses.filter((id) => id !== warehouseId);
    delete next.warehouseCosts[warehouseId];
    disabled.push(label);
  }

  for (const warehouse of item.enableWarehouses) {
    const warehouseId = ensureWarehouseOption(next, warehouse.warehouseName);
    if (!next.selectedWarehouses.includes(warehouseId)) {
      next.selectedWarehouses.push(warehouseId);
    }
    next.warehouseCosts[warehouseId] = formatManualDecimal(warehouse.deliveryToWbPerUnit);
  }

  return {
    manualFields: next,
    changed: {
      disabled,
      enabled: item.enableWarehouses,
      unitEconomicsDeliveryToWb: computeDeliveryToWb(next),
    },
  };
}

async function loadManualRows(
  tx: DrizzleTransaction,
  tenantId: string,
  nmIds: number[],
) {
  const rows = await tx
    .select({
      nmId: unitEconomicsManualInputs.nmId,
      manualFields: unitEconomicsManualInputs.manualFields,
      updatedAt: unitEconomicsManualInputs.updatedAt,
    })
    .from(unitEconomicsManualInputs)
    .where(and(
      eq(unitEconomicsManualInputs.tenantId, tenantId),
      inArray(unitEconomicsManualInputs.nmId, nmIds),
    ));

  return new Map(rows.map((row) => [Number(row.nmId), row]));
}

async function loadProductRows(
  tx: DrizzleTransaction,
  tenantId: string,
  nmIds: number[],
) {
  const rows = await tx
    .select({
      nmId: products.nmId,
      vendorCode: products.vendorCode,
    })
    .from(products)
    .where(and(
      eq(products.tenantId, tenantId),
      inArray(products.nmId, nmIds),
    ));

  return new Map(rows.map((row) => [Number(row.nmId), row]));
}

function buildWarehouseConfigItem(
  nmId: number,
  vendorCode: string | null,
  manualPayload: unknown,
  updatedAt: Date | null,
): WarehouseConfigItem {
  const manualFields = parseManualFieldsFromUnknown(manualPayload);
  const options = getWarehouseOptions(manualFields);
  const warehouses = Array.from(options.entries()).map(([warehouseId, warehouseName]) => {
    const enabled = manualFields.selectedWarehouses.includes(warehouseId);
    return {
      warehouseId,
      warehouseName,
      enabled,
      deliveryToWbPerUnit: enabled ? toNumber(manualFields.warehouseCosts[warehouseId]) : null,
    };
  });

  return {
    nmId,
    vendorCode,
    warehouses,
    unitEconomicsDeliveryToWbMode: 'average_enabled_warehouses',
    unitEconomicsDeliveryToWb: computeDeliveryToWb(manualFields),
    localityIndexPercent: toNumber(manualFields.localityIndexPercent),
    irpPercent: toNumber(manualFields.irpPercent),
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}

function normalizeNmIds(params: AgentReportParams | undefined) {
  return Array.from(new Set(
    [...(params?.nmIds ?? []), params?.nmId ?? 0]
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.trunc(value)),
  ));
}

export async function buildCostWarehouseDeliveryConfigReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  if (!tenantId) {
    throw new AppError('tenantId is required', 400);
  }

  const nmIds = normalizeNmIds(params);
  if (nmIds.length === 0) {
    throw new AppError('params.nmIds or params.nmId is required for cost_warehouse_delivery_config', 400);
  }

  const items = await withTenantContext(db, tenantId, async (tx) => {
    const [manualByNmId, productByNmId] = await Promise.all([
      loadManualRows(tx, tenantId, nmIds),
      loadProductRows(tx, tenantId, nmIds),
    ]);

    return nmIds.map((nmId) => {
      const manual = manualByNmId.get(nmId);
      const product = productByNmId.get(nmId);
      return buildWarehouseConfigItem(
        nmId,
        product?.vendorCode ?? null,
        manual?.manualFields ?? {},
        manual?.updatedAt ?? null,
      );
    });
  });

  return {
    report: 'cost_warehouse_delivery_config',
    tenantId,
    generatedAt: new Date().toISOString(),
    summaryText: `Настройки складов economics-v2: ${items.length} SKU.`,
    totals: {
      itemCount: items.length,
      enabledWarehouseCount: items.reduce((sum, item) =>
        sum + item.warehouses.filter((warehouse) => warehouse.enabled).length, 0),
    },
    items: items as unknown as Array<Record<string, unknown>>,
    data: {
      source: 'unit_economics_manual_inputs.manual_fields',
      itemCount: items.length,
      items,
    },
  };
}

export async function createWarehouseDeliveryApprovalRequest(
  client: AgentApiClient,
  request: ProcifryWarehouseDeliveryActionRequest,
) {
  const items = parseWarehouseDeliveryCostUpdateItems(request.payload);
  const title = items.length === 1
    ? `Заполнить склады / доставка до ВБ для ${items[0]?.nmId ?? 'SKU'}`
    : `Заполнить склады / доставка до ВБ для ${items.length} SKU`;

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
    title,
    body: 'Update enabled warehouse delivery-to-WB costs in economics-v2.',
    payload: {
      tenantId: request.tenantId,
      cabinetOid: request.cabinetOid,
      actionType: request.actionType,
      unitEconomicsDeliveryToWbMode: 'average_enabled_warehouses',
      items,
    },
    tags: ['economics-v2', 'warehouse-delivery', 'approval-required'],
    approvalId: null,
  });

  return {
    ok: true,
    actionType: request.actionType,
    approvalRequired: true,
    approvalRequestId: result.approvalRequestId,
    status: result.approvalStatus ?? 'requested',
    itemCount: items.length,
  };
}

export async function executeWarehouseDeliveryCostUpdate(
  tx: DrizzleTransaction,
  tenantId: string,
  payload: unknown,
) {
  const items = parseWarehouseDeliveryCostUpdateItems(payload);
  const nmIds = [...new Set(items.map((item) => item.nmId))];
  const manualByNmId = await loadManualRows(tx, tenantId, nmIds);
  const now = new Date();
  const appliedItems = [];

  for (const item of items) {
    const currentManual = manualByNmId.get(item.nmId)?.manualFields ?? {};
    const applied = applyWarehouseDeliveryCostUpdateToManualFields(currentManual, item);

    await tx
      .insert(unitEconomicsManualInputs)
      .values({
        tenantId,
        nmId: item.nmId,
        manualFields: applied.manualFields,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [unitEconomicsManualInputs.tenantId, unitEconomicsManualInputs.nmId],
        set: {
          manualFields: applied.manualFields,
          updatedAt: now,
        },
      });

    appliedItems.push({
      nmId: item.nmId,
      changed: applied.changed,
    });
  }

  return {
    actionType: 'warehouse_delivery_cost_update' as const,
    itemCount: appliedItems.length,
    items: appliedItems,
    single: appliedItems.length === 1 ? appliedItems[0] : null,
  };
}

export async function writeWarehouseDeliveryExecutionAudit(args: {
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
      actionType: 'warehouse_delivery_cost_update',
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

export async function loadWarehouseDeliverySourceCoverage(tenantId: string) {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      MIN(updated_at) AS "from",
      MAX(updated_at) AS "to",
      MAX(updated_at) AS "sourceUpdatedAt"
    FROM unit_economics_manual_inputs
    WHERE tenant_id = ${tenantId}
  `));
  return (rows as unknown as Array<{
    from: Date | string | null;
    to: Date | string | null;
    sourceUpdatedAt: Date | string | null;
  }>)[0] ?? null;
}
