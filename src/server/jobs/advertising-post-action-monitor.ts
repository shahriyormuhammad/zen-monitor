import { inngest } from '@/inngest/client';
import { handleInngestFailure } from '@/inngest/on-failure';
import { runAdvertisingPostActionMonitor } from '@/server/advertising/post-action-monitor';

const AD_POST_ACTION_MONITOR_CRON = process.env.AD_POST_ACTION_MONITOR_CRON ?? '17 * * * *';

export const advertisingPostActionMonitorJob = inngest.createFunction(
  {
    id: 'advertising-post-action-monitor',
    name: 'Advertising Post-action Monitor',
    onFailure: handleInngestFailure,
    concurrency: { limit: 1 },
    triggers: [{ cron: AD_POST_ACTION_MONITOR_CRON }],
  },
  async ({ step }) => step.run('monitor-bid-changes', async () => runAdvertisingPostActionMonitor()),
);
