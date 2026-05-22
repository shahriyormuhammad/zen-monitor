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
  executeProcifryAdvertisingAction,
  PROCIFRY_ADVERTISING_ACTION_TYPES,
  type ProcifryAdvertisingActionType,
} from '@/server/agent/procifry-advertising-actions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const workerSchema = z.enum(PROCIFRY_WORKERS);
const confidenceSchema = z.enum(PROCIFRY_CONFIDENCE_LEVELS);
const actionTypeSchema = z.enum(PROCIFRY_ADVERTISING_ACTION_TYPES);
const uuidSchema = z.string().uuid();

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
  source: z.string().trim().min(1).max(120),
  source_updated_at: z.string().trim().min(1).optional(),
  sourceUpdatedAt: z.string().trim().min(1).optional(),
  confidence: confidenceSchema,
  action_type: actionTypeSchema.optional(),
  actionType: actionTypeSchema.optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  multi_tenant: z.boolean().optional(),
  multiTenant: z.boolean().optional(),
});

function requireValue<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined || value === '') {
    throw new AppError(`${field} is required`, 400);
  }
  return value;
}

function parseDate(value: string | undefined, field: string) {
  const raw = requireValue(value, field);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${field} must be a valid date/time`, 400);
  }
  return date;
}

function normalizeBody(raw: z.infer<typeof bodySchema>) {
  const workerId = requireValue(raw.worker_id ?? raw.workerId, 'worker_id') as ProcifryWorkerId;
  const tenantId = requireValue(raw.tenant_id ?? raw.tenantId, 'tenant_id');
  const extraTenantIds = raw.tenant_ids ?? raw.tenantIds ?? [];
  const tenantIds = [...new Set([tenantId, ...extraTenantIds])];
  const cabinetOid = requireValue(raw.cabinet_oid ?? raw.cabinetOid, 'cabinet_oid');

  return {
    workerId,
    tenantId,
    tenantIds,
    cabinetOid,
    multiTenant: raw.multi_tenant ?? raw.multiTenant ?? false,
    periodFrom: parseDate(raw.period_from ?? raw.periodFrom, 'period_from'),
    periodTo: parseDate(raw.period_to ?? raw.periodTo, 'period_to'),
    source: raw.source.trim(),
    sourceUpdatedAt: parseDate(raw.source_updated_at ?? raw.sourceUpdatedAt, 'source_updated_at'),
    confidence: raw.confidence as ProcifryConfidence,
    actionType: requireValue(raw.action_type ?? raw.actionType, 'action_type') as ProcifryAdvertisingActionType,
    payload: raw.payload ?? {},
  };
}

export const POST = withRateLimit(apiRoute(async (request: Request) => {
  const client = requireAgentApiClient(request);
  const raw = await parseRequestBody(request, bodySchema);
  const payload = normalizeBody(raw);
  const result = await executeProcifryAdvertisingAction(client, payload);

  return NextResponse.json({
    ok: true,
    clientId: client.id,
    actionType: payload.actionType,
    result,
  });
}), { per: 'ip', limit: 120, window: 60 });
