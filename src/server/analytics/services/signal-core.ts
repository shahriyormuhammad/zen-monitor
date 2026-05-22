import { and, desc, eq, inArray } from "drizzle-orm";
import { subDays } from "date-fns";
import { db, withTenantContext } from "@/lib/db";
import {
  products,
  rawApiProductMetadata,
  rawApiStocks,
  riskSignals,
  signalOperatorTimeline,
  tenants,
  userTenants,
  users,
} from "@/lib/db/schema";
import type {
  RecentSignalReview,
  SignalAssigneeOption,
  SignalFeedResponse,
  SignalReviewSource,
  SignalTimelineEntry,
  SignalTimelineEventType,
  SignalWorkflowState,
  SignalWorkflowSummary,
} from "@/lib/operator-signal-timeline";
import {
  resolveSignalNotificationPreferenceKey,
  resolveSignalNotificationPreferences,
  resolveSignalWorkflowState,
} from "@/lib/operator-signal-timeline";
import {
  buildSignalAgingSummary,
  buildSignalCollaborationSummary,
  buildSignalOverviewHref,
  getSignalEscalationOutcomeLabel,
  getSafeUserLabel,
  isSlaAutomationNotification,
  normalizeSignalSeverity,
  resolveSignalAutomationSource,
  resolveSignalEscalationOutcome,
  toPayloadRecord,
} from "../helpers/signals";
import { buildSignalInsights, buildSignalRecommendations } from "../helpers/signal-content";
import { BotService } from "@/server/bot/service";

import type { SignalDetailViewer } from "./signal-automation-queries";
export type { SignalDetailViewer };

const SIGNAL_VIEW_DEDUPE_WINDOW_MS = 60_000;

export type UnitEconomicsRow = {
  nmId: number;
  soldQuantity: number | string | null | undefined;
  grossRevenue: number | string | null | undefined;
  netProfit: number | string | null | undefined;
  adSpend: number | string | null | undefined;
  logistics: number | string | null | undefined;
  currentStock: number | string | null | undefined;
  daysOfStock: number | string | null | undefined;
  views: number | string | null | undefined;
  carts: number | string | null | undefined;
  [key: string]: unknown;
};

export type SignalTimelineResponse = {
  latestEvent: SignalTimelineEntry | null;
  signalHistory: SignalTimelineEntry[];
  recentSignals: RecentSignalReview[];
  notes: SignalTimelineEntry[];
};

export async function getActiveSignals(tenantId: string) {
  return await withTenantContext(db, tenantId, (tx) =>
    tx.select().from(riskSignals).where(and(eq(riskSignals.tenantId, tenantId), eq(riskSignals.status, 'active'))),
  );
}

export async function recordSignalTimelineEvent({
  tenantId,
  signalId,
  viewer,
  eventType,
  eventBody,
  eventPayload,
  dedupeWindowMs,
}: {
  tenantId: string;
  signalId: string;
  viewer: SignalDetailViewer;
  eventType: SignalTimelineEventType;
  eventBody?: string | null;
  eventPayload?: Record<string, unknown>;
  dedupeWindowMs?: number;
}) {
  await withTenantContext(db, tenantId, async (tx) => {
    if (dedupeWindowMs && viewer.userId) {
      const [lastEvent] = await tx
        .select({
          createdAt: signalOperatorTimeline.createdAt,
        })
        .from(signalOperatorTimeline)
        .where(and(
          eq(signalOperatorTimeline.tenantId, tenantId),
          eq(signalOperatorTimeline.signalId, signalId),
          eq(signalOperatorTimeline.actorUserId, viewer.userId),
          eq(signalOperatorTimeline.eventType, eventType),
          eq(signalOperatorTimeline.openedFrom, viewer.openedFrom)
        ))
        .orderBy(desc(signalOperatorTimeline.createdAt))
        .limit(1);

      if (lastEvent?.createdAt) {
        const lastSeenAt = new Date(lastEvent.createdAt).getTime();
        if (!Number.isNaN(lastSeenAt) && Date.now() - lastSeenAt < dedupeWindowMs) {
          return;
        }
      }
    }

    await tx.insert(signalOperatorTimeline).values({
      tenantId,
      signalId,
      actorUserId: viewer.userId,
      actorEmail: viewer.actorEmail,
      actorRole: viewer.actorRole,
      eventType,
      openedFrom: viewer.openedFrom,
      eventBody: eventBody ?? null,
      eventPayload: eventPayload ?? {},
    });
  });
}

