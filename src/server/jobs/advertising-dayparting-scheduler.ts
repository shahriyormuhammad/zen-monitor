import { ne } from 'drizzle-orm';

import { inngest } from '@/inngest/client';
import { handleInngestFailure } from '@/inngest/on-failure';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decryptIfNeeded } from '@/lib/encryption';
import { explainAction } from '@/lib/advertising/explanations';
import { WbAdActionVerificationError, wbApi } from '@/lib/wb-api';
import { writeAuditEntry } from '@/server/advertising/audit';
import {
  getCampaignsDueForPause,
  getCampaignsDueForResume,
} from '@/server/advertising/dayparting';

const AD_STATUS_ACTIVE = 9;
const AD_STATUS_PAUSED = 11;
type TenantAdvertisingAutopilotMode = 'advisor' | 'semi_auto' | 'auto';

function normalizeTenantAdvertisingAutopilotMode(value: unknown): TenantAdvertisingAutopilotMode {
  return value === 'semi_auto' || value === 'auto' ? value : 'advisor';
}

export function canApplyDaypartingMutations(value: unknown) {
  const mode = normalizeTenantAdvertisingAutopilotMode(value);
  return mode === 'semi_auto' || mode === 'auto';
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getActualVerifiedStatus(error: unknown) {
  if (!(error instanceof WbAdActionVerificationError)) {
    return null;
  }
  return error.failedItems[0]?.actualStatus ?? null;
}

function getMoscowHour(date = new Date()) {
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).getUTCHours();
}

export const advertisingDaypartingSchedulerJob = inngest.createFunction(
  {
    id: 'advertising-dayparting-scheduler',
    name: 'Advertising Dayparting Scheduler',
    onFailure: handleInngestFailure,
    concurrency: { limit: 3 },
    triggers: [{ cron: '0 * * * *' }], // every hour on the hour
  },
  async ({ step }) => {
    const activeTenants = await step.run('fetch-tenants', async () => {
      return db
        .select({
          id: tenants.id,
          wbApiToken: tenants.wbApiToken,
          advertisingAutopilotMode: tenants.advertisingAutopilotMode,
        })
        .from(tenants)
        .where(ne(tenants.wbTokenHealthStatus, 'invalid'));
    }) as Array<{ id: string; wbApiToken: string | null; advertisingAutopilotMode: string | null }>;

    let paused = 0;
    let resumed = 0;
    let errors = 0;
    let skippedByMode = 0;

    for (const tenant of activeTenants) {
      const result = await step.run(`dayparting-${tenant.id}`, async () => {
        const token = decryptIfNeeded(tenant.wbApiToken ?? '').trim();
        if (!token) return { paused: 0, resumed: 0, errors: 0, skippedByMode: 0 };
        if (!canApplyDaypartingMutations(tenant.advertisingAutopilotMode)) {
          return { paused: 0, resumed: 0, errors: 0, skippedByMode: 1 };
        }

        const [pauseCampaigns, resumeCampaigns] = await Promise.all([
          getCampaignsDueForPause(tenant.id),
          getCampaignsDueForResume(tenant.id),
        ]);

        let localPaused = 0;
        let localResumed = 0;
        let localErrors = 0;

        const nowHour = getMoscowHour();

        for (const campaignId of pauseCampaigns) {
          const reason = explainAction({ type: 'dayparting_pause', hour: nowHour });
          try {
            await wbApi.pauseAdvert(token, campaignId);
            await writeAuditEntry({
              tenantId: tenant.id,
              campaignId,
              actionType: 'dayparting_pause',
              reason,
              source: 'dayparting_cron',
              valueAfter: {
                verificationStatus: 'verified',
                expectedStatus: AD_STATUS_PAUSED,
              },
            });
            localPaused += 1;
          } catch (error) {
            await writeAuditEntry({
              tenantId: tenant.id,
              campaignId,
              actionType: 'dayparting_pause',
              reason,
              source: 'dayparting_cron',
              valueAfter: {
                verificationStatus: 'failed',
                expectedStatus: AD_STATUS_PAUSED,
                actualStatus: getActualVerifiedStatus(error),
                error: getErrorMessage(error),
              },
            });
            localErrors += 1;
          }
        }

        for (const campaignId of resumeCampaigns) {
          const reason = explainAction({ type: 'dayparting_resume', hour: nowHour });
          try {
            await wbApi.resumeAdvert(token, campaignId);
            await writeAuditEntry({
              tenantId: tenant.id,
              campaignId,
              actionType: 'dayparting_resume',
              reason,
              source: 'dayparting_cron',
              valueAfter: {
                verificationStatus: 'verified',
                expectedStatus: AD_STATUS_ACTIVE,
              },
            });
            localResumed += 1;
          } catch (error) {
            await writeAuditEntry({
              tenantId: tenant.id,
              campaignId,
              actionType: 'dayparting_resume',
              reason,
              source: 'dayparting_cron',
              valueAfter: {
                verificationStatus: 'failed',
                expectedStatus: AD_STATUS_ACTIVE,
                actualStatus: getActualVerifiedStatus(error),
                error: getErrorMessage(error),
              },
            });
            localErrors += 1;
          }
        }

        return { paused: localPaused, resumed: localResumed, errors: localErrors, skippedByMode: 0 };
      }) as { paused: number; resumed: number; errors: number; skippedByMode: number };

      paused += result.paused;
      resumed += result.resumed;
      errors += result.errors;
      skippedByMode += result.skippedByMode;
    }

    return { paused, resumed, errors, skippedByMode };
  },
);
