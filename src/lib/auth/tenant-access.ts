import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { db, withAdminContext, withTenantContext } from '@/lib/db';
import { productGroups, userTenants } from '@/lib/db/schema';
import { createClient } from '@/lib/supabase/server';
import {
  ALL_TENANT_FEATURE_PERMISSIONS,
  resolveTenantFeaturePermissions,
  userCanAccessFeature,
  type TenantFeature,
} from '@/lib/auth/feature-access';
import { resolveFeatureForPath } from '@/lib/auth/feature-routes';
import { getActivePlatformImpersonationSessionForUser } from '@/lib/auth/platform-impersonation-session';

export const ALL_TENANT_ROLES = ['owner', 'admin', 'manager', 'viewer'] as const;

export type TenantRole = (typeof ALL_TENANT_ROLES)[number];
type TenantAccess = typeof userTenants.$inferSelect;

// AppError, getErrorStatus, getErrorMessage live in src/lib/errors.ts (no DB deps).
// Imported and re-exported here for backwards compatibility.
import { AppError, getErrorMessage, getErrorStatus } from '@/lib/errors';
export { AppError, getErrorMessage, getErrorStatus };

export const ACTIVE_TENANT_COOKIE = 'active_tenant_id';
const ACTIVE_TENANT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function readActiveTenantCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACTIVE_TENANT_COOKIE)?.value ?? null;
}

export async function setActiveTenantCookie(tenantId: string) {
  const store = await cookies();
  store.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ACTIVE_TENANT_COOKIE_MAX_AGE,
  });
}

export async function clearActiveTenantCookie() {
  const store = await cookies();
  store.delete(ACTIVE_TENANT_COOKIE);
}

export async function requireAuthenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new AppError('Unauthorized', 401);
  }

  return user;
}

export async function requireTenantAccess(
  tenantId: string,
  allowedRoles: readonly TenantRole[] = ALL_TENANT_ROLES
) {
  if (!tenantId) {
    throw new AppError('Missing tenantId', 400);
  }

  const user = await requireAuthenticatedUser();
  const access = await withTenantContext(db, tenantId, (tx) =>
    tx.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, user.id), eq(userTenants.tenantId, tenantId)),
    }),
  );

  if (!access) {
    const impersonation = await getActivePlatformImpersonationSessionForUser(user.id);

    if (!impersonation || impersonation.tenantId !== tenantId) {
      throw new AppError('Access denied', 403);
    }

    const role = 'owner' satisfies TenantRole;
    if (!allowedRoles.includes(role)) {
      throw new AppError('Недостаточно прав для этого действия', 403);
    }

    return {
      user,
      access: {
        id: impersonation.id,
        userId: user.id,
        tenantId,
        role,
        accessPreset: 'all',
        featurePermissions: ALL_TENANT_FEATURE_PERMISSIONS,
        inAppSignalNotificationPrefs: {
          note: true,
          assignment: true,
          blocked: true,
        },
        createdAt: impersonation.startedAt,
        isPlatformImpersonation: true,
        platformImpersonationSessionId: impersonation.id,
        platformAdminRole: impersonation.actorRole,
      },
      tenantId,
      impersonation,
    };
  }

  const typedAccess = access as TenantAccess;

  if (!allowedRoles.includes(typedAccess.role as TenantRole)) {
    throw new AppError('Недостаточно прав для этого действия', 403);
  }

  return {
    user,
    access: {
      ...typedAccess,
      featurePermissions: resolveTenantFeaturePermissions(
        typedAccess.role,
        typedAccess.featurePermissions,
      ),
    },
    tenantId,
    impersonation: null,
  };
}

export async function requireTenantFeatureAccess(
  tenantId: string,
  feature: TenantFeature,
  allowedRoles: readonly TenantRole[] = ALL_TENANT_ROLES,
) {
  const accessContext = await requireTenantAccess(tenantId, allowedRoles);

  if (!userCanAccessFeature(
    accessContext.access.role,
    accessContext.access.featurePermissions,
    feature,
  )) {
    throw new AppError('Нет доступа к этому разделу', 403);
  }

  return accessContext;
}

/**
 * Resolve active tenant for a request from the `active_tenant_id` HttpOnly cookie.
 * Membership is always validated via `requireTenantAccess`, so forging the
 * cookie grants no extra access.
 *
 * The `request` parameter is preserved for API compatibility even though we no
 * longer read query params from it.
 */
export async function requireActiveTenant(
  request: Request,
  allowedRoles: readonly TenantRole[] = ALL_TENANT_ROLES
) {
  const tenantId = (await readActiveTenantCookie()) ?? '';
  const accessContext = await requireTenantAccess(tenantId, allowedRoles);
  const feature = resolveFeatureForPath(new URL(request.url).pathname);

  if (
    feature
    && !userCanAccessFeature(
      accessContext.access.role,
      accessContext.access.featurePermissions,
      feature,
    )
  ) {
    throw new AppError('Нет доступа к этому разделу', 403);
  }

  return accessContext;
}

export async function requireNonImpersonatedMutation() {
  const user = await requireAuthenticatedUser();
  const impersonation = await getActivePlatformImpersonationSessionForUser(user.id);
  return { user, impersonation };
}

export async function requireActiveTenantFeature(
  _request: Request,
  feature: TenantFeature,
  allowedRoles: readonly TenantRole[] = ALL_TENANT_ROLES,
) {
  const tenantId = (await readActiveTenantCookie()) ?? '';
  return requireTenantFeatureAccess(tenantId, feature, allowedRoles);
}

// Validates that a body-supplied tenantId matches the active_tenant_id cookie.
// Ancillary middleware (rate-limit, idempotency) keys off the cookie, so a body/cookie
// mismatch would scope side-effects to one tenant while mutation hits another.
export async function requireTenantMatchesActive(
  bodyTenantId: string,
  allowedRoles: readonly TenantRole[] = ALL_TENANT_ROLES
) {
  const cookieTenantId = await readActiveTenantCookie();
  if (!cookieTenantId || cookieTenantId !== bodyTenantId) {
    throw new AppError('Активный кабинет не совпадает с телом запроса', 400);
  }
  return requireTenantAccess(bodyTenantId, allowedRoles);
}

export async function requireGroupAccess(
  groupId: string,
  allowedRoles: readonly TenantRole[] = ALL_TENANT_ROLES
) {
  if (!groupId) {
    throw new AppError('Missing groupId', 400);
  }

  // Admin lookup: groupId is not tied to a tenantId at this point — we must
  // resolve group.tenantId first, then requireTenantAccess will re-validate
  // membership under a proper tenant context.
  const group = await withAdminContext(db, (tx) =>
    tx.query.productGroups.findFirst({
      where: eq(productGroups.id, groupId),
    }),
  );

  if (!group) {
    throw new AppError('Group not found', 404);
  }

  const tenantAccess = await requireTenantAccess(group.tenantId, allowedRoles);

  return {
    ...tenantAccess,
    group,
  };
}