export async function recordSignalView({
  tenantId,
  signalId,
  viewer,
}: {
  tenantId: string;
  signalId: string;
  viewer: SignalDetailViewer;
}) {
  await recordSignalTimelineEvent({
    tenantId,
    signalId,
    viewer,
    eventType: "view",
    dedupeWindowMs: SIGNAL_VIEW_DEDUPE_WINDOW_MS,
  });
}

export async function getSignalTimeline(tenantId: string, signalId: string): Promise<SignalTimelineResponse> {
  const rows = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({
        eventId: signalOperatorTimeline.id,
        eventSignalId: signalOperatorTimeline.signalId,
        actorUserId: signalOperatorTimeline.actorUserId,
        actorEmail: signalOperatorTimeline.actorEmail,
        actorRole: signalOperatorTimeline.actorRole,
        eventType: signalOperatorTimeline.eventType,
        openedFrom: signalOperatorTimeline.openedFrom,
        eventBody: signalOperatorTimeline.eventBody,
        eventPayload: signalOperatorTimeline.eventPayload,
        createdAt: signalOperatorTimeline.createdAt,
        signalTitle: riskSignals.title,
        signalSeverity: riskSignals.severity,
        signalNmId: riskSignals.nmId,
        signalStatus: riskSignals.status,
      })
      .from(signalOperatorTimeline)
      .leftJoin(riskSignals, eq(signalOperatorTimeline.signalId, riskSignals.id))
      .where(eq(signalOperatorTimeline.tenantId, tenantId))
      .orderBy(desc(signalOperatorTimeline.createdAt))
      .limit(32),
  );

  const signalHistory: SignalTimelineEntry[] = [];
  const notes: SignalTimelineEntry[] = [];
  const recentSignals: RecentSignalReview[] = [];
  const seenSignals = new Set<string>();

  for (const row of rows) {
    const entry: SignalTimelineEntry = {
      id: row.eventId,
      signalId: row.eventSignalId,
      actorUserId: row.actorUserId,
      actorEmail: row.actorEmail,
      actorRole: row.actorRole,
      eventType: row.eventType as SignalTimelineEventType,
      openedFrom: row.openedFrom as SignalReviewSource,
      eventBody: row.eventBody ?? null,
      eventPayload: (row.eventPayload ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt,
    };

    if (row.eventSignalId === signalId && signalHistory.length < 8) {
      signalHistory.push(entry);
    }

    if (row.eventSignalId === signalId && entry.eventType === "note" && notes.length < 8) {
      notes.push(entry);
    }

    if (row.eventSignalId !== signalId && !seenSignals.has(row.eventSignalId) && recentSignals.length < 6) {
      recentSignals.push({
        signalId: row.eventSignalId,
        title: row.signalTitle ?? `Signal ${row.eventSignalId.slice(0, 8)}`,
        severity: row.signalSeverity ?? "medium",
        nmId: row.signalNmId ?? null,
        actorEmail: row.actorEmail,
        actorRole: row.actorRole,
        eventType: row.eventType as SignalTimelineEventType,
        openedFrom: row.openedFrom as SignalReviewSource,
        createdAt: row.createdAt,
        isActive: row.signalStatus === "active",
      });
      seenSignals.add(row.eventSignalId);
    }
  }

  return {
    latestEvent: signalHistory[0] ?? null,
    signalHistory,
    recentSignals,
    notes,
  };
}

export async function getSignalWorkflowMembers(tenantId: string): Promise<SignalAssigneeOption[]> {
  const collaborators = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({
        userId: userTenants.userId,
        role: userTenants.role,
        email: users.email,
      })
      .from(userTenants)
      .leftJoin(users, eq(userTenants.userId, users.id))
      .where(eq(userTenants.tenantId, tenantId))
      .orderBy(userTenants.role, users.email),
  );

  return collaborators.map((member) => ({
    userId: member.userId,
    email: member.email ?? null,
    role: member.role,
  }));
}

