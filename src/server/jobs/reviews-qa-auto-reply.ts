import { inngest } from '@/inngest/client';
import { handleInngestFailure } from '@/inngest/on-failure';
import { runDueReviewsQaAutoReplies } from '@/server/reviews-qa/auto-reply';

const REVIEWS_QA_AUTO_REPLY_CRON = process.env.REVIEWS_QA_AUTO_REPLY_CRON ?? '*/15 * * * *';

export const reviewsQaAutoReplyJob = inngest.createFunction(
  {
    id: 'reviews-qa-auto-reply',
    name: 'WB Reviews QA Auto Reply',
    concurrency: { limit: 1 },
    onFailure: handleInngestFailure,
    triggers: [{ cron: REVIEWS_QA_AUTO_REPLY_CRON }],
  },
  async () => {
    return runDueReviewsQaAutoReplies();
  },
);
