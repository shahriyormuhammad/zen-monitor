'use server';

import { db, withAdminContext, withTenantContext } from '@/lib/db';
import { invitations, tenants, userTenants, users } from '@/lib/db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { addDays } from 'date-fns';
import { AppError, requireAuthenticatedUser, requireTenantAccess } from '@/lib/auth/tenant-access';
import { ensureLocalUserProfile } from '@/lib/auth/user-bootstrap';
import { z } from 'zod';
import {
  permissionsForPreset,
  resolveTenantFeaturePermissions,
  TENANT_ACCESS_PRESETS,
  type TenantAccessPreset,
  type TenantFeaturePermissions,
} from '@/lib/auth/feature-access';

const teamRoles = ['admin', 'manager', 'viewer'] as const;
const accessPresets = Object.keys(TENANT_ACCESS_PRESETS) as [TenantAccessPreset, ...TenantAccessPreset[]];

const inviteInputSchema = z.object({
  email: z.string().trim().toLowerCase().email('Введите корректный email коллеги'),
  role: z.enum(teamRoles),
  accessPreset: z.enum(accessPresets).default('viewer'),
  featurePermissions: z.record(z.string(), z.boolean()).optional(),
});

const accessInputSchema = z.object({
  role: z.enum(teamRoles),
  accessPreset: z.enum(accessPresets).default('viewer'),
  featurePermissions: z.record(z.string(), z.boolean()).optional(),
});

function normalizeAccessInput(input: z.infer<typeof accessInputSchema>) {
  if (input.role === 'admin') {
    return {
      role: 'admin' as const,
      accessPreset: 'all' as TenantAccessPreset,
      featurePermissions: {},
      resolvedPermissions: resolveTenantFeaturePermissions('admin', {}),
    };
  }

  const accessPreset = input.accessPreset === 'all' ? 'custom' : input.accessPreset;
  const featurePermissions = accessPreset === 'custom'
    ? resolveTenantFeaturePermissions(input.role, input.featurePermissions ?? {})
    : permissionsForPreset(accessPreset);

  return {
    role: input.role,
    accessPreset,
    featurePermissions,
    resolvedPermissions: resolveTenantFeaturePermissions(input.role, featurePermissions),
  };
}

/**
 * Пригласить пользователя в кабинет
 */
export async function inviteMember(
  tenantId: string,
  email: string,
  role: 'admin' | 'manager' | 'viewer',
  accessPreset: TenantAccessPreset = 'viewer',
  featurePermissions?: Partial<TenantFeaturePermissions>,
) {
  const { user } = await requireTenantAccess(tenantId, ['owner', 'admin']);
  const parsed = inviteInputSchema.safeParse({ email, role, accessPreset, featurePermissions });

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Некорректные данные приглашения', 400);
  }

  if (user.email && parsed.data.email === user.email.toLowerCase()) {
    throw new AppError('Нельзя отправить приглашение на собственный email', 400);
  }

  const normalizedAccess = normalizeAccessInput(parsed.data);

  const token = crypto.randomUUID();
  const expiresAt = addDays(new Date(), 2); // 48 часов

  await withTenantContext(db, tenantId, (tx) =>
    tx.insert(invitations).values({
      tenantId,
      email: parsed.data.email,
      role: normalizedAccess.role,
      accessPreset: normalizedAccess.accessPreset,
      featurePermissions: normalizedAccess.featurePermissions,
      token,
      invitedBy: user.id,
      expiresAt
    }).onConflictDoUpdate({
      target: [invitations.email, invitations.tenantId],
      set: {
        token,
        role: normalizedAccess.role,
        accessPreset: normalizedAccess.accessPreset,
        featurePermissions: normalizedAccess.featurePermissions,
        expiresAt,
        status: 'pending'
      }
    }),
  );

  revalidatePath(`/cabinets/${tenantId}/team`);
  return { success: true, token };
}

/**
 * Получить список участников и активных инвайтов для кабинета
 */
export async function getTeamData(tenantId: string) {
  const { user, access } = await requireTenantAccess(tenantId);

  const [tenant] = await db.select({
    id: tenants.id,
    name: tenants.name,
    shopName: tenants.shopName,
  })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  // Активные участники + pending invitations — оба под RLS, читаем в одной
  // транзакции под SET LOCAL app.tenant_id.
  const [collaborators, pendingInvites] = await withTenantContext(db, tenantId, (tx) => Promise.all([
    tx.select({
      id: users.id,
      email: users.email,
      role: userTenants.role,
      accessPreset: userTenants.accessPreset,
      featurePermissions: userTenants.featurePermissions,
      joinedAt: userTenants.createdAt
    })
      .from(userTenants)
      .leftJoin(users, eq(userTenants.userId, users.id))
      .where(eq(userTenants.tenantId, tenantId)),
    tx.select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      accessPreset: invitations.accessPreset,
      featurePermissions: invitations.featurePermissions,
      token: invitations.token,
      expiresAt: invitations.expiresAt,
      createdAt: invitations.createdAt,
    })
      .from(invitations)
      .where(and(eq(invitations.tenantId, tenantId), eq(invitations.status, 'pending')))
      .orderBy(desc(invitations.createdAt)),
  ]));

  return {
    tenant,
    currentUserId: user.id,
    currentUserRole: access.role as 'owner' | 'admin' | 'manager' | 'viewer',
    collaborators: collaborators.map((member) => ({
      ...member,
      featurePermissions: resolveTenantFeaturePermissions(member.role, member.featurePermissions),
    })),
    pendingInvites: pendingInvites.map((invite) => ({
      ...invite,
      featurePermissions: resolveTenantFeaturePermissions(invite.role, invite.featurePermissions),
    })),
  };
}