export async function getLatestSignalEscalations(
  tenantId: string,
  signals: Array<{
    id: string;
    status: string;
    resolvedAt: Date | null;
    workflowUpdatedAt: Date | null;
    workflowUpdatedByEmail: string | null;
  }>,
) {
  if (signals.length === 0) {
    return new Map<string, SignalFeedResponse["signals"][number]["lastEscalation"]>();
  }

  const signalIds = signals.map((signal) => signal.id);
  const rows = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({
        signalId: signalOperatorTimeline.signalId,
        actorEmail: signalOperatorTimeline.actorEmail,
        createdAt: signalOperatorTimeline.createdAt,
        eventPayload: signalOperatorTimeline.eventPayload,
      })
      .from(signalOperatorTimeline)
      .where(and(
        eq(signalOperatorTimeline.tenantId, tenantId),
        eq(signalOperatorTimeline.eventType, "note"),
        inArray(signalOperatorTimeline.signalId, signalIds),
      ))
      .orderBy(desc(signalOperatorTimeline.createdAt)),
  );

  const signalById = new Map(signals.map((signal) => [signal.id, signal]));
  const latestEscalations = new Map<string, SignalFeedResponse["signals"][number]["lastEscalation"]>();

  for (const row of rows) {
    if (latestEscalations.has(row.signalId)) {
      continue;
    }

    const payload = toPayloadRecord(row.eventPayload);
    if (payload.automation !== "sla") {
      continue;
    }

    const signal = signalById.get(row.signalId);
    if (!signal) {
      continue;
    }

    const automationRunId = typeof payload.automationRunId === "string" ? payload.automationRunId : null;
    const presetId = typeof payload.presetId === "string" ? payload.presetId : null;
    const automationSource = resolveSignalAutomationSource(
      typeof payload.automationSource === "string" ? payload.automationSource : null,
    );
    const outcome = resolveSignalEscalationOutcome({
      signalStatus: signal.status,
      resolvedAt: signal.resolvedAt,
      workflowUpdatedAt: signal.workflowUpdatedAt,
      workflowUpdatedByEmail: signal.workflowUpdatedByEmail,
      escalatedAt: row.createdAt,
      actorEmail: row.actorEmail,
    });

    latestEscalations.set(row.signalId, {
      automationRunId,
      presetId,
      automationSource,
      actorEmail: row.actorEmail,
      createdAt: row.createdAt,
      outcome,
      outcomeLabel: getSignalEscalationOutcomeLabel(outcome),
    });
  }

  return latestEscalations;
}

export async function dispatchSignalCollaborationNotification({
  tenantId,
  signal,
  viewer,
  eventType,
  eventBody,
  eventPayload,
}: {
  tenantId: string;
  signal: {
    id: string;
    title: string;
    severity: string;
    nmId: number | null;
  };
  viewer: SignalDetailViewer;
  eventType: SignalTimelineEventType;
  eventBody?: string | null;
  eventPayload?: Record<string, unknown>;
}) {
  const preferenceKey = resolveSignalNotificationPreferenceKey(eventType, eventPayload ?? {});
  if (!preferenceKey) {
    return;
  }

  const [tenantSettings] = await db.select({
    telegramChatId: tenants.telegramChatId,
    notificationsEnabled: tenants.notificationsEnabled,
    telegramSignalNotificationPrefs: tenants.telegramSignalNotificationPrefs,
  })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const telegramPreferences = resolveSignalNotificationPreferences(tenantSettings?.telegramSignalNotificationPrefs);
  if (!tenantSettings?.telegramChatId || !tenantSettings.notificationsEnabled || !telegramPreferences[preferenceKey]) {
    return;
  }

  await BotService.sendSignalCollaborationEvent(tenantId, {
    signalId: signal.id,
    signalTitle: signal.title,
    signalSeverity: normalizeSignalSeverity(signal.severity),
    signalNmId: signal.nmId ?? null,
    actorEmail: viewer.actorEmail,
    eventType,
    eventBody: eventBody ?? null,
    assigneeEmail: typeof eventPayload?.assigneeEmail === "string" ? eventPayload.assigneeEmail : null,
    summary: buildSignalCollaborationSummary({
      actorEmail: viewer.actorEmail,
      eventType,
      eventPayload: eventPayload ?? {},
    }),
    isSlaNotification: isSlaAutomationNotification(eventPayload ?? {}),
    href: buildSignalOverviewHref(signal.id),
  });
}

