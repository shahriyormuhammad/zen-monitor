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
  createUnitEconomicsIndicesApprovalRequest,
  PROCIFRY_UNIT_ECONOMICS_INDICES_ACTION_TYPES,
  type ProcifryUnitEconomicsIndicesActionType,
} from '@/server/agent/procifry-unit-economics-indices';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const workerSchema = z.enum(PROCIFRY_WORKERS);
const confidenceSchema = z.enum(PROCIFRY_CONFIDENCE_LEVELS);
const actionTypeSchema = z.enum(PROCIFRY_UNIT_ECONOMICS_INDICES_ACTION_TYPES);
const uuidSchema = z.string().uuid();
const percentInputSchema = z.union([z.number(), z.string().trim().min(1)]);

const valuesSchema = z.object({
  localityIndexPercent: percentInputSchema.optional(),
  localizationIndex: percentInputSchema.optional(),
  irpPercent: percentInputSchema.optional(),
  salesDistributionIndex: percentInputSchema.optional(),
});

const itemSchema = z.object({
  nmId: z.number().int().positive(),
  localityIndexPercent: percentInputSchema.optional(),
  localizationIndex: percentInputSchema.optional(),
  irpPercent: percentInputSchema.optional(),
  salesDistributionIndex: percentInputSchema.optional(),
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
  scope: z.string().trim().min(1).max(120).optional(),
  values: valuesSchema.optional(),
  nmId: z.number().int().positive().optional(),
  localityIndexPercent: percentInputSchema.optional(),
  localizationIndex: percentInputSchema.optional(),
  irpPercent: percentInputSchema.optional(),
  salesDistributionIndex: percentInputSchema.optional(),
  items: z.array(itemSchema).max(5000).optional(),
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
    scope: raw.scope,
    values: raw.values,
    nmId: raw.nmId,
    localityIndexPercent: raw.localityIndexPercent,
    localizationIndex: raw.localizationIndex,
    irpPercent: raw.irpPercent,
    salesDistributionIndex: raw.salesDistributionIndex,
    items: raw.items,
  };
}

function sourceFrom(raw: z.infer<typeof bodySchema>, payload: Record<string, unknown>) {
  if (raw.source?.trim()) return raw.source.trim();
  const values = payload.values;
  if (values && typeof values === 'object' && !Array.isArray(values)) {
    const source = (values as Record<string, unknown>).source;
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
    actionType: (raw.action_type ?? raw.actionType ?? 'unit_economics_indices_update') as ProcifryUnitEconomicsIndicesActionType,
    payload,
  };
}

export const POST = withRateLimit(apiRoute(async (request: Request) => {
  const client = requireAgentApiClient(request);
  const raw = await parseRequestBody(request, bodySchema);
  const payload = normalizeBody(raw, client.workerId);
  const result = await createUnitEconomicsIndicesApprovalRequest(client, payload);

  return NextResponse.json({
    clientId: client.id,
    ...result,
  });
}), { per: 'ip', limit: 120, window: 60 });
