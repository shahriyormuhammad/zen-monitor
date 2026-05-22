import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { db, withTenantContext } from "@/lib/db";
import { signalSavedViews, userTenants, users } from "@/lib/db/schema";
import type {
  SignalSavedView,
  SignalSavedViewScope,
  SignalSortPreset,
} from "@/lib/operator-signal-timeline";
import {
  resolveSignalSavedViewScope,
  resolveSignalSortPreset,
} from "@/lib/operator-signal-timeline";
import { isTenantManager } from "../helpers/signals";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function resolveSignalSavedViewSharedOwner(
  tenantId: string,
  sharedOwnerUserId: string | null | undefined,
): Promise<{ userId: string; email: string | null } | null> {
  if (!sharedOwnerUserId) {
    return null;
  }

  const [owner] = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({
        userId: userTenants.userId,
        email: users.email,
      })
      .from(userTenants)
      .leftJoin(users, eq(userTenants.userId, users.id))
      .where(and(
        eq(userTenants.tenantId, tenantId),
        eq(userTenants.userId, sharedOwnerUserId),
      ))
      .limit(1),
  );

  if (!owner) {
    throw new Error("Нельзя назначить queue owner вне этой команды");
  }

  return {
    userId: owner.userId,
    email: owner.email ?? null,
  };
}

export async function getSignalSavedViewNextPosition(
  tx: DbTransaction,
  tenantId: string,
  userId: string,
  scope: SignalSavedViewScope,
  isPinned: boolean,
) {
  const [row] = await tx
    .select({
      maxPosition: sql<number>`coalesce(max(${signalSavedViews.position}), -1)`,
    })
    .from(signalSavedViews)
    .where(and(
      eq(signalSavedViews.tenantId, tenantId),
      eq(signalSavedViews.scope, scope),
      eq(signalSavedViews.isPinned, isPinned),
      scope === "team" ? undefined : eq(signalSavedViews.userId, userId),
    ));

  return Number(row?.maxPosition ?? -1) + 1;
}

export async function getSignalSavedViewForMutation(
  tenantId: string,
  currentUserId: string,
  currentUserRole: string,
  viewId: string,
) {
  const [view] = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select()
      .from(signalSavedViews)
      .where(and(
        eq(signalSavedViews.tenantId, tenantId),
        eq(signalSavedViews.id, viewId),
      ))
      .limit(1),
  );

  if (!view) {
    throw new Error("Saved view не найден");
  }

  if (view.scope === "team") {
    if (!isTenantManager(currentUserRole)) {
      throw new Error("Недостаточно прав для управления team saved view");
    }
    return view;
  }

  if (view.userId !== currentUserId) {
    throw new Error("Нельзя менять чужой private saved view");
  }

  return view;
}

