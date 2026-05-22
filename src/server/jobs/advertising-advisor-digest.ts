import { inngest } from '@/inngest/client';
import { handleInngestFailure } from '@/inngest/on-failure';
import {
  buildAndSendDigestForTenant,
  listTenantsForDigest,
} from '@/server/advertising/advisor-digest';
import { logger } from '@/lib/logger';

const DIGEST_CRON = process.env.AD_ADVISOR_DIGEST_CRON ?? '0 9 * * *';

/**
 * Daily digest of advertising autopilot activity (P70).
 * Ежедневно в 09:00 (Europe/Moscow) для каждого тенанта с `telegramChatId`
 * и хотя бы одним auto-изменением ставки за последние 24ч отправляем TG-алерт
 * `advisor_daily_digest`. Throttle 24ч из P70 защищает от повторов при
 * пересечении cron и ручного запуска.
 */
export const advertisingAdvisorDigestJob = inngest.createFunction(
  {
    id: 'advertising-advisor-digest',
    name: 'Advertising Advisor Daily Digest',
    onFailure: handleInngestFailure,
    concurrency: { limit: 3 },
    triggers: [{ cron: DIGEST_CRON }],
  },
  async ({ step }) => {
    const tenantIds = await step.run('list-tenants', async () => {
      return listTenantsForDigest();
    }) as string[];

    let sent = 0;
    let skipped = 0;

    for (const tenantId of tenantIds) {
      const result = await step.run(`digest-${tenantId}`, async () => {
        try {
          return await buildAndSendDigestForTenant(tenantId);
        } catch (error: unknown) {
          logger.error({ err: error, tenantId }, '[advisor-digest] tenant digest failed');
          return { status: 'skipped' as const, reason: 'send_failed' as const };
        }
      });

      if (result.status === 'sent') {
        sent += 1;
      } else {
        skipped += 1;
      }
    }

    return { totalTenants: tenantIds.length, sent, skipped };
  },
);
