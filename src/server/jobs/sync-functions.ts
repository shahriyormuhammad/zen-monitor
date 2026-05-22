import { wbSyncAdsRetryDispatcher } from "./wb-ads-retry";
import {
  wbSppSnapshotJob,
  wbSyncFastJob,
  wbSyncMediumJob,
  wbSyncNightlyJob,
  wbSyncWeeklyFinanceRetryJob,
} from "./wb-scheduled-sync";
import { wbSyncRecoveryJob } from "./wb-sync-recovery";
import { wbSupplyWriteoffsJob } from "./wb-supply-writeoffs";
import { staleSyncAlertJob } from "@/inngest/stale-sync-alert";
import { wbTokenPreflightJob } from "@/inngest/wb-token-preflight";

export const syncInngestFunctions = [
  wbSyncAdsRetryDispatcher,
  wbSyncFastJob,
  wbSyncMediumJob,
  wbSyncNightlyJob,
  wbSyncWeeklyFinanceRetryJob,
  wbSyncRecoveryJob,
  wbSupplyWriteoffsJob,
  wbSppSnapshotJob,
  staleSyncAlertJob,
  wbTokenPreflightJob,
];
