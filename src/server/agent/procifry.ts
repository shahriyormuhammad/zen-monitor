import { and, desc, eq, sql } from 'drizzle-orm';

import type {
  AgentApiClient,
  ProcifryAccessMode,
  ProcifryConfidence,
  ProcifryResourceType,
  ProcifryWorkerId,
} from '@/lib/agent-api';
import { assertProcifryClientAccess } from '@/lib/agent-api';
import { db, withTenantContext } from '@/lib/db';
import {
  procifryAgentAuditLog,
  procifryApprovalRequests,
  procifryWorkerArtifacts,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';

export type ProcifryWriteRequest = {
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
  accessMode: ProcifryAccessMode;
  resourceType: ProcifryResourceType;
  actionType: string | null;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  tags: string[];
  approvalId: string | null;
};

export type ProcifryListRequest = {
  workerId: ProcifryWorkerId;
  tenantId: string;
  cabinetOid: string;
  kind: 'artifacts' | 'approvals' | 'audit';
  resourceType?: ProcifryResourceType | null;
  status?: string | null;
  limit: number;
};

export type ProcifryCreateResult = {
  auditId: string;
  artifactId: string | null;
  approvalRequestId: string | null;
  approvalStatus: string | null;
  accessMode: ProcifryAccessMode;
  resourceType: ProcifryResourceType;
};

function assertDateOrder(periodFrom: Date, periodTo: Date) {
  if (periodFrom.getTime() > periodTo.getTime()) {
    throw new AppError('period_from must be <= period_to', 400);
  }
}

function toIsoOrNull(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function normalizeTags(tags: string[]) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 50);
}

export async function createProcifryRecord(
  client: AgentApiClient,
  request: ProcifryWriteRequest,
): Promise<ProcifryCreateResult> {
  const requestedTenantIds = request.tenantIds.length > 0
    ? [...new Set(request.tenantIds)]
    : [request.tenantId];

  assertDateOrder(request.periodFrom, request.periodTo);
  assertProcifryClientAccess(client, {
    workerId: request.workerId,
    tenantIds: requestedTenantIds,
    cabinetOid: request.cabinetOid,
    multiTenant: request.multiTenant,
    resourceType: request.resourceType,
    accessMode: request.accessMode,
    actionType: request.actionType,
    approvalId: request.approvalId,
  });

  const primaryTenantId = request.tenantId;
  const tags = normalizeTags(request.tags);
  const requestPayload = {
    tenantIds: requestedTenantIds,
    title: request.title,
    body: request.body,
    payload: request.payload,
    tags,
  };

  return withTenantContext(db, primaryTenantId, async (tx) => {
    let approvalRequestId = request.approvalId;
    let artifactId: string | null = null;
    let approvalStatus: string | null = null;

    if (request.resourceType === 'external_action') {
      const [approval] = await tx
        .select({
          id: procifryApprovalRequests.id,
          status: procifryApprovalRequests.status,
          actionType: procifryApprovalRequests.actionType,
        })
        .from(procifryApprovalRequests)
        .where(and(
          eq(procifryApprovalRequests.tenantId, primaryTenantId),
          eq(procifryApprovalRequests.id, request.approvalId ?? ''),
        ))
        .limit(1);

      if (!approval) {
        throw new AppError('Approval request not found', 404);
      }
      if (approval.status !== 'approved') {
        throw new AppError('Approval request is not approved', 409);
      }
      if (request.actionType && approval.actionType !== request.actionType) {
        throw new AppError('approval_id action_type does not match request action_type', 400);
      }

      approvalStatus = approval.status;
    }

    if (request.resourceType === 'approval_request') {
      const [approval] = await tx
        .insert(procifryApprovalRequests)
        .values({
          tenantId: primaryTenantId,
          workerId: request.workerId,
          clientId: client.id,
          cabinetOid: request.cabinetOid,
          actionType: request.actionType ?? 'unknown',
          title: request.title,
          description: request.body,
          payload: request.payload,
          source: request.source,
          sourceUpdatedAt: request.sourceUpdatedAt,
          periodFrom: request.periodFrom,
          periodTo: request.periodTo,
          confidence: request.confidence,
          status: 'requested',
        })
        .returning({ id: procifryApprovalRequests.id, status: procifryApprovalRequests.status });

      if (!approval) {
        throw new AppError('Failed to create approval request', 500);
      }
      approvalRequestId = approval.id;
      approvalStatus = approval.status;
    }

    if (request.resourceType !== 'read_request') {
      const [artifact] = await tx
        .insert(procifryWorkerArtifacts)
        .values({
          tenantId: primaryTenantId,
          workerId: request.workerId,
          clientId: client.id,
          cabinetOid: request.cabinetOid,
          artifactType: request.resourceType,
          actionType: request.actionType,
          accessMode: request.accessMode,
          title: request.title,
          body: request.body,
          payload: request.payload,
          tags,
          source: request.source,
          sourceUpdatedAt: request.sourceUpdatedAt,
          periodFrom: request.periodFrom,
          periodTo: request.periodTo,
          confidence: request.confidence,
          approvalRequestId,
        })
        .returning({ id: procifryWorkerArtifacts.id });
      if (!artifact) {
        throw new AppError('Failed to create Procifry artifact', 500);
      }
      artifactId = artifact.id;
    }

    if (request.resourceType === 'external_action') {
      await tx
        .update(procifryApprovalRequests)
        .set({
          status: 'executed',
          executedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(procifryApprovalRequests.tenantId, primaryTenantId),
          eq(procifryApprovalRequests.id, approvalRequestId ?? ''),
        ));
      approvalStatus = 'executed';
    }

    const [audit] = await tx
      .insert(procifryAgentAuditLog)
      .values({
        tenantId: primaryTenantId,
        tenantIds: requestedTenantIds,
        multiTenant: request.multiTenant,
        workerId: request.workerId,
        clientId: client.id,
        cabinetOid: request.cabinetOid,
        periodFrom: request.periodFrom,
        periodTo: request.periodTo,
        source: request.source,
        sourceUpdatedAt: request.sourceUpdatedAt,
        confidence: request.confidence,
        accessMode: request.accessMode,
        resourceType: request.resourceType,
        actionType: request.actionType,
        outcome: 'accepted',
        artifactId,
        approvalRequestId,
        requestPayload,
        responsePayload: {
          artifactId,
          approvalRequestId,
          approvalStatus,
        },
      })
      .returning({ id: procifryAgentAuditLog.id });

    if (!audit) {
      throw new AppError('Failed to create Procifry audit row', 500);
    }

    return {
      auditId: audit.id,
      artifactId,
      approvalRequestId,
      approvalStatus,
      accessMode: request.accessMode,
      resourceType: request.resourceType,
    };
  });
}