export async function getSignalSavedViews(
  tenantId: string,
  currentUserId: string,
  currentUserRole: string,
): Promise<SignalSavedView[]> {
  const rows = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({
        id: signalSavedViews.id,
        tenantId: signalSavedViews.tenantId,
        userId: signalSavedViews.userId,
        name: signalSavedViews.name,
        sharedOwnerUserId: signalSavedViews.sharedOwnerUserId,
        sharedOwnerEmail: signalSavedViews.sharedOwnerEmail,
        scope: signalSavedViews.scope,
        queueView: signalSavedViews.queueView,
        assigneeFilter: signalSavedViews.assigneeFilter,
        workflowFilter: signalSavedViews.workflowFilter,
        sortPreset: signalSavedViews.sortPreset,
        isPinned: signalSavedViews.isPinned,
        isDefault: signalSavedViews.isDefault,
        position: signalSavedViews.position,
        createdAt: signalSavedViews.createdAt,
        updatedAt: signalSavedViews.updatedAt,
        ownerEmail: users.email,
      })
      .from(signalSavedViews)
      .leftJoin(users, eq(signalSavedViews.userId, users.id))
      .where(and(
        eq(signalSavedViews.tenantId, tenantId),
        or(
          eq(signalSavedViews.userId, currentUserId),
          eq(signalSavedViews.scope, "team"),
        ),
      ))
      .orderBy(
        asc(signalSavedViews.scope),
        desc(signalSavedViews.isPinned),
        asc(signalSavedViews.position),
        desc(signalSavedViews.updatedAt),
      ),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    queueView: row.queueView as SignalSavedView["queueView"],
    assigneeFilter: row.assigneeFilter,
    workflowFilter: row.workflowFilter as SignalSavedView["workflowFilter"],
    sortPreset: resolveSignalSortPreset(row.sortPreset) ?? "severity",
    scope: resolveSignalSavedViewScope(row.scope) ?? "private",
    ownerUserId: row.userId,
    ownerEmail: row.ownerEmail ?? null,
    sharedOwnerUserId: row.sharedOwnerUserId ?? null,
    sharedOwnerEmail: row.sharedOwnerEmail ?? null,
    isPinned: row.isPinned,
    isDefault: row.isDefault && row.scope !== "team" && row.userId === currentUserId,
    isTeamDefault: row.isDefault && row.scope === "team",
    position: row.position,
    canEdit: row.scope === "team" ? isTenantManager(currentUserRole) : row.userId === currentUserId,
    canDelete: row.scope === "team" ? isTenantManager(currentUserRole) : row.userId === currentUserId,
    canReorder: row.scope === "team" ? isTenantManager(currentUserRole) : row.userId === currentUserId,
    canTogglePin: row.scope === "team" ? isTenantManager(currentUserRole) : row.userId === currentUserId,
    canSetDefault: row.scope !== "team" && row.userId === currentUserId,
    canSetTeamDefault: row.scope === "team" && isTenantManager(currentUserRole),
    canManageSharedOwner: row.scope === "team" && isTenantManager(currentUserRole),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function saveSignalSavedView(
  tenantId: string,
  userId: string,
  currentUserRole: string,
  payload: {
    name: string;
    scope: SignalSavedViewScope;
    queueView: SignalSavedView["queueView"];
    assigneeFilter: string;
    workflowFilter: SignalSavedView["workflowFilter"];
    sortPreset: SignalSortPreset;
    sharedOwnerUserId?: string | null;
  },
) {
  if (payload.scope === "team" && !isTenantManager(currentUserRole)) {
    throw new Error("Недостаточно прав для создания team saved view");
  }

  const sharedOwner = payload.scope === "team"
    ? await resolveSignalSavedViewSharedOwner(tenantId, payload.sharedOwnerUserId ?? null)
    : null;
  const now = new Date();

  await withTenantContext(db, tenantId, async (tx) => {
    const [existingView] = await tx
      .select({
        id: signalSavedViews.id,
        userId: signalSavedViews.userId,
      })
      .from(signalSavedViews)
      .where(and(
        eq(signalSavedViews.tenantId, tenantId),
        eq(signalSavedViews.name, payload.name),
        payload.scope === "team"
          ? eq(signalSavedViews.scope, "team")
          : and(
            eq(signalSavedViews.scope, "private"),
            eq(signalSavedViews.userId, userId),
          ),
      ))
      .limit(1);

    if (existingView) {
      if (payload.scope === "team" && existingView.userId !== userId) {
        throw new Error("Team saved view с таким названием уже существует");
      }

      await tx.update(signalSavedViews)
        .set({
          scope: payload.scope,
          queueView: payload.queueView,
          assigneeFilter: payload.assigneeFilter,
          workflowFilter: payload.workflowFilter,
          sortPreset: payload.sortPreset,
          sharedOwnerUserId: sharedOwner?.userId ?? null,
          sharedOwnerEmail: sharedOwner?.email ?? null,
          updatedAt: now,
        })
        .where(eq(signalSavedViews.id, existingView.id));
      return;
    }

    const position = await getSignalSavedViewNextPosition(tx, tenantId, userId, payload.scope, false);

    await tx.insert(signalSavedViews)
      .values({
        tenantId,
        userId,
        name: payload.name,
        scope: payload.scope,
        queueView: payload.queueView,
        assigneeFilter: payload.assigneeFilter,
        workflowFilter: payload.workflowFilter,
        sortPreset: payload.sortPreset,
        sharedOwnerUserId: sharedOwner?.userId ?? null,
        sharedOwnerEmail: sharedOwner?.email ?? null,
        isPinned: false,
        position,
        updatedAt: now,
      });
  });

  return getSignalSavedViews(tenantId, userId, currentUserRole);
}

export async function updateSignalSavedView(
  tenantId: string,
  userId: string,
  currentUserRole: string,
  viewId: string,
  payload: {
    name: string;
    scope: SignalSavedViewScope;
    queueView: SignalSavedView["queueView"];
    assigneeFilter: string;
    workflowFilter: SignalSavedView["workflowFilter"];
    sortPreset: SignalSortPreset;
    sharedOwnerUserId?: string | null;
  },
) {
  if (payload.scope === "team" && !isTenantManager(currentUserRole)) {
    throw new Error("Недостаточно прав для сохранения team saved view");
  }

  const sharedOwner = payload.scope === "team"
    ? await resolveSignalSavedViewSharedOwner(tenantId, payload.sharedOwnerUserId ?? null)
    : null;
  const existingView = await getSignalSavedViewForMutation(tenantId, userId, currentUserRole, viewId);
  const duplicateView = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({ id: signalSavedViews.id })
      .from(signalSavedViews)
      .where(and(
        eq(signalSavedViews.tenantId, tenantId),
        eq(signalSavedViews.name, payload.name),
        ne(signalSavedViews.id, viewId),
        payload.scope === "team"
          ? eq(signalSavedViews.scope, "team")
          : and(
            eq(signalSavedViews.scope, "private"),
            eq(signalSavedViews.userId, existingView.userId),
          ),
      ))
      .limit(1),
  );

  if (duplicateView[0]) {
    throw new Error(
      payload.scope === "team"
        ? "Team saved view с таким названием уже существует"
        : "Saved view с таким названием уже существует",
    );
  }

  const now = new Date();
  const updatedRows = await withTenantContext(db, tenantId, async (tx) => {
    const nextScope = payload.scope;
    let nextPosition = existingView.position;

    if (existingView.scope !== nextScope) {
      nextPosition = await getSignalSavedViewNextPosition(tx, tenantId, existingView.userId, nextScope, existingView.isPinned);
    }

    return tx.update(signalSavedViews)
      .set({
        name: payload.name,
        scope: nextScope,
        queueView: payload.queueView,
        assigneeFilter: payload.assigneeFilter,
        workflowFilter: payload.workflowFilter,
        sortPreset: payload.sortPreset,
        sharedOwnerUserId: sharedOwner?.userId ?? null,
        sharedOwnerEmail: sharedOwner?.email ?? null,
        isDefault: existingView.scope === nextScope ? existingView.isDefault : false,
        position: nextPosition,
        updatedAt: now,
      })
      .where(and(
        eq(signalSavedViews.tenantId, tenantId),
        eq(signalSavedViews.id, viewId),
      ))
      .returning({ id: signalSavedViews.id });
  });

  if (updatedRows.length === 0) {
    throw new Error("Saved view не найден");
  }

  return getSignalSavedViews(tenantId, userId, currentUserRole);
}