export async function getSignalDetails(
  tenantId: string,
  signalId: string,
  options?: {
    viewer?: SignalDetailViewer;
    getUnitEconomics?: (tenantId: string, dateFrom: Date, dateTo: Date) => Promise<UnitEconomicsRow[]>;
  }
) {
  const [signal] = await withTenantContext(db, tenantId, (tx) =>
    tx.select().from(riskSignals).where(and(
      eq(riskSignals.id, signalId),
      eq(riskSignals.tenantId, tenantId),
      eq(riskSignals.status, "active")
    )).limit(1),
  );

  if (!signal) {
    return null;
  }

  if (options?.viewer) {
    await recordSignalView({
      tenantId,
      signalId: signal.id,
      viewer: options.viewer,
    });
  }

  let productContext: {
    nmId: number;
    brand: string | null;
    vendorCode: string | null;
    category: string | null;
    photoUrl: string | null;
  } | null = null;

  let contentContext: {
    title: string | null;
    photosCount: number;
    hasVideo: boolean;
    characteristicsCount: number;
    updatedAt: Date | null;
  } | null = null;

  let metricsContext: {
    soldQuantity: number;
    grossRevenue: number;
    netProfit: number;
    adSpend: number;
    logistics: number;
    currentStock: number;
    daysOfStock: number | null;
    views: number;
    carts: number;
  } | null = null;

  let stockContext: {
    total: number;
    warehouses: Array<{ warehouseName: string; amount: number }>;
  } | null = null;

  const timelinePromise = getSignalTimeline(tenantId, signal.id);
  const workflowMembersPromise = getSignalWorkflowMembers(tenantId);

  if (signal.nmId) {
    const nmId = signal.nmId;
    const economicsFetcher = options?.getUnitEconomics;
    const [[productRows, metadataRows, stockRows], economicsRows] = await Promise.all([
      withTenantContext(db, tenantId, (tx) => Promise.all([
        tx.select({
          nmId: products.nmId,
          brand: products.brand,
          vendorCode: products.vendorCode,
          category: products.category,
          photoUrl: products.photoUrl,
        }).from(products).where(and(eq(products.tenantId, tenantId), eq(products.nmId, nmId))).limit(1),
        tx.select({
          title: rawApiProductMetadata.title,
          photosCount: rawApiProductMetadata.photosCount,
          hasVideo: rawApiProductMetadata.hasVideo,
          characteristicsCount: rawApiProductMetadata.characteristicsCount,
          updatedAt: rawApiProductMetadata.updatedAt,
        }).from(rawApiProductMetadata).where(and(eq(rawApiProductMetadata.tenantId, tenantId), eq(rawApiProductMetadata.nmId, nmId))).limit(1),
        tx.select({
          warehouseName: rawApiStocks.warehouseName,
          amount: rawApiStocks.amount,
        }).from(rawApiStocks).where(and(eq(rawApiStocks.tenantId, tenantId), eq(rawApiStocks.nmId, nmId))),
      ])),
      economicsFetcher ? economicsFetcher(tenantId, subDays(new Date(), 14), new Date()) : Promise.resolve([]),
    ]);

    const [product] = productRows;
    const [metadata] = metadataRows;
    const economics = economicsRows.find((row) => Number(row.nmId) === signal.nmId);
    const warehouses = stockRows
      .map((stock) => ({
        warehouseName: stock.warehouseName,
        amount: Number(stock.amount ?? 0),
      }))
      .sort((left, right) => right.amount - left.amount);
    const totalStock = warehouses.reduce((sum, item) => sum + item.amount, 0);

    if (product) {
      productContext = {
        nmId: Number(product.nmId),
        brand: product.brand ?? null,
        vendorCode: product.vendorCode ?? null,
        category: product.category ?? null,
        photoUrl: product.photoUrl ?? null,
      };
    } else {
      productContext = {
        nmId: signal.nmId,
        brand: null,
        vendorCode: null,
        category: null,
        photoUrl: null,
      };
    }

    if (metadata) {
      contentContext = {
        title: metadata.title ?? null,
        photosCount: Number(metadata.photosCount ?? 0),
        hasVideo: Boolean(metadata.hasVideo),
        characteristicsCount: Number(metadata.characteristicsCount ?? 0),
        updatedAt: metadata.updatedAt ?? null,
      };
    }

    if (economics) {
      metricsContext = {
        soldQuantity: Number(economics.soldQuantity ?? 0),
        grossRevenue: Number(economics.grossRevenue ?? 0),
        netProfit: Number(economics.netProfit ?? 0),
        adSpend: Number(economics.adSpend ?? 0),
        logistics: Number(economics.logistics ?? 0),
        currentStock: Number(economics.currentStock ?? 0),
        daysOfStock: economics.daysOfStock === null || economics.daysOfStock === undefined ? null : Number(economics.daysOfStock),
        views: Number(economics.views ?? 0),
        carts: Number(economics.carts ?? 0),
      };
    }

    if (warehouses.length > 0 || metricsContext) {
      stockContext = {
        total: warehouses.length > 0 ? totalStock : metricsContext?.currentStock ?? 0,
        warehouses,
      };
    }
  }

  const impactRub = Number(signal.impactRub ?? 0);
  const workflowMembers = await workflowMembersPromise;
  const workflow: SignalWorkflowSummary = {
    workflowState: (signal.workflowState as SignalWorkflowState) ?? "new",
    assigneeUserId: signal.assigneeUserId ?? null,
    assigneeEmail: signal.assigneeEmail ?? null,
    workflowUpdatedAt: signal.workflowUpdatedAt ?? null,
    workflowUpdatedByUserId: signal.workflowUpdatedByUserId ?? null,
    workflowUpdatedByEmail: signal.workflowUpdatedByEmail ?? null,
    availableAssignees: workflowMembers,
  };

  return {
    signal: {
      id: signal.id,
      nmId: signal.nmId,
      type: signal.type,
      severity: signal.severity,
      title: signal.title,
      description: signal.description,
      impactRub: signal.impactRub,
      status: signal.status,
      createdAt: signal.createdAt,
      aging: buildSignalAgingSummary({
        createdAt: signal.createdAt,
        workflowUpdatedAt: signal.workflowUpdatedAt,
        workflowState: resolveSignalWorkflowState(signal.workflowState) ?? "new",
      }),
    },
    workflow,
    product: productContext,
    content: contentContext,
    metrics: metricsContext,
    stocks: stockContext,
    insights: buildSignalInsights({
      type: signal.type,
      impactRub,
      metrics: metricsContext,
      content: contentContext,
      totalStock: stockContext?.total ?? null,
    }),
    recommendations: buildSignalRecommendations({
      type: signal.type,
      nmId: signal.nmId,
      signalTitle: signal.title,
      signalId: signal.id,
    }),
    timeline: await timelinePromise,
  };
}

