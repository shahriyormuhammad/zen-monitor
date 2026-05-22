import { inngest } from '@/inngest/client';
import { handleInngestFailure } from '@/inngest/on-failure';
import {
  runDueAdvertisingPacingRules,
  runDueAdvertisingPortfolios,
} from '@/server/advertising/pacing-portfolios';
import { runDueAdvertisingAutoBidStrategies } from '@/server/advertising/workspace';

const AD_AUTO_BIDDER_CRON = process.env.AD_AUTO_BIDDER_CRON ?? '*/20 * * * *';

export const advertisingAutoBidderJob = inngest.createFunction(
  {
    id: 'advertising-auto-bidder',
    name: 'Рекламный автобидер',
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: AD_AUTO_BIDDER_CRON }],
  },
  async () => {
    const [strategies, pacing, portfolios] = await Promise.all([
      runDueAdvertisingAutoBidStrategies(),
      runDueAdvertisingPacingRules(),
      runDueAdvertisingPortfolios(),
    ]);

    return {
      strategies,
      pacing,
      portfolios,
    };
  },
);