export async function setSignalSavedViewDefault(
  tenantId: string,
  userId: string,
  currentUserRole: string,
  viewId: string,
  isDefault: boolean,
) {
  const now = new Date();
  const view = await getSignalSavedViewForMutation(tenantId, userId, currentUserRole, viewId);

  if (view.scope !== "team" && view.userId !== userId) {
    throw new Error("Default можно ставить только на свои saved views");
  }

  await withTenantContext(db, tenantId, async (tx) => {
    if (isDefault) {
      if (view.scope === "team") {
        await tx.update(signalSavedViews)
          .set({
            isDefault: false,
            updatedAt: now,
          })
          .where(and(
            eq(signalSavedViews.tenantId, tenantId),
            eq(signalSavedViews.scope, "team"),
            eq(signalSavedViews.isDefault, true),
            view.sharedOwnerUserId
              ? eq(signalSavedViews.sharedOwnerUserId, view.sharedOwnerUserId)
              : isNull(signalSavedViews.sharedOwnerUserId),
          ));
      } else {
        await tx.update(signalSavedViews)
          .set({
            isDefault: false,
            updatedAt: now,
          })
          .where(and(
            eq(signalSavedViews.tenantId, tenantId),
            eq(signalSavedViews.userId, userId),
            eq(signalSavedViews.scope, "private"),
            eq(signalSavedViews.isDefault, true),
          ));
      }
    }

    await tx.update(signalSavedViews)
      .set({
        isDefault,
        updatedAt: now,
      })
      .where(and(
        eq(signalSavedViews.tenantId, tenantId),
        view.scope === "team" ? undefined : eq(signalSavedViews.userId, userId),
        eq(signalSavedViews.id, viewId),
      ));
  });

  return getSignalSavedViews(tenantId, userId, currentUserRole);
}

