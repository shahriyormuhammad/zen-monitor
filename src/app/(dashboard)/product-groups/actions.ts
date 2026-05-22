'use server';

import { db, withTenantContext } from "@/lib/db";
import { productGroups, productGroupMembers } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireGroupAccess, requireTenantAccess } from "@/lib/auth/tenant-access";

const RESERVED_SCOPE_NAME = "весь магазин";

function normalizeGroupName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function canonicalGroupName(name: string) {
  return normalizeGroupName(name).toLocaleLowerCase("ru-RU");
}

function isReservedGroupName(name: string) {
  return canonicalGroupName(name) === RESERVED_SCOPE_NAME;
}

async function assertGroupNameAvailable(
  tenantId: string,
  name: string,
  excludedGroupId?: string,
) {
  if (isReservedGroupName(name)) {
    throw new Error('Название «Весь магазин» зарезервировано системным фильтром. Выберите другое имя.');
  }

  const canonical = canonicalGroupName(name);
  const duplicate = await withTenantContext(db, tenantId, async (tx) => (
    tx.execute<{ id: string }>(sql`
      SELECT id
      FROM product_groups
      WHERE tenant_id = ${tenantId}
        AND LOWER(REGEXP_REPLACE(TRIM(name), '\s+', ' ', 'g')) = ${canonical}
        ${excludedGroupId ? sql`AND id <> ${excludedGroupId}` : sql``}
      LIMIT 1
    `)
  ));

  if (duplicate.length > 0) {
    throw new Error('Склейка с таким названием уже существует');
  }
}

export async function getGroups(tenantId: string) {
  await requireTenantAccess(tenantId);
  return withTenantContext(db, tenantId, async (tx) =>
    tx.select().from(productGroups).where(eq(productGroups.tenantId, tenantId)),
  );
}

export async function createGroup(tenantId: string, name: string) {
  await requireTenantAccess(tenantId, ['owner', 'admin']);
  const normalizedName = normalizeGroupName(name);
  if (!normalizedName) {
    throw new Error('Название склейки не может быть пустым');
  }
  await assertGroupNameAvailable(tenantId, normalizedName);

  const group = await withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx.insert(productGroups).values({
      tenantId,
      name: normalizedName,
    }).returning();
    return row;
  });
  revalidatePath('/dynamics');
  revalidatePath('/overview');
  return group;
}

export async function renameGroup(groupId: string, name: string) {
  const { tenantId } = await requireGroupAccess(groupId, ['owner', 'admin']);
  const normalizedName = normalizeGroupName(name);
  if (!normalizedName) {
    throw new Error('Название склейки не может быть пустым');
  }
  await assertGroupNameAvailable(tenantId, normalizedName, groupId);

  const group = await withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx
      .update(productGroups)
      .set({ name: normalizedName })
      .where(and(eq(productGroups.id, groupId), eq(productGroups.tenantId, tenantId)))
      .returning();
    return row;
  });

  revalidatePath('/dynamics');
  revalidatePath('/overview');
  return group;
}

export async function deleteGroup(groupId: string) {
  const { tenantId } = await requireGroupAccess(groupId, ['owner', 'admin']);

  const deleted = await withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx
      .delete(productGroups)
      .where(and(eq(productGroups.id, groupId), eq(productGroups.tenantId, tenantId)))
      .returning({ id: productGroups.id });
    return row;
  });

  if (!deleted) {
    throw new Error('Склейка не найдена или уже удалена');
  }

  revalidatePath('/dynamics');
  revalidatePath('/overview');
  return deleted;
}

// product_group_members не в 0040_rls_enable.sql (нет tenant_id колонки).
// Защита обеспечивается через requireGroupAccess (FK продукт groups → tenant).
// После flip-the-switch (Slice 11) доступ к product_groups внутри
// requireGroupAccess потребует admin-паттерна (Slice 6).

export async function addMemberToGroup(groupId: string, nmId: number) {
  await requireGroupAccess(groupId, ['owner', 'admin']);
  return db.insert(productGroupMembers).values({
    groupId,
    nmId,
  }).onConflictDoNothing();
}

export async function addMembersToGroup(groupId: string, nmIds: number[]) {
  await requireGroupAccess(groupId, ['owner', 'admin']);

  const uniqueNmIds = Array.from(new Set(nmIds.filter((nmId) => Number.isFinite(nmId) && nmId > 0)));
  if (uniqueNmIds.length === 0) {
    return { added: 0 };
  }

  await db.insert(productGroupMembers).values(
    uniqueNmIds.map((nmId) => ({
      groupId,
      nmId,
    })),
  ).onConflictDoNothing();

  return { added: uniqueNmIds.length };
}

export async function removeMemberFromGroup(groupId: string, nmId: number) {
  await requireGroupAccess(groupId, ['owner', 'admin']);
  return db.delete(productGroupMembers).where(and(eq(productGroupMembers.groupId, groupId), eq(productGroupMembers.nmId, nmId)));
}

export async function getGroupMembers(groupId: string) {
  await requireGroupAccess(groupId);
  return db.select().from(productGroupMembers).where(eq(productGroupMembers.groupId, groupId));
}
