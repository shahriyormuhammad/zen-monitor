import { and, eq } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db, withAdminContext, withTenantContext } from "@/lib/db";
import { riskSignals, tenants } from "@/lib/db/schema";
import { AnalyticsEngine } from "@/server/analytics/engine";

const DEFAULT_SIGNAL_SLA_SWEEP_CRON = process.env.SIGNAL_SLA_SWEEP_CRON ?? "15 * * * *";

const scheduledSlaActor = {
  userId: null,
  actorEmail: "system:sla-sweep",
  actorRole: "system",
  openedFrom: "overview" as const,
};

export async function runScheduledSignalSlaSweepForTenant(
  tenantId: string,
  tenantName: string,
  options?: {
    dryRun?: boolean;
  },
) {
  const activeSignals = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({ id: riskSignals.id })
      .from(riskSignals)
      .where(and(
        eq(riskSignals.tenantId, tenantId),
        eq(riskSignals.status, "active"),
      )),
  );

  const result = await AnalyticsEngine.runSignalSlaAutomation(
    tenantId,
    activeSignals.map((signal) => signal.id),
    scheduledSlaActor,
    {
      automationSource: "scheduled",
      dryRun: options?.dryRun ?? false,
    },
  );

  return {
    tenantId,
    tenantName,
    scannedSignals: activeSignals.length,
    ...result,
  };
}

export async function runScheduledSignalSlaSweep(options?: {
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
    tenantsResults.push(await runScheduledSignalSlaSweepForTenant(tenant.id, tenant.name, options));
  }

  return {
    scannedTenants: activeTenants.length,
    affected: tenantsResults.reduce((sum, tenant) => sum + tenant.affected, 0),
    eligible: tenantsResults.reduce((sum, tenant) => sum + tenant.eligible, 0),
    skippedAlreadyEscalated: tenantsResults.reduce((sum, tenant) => sum + tenant.skippedAlreadyEscalated, 0),
    tenants: tenantsResults,
  };
}

export const signalSlaSweepJob = inngest.createFunction(
  {
    id: "signal-sla-sweep",
    name: "Signal SLA Sweep",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: DEFAULT_SIGNAL_SLA_SWEEP_CRON }],
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
      const result = await step.run(`signal-sla-sweep-${tenant.id}`, async () => {
        return runScheduledSignalSlaSweepForTenant(tenant.id, tenant.name);
      });

      tenantsResults.push(result);
    }

    return {
      scannedTenants: activeTenants.length,
      affected: tenantsResults.reduce((sum, tenant) => sum + tenant.affected, 0),
      eligible: tenantsResults.reduce((sum, tenant) => sum + tenant.eligible, 0),
      skippedAlreadyEscalated: tenantsResults.reduce((sum, tenant) => sum + tenant.skippedAlreadyEscalated, 0),
      tenants: tenantsResults,
    };
  },
);