/**
 * Принять приглашение
 */
export async function acceptInvitation(token: string) {
  const user = await requireAuthenticatedUser();
  await ensureLocalUserProfile(user.id, user.email ?? null);
  const normalizedUserEmail = user.email?.trim().toLowerCase();

  if (!normalizedUserEmail) {
    throw new AppError("Профиль пользователя не содержит email. Проверьте аккаунт и повторите попытку.", 400);
  }

  // Admin-path: token-based invitation lookup is intrinsically cross-tenant —
  // the user isn't yet a member of the target tenant. After we learn the
  // tenantId from the claimed invite, the rest of the flow is performed
  // in the same transaction under the admin sentinel so user_tenants insert
  // succeeds even if the strict-RLS policy is active.
  const result = await withAdminContext(db, async (tx) => {
    const [claimedInvite] = await tx
      .update(invitations)
      .set({ status: 'accepted' })
      .where(and(
        eq(invitations.token, token),
        eq(invitations.status, 'pending'),
        sql`${invitations.expiresAt} > NOW()`,
        sql`LOWER(${invitations.email}) = ${normalizedUserEmail}`,
      ))
      .returning({
        tenantId: invitations.tenantId,
        role: invitations.role,
        accessPreset: invitations.accessPreset,
        featurePermissions: invitations.featurePermissions,
        email: invitations.email,
      });

    if (!claimedInvite) {
      const [invite] = await tx.select({
        status: invitations.status,
        email: invitations.email,
        expiresAt: invitations.expiresAt,
      })
        .from(invitations)
        .where(eq(invitations.token, token))
        .limit(1);

      if (!invite) {
        throw new Error("Приглашение не найдено");
      }
      if (invite.status !== 'pending') {
        throw new Error("Приглашение уже использовано");
      }
      if (new Date() > invite.expiresAt) {
        throw new Error("Срок действия приглашения истек");
      }
      if (invite.email.toLowerCase() !== normalizedUserEmail) {
        throw new AppError("Это приглашение выдано для другого email", 403);
      }

      throw new Error("Не удалось принять приглашение. Повторите попытку.");
    }

    await tx.insert(userTenants).values({
      userId: user.id,
      tenantId: claimedInvite.tenantId,
      role: claimedInvite.role,
      accessPreset: claimedInvite.accessPreset,
      featurePermissions: claimedInvite.featurePermissions,
    }).onConflictDoNothing();

    await tx.update(users)
      .set({
        tenantId: claimedInvite.tenantId,
        role: claimedInvite.role,
        email: user.email ?? claimedInvite.email,
      })
      .where(eq(users.id, user.id));

    return { tenantId: claimedInvite.tenantId };
  });

  revalidatePath('/');
  return { success: true, tenantId: result.tenantId };
}

/**
 * Удалить участника или отозвать инвайт
 */
export async function removeTeamMember(tenantId: string, targetId: string, isInvite = false) {
  const { user } = await requireTenantAccess(tenantId, ['owner']);

  if (isInvite) {
    await withTenantContext(db, tenantId, (tx) =>
      tx.delete(invitations).where(and(
        eq(invitations.id, targetId),
        eq(invitations.tenantId, tenantId),
      )),
    );
  } else {
    // Нельзя удалить самого себя (владельца)
    if (targetId === user.id) throw new Error("Нельзя удалить владельца");
    await withTenantContext(db, tenantId, (tx) =>
      tx.delete(userTenants).where(and(eq(userTenants.userId, targetId), eq(userTenants.tenantId, tenantId))),
    );
  }

  revalidatePath(`/cabinets/${tenantId}/team`);
  return { success: true };
}

export async function updateTeamMemberAccess(
  tenantId: string,
  targetUserId: string,
  input: {
    role: 'admin' | 'manager' | 'viewer';
    accessPreset: TenantAccessPreset;
    featurePermissions?: Partial<TenantFeaturePermissions>;
  },
) {
  const { user } = await requireTenantAccess(tenantId, ['owner']);

  if (targetUserId === user.id) {
    throw new AppError('Нельзя менять собственный доступ из этого экрана', 400);
  }

  const parsed = accessInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? 'Некорректные настройки доступа', 400);
  }

  const normalizedAccess = normalizeAccessInput(parsed.data);

  await withTenantContext(db, tenantId, async (tx) => {
    const [targetAccess] = await tx.select({
      role: userTenants.role,
    })
      .from(userTenants)
      .where(and(eq(userTenants.tenantId, tenantId), eq(userTenants.userId, targetUserId)))
      .limit(1);

    if (!targetAccess) {
      throw new AppError('Участник не найден', 404);
    }

    if (targetAccess.role === 'owner') {
      throw new AppError('Нельзя менять доступ владельца', 400);
    }

    await tx.update(userTenants)
      .set({
        role: normalizedAccess.role,
        accessPreset: normalizedAccess.accessPreset,
        featurePermissions: normalizedAccess.featurePermissions,
      })
      .where(and(eq(userTenants.tenantId, tenantId), eq(userTenants.userId, targetUserId)));
  });

  await db.update(users)
    .set({ role: normalizedAccess.role })
    .where(and(eq(users.id, targetUserId), eq(users.tenantId, tenantId)));

  revalidatePath(`/cabinets/${tenantId}/team`);
  revalidatePath('/settings');
  return { success: true };
}
