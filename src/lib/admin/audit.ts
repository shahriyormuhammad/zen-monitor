import { db, withAdminContext } from '@/lib/db';
import { platformAuditLog } from '@/lib/db/schema';
import type { PlatformAdminRole } from '@/lib/auth/platform-admin';

type PlatformAuditEntity = {
  entityType: string;
  entityId?: string | null;
  tenantId?: string | null;
};

type PlatformAuditPayload = {
  actorUserId: string;
  actorRole: PlatformAdminRole;
  action: string;
  entity: PlatformAuditEntity;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
};

export async function recordPlatformAuditLog(payload: PlatformAuditPayload) {
  await withAdminContext(db, (tx) =>
    tx.insert(platformAuditLog).values({
      actorUserId: payload.actorUserId,
      actorRole: payload.actorRole,
      action: payload.action,
      entityType: payload.entity.entityType,
      entityId: payload.entity.entityId ?? null,
      tenantId: payload.entity.tenantId ?? null,
      before: payload.before ?? null,
      after: payload.after ?? null,
      reason: payload.reason ?? null,
    }),
  );
}

