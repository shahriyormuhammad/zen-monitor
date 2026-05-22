import { ne } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { reconcileWbSupplyWriteoffsForTenant } from "@/server/analytics/stocks-v2/supply-writeoffs";

const WB_SUPPLY_WRITEOFF_CRON = process.env.WB_SUPPLY_WRITEOFF_CRON ?? "30 20 * * *"; // 23:30 MSK

export const wbSupplyWriteoffsJob = inngest.createFunction(
  {
    id: "wb-supply-writeoffs-nightly",
    name: "WB Supply Writeoffs Nightly",
    onFailure: handleInngestFailure,
    concurrency: { limit: 1 },
    triggers: [{ cron: WB_SUPPLY_WRITEOFF_CRON }],
  },
  async ({ step }) => {
    const activeTenants = await step.run("fetch-tenants", async () => {
      return db
        .select({
          id: tenants.id,
          wbApiToken: tenants.wbApiToken,
        })
        .from(tenants)
        .where(ne(tenants.wbTokenHealthStatus, "invalid"));
    });

    const results: Array<{
      tenantId: string;
      skipped?: string;
      suppliesScanned?: number;
      linesSeen?: number;
      writtenOffLines?: number;
      writtenOffUnits?: number;
      discrepancies?: number;
      writeOffErrors?: number;
      notificationsSent?: boolean;
    }> = [];

    for (const tenant of activeTenants) {
      if (!tenant.wbApiToken?.trim()) {
        results.push({ tenantId: tenant.id, skipped: "no_token" });
        continue;
      }

      const result = await step.run(`supply-writeoffs-${tenant.id}`, async () => {
        return reconcileWbSupplyWriteoffsForTenant(tenant.id);
      });

      results.push({
        tenantId: tenant.id,
        ...result,
      });
    }

    return {
      tenants: results.length,
      results,
    };
  },
);
