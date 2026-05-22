import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db, withAdminContext } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { AnalyticsEngine } from "@/server/analytics/engine";

const DEFAULT_SIGNAL_SLA_FOLLOW_UP_CRON = process.env.SIGNAL_SLA_FOLLOW_UP_CRON ?? "45 */2 * * *";

const scheduledFollowUpActor = {
  userId: null,
  actorEmail: "system:sla-follow-up",
  actorRole: "system",
  openedFrom: "overview" as const,
};

export async function runScheduledSignalSlaFollowUpForTenant(
  tenantId: string,
  tenantName: string,
  options?: {
    dryRun?: boolean;
  },
) {
  const result = await AnalyticsEngine.runSignalSlaPendingFollowUpSweep(
    tenantId,
    scheduledFollowUpActor,
    {
      dryRun: options?.dryRun ?? false,
    },
  );

  return {
    tenantId,
    tenantName,
    ...result,
  };
}

export async function runScheduledSignalSlaFollowUpSweep(options?: {
  dryRun?: boolean;
}) {
  const activeTenants = await withAdminContext(db, (tx) =>
    tx
      .select({
        id: tenants.id,
        name: tenants.name,
      })
      .from(tenants),
  );

  const tenantsResults = [];

  for (const tenant of activeTenants) {
    tenantsResults.push(await runScheduledSignalSlaFollowUpForTenant(tenant.id, tenant.name, options));
  }

  return {
    scannedTenants: activeTenants.length,
    runsScanned: tenantsResults.reduce((sum, tenant) => sum + tenant.runsScanned, 0),
    runsWithPending: tenantsResults.reduce((sum, tenant) => sum + tenant.runsWithPending, 0),
    runsFollowedUp: tenantsResults.reduce((sum, tenant) => sum + tenant.runsFollowedUp, 0),
    signalsPending: tenantsResults.reduce((sum, tenant) => sum + tenant.signalsPending, 0),
    affected: tenantsResults.reduce((sum, tenant) => sum + tenant.affected, 0),
    skippedRecentlyReminded: tenantsResults.reduce((sum, tenant) => sum + tenant.skippedRecentlyReminded, 0),
    skippedSuppressed: tenantsResults.reduce((sum, tenant) => sum + (tenant.skippedSuppressed ?? 0), 0),
    awaitingExplicitOutcome: tenantsResults.reduce((sum, tenant) => sum + (tenant.awaitingExplicitOutcome ?? 0), 0),
    skippedAcknowledged: tenantsResults.reduce((sum, tenant) => sum + (tenant.skippedAcknowledged ?? 0), 0),
    skippedOutcomeCaptured: tenantsResults.reduce((sum, tenant) => sum + (tenant.skippedOutcomeCaptured ?? 0), 0),
    escalationEligible: tenantsResults.reduce((sum, tenant) => sum + (tenant.escalationEligible ?? 0), 0),
    escalationAlertsTriggered: tenantsResults.reduce((sum, tenant) => sum + (tenant.escalationAlertsTriggered ?? 0), 0),
    skippedEscalationRecently: tenantsResults.reduce((sum, tenant) => sum + (tenant.skippedEscalationRecently ?? 0), 0),
    skippedEscalationTooFresh: tenantsResults.reduce((sum, tenant) => sum + (tenant.skippedEscalationTooFresh ?? 0), 0),
    tenants: tenantsResults,
  };
}

export const signalSlaFollowUpJob = inngest.createFunction(
  {
    id: "signal-sla-follow-up",
    name: "Signal SLA Follow-Up Sweep",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: DEFAULT_SIGNAL_SLA_FOLLOW_UP_CRON }],
  },
  async ({ step }) => {
    const activeTenants = await step.run("fetch-tenants", async () => {
      return withAdminContext(db, (tx) =>
        tx
          .select({
            id: tenants.id,
            name: tenants.name,
          })
          .from(tenants),
      );
    });

    const tenantsResults = [];

    for (const tenant of activeTenants) {
      const result = await step.run(`signal-sla-follow-up-${tenant.id}`, async () => {
        return runScheduledSignalSlaFollowUpForTenant(tenant.id, tenant.name);
      });

      tenantsResults.push(result);
    }

    return {
      scannedTenants: activeTenants.length,
      runsScanned: tenantsResults.reduce((sum, tenant) => sum + tenant.runsScanned, 0),
      runsWithPending: tenantsResults.reduce((sum, tenant) => sum + tenant.runsWithPending, 0),
      runsFollowedUp: tenantsResults.reduce((sum, tenant) => sum + tenant.runsFollowedUp, 0),
      signalsPending: tenantsResults.reduce((sum, tenant) => sum + tenant.signalsPending, 0),
      affected: tenantsResults.reduce((sum, tenant) => sum + tenant.affected, 0),
      skippedRecentlyReminded: tenantsResults.reduce((sum, tenant) => sum + tenant.skippedRecentlyReminded, 0),
      skippedSuppressed: tenantsResults.reduce((sum, tenant) => sum + (tenant.skippedSuppressed ?? 0), 0),
      awaitingExplicitOutcome: tenantsResults.reduce((sum, tenant) => sum + (tenant.awaitingExplicitOutcome ?? 0), 0),
      skippedAcknowledged: tenantsResults.reduce((sum, tenant) => sum + (tenant.skippedAcknowledged ?? 0), 0),
      skippedOutcomeCaptured: tenantsResults.reduce((sum, tenant) => sum + (tenant.skippedOutcomeCaptured ?? 0), 0),
      escalationEligible: tenantsResults.reduce((sum, tenant) => sum + (tenant.escalationEligible ?? 0), 0),
      escalationAlertsTriggered: tenantsResults.reduce((sum, tenant) => sum + (tenant.escalationAlertsTriggered ?? 0), 0),
      skippedEscalationRecently: tenantsResults.reduce((sum, tenant) => sum + (tenant.skippedEscalationRecently ?? 0), 0),
      skippedEscalationTooFresh: tenantsResults.reduce((sum, tenant) => sum + (tenant.skippedEscalationTooFresh ?? 0), 0),
      tenants: tenantsResults,
    };
  },
);
