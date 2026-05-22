import { ne } from 'drizzle-orm';

import { inngest } from '@/inngest/client';
import { handleInngestFailure } from '@/inngest/on-failure';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { syncAdvertisingHourlyStats } from '@/server/advertising/hourly-stats';

const HOURLY_STATS_SYNC_CRON = process.env.AD_HOURLY_STATS_SYNC_CRON ?? '7 * * * *';

export const advertisingHourlyStatsSyncJob = inngest.createFunction(
  {
    id: 'advertising-hourly-stats-sync',
    name: 'Advertising Hourly Stats Sync',
    onFailure: handleInngestFailure,
    concurrency: { limit: 2 },
    triggers: [{ cron: HOURLY_STATS_SYNC_CRON }],
  },
  async ({ step }) => {
    const activeTenants = await step.run('fetch-tenants', async () => {
      return db
        .select({ id: tenants.id })
        .from(tenants)
        .where(ne(tenants.wbTokenHealthStatus, 'invalid'));
    }) as Array<{ id: string }>;

    let syncedTenants = 0;
    let skippedTenants = 0;
    let syncedRows = 0;
    let firstSnapshots = 0;

    for (const tenant of activeTenants) {
      const result = await step.run(`sync-hourly-ads-${tenant.id}`, async () => {
        try {
          return await syncAdvertisingHourlyStats(tenant.id);
        } catch {
          return null;
        }
      }) as Awaited<ReturnType<typeof syncAdvertisingHourlyStats>> | null;

      if (!result) {
        skippedTenants += 1;
        continue;
      }

      syncedTenants += 1;
      syncedRows += result.synced;
      firstSnapshots += result.firstSnapshots;
    }

    return {
      syncedTenants,
      skippedTenants,
      syncedRows,
      firstSnapshots,
    };
  },
);
