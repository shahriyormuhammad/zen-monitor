import { db, withTenantContext } from "@/lib/db";
import { and, eq, inArray } from "drizzle-orm";
import { products, riskSignals } from "@/lib/db/schema";
import type { SignalFeedResponse, SignalWorkflowState } from "@/lib/operator-signal-timeline";
import { resolveSignalWorkflowState } from "@/lib/operator-signal-timeline";
import { buildSignalAgingSummary, buildSignalFixAction, normalizeSignalSeverity } from "../helpers/signals";
import {
  getActiveSignals,
  getLatestSignalEscalations,
  getSignalWorkflowMembers,
  assignSignalOwner,
  updateSignalWorkflowState,
  addSignalNote,
} from "./signal-core";
import * as SignalSavedViewsService from "./signal-saved-views";
import * as SignalAutomationQueriesService from "./signal-automation-queries";
import type { SignalDetailViewer } from "./signal-automation-queries";

export { dispatchSignalCollaborationNotification } from "./signal-core";

export async function getSignalsFeed(tenantId: string, currentUserId: string, currentUserRole: string): Promise<SignalFeedResponse> {
  const [signals, availableAssignees, savedViews, automationRuns, automationSuppressions, automationControlEvents] = await Promise.all([
    getActiveSignals(tenantId),
    getSignalWorkflowMembers(tenantId),
    SignalSavedViewsService.getSignalSavedViews(tenantId, currentUserId, currentUserRole),
    SignalAutomationQueriesService.getSignalAutomationRuns(tenantId),
    SignalAutomationQueriesService.getSignalAutomationSuppressions(tenantId),
    SignalAutomationQueriesService.getSignalAutomationControlEvents(tenantId),
  ]);
  const latestEscalations = await getLatestSignalEscalations(tenantId, signals.map((signal) => ({
    id: signal.id,
    status: signal.status,
    resolvedAt: signal.resolvedAt ?? null,
    workflowUpdatedAt: signal.workflowUpdatedAt ?? null,
    workflowUpdatedByEmail: signal.workflowUpdatedByEmail ?? null,
  })));
  const nmIds = Array.from(new Set(
    signals
      .map((signal) => Number(signal.nmId ?? 0))
      .filter((nmId) => Number.isInteger(nmId) && nmId > 0),
  ));
  const productRows = nmIds.length
    ? await withTenantContext(db, tenantId, (tx) => tx
      .select({
        nmId: products.nmId,
        vendorCode: products.vendorCode,
        brand: products.brand,
        photoUrl: products.photoUrl,
      })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), inArray(products.nmId, nmIds))))
    : [];
  const productByNmId = new Map(productRows.map((product) => [Number(product.nmId), product]));

  return {
    signals: signals.map((signal) => {
      const product = signal.nmId ? productByNmId.get(Number(signal.nmId)) ?? null : null;
      const primaryAction = buildSignalFixAction({
        type: signal.type,
        nmId: signal.nmId,
        signalTitle: signal.title,
        signalId: signal.id,
      });

      return {
        id: signal.id,
        nmId: signal.nmId,
        vendorCode: product?.vendorCode ?? null,
        brand: product?.brand ?? null,
        photoUrl: product?.photoUrl ?? null,
        type: signal.type,
        severity: normalizeSignalSeverity(signal.severity),
        title: signal.title,
        description: signal.description,
        impactRub: signal.impactRub,
        primaryActionLabel: primaryAction.label,
        primaryActionHref: primaryAction.href,
        createdAt: signal.createdAt,
        workflowState: resolveSignalWorkflowState(signal.workflowState) ?? "new",
        assigneeUserId: signal.assigneeUserId ?? null,
        assigneeEmail: signal.assigneeEmail ?? null,
        status: signal.status,
        workflowUpdatedAt: signal.workflowUpdatedAt ?? null,
        aging: buildSignalAgingSummary({
          createdAt: signal.createdAt,
          workflowUpdatedAt: signal.workflowUpdatedAt,
          workflowState: resolveSignalWorkflowState(signal.workflowState) ?? "new",
        }),
        lastEscalation: latestEscalations.get(signal.id) ?? null,
      };
    }),
    availableAssignees,
    savedViews,
    automationRuns,
    automationSuppressions,
    automationControlEvents,
  };
}

export async function bulkUpdateSignalStatus(
  tenantId: string,
  signalIds: string[],
  status: 'resolved' | 'ignored',
) {
  const uniqueSignalIds = Array.from(new Set(signalIds.filter(Boolean)));
  if (uniqueSignalIds.length === 0) {
    return { affected: 0 };
  }

  const setPayload =
    status === 'resolved'
      ? { status, resolvedAt: new Date() }
      : { status, resolvedAt: null };

  await withTenantContext(db, tenantId, (tx) =>
    tx.update(riskSignals)
      .set(setPayload)
      .where(and(
        eq(riskSignals.tenantId, tenantId),
        inArray(riskSignals.id, uniqueSignalIds),
      )),
  );

  return { affected: uniqueSignalIds.length };
}

export async function bulkAssignSignalOwner(
  tenantId: string,
  signalIds: string[],
  assigneeUserId: string | null,
  actor: SignalDetailViewer,
) {
  const uniqueSignalIds = Array.from(new Set(signalIds.filter(Boolean)));
  for (const signalId of uniqueSignalIds) {
    await assignSignalOwner(tenantId, signalId, assigneeUserId, actor);
  }
  return { affected: uniqueSignalIds.length };
}

export async function bulkUpdateSignalWorkflowState(
  tenantId: string,
  signalIds: string[],
  workflowState: SignalWorkflowState,
  actor: SignalDetailViewer,
) {
  const uniqueSignalIds = Array.from(new Set(signalIds.filter(Boolean)));
  for (const signalId of uniqueSignalIds) {
    await updateSignalWorkflowState(tenantId, signalId, workflowState, actor);
  }
  return { affected: uniqueSignalIds.length };
}

export async function bulkAddSignalNote(
  tenantId: string,
  signalIds: string[],
  noteBody: string,
  actor: SignalDetailViewer,
  eventPayload?: Record<string, unknown>,
) {
  const uniqueSignalIds = Array.from(new Set(signalIds.filter(Boolean)));
  for (const signalId of uniqueSignalIds) {
    await addSignalNote(tenantId, signalId, noteBody, actor, { eventPayload });
  }
  return { affected: uniqueSignalIds.length };
}

export async function bulkApplySignalHandoffPreset(
  tenantId: string,
  signalIds: string[],
  payload: {
    assigneeUserId?: string | null;
    workflowState: SignalWorkflowState;
    noteBody: string;
    noteEventPayload?: Record<string, unknown>;
  },
  actor: SignalDetailViewer,
) {
  const uniqueSignalIds = Array.from(new Set(signalIds.filter(Boolean)));
  if (uniqueSignalIds.length === 0) {
    return { affected: 0 };
  }

  if (payload.assigneeUserId !== undefined) {
    await bulkAssignSignalOwner(tenantId, uniqueSignalIds, payload.assigneeUserId ?? null, actor);
  }

  await bulkUpdateSignalWorkflowState(tenantId, uniqueSignalIds, payload.workflowState, actor);
  await bulkAddSignalNote(tenantId, uniqueSignalIds, payload.noteBody, actor, payload.noteEventPayload);

  return { affected: uniqueSignalIds.length };
}
