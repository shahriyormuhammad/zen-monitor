import { advertisingAdvisorDigestJob } from "./advertising-advisor-digest";
import { advertisingAutoBidderJob } from "./advertising-auto-bidder";
import { advertisingBalanceSyncJob } from "./advertising-balance-sync";
import { advertisingDaypartingSchedulerJob } from "./advertising-dayparting-scheduler";
import { advertisingDecisionAutopilotJob } from "./advertising-decision-autopilot";
import { advertisingHourlyStatsSyncJob } from "./advertising-hourly-stats-sync";
import { advertisingPostActionMonitorJob } from "./advertising-post-action-monitor";

export const advertisingInngestFunctions = [
  advertisingAdvisorDigestJob,
  advertisingAutoBidderJob,
  advertisingDecisionAutopilotJob,
  advertisingPostActionMonitorJob,
  advertisingBalanceSyncJob,
  advertisingHourlyStatsSyncJob,
  advertisingDaypartingSchedulerJob,
];
