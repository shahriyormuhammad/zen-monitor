import { signalSlaFollowUpJob } from "./signal-sla-follow-up";
import { signalSlaSweepJob } from "./signal-sla-sweep";
import { stockAlertsJob } from "./stock-alerts";

export const opsInngestFunctions = [
  signalSlaFollowUpJob,
  signalSlaSweepJob,
  stockAlertsJob,
];
