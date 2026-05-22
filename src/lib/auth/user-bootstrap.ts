import { and, asc, eq } from 'drizzle-orm';

import { db, withAdminContext } from '@/lib/db';
import { userTenants, users } from '@/lib/db/schema';
import type { UserRole } from '@/store/useStore';
import {
  resolveTenantFeaturePermissions,
  type TenantFeaturePermissions,
} from '@/lib/auth/feature-access';

export interface UserBootstrapState {
  tenantId: string | null;
  role: UserRole | null;
  featurePermissions: TenantFeaturePermissions | null;
  needsTenantSetup: boolean;
}

export async function ensureLocalUserProfile(userId: string, email?: string | null) {
  const existing = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (existing) {
    if (email && existing.email !== email) {
      await db.update(users)
        .set({ email })
        .where(eq(users.id, userId));

      return db.query.users.findFirst({
        where: eq(users.id, userId),
      });
    }

    return existing;
  }

  await db.insert(users).values({
    id: userId,
    email: email ?? null,
  }).onConflictDoNothing();

  return db.query.users.findFirst({
    where: eq(users.id, userId),
  });
}

export async function syncActiveTenantForUser(userId: string, email?: string | null): Promise<UserBootstrapState> {
  const profile = await ensureLocalUserProfile(userId, email);
  // Admin-path: listing user_tenants by user_id is inherently cross-tenant
  // (we do not yet know which tenant the user lives in).
  const memberships = await withAdminContext(db, (tx) =>
    tx.select()
      .from(userTenants)
      .where(eq(userTenants.userId, userId))
      .orderBy(asc(userTenants.createdAt))
      .limit(1),
  );

  const firstMembership = memberships[0];

  if (!firstMembership) {
    if (profile?.tenantId) {
      await db.update(users)
        .set({ tenantId: null, role: 'viewer' })
        .where(eq(users.id, userId));
    }

    return {
      tenantId: null,
      role: null,
      featurePermissions: null,
      needsTenantSetup: true,
    };
  }

  const preferredTenantId = profile?.tenantId ?? firstMembership.tenantId;
  const activeAccess = await withAdminContext(db, (tx) =>
    tx.query.userTenants.findFirst({
      where: and(eq(userTenants.userId, userId), eq(userTenants.tenantId, preferredTenantId)),
    }),
  );

  const resolvedAccess = activeAccess ?? firstMembership;

  if (!profile || profile.tenantId !== resolvedAccess.tenantId || profile.role !== resolvedAccess.role) {
    await db.update(users)
      .set({
        tenantId: resolvedAccess.tenantId,
        role: resolvedAccess.role,
      })
      .where(eq(users.id, userId));
  }

  return {
    tenantId: resolvedAccess.tenantId,
    role: resolvedAccess.role as UserRole,
    featurePermissions: resolveTenantFeaturePermissions(
      resolvedAccess.role,
      resolvedAccess.featurePermissions,
    ),
    needsTenantSetup: false,
  };
}
