import { ne } from 'drizzle-orm';

import { inngest } from '@/inngest/client';
import { handleInngestFailure } from '@/inngest/on-failure';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { syncAdvertisingBalance } from '@/server/advertising/balance';

const BALANCE_SYNC_CRON = process.env.AD_BALANCE_SYNC_CRON ?? '17 */2 * * *';

export const advertisingBalanceSyncJob = inngest.createFunction(
  {
    id: 'advertising-balance-sync',
    name: 'Advertising Balance Sync',
    onFailure: handleInngestFailure,
    concurrency: { limit: 5 },
    triggers: [{ cron: BALANCE_SYNC_CRON }],
  },
  async ({ step }) => {
    const activeTenants = await step.run('fetch-tenants', async () => {
      return db
        .select({ id: tenants.id })
        .from(tenants)
        .where(ne(tenants.wbTokenHealthStatus, 'invalid'));
    }) as Array<{ id: string }>;

    let synced = 0;
    let skipped = 0;

    for (const tenant of activeTenants) {
      const result = await step.run(`sync-balance-${tenant.id}`, async () => {
        try {
          await syncAdvertisingBalance(tenant.id);
          return { ok: true };
        } catch {
          return { ok: false };
        }
      }) as { ok: boolean };

      if (result.ok) {
        synced += 1;
      } else {
        skipped += 1;
      }
    }

    return { synced, skipped };
  }
);
