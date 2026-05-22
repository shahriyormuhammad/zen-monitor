import { and, inArray, max } from 'drizzle-orm';

import { inngest } from './client';
import { handleInngestFailure } from './on-failure';
import { db, withAdminContext } from '@/lib/db';
import { syncRuns } from '@/lib/db/schema';
import { bot } from '@/server/bot/service';
import { logger } from '@/lib/logger';

const STALE_THRESHOLD_HOURS = Number(process.env.SYNC_STALE_ALERT_HOURS ?? '6');
// Tenants inactive for this long are treated as dormant (paused, trial expired, etc.) and are
// not alerted. Cuts false positives from onboarding gaps and long holidays.
const DORMANT_THRESHOLD_DAYS = Number(process.env.SYNC_DORMANT_DAYS ?? '14');
const SUCCESSFUL_STATUSES = ['completed', 'partial'] as const;

export const staleSyncAlertJob = inngest.createFunction(
  {
    id: 'stale-sync-alert',
    name: 'Stale Sync Alert',
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: '0 */2 * * *' }], // every 2 hours
  },
  async ({ step }) => {
    const alertTenants = await step.run('get-alert-tenants', () =>
      db.query.tenants.findMany({
        where: (t, { and: qAnd, eq: qEq, isNotNull: qIsNotNull }) =>
          qAnd(
            qEq(t.notificationsEnabled, true),
            qIsNotNull(t.telegramChatId),
            qIsNotNull(t.wbApiToken),
          ),
        columns: { id: true, telegramChatId: true },
      })
    );

    if (alertTenants.length === 0) {
      return { checked: 0, stale: 0 };
    }

    const tenantIds = alertTenants.map((t) => t.id);

    // Admin-path: cross-tenant aggregate over syncRuns for stale-detection.
    const lastSyncRows = await step.run('get-last-successful-syncs', () =>
      withAdminContext(db, (tx) =>
        tx
          .select({
            tenantId: syncRuns.tenantId,
            lastFinishedAt: max(syncRuns.finishedAt),
          })
          .from(syncRuns)
          .where(
            and(
              inArray(syncRuns.tenantId, tenantIds),
              inArray(syncRuns.status, [...SUCCESSFUL_STATUSES]),
            )
          )
          .groupBy(syncRuns.tenantId),
      )
    );

    const now = Date.now();
    const staleMs = STALE_THRESHOLD_HOURS * 3_600_000;
    const dormantMs = DORMANT_THRESHOLD_DAYS * 24 * 3_600_000;

    const staleTenants: Array<{ id: string; telegramChatId: number; hoursAgo: number }> = [];

    for (const tenant of alertTenants) {
      const row = lastSyncRows.find((r) => r.tenantId === tenant.id);
      // Skip tenants with no successful sync ever — they may be onboarding
      if (!row?.lastFinishedAt) continue;

      const elapsed = now - new Date(row.lastFinishedAt).getTime();
      // Skip dormant tenants (paused, trial expired, holidays) to cut false positives
      if (elapsed > dormantMs) continue;
      if (elapsed > staleMs) {
        staleTenants.push({
          id: tenant.id,
          telegramChatId: tenant.telegramChatId!,
          hoursAgo: Math.round(elapsed / 3_600_000),
        });
      }
    }

    logger.info(
      { checked: alertTenants.length, stale: staleTenants.length },
      'Stale sync check complete'
    );

    if (staleTenants.length === 0) {
      return { checked: alertTenants.length, stale: 0 };
    }

    logger.warn(
      { staleTenantIds: staleTenants.map((t) => t.id) },
      'Stale sync detected — sending Telegram alerts'
    );

    await step.run('send-stale-alerts', async () => {
      if (!bot) return;

      for (const tenant of staleTenants) {
        const message = [
          `⚠️ <b>Синхронизация данных WB устарела</b>`,
          ``,
          `Последняя успешная синхронизация была <b>${tenant.hoursAgo} ч. назад</b>.`,
          `Нормальный интервал: каждые ${STALE_THRESHOLD_HOURS} ч.`,
          ``,
          `Проверьте статус в разделе «Настройки → Синхронизация» или обратитесь в поддержку.`,
        ].join('\n');

        try {
          await bot.api.sendMessage(tenant.telegramChatId, message, { parse_mode: 'HTML' });
        } catch (err) {
          logger.error({ err, tenantId: tenant.id }, 'Failed to send stale sync Telegram alert');
        }
      }
    });

    return { checked: alertTenants.length, stale: staleTenants.length };
  }
);
