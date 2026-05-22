import { and, eq } from 'drizzle-orm';

import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import {
  PLATFORM_IMPERSONATION_TTL_SECONDS,
  clearPlatformImpersonationCookie,
  getActivePlatformImpersonationSessionForUser,
  setPlatformImpersonationCookie,
} from '@/lib/auth/platform-impersonation-session';
import { clearActiveTenantCookie, setActiveTenantCookie } from '@/lib/auth/tenant-access';
import { db, withAdminContext } from '@/lib/db';
import { platformAuditLog, platformImpersonationSessions, tenants } from '@/lib/db/schema';
import { AppError } from '@/lib/errors';

const ALLOWED_REASONS = new Set([
  'support_debug',
  'onboarding_help',
  'billing_support',
  'incident_review',
  'owner_request',
]);

export function normalizeImpersonationReason(reason: unknown) {
  const normalized = typeof reason === 'string' ? reason.trim() : '';
  return ALLOWED_REASONS.has(normalized) ? normalized : 'support_debug';
}

export function normalizeImpersonationNote(note: unknown) {
  const normalized = typeof note === 'string' ? note.trim() : '';
  return normalized.length > 0 ? normalized.slice(0, 1000) : null;
}

export async function beginPlatformImpersonation(input: {
  tenantId: string;
  reason: string;
  note?: string | null;
}) {
  const admin = await requirePlatformAdmin(['owner', 'support', 'ops']);
  const reason = normalizeImpersonationReason(input.reason);
  const note = normalizeImpersonationNote(input.note);
  const expiresAt = new Date(Date.now() + PLATFORM_IMPERSONATION_TTL_SECONDS * 1000);

  const session = await withAdminContext(db, async (tx) => {
    const tenant = await tx.query.tenants.findFirst({
      where: eq(tenants.id, input.tenantId),
    });

    if (!tenant) {
      throw new AppError('Клиентский кабинет не найден', 404);
    }

    await tx
      .update(platformImpersonationSessions)
      .set({ status: 'ended', endedAt: new Date() })
      .where(and(
        eq(platformImpersonationSessions.actorUserId, admin.user.id),
        eq(platformImpersonationSessions.status, 'active'),
      ));

    const [created] = await tx
      .insert(platformImpersonationSessions)
      .values({
        actorUserId: admin.user.id,
        actorRole: admin.role,
        tenantId: input.tenantId,
        reason,
        note,
        expiresAt,
      })
      .returning({
        id: platformImpersonationSessions.id,
        tenantId: platformImpersonationSessions.tenantId,
        reason: platformImpersonationSessions.reason,
        note: platformImpersonationSessions.note,
        startedAt: platformImpersonationSessions.startedAt,
        expiresAt: platformImpersonationSessions.expiresAt,
      });

    if (!created) {
      throw new AppError('Не удалось создать сессию просмотра клиента', 500);
    }

    await tx.insert(platformAuditLog).values({
      actorUserId: admin.user.id,
      actorRole: admin.role,
      action: 'platform.impersonation.start',
      entityType: 'platform_impersonation_session',
      entityId: created.id,
      tenantId: input.tenantId,
      before: null,
      after: {
        sessionId: created.id,
        tenantId: created.tenantId,
        reason: created.reason,
        note: created.note,
        startedAt: created.startedAt,
        expiresAt: created.expiresAt,
      },
      reason: note ? `${reason}: ${note}` : reason,
    });

    return created;
  });

  await setPlatformImpersonationCookie(session.id);
  await setActiveTenantCookie(session.tenantId);

  return session;
}

export async function endPlatformImpersonation() {
  const admin = await requirePlatformAdmin();
  const session = await getActivePlatformImpersonationSessionForUser(admin.user.id);

  if (!session) {
    await clearPlatformImpersonationCookie();
    await clearActiveTenantCookie();
    return null;
  }

  await withAdminContext(db, async (tx) => {
    await tx
      .update(platformImpersonationSessions)
      .set({ status: 'ended', endedAt: new Date() })
      .where(eq(platformImpersonationSessions.id, session.id));

    await tx.insert(platformAuditLog).values({
      actorUserId: admin.user.id,
      actorRole: admin.role,
      action: 'platform.impersonation.stop',
      entityType: 'platform_impersonation_session',
      entityId: session.id,
      tenantId: session.tenantId,
      before: {
        sessionId: session.id,
        status: session.status,
        reason: session.reason,
      },
      after: {
        sessionId: session.id,
        status: 'ended',
      },
      reason: 'manual_stop',
    });
  });

  await clearPlatformImpersonationCookie();
  await clearActiveTenantCookie();

  return session;
}