export async function assignSignalOwner(
  tenantId: string,
  signalId: string,
  assigneeUserId: string | null,
  actor: SignalDetailViewer,
) {
  const [signal] = await withTenantContext(db, tenantId, (tx) =>
    tx.select().from(riskSignals).where(and(
      eq(riskSignals.id, signalId),
      eq(riskSignals.tenantId, tenantId),
      eq(riskSignals.status, "active"),
    )).limit(1),
  );

  if (!signal) {
    throw new Error("Сигнал не найден");
  }

  let assigneeEmail: string | null = null;
  const previousAssigneeUserId = signal.assigneeUserId ?? null;
  const previousAssigneeEmail = signal.assigneeEmail ?? null;

  if (assigneeUserId) {
    const [assignee] = await withTenantContext(db, tenantId, (tx) =>
      tx
        .select({
          userId: userTenants.userId,
          email: users.email,
        })
        .from(userTenants)
        .leftJoin(users, eq(userTenants.userId, users.id))
        .where(and(eq(userTenants.tenantId, tenantId), eq(userTenants.userId, assigneeUserId)))
        .limit(1),
    );

    if (!assignee) {
      throw new Error("Нельзя назначить сигнал пользователю вне этой команды");
    }

    assigneeEmail = assignee.email ?? getSafeUserLabel(assignee.email, assignee.userId);
  }

  if ((signal.assigneeUserId ?? null) === assigneeUserId && (signal.assigneeEmail ?? null) === assigneeEmail) {
    return;
  }

  await withTenantContext(db, tenantId, (tx) =>
    tx.update(riskSignals)
      .set({
        assigneeUserId,
        assigneeEmail,
        workflowUpdatedAt: new Date(),
        workflowUpdatedByUserId: actor.userId,
        workflowUpdatedByEmail: actor.actorEmail,
      })
      .where(and(eq(riskSignals.id, signalId), eq(riskSignals.tenantId, tenantId))),
  );

  await recordSignalTimelineEvent({
    tenantId,
    signalId,
    viewer: actor,
    eventType: "assignment",
    eventBody: assigneeEmail ? `Ответственный назначен: ${assigneeEmail}` : "Ответственный снят",
    eventPayload: {
      previousAssigneeUserId,
      previousAssigneeEmail,
      assigneeUserId,
      assigneeEmail,
    },
  });

  await dispatchSignalCollaborationNotification({
    tenantId,
    signal: {
      id: signal.id,
      title: signal.title,
      severity: signal.severity,
      nmId: signal.nmId,
    },
    viewer: actor,
    eventType: "assignment",
    eventBody: assigneeEmail ? `Ответственный назначен: ${assigneeEmail}` : "Ответственный снят",
    eventPayload: {
      previousAssigneeUserId,
      previousAssigneeEmail,
      assigneeUserId,
      assigneeEmail,
    },
  });
}

