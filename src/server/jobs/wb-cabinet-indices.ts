import { ne } from 'drizzle-orm';

import { inngest } from '@/inngest/client';
import { handleInngestFailure } from '@/inngest/on-failure';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { refreshCabinetIndicesFromWbTariffsForTenant } from '@/server/economics/cabinet-indices';

// 10:00 Monday Moscow = 07:00 UTC.
const CABINET_INDICES_WEEKLY_CRON = process.env.WB_CABINET_INDICES_WEEKLY_CRON ?? '0 7 * * 1';

export const wbCabinetIndicesWeeklyJob = inngest.createFunction(
  {
    id: 'wb-cabinet-indices-weekly',
    name: 'WB Cabinet Indices Weekly',
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: CABINET_INDICES_WEEKLY_CRON }],
  },
  async ({ step }) => {
    const tenantRows = await step.run('fetch-active-tenants', async () => db
      .select({ id: tenants.id, wbLkStorageState: tenants.wbLkStorageState })
      .from(tenants)
      .where(ne(tenants.wbTokenHealthStatus, 'invalid')));

    let refreshed = 0;
    let skippedWithoutLkSession = 0;
    let failed = 0;
    const failures: Array<{ tenantId: string; message: string }> = [];

    for (const tenant of tenantRows) {
      if (!tenant.wbLkStorageState?.trim()) {
        skippedWithoutLkSession += 1;
        continue;
      }

      try {
        await step.run(`refresh-cabinet-indices-${tenant.id}`, async () => (
          refreshCabinetIndicesFromWbTariffsForTenant(tenant.id)
        ));
        refreshed += 1;
      } catch (error) {
        failed += 1;
        failures.push({
          tenantId: tenant.id,
          message: error instanceof Error ? error.message : 'unknown_error',
        });
      }
    }

    return {
      scannedTenants: tenantRows.length,
      refreshed,
      skippedWithoutLkSession,
      failed,
      failures,
      schedule: CABINET_INDICES_WEEKLY_CRON,
      note: 'Uses exact cabinet-wide WB tariff indices from the Seller portal weekly-rating endpoint. Approximate per-SKU fallback is intentionally disabled.',
    };
  },
);
