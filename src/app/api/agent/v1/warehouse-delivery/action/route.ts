import { NextResponse } from 'next/server';
import { z } from 'zod';

import { parseRequestBody } from '@/lib/api-parse';
import { apiRoute } from '@/lib/api-response';
import {
  PROCIFRY_CONFIDENCE_LEVELS,
  PROCIFRY_WORKERS,
  requireAgentApiClient,
  type ProcifryConfidence,
  type ProcifryWorkerId,
} from '@/lib/agent-api';
import { AppError } from '@/lib/errors';
import { withRateLimit } from '@/lib/rate-limit';
import {
  createWarehouseDeliveryApprovalRequest,
  PROCIFRY_WAREHOUSE_DELIVERY_ACTION_TYPES,
  type ProcifryWarehouseDeliveryActionType,
} from '@/server/agent/procifry-warehouse-delivery';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const workerSchema = z.enum(PROCIFRY_WORKERS);
const confidenceSchema = z.enum(PROCIFRY_CONFIDENCE_LEVELS);
const actionTypeSchema = z.enum(PROCIFRY_WAREHOUSE_DELIVERY_ACTION_TYPES);
const uuidSchema = z.string().uuid();

const warehouseSchema = z.object({
  warehouseName: z.string().trim().min(1).max(255),
  deliveryToWbPerUnit: z.number().min(0),
});

const itemSchema = z.object({
  nmId: z.number().int().positive(),
  unitsPerBox: z.number().positive().optional(),
  disableWarehouses: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
  enableWarehouses: z.array(warehouseSchema).max(50).optional(),
  warehouses: z.array(warehouseSchema).max(50).optional(),
  unitEconomicsDeliveryToWbMode: z.literal('average_enabled_warehouses').optional(),
  calculation: z.record(z.string(), z.unknown()).optional(),
});

const bodySchema = z.object({
  worker_id: workerSchema.optional(),
  workerId: workerSchema.optional(),
  tenant_id: uuidSchema.optional(),
  tenantId: uuidSchema.optional(),
  tenant_ids: z.array(uuidSchema).max(20).optional(),
  tenantIds: z.array(uuidSchema).max(20).optional(),
  cabinet_oid: z.string().trim().min(1).max(120).optional(),
  cabinetOid: z.string().trim().min(1).max(120).optional(),
  period_from: z.string().trim().min(1).optional(),
  periodFrom: z.string().trim().min(1).optional(),
  period_to: z.string().trim().min(1).optional(),
  periodTo: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).max(255).optional(),
  source_updated_at: z.string().trim().min(1).optional(),
  sourceUpdatedAt: z.string().trim().min(1).optional(),
  confidence: confidenceSchema.optional(),
  action_type: actionTypeSchema.optional(),
  actionType: actionTypeSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  multi_tenant: z.boolean().optional(),
  multiTenant: z.boolean().optional(),
  nmId: z.number().int().positive().optional(),
  disableWarehouses: z.array(z.string().trim().min(1).max(255)).max(50).optional(),
  enableWarehouses: z.array(warehouseSchema).max(50).optional(),
  unitEconomicsDeliveryToWbMode: z.literal('average_enabled_warehouses').optional(),
  calculation: z.record(z.string(), z.unknown()).optional(),
  items: z.array(itemSchema).max(500).optional(),
});

function requireValue<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined || value === '') {
    throw new AppError(`${field} is required`, 400);
  }
  return value;
}

function parseDateOrNow(value: string | undefined) {
  if (!value?.trim()) {
    return new Date();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('date/time fields must be valid', 400);
  }
  return date;
}

function buildActionPayload(raw: z.infer<typeof bodySchema>) {
  if (raw.payload) {
    return raw.payload;
  }

  return {
    tenantId: raw.tenant_id ?? raw.tenantId,
    cabinetOid: raw.cabinet_oid ?? raw.cabinetOid,
    nmId: raw.nmId,
    disableWarehouses: raw.disableWarehouses,
    enableWarehouses: raw.enableWarehouses,
    unitEconomicsDeliveryToWbMode: raw.unitEconomicsDeliveryToWbMode,
    calculation: raw.calculation,
    items: raw.items,
  };
}

function sourceFrom(raw: z.infer<typeof bodySchema>, payload: Record<string, unknown>) {
  if (raw.source?.trim()) return raw.source.trim();
  const calculation = payload.calculation;
  if (calculation && typeof calculation === 'object' && !Array.isArray(calculation)) {
    const source = (calculation as Record<string, unknown>).source;
    if (typeof source === 'string' && source.trim()) {
      return source.trim();
    }
  }
  return 'procifry-agent';
}

function normalizeBody(raw: z.infer<typeof bodySchema>, clientWorkerId: ProcifryWorkerId | null) {
  const workerId = requireValue(raw.worker_id ?? raw.workerId ?? clientWorkerId, 'worker_id') as ProcifryWorkerId;
  const tenantId = requireValue(raw.tenant_id ?? raw.tenantId, 'tenant_id');
  const extraTenantIds = raw.tenant_ids ?? raw.tenantIds ?? [];
  const tenantIds = [...new Set([tenantId, ...extraTenantIds])];
  const cabinetOid = requireValue(raw.cabinet_oid ?? raw.cabinetOid, 'cabinet_oid');
  const payload = buildActionPayload(raw);

  return {
    workerId,
    tenantId,
    tenantIds,
    cabinetOid,
    multiTenant: raw.multi_tenant ?? raw.multiTenant ?? false,
    periodFrom: parseDateOrNow(raw.period_from ?? raw.periodFrom),
    periodTo: parseDateOrNow(raw.period_to ?? raw.periodTo),
    source: sourceFrom(raw, payload),
    sourceUpdatedAt: parseDateOrNow(raw.source_updated_at ?? raw.sourceUpdatedAt),
    confidence: (raw.confidence ?? 'confirmed') as ProcifryConfidence,
    actionType: (raw.action_type ?? raw.actionType ?? 'warehouse_delivery_cost_update') as ProcifryWarehouseDeliveryActionType,
    payload,
  };
}

export const POST = withRateLimit(apiRoute(async (request: Request) => {
  const client = requireAgentApiClient(request);
  const raw = await parseRequestBody(request, bodySchema);
  const payload = normalizeBody(raw, client.workerId);
  const result = await createWarehouseDeliveryApprovalRequest(client, payload);

  return NextResponse.json({
    clientId: client.id,
    ...result,
  });
}), { per: 'ip', limit: 120, window: 60 });
