import { isStaleSyncRunError } from "@/lib/sync-run";
import {
  WB_SYNC_FAST_SOURCES,
  WB_SYNC_MEDIUM_SOURCES,
  WB_SYNC_NIGHTLY_SOURCES,
  WB_SYNC_PRICE_SNAPSHOT_SOURCES,
  WB_SYNC_WEEKLY_FINANCE_RETRY_SOURCES,
  WB_SYNC_SOURCE_SEQUENCE,
  type WbSyncSource,
} from "@/server/jobs/wb-sync-sources";
import type { SyncSourceSummary } from "@/server/jobs/sync-runtime";

const SOURCE_SET = new Set<WbSyncSource>(WB_SYNC_SOURCE_SEQUENCE);
const ACTIVE_STATUSES = ["pending", "running"] as const;
const DEFAULT_RECOVERY_MAX_ATTEMPTS = 3;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const toDate = (value: unknown) => {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const readString = (value: unknown) => (typeof value === "string" ? value : undefined);

const readNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
};

const isWbSyncSource = (value: unknown): value is WbSyncSource => (
  typeof value === "string" && SOURCE_SET.has(value as WbSyncSource)
);

const normalizeSources = (value: unknown): WbSyncSource[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const selected = new Set<WbSyncSource>();
  for (const source of value) {
    if (isWbSyncSource(source)) {
      selected.add(source);
    }
  }

  return WB_SYNC_SOURCE_SEQUENCE.filter((source) => selected.has(source));
};

const sourcesForTrigger = (triggerSource: string | null | undefined): readonly WbSyncSource[] | null => {
  if (!triggerSource) {
    return null;
  }

  if (triggerSource === "manual") {
    return WB_SYNC_NIGHTLY_SOURCES;
  }

  if (triggerSource.startsWith("scheduled-fast")) {
    return WB_SYNC_FAST_SOURCES;
  }

  if (triggerSource.startsWith("scheduled-medium")) {
    return WB_SYNC_MEDIUM_SOURCES;
  }

  if (triggerSource.startsWith("scheduled-nightly")) {
    return WB_SYNC_NIGHTLY_SOURCES;
  }

  if (triggerSource.startsWith("scheduled-spp-snapshot")) {
    return WB_SYNC_PRICE_SNAPSHOT_SOURCES;
  }

  if (triggerSource.startsWith("scheduled-source-retry")) {
    return ["orders", "sales", "ads", "ad_clusters"];
  }

  if (triggerSource.startsWith("scheduled-ads-retry")) {
    return ["ads", "ad_clusters"];
  }

  if (triggerSource.startsWith("scheduled-weekly-finance-retry")) {
    return WB_SYNC_WEEKLY_FINANCE_RETRY_SOURCES;
  }

  return null;
};

const readRequestedSources = (
  summary: Record<string, unknown>,
  triggerSource: string | null | undefined,
) => {
  const directSources = normalizeSources(summary.requestedSources);
  if (directSources.length > 0) {
    return directSources;
  }

  const adsRetry = isPlainRecord(summary.adsRetry) ? summary.adsRetry : null;
  const adsRetrySources = normalizeSources(adsRetry?.requestedSources);
  if (adsRetrySources.length > 0) {
    return adsRetrySources;
  }

  const sourceRetry = isPlainRecord(summary.sourceRetry) ? summary.sourceRetry : null;
  const sourceRetrySources = normalizeSources(sourceRetry?.requestedSources);
  if (sourceRetrySources.length > 0) {
    return sourceRetrySources;
  }

  const triggerSources = sourcesForTrigger(triggerSource);
  if (triggerSources) {
    return [...triggerSources];
  }

  const progress = isPlainRecord(summary.progress) ? summary.progress : null;
  const totalSources = readNumber(progress?.totalSources);
  if (totalSources === WB_SYNC_SOURCE_SEQUENCE.length) {
    return [...WB_SYNC_SOURCE_SEQUENCE];
  }

  return [];
};