export async function toggleSignalSavedViewPin(
  tenantId: string,
  userId: string,
  currentUserRole: string,
  viewId: string,
  isPinned: boolean,
) {
  const now = new Date();
  const view = await getSignalSavedViewForMutation(tenantId, userId, currentUserRole, viewId);

  await withTenantContext(db, tenantId, async (tx) => {
    const position = await getSignalSavedViewNextPosition(tx, tenantId, view.userId, view.scope as SignalSavedViewScope, isPinned);

    await tx.update(signalSavedViews)
      .set({
        isPinned,
        position,
        updatedAt: now,
      })
      .where(eq(signalSavedViews.id, viewId));
  });

  return getSignalSavedViews(tenantId, userId, currentUserRole);
}

export async function moveSignalSavedView(
  tenantId: string,
  userId: string,
  currentUserRole: string,
  viewId: string,
  direction: "up" | "down",
) {
  const now = new Date();
  const view = await getSignalSavedViewForMutation(tenantId, userId, currentUserRole, viewId);
  const scope = resolveSignalSavedViewScope(view.scope) ?? "private";

  await withTenantContext(db, tenantId, async (tx) => {
    const peers = await tx
      .select({
        id: signalSavedViews.id,
        position: signalSavedViews.position,
      })
      .from(signalSavedViews)
      .where(and(
        eq(signalSavedViews.tenantId, tenantId),
        eq(signalSavedViews.scope, scope),
        eq(signalSavedViews.isPinned, view.isPinned),
        scope === "team" ? undefined : eq(signalSavedViews.userId, view.userId),
      ))
      .orderBy(asc(signalSavedViews.position), desc(signalSavedViews.updatedAt));

    const targetIndex = peers.findIndex((peer) => peer.id === viewId);
    if (targetIndex === -1) {
      throw new Error("Saved view не найден в рабочем порядке");
    }

    const swapIndex = direction === "up" ? targetIndex - 1 : targetIndex + 1;
    if (swapIndex < 0 || swapIndex >= peers.length) {
      return;
    }

    const targetPeer = peers[targetIndex]!;
    const swapPeer = peers[swapIndex]!;

    await tx.update(signalSavedViews)
      .set({
        position: swapPeer.position,
        updatedAt: now,
      })
      .where(eq(signalSavedViews.id, targetPeer.id));

    await tx.update(signalSavedViews)
      .set({
        position: targetPeer.position,
        updatedAt: now,
      })
      .where(eq(signalSavedViews.id, swapPeer.id));
  });

  return getSignalSavedViews(tenantId, userId, currentUserRole);
}

export async function deleteSignalSavedView(
  tenantId: string,
  userId: string,
  currentUserRole: string,
  viewId: string,
) {
  await getSignalSavedViewForMutation(tenantId, userId, currentUserRole, viewId);

  await withTenantContext(db, tenantId, (tx) =>
    tx.delete(signalSavedViews)
      .where(and(
        eq(signalSavedViews.tenantId, tenantId),
        eq(signalSavedViews.id, viewId),
      )),
  );

  return getSignalSavedViews(tenantId, userId, currentUserRole);
}
