import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiRoute } from '@/lib/api-response';
import {
  PROCIFRY_ACCESS_MODES,
  PROCIFRY_CONFIDENCE_LEVELS,
  PROCIFRY_RESOURCE_TYPES,
  PROCIFRY_WORKERS,
  requireAgentApiClient,
} from '@/lib/agent-api';
import type {
  ProcifryAccessMode,
  ProcifryConfidence,
  ProcifryResourceType,
  ProcifryWorkerId,
} from '@/lib/agent-api';
import { parseRequestBody, parseRequestQuery } from '@/lib/api-parse';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';
import {
  createProcifryRecord,
  listProcifryRecords,
  serializeProcifryResult,
} from '@/server/agent/procifry';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const workerSchema = z.enum(PROCIFRY_WORKERS);
const resourceTypeSchema = z.enum(PROCIFRY_RESOURCE_TYPES);
const accessModeSchema = z.enum(PROCIFRY_ACCESS_MODES);
const confidenceSchema = z.enum(PROCIFRY_CONFIDENCE_LEVELS);
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
  access_mode: accessModeSchema.optional(),
  accessMode: accessModeSchema.optional(),
  status: accessModeSchema.optional(),
  resource_type: resourceTypeSchema.optional(),
  resourceType: resourceTypeSchema.optional(),
  action_type: z.string().trim().min(1).max(120).optional().nullable(),
  actionType: z.string().trim().min(1).max(120).optional().nullable(),
  title: z.string().trim().max(255).optional().nullable(),
  body: z.string().trim().max(20_000).optional().nullable(),
  payload: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  approval_id: uuidSchema.optional().nullable(),
  approvalId: uuidSchema.optional().nullable(),
  multi_tenant: z.boolean().optional(),
  multiTenant: z.boolean().optional(),
});

const querySchema = z.object({
  worker_id: workerSchema.optional(),
  workerId: workerSchema.optional(),
  tenant_id: uuidSchema.optional(),
  tenantId: uuidSchema.optional(),
  cabinet_oid: z.string().trim().min(1).max(120).optional(),
  cabinetOid: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(['artifacts', 'approvals', 'audit']).optional(),
  resource_type: resourceTypeSchema.optional(),
  resourceType: resourceTypeSchema.optional(),
  status: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
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
  const resourceType = requireValue(raw.resource_type ?? raw.resourceType, 'resource_type') as ProcifryResourceType;
  const accessMode = requireValue(raw.access_mode ?? raw.accessMode ?? raw.status, 'access_mode') as ProcifryAccessMode;
  const title = raw.title?.trim() || `${resourceType} from ${workerId}`;

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
    accessMode,
    resourceType,
    actionType: raw.action_type ?? raw.actionType ?? null,
    title,
    body: raw.body?.trim() || null,
    payload: raw.payload ?? {},
    tags: raw.tags ?? [],
    approvalId: raw.approval_id ?? raw.approvalId ?? null,
  };
}

function normalizeQuery(raw: z.infer<typeof querySchema>) {
  return {
    workerId: requireValue(raw.worker_id ?? raw.workerId, 'worker_id') as ProcifryWorkerId,
    tenantId: requireValue(raw.tenant_id ?? raw.tenantId, 'tenant_id'),
    cabinetOid: requireValue(raw.cabinet_oid ?? raw.cabinetOid, 'cabinet_oid'),
    kind: raw.kind ?? 'artifacts',
    resourceType: (raw.resource_type ?? raw.resourceType ?? null) as ProcifryResourceType | null,
    status: raw.status ?? null,
    limit: raw.limit ?? 50,
  };
}

export const POST = withRateLimit(apiRoute(async (request: Request) => {
  const client = requireAgentApiClient(request);
  const raw = await parseRequestBody(request, bodySchema);
  const payload = normalizeBody(raw);

  const result = await createProcifryRecord(client, payload);

  logger.info({
    clientId: client.id,
    workerId: payload.workerId,
    tenantId: payload.tenantId,
    tenantIds: payload.tenantIds,
    cabinetOid: payload.cabinetOid,
    resourceType: payload.resourceType,
    accessMode: payload.accessMode,
    auditId: result.auditId,
  }, '[agent-api] procifry record accepted');

  return NextResponse.json({
    ok: true,
    clientId: client.id,
    ...result,
  });
}), { per: 'ip', limit: 180, window: 60 });

export const GET = withRateLimit(apiRoute(async (request: Request) => {
  const client = requireAgentApiClient(request);
  const raw = parseRequestQuery(request, querySchema);
  const query = normalizeQuery(raw);

  const result = await listProcifryRecords(client, query);

  logger.info({
    clientId: client.id,
    workerId: query.workerId,
    tenantId: query.tenantId,
    cabinetOid: query.cabinetOid,
    kind: query.kind,
  }, '[agent-api] procifry records read');

  return NextResponse.json({
    ok: true,
    clientId: client.id,
    ...serializeProcifryResult(result),
  });
}), { per: 'ip', limit: 180, window: 60 });