export async function updateSignalWorkflowState(
  tenantId: string,
  signalId: string,
  workflowState: SignalWorkflowState,
  actor: SignalDetailViewer,
) {
  const [signal] = await withTenantContext(db, tenantId, (tx) =>
    tx.select().from(riskSignals).where(and(
      eq(riskSignals.id, signalId),
      eq(riskSignals.tenantId, tenantId),
      eq(riskSignals.status, "active"),
    )).limit(1),
  );

  if (!signal) {
    throw new Error("Сигнал не найден");
  }

  if ((signal.workflowState as SignalWorkflowState) === workflowState) {
    return;
  }

  await withTenantContext(db, tenantId, (tx) =>
    tx.update(riskSignals)
      .set({
        workflowState,
        workflowUpdatedAt: new Date(),
        workflowUpdatedByUserId: actor.userId,
        workflowUpdatedByEmail: actor.actorEmail,
      })
      .where(and(eq(riskSignals.id, signalId), eq(riskSignals.tenantId, tenantId))),
  );

  await recordSignalTimelineEvent({
    tenantId,
    signalId,
    viewer: actor,
    eventType: "workflow_state",
    eventBody: `Статус разбора: ${workflowState}`,
    eventPayload: {
      workflowState,
    },
  });

  await dispatchSignalCollaborationNotification({
    tenantId,
    signal: {
      id: signal.id,
      title: signal.title,
      severity: signal.severity,
      nmId: signal.nmId,
    },
    viewer: actor,
    eventType: "workflow_state",
    eventBody: `Статус разбора: ${workflowState}`,
    eventPayload: {
      workflowState,
    },
  });
}

export async function addSignalNote(
  tenantId: string,
  signalId: string,
  noteBody: string,
  actor: SignalDetailViewer,
  options?: {
    eventPayload?: Record<string, unknown>;
  },
) {
  const [signal] = await withTenantContext(db, tenantId, (tx) =>
    tx.select({
      id: riskSignals.id,
      title: riskSignals.title,
      severity: riskSignals.severity,
      nmId: riskSignals.nmId,
    }).from(riskSignals).where(and(
      eq(riskSignals.id, signalId),
      eq(riskSignals.tenantId, tenantId),
      eq(riskSignals.status, "active"),
    )).limit(1),
  );

  if (!signal) {
    throw new Error("Сигнал не найден");
  }

  await recordSignalTimelineEvent({
    tenantId,
    signalId,
    viewer: actor,
    eventType: "note",
    eventBody: noteBody,
    eventPayload: {
      noteLength: noteBody.length,
      ...(options?.eventPayload ?? {}),
    },
  });

  await dispatchSignalCollaborationNotification({
    tenantId,
    signal: {
      id: signal.id,
      title: signal.title,
      severity: signal.severity,
      nmId: signal.nmId,
    },
    viewer: actor,
    eventType: "note",
    eventBody: noteBody,
    eventPayload: {
      noteLength: noteBody.length,
      ...(options?.eventPayload ?? {}),
    },
  });
}

export async function updateSignalStatus(tenantId: string, signalId: string, status: 'resolved' | 'ignored') {
  return await withTenantContext(db, tenantId, (tx) =>
    tx.update(riskSignals)
      .set({
        status,
        resolvedAt: status === 'resolved' ? new Date() : null
      })
      .where(and(eq(riskSignals.id, signalId), eq(riskSignals.tenantId, tenantId))),
  );
}

