import { inngest } from "@/inngest/client";
import { handleInngestFailure } from "@/inngest/on-failure";
import { runRouteScanForAllTenants } from "@/server/redistribution/route-scan";

const REDISTRIBUTION_ROUTE_SCAN_CRON = process.env.REDISTRIBUTION_ROUTE_SCAN_CRON ?? "35 6 * * *";

export const redistributionRouteScanJob = inngest.createFunction(
  {
    id: "redistribution-route-scan-daily",
    name: "Redistribution Route Scan Daily",
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: REDISTRIBUTION_ROUTE_SCAN_CRON }],
  },
  async ({ step }) => {
    const result = await step.run("redistribution-route-scan-all-tenants", async () => {
      return runRouteScanForAllTenants();
    });

    return {
      cron: REDISTRIBUTION_ROUTE_SCAN_CRON,
      ...result,
    };
  },
);
