import { and, eq } from 'drizzle-orm';

import { db, withAdminContext } from '@/lib/db';
import { platformAdmins } from '@/lib/db/schema';
import { AppError, requireAuthenticatedUser } from '@/lib/auth/tenant-access';

export const PLATFORM_ADMIN_ROLES = ['owner', 'finance', 'support', 'ops', 'readonly'] as const;

export type PlatformAdminRole = (typeof PLATFORM_ADMIN_ROLES)[number];
type PlatformAdminAccess = typeof platformAdmins.$inferSelect;

export async function requirePlatformAdmin(
  allowedRoles: readonly PlatformAdminRole[] = PLATFORM_ADMIN_ROLES,
) {
  const user = await requireAuthenticatedUser();

  const access = await withAdminContext(db, (tx) =>
    tx.query.platformAdmins.findFirst({
      where: and(
        eq(platformAdmins.userId, user.id),
        eq(platformAdmins.status, 'active'),
      ),
    }),
  );

  if (!access) {
    throw new AppError('Platform admin access denied', 403);
  }

  const typedAccess = access as PlatformAdminAccess;
  if (!allowedRoles.includes(typedAccess.role as PlatformAdminRole)) {
    throw new AppError('Недостаточно прав platform admin для этого действия', 403);
  }

  return {
    user,
    access: typedAccess,
    role: typedAccess.role as PlatformAdminRole,
  };
}

