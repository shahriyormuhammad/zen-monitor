import { redistributionDigestJob } from "./redistribution-digest";
import { redistributionRpaJob } from "./redistribution-rpa";
import { redistributionRouteScanJob } from "./redistribution-route-scan";
import { redistributionSlotMonitorJob } from "./redistribution-slot-monitor";

export const redistributionInngestFunctions = [
  redistributionRouteScanJob,
  redistributionSlotMonitorJob,
  redistributionDigestJob,
  redistributionRpaJob,
];