const readCompletedSources = (summary: Record<string, unknown>) => {
  if (!Array.isArray(summary.sources)) {
    return {
      completedSources: [],
      sourceSummaries: [],
    };
  }

  const completed = new Set<WbSyncSource>();
  const sourceSummaries: SyncSourceSummary[] = [];

  for (const item of summary.sources) {
    if (!isPlainRecord(item) || !isWbSyncSource(item.source)) {
      continue;
    }

    completed.add(item.source);
    sourceSummaries.push(item as unknown as SyncSourceSummary);
  }

  return {
    completedSources: [...completed],
    sourceSummaries,
  };
};

const readRecoveryInfo = (summary: Record<string, unknown>) => {
  const recovery = isPlainRecord(summary.recovery) ? summary.recovery : {};
  return {
    attempt: readNumber(recovery.attempt) ?? 0,
    recoverySyncRunId: readString(recovery.recoverySyncRunId),
  };
};

export type SyncRunRecoveryPlan = {
  shouldRecover: boolean;
  reason: string;
  requestedSources: WbSyncSource[];
  completedSources: WbSyncSource[];
  remainingSources: WbSyncSource[];
  sourceSummaries: SyncSourceSummary[];
  runningSource?: WbSyncSource;
  heartbeatAt?: Date;
  nextAttempt: number;
};

export function buildSyncRunRecoveryPlan(input: {
  status: string;
  triggerSource?: string | null;
  summary?: Record<string, unknown> | null;
  requestedAt: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  errorMessage?: string | null;
  staleBefore: Date;
  maxAttempts?: number;
}): SyncRunRecoveryPlan {
  const summary = isPlainRecord(input.summary) ? input.summary : {};
  const progress = isPlainRecord(summary.progress) ? summary.progress : null;
  const heartbeatAt = toDate(progress?.updatedAt) ?? input.startedAt ?? input.requestedAt;
  const recoveryInfo = readRecoveryInfo(summary);
  const maxAttempts = input.maxAttempts ?? DEFAULT_RECOVERY_MAX_ATTEMPTS;

  const requestedSources = readRequestedSources(summary, input.triggerSource);
  const { completedSources, sourceSummaries } = readCompletedSources(summary);
  const runningSourceRaw = readString(progress?.runningSource);
  const runningSource = isWbSyncSource(runningSourceRaw) ? runningSourceRaw : undefined;

  const basePlan = {
    requestedSources,
    completedSources,
    remainingSources: [],
    sourceSummaries,
    runningSource,
    heartbeatAt,
    nextAttempt: recoveryInfo.attempt + 1,
  };

  if (recoveryInfo.recoverySyncRunId) {
    return { ...basePlan, shouldRecover: false, reason: "already_recovered" };
  }

  if (recoveryInfo.attempt >= maxAttempts) {
    return { ...basePlan, shouldRecover: false, reason: "max_attempts_reached" };
  }

  const isActive = ACTIVE_STATUSES.includes(input.status as (typeof ACTIVE_STATUSES)[number]);
  const isFailedByStaleGuard = input.status === "failed" && isStaleSyncRunError(input.errorMessage);

  if (!isActive && !isFailedByStaleGuard) {
    return { ...basePlan, shouldRecover: false, reason: "status_not_recoverable" };
  }

  if (isActive && heartbeatAt > input.staleBefore) {
    return { ...basePlan, shouldRecover: false, reason: "heartbeat_fresh" };
  }

  if (requestedSources.length === 0) {
    return { ...basePlan, shouldRecover: false, reason: "requested_sources_unknown" };
  }

  const completedSet = new Set(completedSources);
  let startIndex = requestedSources.findIndex((source) => !completedSet.has(source));
  if (runningSource && requestedSources.includes(runningSource) && !completedSet.has(runningSource)) {
    startIndex = requestedSources.indexOf(runningSource);
  }

  const remainingSources = startIndex === -1
    ? []
    : requestedSources.slice(startIndex).filter((source) => !completedSet.has(source));

  return {
    ...basePlan,
    shouldRecover: true,
    reason: remainingSources.length > 0 ? "resume_remaining_sources" : "finalize_completed_stale_run",
    remainingSources,
  };
}
