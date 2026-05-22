import { inngest } from '@/inngest/client';
import { handleInngestFailure } from '@/inngest/on-failure';
import { runAdvertisingDecisionAutopilot } from '@/server/advertising/decision-autopilot';

const AD_DECISION_AUTOPILOT_CRON = process.env.AD_DECISION_AUTOPILOT_CRON ?? '*/30 * * * *';

export const advertisingDecisionAutopilotJob = inngest.createFunction(
  {
    id: 'advertising-decision-autopilot',
    name: 'Advertising Decision Autopilot',
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: AD_DECISION_AUTOPILOT_CRON }],
  },
  async () => runAdvertisingDecisionAutopilot(),
);