export async function listProcifryRecords(
  client: AgentApiClient,
  request: ProcifryListRequest,
) {
  assertProcifryClientAccess(client, {
    workerId: request.workerId,
    tenantIds: [request.tenantId],
    cabinetOid: request.cabinetOid,
    multiTenant: false,
    resourceType: 'read_request',
    accessMode: 'read_only',
  });

  return withTenantContext(db, request.tenantId, async (tx) => {
    if (request.kind === 'approvals') {
      const conditions = [
        eq(procifryApprovalRequests.tenantId, request.tenantId),
        eq(procifryApprovalRequests.cabinetOid, request.cabinetOid),
      ];
      if (request.status) {
        conditions.push(eq(procifryApprovalRequests.status, request.status));
      }

      const rows = await tx
        .select()
        .from(procifryApprovalRequests)
        .where(and(...conditions))
        .orderBy(desc(procifryApprovalRequests.createdAt))
        .limit(request.limit);

      return { kind: request.kind, items: rows };
    }

    if (request.kind === 'audit') {
      const conditions = [
        eq(procifryAgentAuditLog.tenantId, request.tenantId),
        eq(procifryAgentAuditLog.cabinetOid, request.cabinetOid),
      ];
      if (request.resourceType) {
        conditions.push(eq(procifryAgentAuditLog.resourceType, request.resourceType));
      }

      const rows = await tx
        .select()
        .from(procifryAgentAuditLog)
        .where(and(...conditions))
        .orderBy(desc(procifryAgentAuditLog.createdAt))
        .limit(request.limit);

      return { kind: request.kind, items: rows };
    }

    const conditions = [
      eq(procifryWorkerArtifacts.tenantId, request.tenantId),
      eq(procifryWorkerArtifacts.cabinetOid, request.cabinetOid),
    ];
    if (request.resourceType) {
      conditions.push(eq(procifryWorkerArtifacts.artifactType, request.resourceType));
    }
    if (request.status) {
      conditions.push(sql`${procifryWorkerArtifacts.accessMode} = ${request.status}`);
    }

    const rows = await tx
      .select()
      .from(procifryWorkerArtifacts)
      .where(and(...conditions))
      .orderBy(desc(procifryWorkerArtifacts.createdAt))
      .limit(request.limit);

    return { kind: request.kind, items: rows };
  });
}

export function serializeProcifryResult<T extends Record<string, unknown>>(result: T) {
  return JSON.parse(JSON.stringify(result, (_key, value) => {
    if (value instanceof Date) {
      return toIsoOrNull(value);
    }
    return value;
  })) as T;
}
