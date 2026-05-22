import { inngest } from "./client";
import { handleInngestFailure } from "./on-failure";
import { db, withAdminContext, withTenantContext } from "@/lib/db";
import {
  tenants,
  rawApiRealizationReports,
  rawApiOrders,
  products,
  rawApiAdCosts,
  rawApiAdClusters,
  rawApiStocks,
  rawApiStockOffices,
  rawApiStockSizes,
  rawApiRegionSales,
  wbTariffSnapshots,
  wbCategoryCommissionSnapshots,
  rawApiFunnelStats,
  rawApiPaidStorage,
  rawApiSales,
  rawApiProductMetadata,
  rawApiPrices,
  rawApiPriceSnapshots,
  syncRuns,
} from "@/lib/db/schema";
import {
  wbApi,
  type WbAdCampaign,
  type WbDailyFunnelWindow,
  type WbPaidStorageItem,
  type WbPriceItem,
  type WbProductCard,
  type WbSaleItem,
  type WbSearchKeywordStat,
  type WbStockOfficeMetricItem,
  type WbStockSizeMetricItem,
  type WbStockItem,
} from "@/lib/wb-api";
import { getWbPhotoUrl } from "@/lib/wb-api/wb-photos";
import { decryptIfNeeded } from "@/lib/encryption";
import {
  dedupePaidStorageItems,
  dedupeStockOfficeMetricItems,
  dedupeStockSizeMetricItems,
} from "@/lib/wb-sync-utils";
import { WbApiError } from "@/lib/wb-api/client";
import { and, eq, gte, lte, lt, sql } from "drizzle-orm";
import { subDays } from "date-fns";
import { AnalyticsEngine } from "@/server/analytics/engine";
import { buildHistoricalAdCostRows, dedupeAdCostRows } from "@/server/advertising/ad-cost-history";
import { invalidateDashboardCache } from "@/lib/analytics/dashboard-cache";
import { BotService } from "@/server/bot/service";
import { reconcileObservedProducts } from "@/server/catalog/observed-products";
import { WB_SYNC_SOURCE_SEQUENCE, type WbSyncSource } from "@/server/jobs/wb-sync-sources";
import {
  buildSyncRunSummary,
  chunkArray,
  formatSyncRunErrorMessage,
  resolveSyncRunStatus,
  runSyncSource,
  serializeError,
  SyncSourceTimeoutError,
  type SyncSourceSummary,
} from "@/server/jobs/sync-runtime";
import type { WbFunnelItem, WbOrderItem, WbRealizationReportItem } from "@/types/wb";
import { logger } from "@/lib/logger";

interface SyncRequestedEvent {
  data: {
    tenantId: string;
    syncRunId?: string;
    from?: string;
    to?: string;
    requestedSources?: WbSyncSource[];
    adsRetryAttempt?: number;
    adsRetryParentSyncRunId?: string;
    lastErrorCode?: number;
  };
}

interface SyncStep {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

interface SignalSummary {
  severity: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const optionalText = (value: string | null | undefined) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
};

const optionalNumberString = (value: number | null | undefined) => (
  Number.isFinite(value) ? String(value) : null
);

const ADS_SOURCE_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.WB_ADS_SOURCE_TIMEOUT_MS ?? "1200000", 10);
  if (!Number.isFinite(parsed) || parsed < 60_000) {
    return 1_200_000;
  }

  return parsed;
})();

const ADS_SYNC_LOOKBACK_DAYS = (() => {
  const parsed = Number.parseInt(process.env.WB_ADS_SYNC_LOOKBACK_DAYS ?? "7", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 7;
  }

  return Math.min(31, parsed);
})();

const PAID_STORAGE_SYNC_LOOKBACK_DAYS = (() => {
  const parsed = Number.parseInt(process.env.WB_PAID_STORAGE_SYNC_LOOKBACK_DAYS ?? "8", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 8;
  }

  return Math.min(31, parsed);
})();

const PAID_STORAGE_SOURCE_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.WB_PAID_STORAGE_SOURCE_TIMEOUT_MS ?? "600000", 10);
  if (!Number.isFinite(parsed) || parsed < 120_000) {
    return 600_000;
  }

  return parsed;
})();

const AD_CLUSTERS_SOURCE_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.WB_AD_CLUSTERS_SOURCE_TIMEOUT_MS ?? "300000", 10);
  if (!Number.isFinite(parsed) || parsed < 60_000) {
    return 300_000;
  }

  return parsed;
})();

const STOCK_SIZES_SOURCE_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.WB_STOCK_SIZES_SOURCE_TIMEOUT_MS ?? "2100000", 10);
  if (!Number.isFinite(parsed) || parsed < 300_000) {
    return 2_100_000;
  }

  return parsed;
})();

const SOURCE_TIMEOUT_MS: Partial<Record<WbSyncSource, number>> = {
  paid_storage: PAID_STORAGE_SOURCE_TIMEOUT_MS,
  stock_sizes: STOCK_SIZES_SOURCE_TIMEOUT_MS,
  ads: ADS_SOURCE_TIMEOUT_MS,
  ad_clusters: AD_CLUSTERS_SOURCE_TIMEOUT_MS,
};
const ADS_RETRY_EVENT_NAME = "wb/sync.ads_retry.requested";
const ADS_RETRY_MAX_ATTEMPTS = (() => {
  const parsed = Number.parseInt(process.env.WB_ADS_RETRY_MAX_ATTEMPTS ?? "2", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 2;
  }

  return parsed;
})();
const STOCK_SIZES_MAX_NM_IDS = (() => {
  const parsed = Number.parseInt(process.env.WB_STOCK_SIZES_MAX_NM_IDS ?? "64", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 64;
  }

  return Math.min(200, parsed);
})();
const STOCK_SIZES_MISSING_RETRY_MAX_NM_IDS = (() => {
  const parsed = Number.parseInt(process.env.WB_STOCK_SIZES_MISSING_RETRY_MAX_NM_IDS ?? "16", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 16;
  }

  return Math.min(64, parsed);
})();
const STOCK_ANALYTICS_LOOKBACK_DAYS = 31;

const getDayBucket = (value?: string | Date) => {
  const date = value ? new Date(value) : new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const formatDateOnly = (date: Date) => date.toISOString().slice(0, 10);
const SPP_SNAPSHOT_TRIGGER_SOURCE = "scheduled-spp-snapshot";
const SPP_PUBLIC_DEST = process.env.WB_SPP_PUBLIC_DEST ?? "-1257786";
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

const roundPriceMoney = (value: number) => Math.round(value * 100) / 100;
const clampDiscountPercent = (value: number) => Math.min(100, Math.max(0, value));
const calculateImpliedSpp = (sellerPriceAfterDiscount: number, customerPrice: number) => {
  if (sellerPriceAfterDiscount <= 0 || customerPrice <= 0) {
    return 0;
  }

  return Math.max(0, roundPriceMoney(((sellerPriceAfterDiscount - customerPrice) / sellerPriceAfterDiscount) * 100));
};

const resolveMskSppSnapshotSlot = (snapshotAt: Date) => {
  const mskDate = new Date(snapshotAt.getTime() + MOSCOW_OFFSET_MS);
  const snapshotDate = mskDate.toISOString().slice(0, 10);
  const mskHour = mskDate.getUTCHours();

  return {
    snapshotDate,
    snapshotSlot: mskHour < 14 ? "msk-09" : "msk-18",
  };
};

const splitDateOnlyRangeByMaxDays = (from: string, to: string, maxDays: number) => {
  const windows: Array<{ from: string; to: string }> = [];
  const end = getDayBucket(`${to}T00:00:00.000Z`);
  let cursor = getDayBucket(`${from}T00:00:00.000Z`);
  const windowSpanMs = Math.max(1, maxDays) * 24 * 60 * 60 * 1000;

  while (cursor <= end) {
    const windowEnd = new Date(Math.min(end.getTime(), cursor.getTime() + windowSpanMs - 1));
    windows.push({ from: formatDateOnly(cursor), to: formatDateOnly(windowEnd) });
    cursor = new Date(windowEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    cursor.setUTCHours(0, 0, 0, 0);
  }

  return windows;
};

const getCardPhotoUrl = (card: WbProductCard) => (
  card.photos?.[0]?.big
  || card.photos?.[0]?.square
  || card.photos?.[0]?.tm
  || getWbPhotoUrl(card.nmID)
);

const mergeCards = (base: WbProductCard | undefined, overlay: WbProductCard): WbProductCard => ({
  ...base,
  ...overlay,
  nmID: overlay.nmID,
  vendorCode: overlay.vendorCode || base?.vendorCode,
  brand: overlay.brand || base?.brand,
  subjectName: overlay.subjectName || base?.subjectName,
  title: overlay.title || base?.title,
  description: overlay.description || base?.description,
  photos: Array.isArray(overlay.photos) && overlay.photos.length > 0 ? overlay.photos : base?.photos,
  video: overlay.video ?? base?.video,
  characteristics: Array.isArray(overlay.characteristics) && overlay.characteristics.length > 0
    ? overlay.characteristics
    : base?.characteristics,
});

type SnapshotRecoverableSource = "paid_storage" | "ads" | "ad_clusters";

const isRecoverableSnapshotError = (error: unknown) => {
  if (error instanceof SyncSourceTimeoutError) {
    return true;
  }

  if (error instanceof WbApiError) {
    if (error.status === 401) {
      return false;
    }

    if (typeof error.status !== "number") {
      return true;
    }

    return error.status === 408
      || error.status === 425
      || error.status === 429
      || error.status >= 500;
  }

  return /fetch failed|network|timeout|timed out|ECONNRESET|socket hang up/i.test(serializeError(error));
};

const getWbStatusCode = (error: unknown) => {
  if (error instanceof WbApiError && typeof error.status === "number") {
    return error.status;
  }

  const message = serializeError(error);
  const match = message.match(/\bstatus\s+(\d{3})\b/i);
  if (!match) {
    return undefined;
  }

  const status = Number.parseInt(match[1]!, 10);
  return Number.isFinite(status) ? status : undefined;
};

const TRANSIENT_ADS_SKIP_REASONS = new Set([
  "wb_rate_limited",
  "wb_temporary_unavailable",
  "retained_previous_snapshot",
]);
const RETRYABLE_SYNC_SOURCES: readonly WbSyncSource[] = ["orders", "sales", "ads", "ad_clusters"];

const normalizeAdsRetryAttempt = (attempt?: number) => {
  if (!Number.isFinite(attempt)) {
    return 0;
  }

  return Math.max(0, Math.floor(attempt as number));
};

const isRetryableSyncSource = (summary: SyncSourceSummary | undefined) => {
  if (!summary || !RETRYABLE_SYNC_SOURCES.includes(summary.source as WbSyncSource)) {
    return false;
  }

  if (summary.status === "skipped") {
    const reason = typeof summary.meta?.reason === "string" ? summary.meta.reason : "";
    return TRANSIENT_ADS_SKIP_REASONS.has(reason);
  }

  if (summary.status !== "error") {
    return false;
  }

  if (summary.meta?.statusCode === 401) {
    return false;
  }

  if (
    summary.meta?.reason === "wb_rate_limited"
    || summary.meta?.errorCategory === "wb_rate_limited"
    || summary.meta?.statusCode === 429
  ) {
    return true;
  }

  if (summary.source === "orders" || summary.source === "sales") {
    return false;
  }

  if (summary.meta?.errorCategory === "network_error" || summary.meta?.errorCategory === "wb_upstream_error") {
    return true;
  }

  const combinedError = `${summary.error ?? ""} ${summary.meta?.shortMessage ?? ""}`;
  return /status 429|too many requests|timed out|timeout|fetch failed|network|status 5\d\d/i.test(combinedError);
};

const resolveSyncRetrySources = (sourceResults: SyncSourceSummary[]) => {
  const retrySources: WbSyncSource[] = [];

  for (const source of RETRYABLE_SYNC_SOURCES) {
    const summary = sourceResults.find((item) => item.source === source);
    if (isRetryableSyncSource(summary)) {
      retrySources.push(source);
    }
  }

  return retrySources;
};

const resolveSyncRetryLastErrorCode = (
  sourceResults: SyncSourceSummary[],
  retrySources: readonly WbSyncSource[],
) => {
  let fallbackCode: number | undefined;

  for (const source of retrySources) {
    const summary = sourceResults.find((item) => item.source === source);
    const statusCode = typeof summary?.meta?.statusCode === "number" ? summary.meta.statusCode : undefined;

    if (statusCode === 429) {
      return 429;
    }

    if (fallbackCode === undefined && statusCode !== undefined) {
      fallbackCode = statusCode;
    }
  }

  return fallbackCode;
};

/**
 * Фоновая задача синхронизации данных v7 с source-level error isolation.
 */
export const syncWildberriesData = inngest.createFunction(
  {
    id: "sync-wb-data-v7",
    name: "Sync Wildberries Data v7",
    concurrency: [
      { limit: 1, key: "event.data.tenantId" },
      { limit: 3 },
    ],
    onFailure: handleInngestFailure,
    triggers: [{ event: "wb/sync.requested" }],
  },
  async ({ event, step }: { event: SyncRequestedEvent; step: SyncStep }) => {
    const {
      tenantId,
      syncRunId,
      from,
      to,
      requestedSources: requestedSourcesRaw,
      adsRetryAttempt: adsRetryAttemptRaw,
    } = event.data;
    const persistedSyncRunId = syncRunId && UUID_RE.test(syncRunId) ? syncRunId : undefined;
    const adsRetryAttempt = normalizeAdsRetryAttempt(adsRetryAttemptRaw);
    const requestedSources = Array.isArray(requestedSourcesRaw)
      ? requestedSourcesRaw.filter((source): source is WbSyncSource => WB_SYNC_SOURCE_SEQUENCE.includes(source))
      : [];
    const enabledSources = requestedSources.length > 0
      ? new Set<WbSyncSource>(requestedSources)
      : new Set<WbSyncSource>(WB_SYNC_SOURCE_SEQUENCE);
    const sourceResults: SyncSourceSummary[] = [];
    const totalSources = enabledSources.size;
    let syncTriggerSource: string | undefined;
    let persistedSummaryBase: Record<string, unknown> = {};

    if (totalSources === 0) {
      throw new Error("No sync sources requested");
    }

    const buildPersistedSyncRunSummary = (runningSource?: string) => ({
      ...persistedSummaryBase,
      ...buildSyncRunSummary(sourceResults, {
        totalSources,
        completedSources: sourceResults.length,
        runningSource,
      }),
      requestedSources: [...enabledSources],
    });

    const persistProgress = async (stepId: string, runningSource?: string) => {
      if (!persistedSyncRunId) {
        return;
      }

      const summary = buildPersistedSyncRunSummary(runningSource);

      await step.run(stepId, async () => {
        await withTenantContext(db, tenantId, async (tx) => {
          await tx.update(syncRuns)
            .set({
              status: 'running',
              summary: summary as unknown as Record<string, unknown>,
              errorMessage: null,
            })
            .where(eq(syncRuns.id, persistedSyncRunId));
        });
      });
    };

    const recordSource = async (
      stepId: string,
      source: WbSyncSource,
      executor: Parameters<typeof runSyncSource>[1]
    ) => {
      if (!enabledSources.has(source)) {
        return null;
      }

      await persistProgress(`${stepId}-progress-start`, source);
      const timeoutMs = SOURCE_TIMEOUT_MS[source];
      const summary = await step.run(stepId, async () => runSyncSource(
        source,
        executor,
        timeoutMs ? { timeoutMs } : undefined,
      ));
      sourceResults.push(summary);
      await persistProgress(`${stepId}-progress-finish`);
      return summary;
    };

    const runAbortableSource = async <T>(
      source: WbSyncSource,
      executor: (signal: AbortSignal) => Promise<T>
    ) => {
      const timeoutMs = SOURCE_TIMEOUT_MS[source];
      if (!timeoutMs) {
        return await executor(new AbortController().signal);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort(new SyncSourceTimeoutError(source, timeoutMs));
      }, timeoutMs);

      try {
        return await executor(controller.signal);
      } finally {
        clearTimeout(timeout);
      }
    };

    try {
      const tenant = await step.run("get-tenant-token", async () => {
        const result = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
        if (!result?.wbApiToken) {
          throw new Error("Токен WB не найден");
        }
        return result;
      });

      if (persistedSyncRunId) {
        const [currentSyncRun] = await step.run("get-sync-run-state", async () => {
          return withTenantContext(db, tenantId, async (tx) => tx
            .select({
              status: syncRuns.status,
              triggerSource: syncRuns.triggerSource,
              summary: syncRuns.summary,
            })
            .from(syncRuns)
            .where(eq(syncRuns.id, persistedSyncRunId))
            .limit(1));
        }) as Array<{ status: string; triggerSource: string | null; summary: Record<string, unknown> }>;

        if (!currentSyncRun || !["pending", "running"].includes(currentSyncRun.status)) {
          return {
            success: false,
            syncRunId: persistedSyncRunId,
            status: currentSyncRun?.status ?? "missing",
            skipped: true,
            reason: "sync_run_already_finalized",
          };
        }
        syncTriggerSource = currentSyncRun.triggerSource ?? undefined;
        persistedSummaryBase = isPlainRecord(currentSyncRun.summary) ? currentSyncRun.summary : {};

        await step.run("mark-sync-run-running", async () => {
          await withTenantContext(db, tenantId, async (tx) => {
            await tx.update(syncRuns)
              .set({
                status: 'running',
                startedAt: new Date(),
                errorMessage: null,
                summary: buildPersistedSyncRunSummary() as unknown as Record<string, unknown>,
              })
              .where(eq(syncRuns.id, persistedSyncRunId));
          });
        });
      }

      const plainToken = decryptIfNeeded(tenant.wbApiToken);
      const todayUtc = getDayBucket();
      let selectedPeriodEnd = to ? getDayBucket(to) : new Date(todayUtc);
      if (selectedPeriodEnd > todayUtc) {
        selectedPeriodEnd = new Date(todayUtc);
      }

      let selectedPeriodStart = from ? getDayBucket(from) : getDayBucket(subDays(selectedPeriodEnd, 30));
      if (selectedPeriodStart > selectedPeriodEnd) {
        selectedPeriodStart = new Date(selectedPeriodEnd);
      }

      const selectedPeriodStartIso = selectedPeriodStart.toISOString();
      const selectedPeriodEndIso = selectedPeriodEnd.toISOString();
      const dateFrom = selectedPeriodStartIso;
      const dateTo = selectedPeriodEndIso;
      const paidStorageStartCandidate = getDayBucket(subDays(selectedPeriodEnd, PAID_STORAGE_SYNC_LOOKBACK_DAYS - 1));
      const paidStoragePeriodStart = paidStorageStartCandidate > selectedPeriodStart
        ? paidStorageStartCandidate
        : selectedPeriodStart;
      const paidStorageDateFrom = paidStoragePeriodStart.toISOString();
      const adsPeriodStartCandidate = getDayBucket(subDays(selectedPeriodEnd, ADS_SYNC_LOOKBACK_DAYS - 1));
      const adsPeriodStart = adsPeriodStartCandidate > selectedPeriodStart
        ? adsPeriodStartCandidate
        : selectedPeriodStart;
      const adsDateFrom = adsPeriodStart.toISOString();
      const selectedPeriodStartDate = selectedPeriodStart.toISOString().slice(0, 10);
      const selectedPeriodEndDate = selectedPeriodEnd.toISOString().slice(0, 10);
      const paidStoragePeriodStartDate = paidStoragePeriodStart.toISOString().slice(0, 10);
      const adsPeriodStartDate = adsPeriodStart.toISOString().slice(0, 10);
      const stockAnalyticsStartCandidate = getDayBucket(subDays(selectedPeriodEnd, STOCK_ANALYTICS_LOOKBACK_DAYS - 1));
      const stockAnalyticsPeriodStart = stockAnalyticsStartCandidate > selectedPeriodStart
        ? stockAnalyticsStartCandidate
        : selectedPeriodStart;
      const stockAnalyticsDateFrom = stockAnalyticsPeriodStart.toISOString();
      const stockAnalyticsPeriodStartDate = stockAnalyticsPeriodStart.toISOString().slice(0, 10);
      const countRetainedSnapshotRows = async (source: SnapshotRecoverableSource) => {
        return withTenantContext(db, tenantId, async (tx) => {
          if (source === "paid_storage") {
            const [row] = await tx.select({
              count: sql<number>`count(*)::int`,
            }).from(rawApiPaidStorage).where(and(
              eq(rawApiPaidStorage.tenantId, tenantId),
              gte(rawApiPaidStorage.date, paidStoragePeriodStart),
              lte(rawApiPaidStorage.date, selectedPeriodEnd),
            ));

            return row?.count ?? 0;
          }

          if (source === "ads") {
            const [row] = await tx.select({
              count: sql<number>`count(*)::int`,
            }).from(rawApiAdCosts).where(and(
              eq(rawApiAdCosts.tenantId, tenantId),
              gte(rawApiAdCosts.date, selectedPeriodStart),
              lte(rawApiAdCosts.date, selectedPeriodEnd),
            ));

            return row?.count ?? 0;
          }

          const [row] = await tx.select({
            count: sql<number>`count(*)::int`,
          }).from(rawApiAdClusters).where(and(
            eq(rawApiAdClusters.tenantId, tenantId),
            gte(rawApiAdClusters.date, selectedPeriodStart),
            lte(rawApiAdClusters.date, selectedPeriodEnd),
          ));

          return row?.count ?? 0;
        });
      };
      const recoverWithRetainedSnapshot = async (source: SnapshotRecoverableSource, error: unknown) => {
        if (!isRecoverableSnapshotError(error)) {
          throw error;
        }

        const retainedRecords = await countRetainedSnapshotRows(source);
        if (retainedRecords <= 0) {
          throw error;
        }

        return {
          status: 'skipped' as const,
          meta: {
            reason: 'retained_previous_snapshot',
            retainedRecords,
            fallbackError: serializeError(error),
          },
        };
      };
      const recoverOrSkipTransientSource = async (source: SnapshotRecoverableSource, error: unknown) => {
        try {
          return await recoverWithRetainedSnapshot(source, error);
        } catch (snapshotRecoveryError) {
          if (!isRecoverableSnapshotError(error)) {
            throw snapshotRecoveryError;
          }

          const statusCode = getWbStatusCode(error);
          return {
            status: 'skipped' as const,
            meta: {
              reason: statusCode === 429 ? 'wb_rate_limited' : 'wb_temporary_unavailable',
              statusCode,
              fallbackError: serializeError(error),
            },
          };
        }
      };
      let rootCards: WbProductCard[] = [];
      let rootCardsLoaded = false;
      let mergedCards: WbProductCard[] = [];
      let mergedCardsLoaded = false;
      let mediaCardsCount = 0;
      let adCampaignsCache: WbAdCampaign[] | null = null;

      const ensureCardsLoaded = async () => {
        if (!rootCardsLoaded) {
          rootCards = await wbApi.getAllCardsList(plainToken, 100);
          rootCardsLoaded = true;
        }

        return rootCards;
      };

      const ensureMergedCardsLoaded = async () => {
        if (!mergedCardsLoaded) {
          const baseCards = await ensureCardsLoaded();
          const mediaCards = await wbApi.getAllCardsList(plainToken, 100, { filter: { withPhoto: -1 } });
          mediaCardsCount = mediaCards.length;
          const mergedCardsMap = new Map<number, WbProductCard>();

          for (const card of baseCards) {
            if (Number.isFinite(card.nmID) && card.nmID > 0) {
              mergedCardsMap.set(card.nmID, mergeCards(undefined, card));
            }
          }

          for (const card of mediaCards) {
            if (Number.isFinite(card.nmID) && card.nmID > 0) {
              mergedCardsMap.set(card.nmID, mergeCards(mergedCardsMap.get(card.nmID), card));
            }
          }

          mergedCards = Array.from(mergedCardsMap.values());
          mergedCardsLoaded = true;
        }

        return mergedCards;
      };
      const ensureAdCampaignsLoaded = async (signal?: AbortSignal) => {
        if (adCampaignsCache === null) {
          adCampaignsCache = await wbApi.getAdCampaigns(plainToken, { signal });
        }

        return adCampaignsCache;
      };

      let reports: WbRealizationReportItem[] = [];
      await recordSource("sync-realization-reports", "realization_reports", async () => {
        reports = await wbApi.getAllRealizationReports(plainToken, dateFrom, dateTo);

        if (reports.length === 0) {
          return { status: 'skipped', meta: { reason: 'empty' } };
        }

        let batches = 0;
        await withTenantContext(db, tenantId, async (tx) => {
         for (const chunk of chunkArray(reports, 100)) {
          batches += 1;
          const toNumber = (value: unknown) => {
            if (typeof value === "number") {
              return Number.isFinite(value) ? value : 0;
            }

            if (typeof value === "string") {
              const parsed = Number(value);
              return Number.isFinite(parsed) ? parsed : 0;
            }

            return 0;
          };
          const toText = (value: unknown) => typeof value === "string" ? value : "";
          const toOptionalText = (value: unknown) => {
            const text = toText(value).trim();
            return text.length > 0 ? text : null;
          };
          const toOptionalNumber = (value: unknown) => {
            if (value === null || value === undefined || value === "") return null;
            const parsed = toNumber(value);
            return Number.isFinite(parsed) ? parsed : null;
          };
          const toOptionalBoolean = (value: unknown) => {
            if (typeof value === "boolean") return value;
            if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
            if (typeof value === "string") {
              const normalized = value.trim().toLowerCase();
              if (["true", "1", "yes", "y", "да"].includes(normalized)) return true;
              if (["false", "0", "no", "n", "нет"].includes(normalized)) return false;
            }
            return null;
          };

          await tx.insert(rawApiRealizationReports).values(chunk.map((item) => {
            const commission = toNumber(item.commission_amount) !== 0
              ? toNumber(item.commission_amount)
              : toNumber(item.ppvz_sales_commission);
            const storageFee = toNumber(item.storage_fee_rub) !== 0
              ? toNumber(item.storage_fee_rub)
              : toNumber(item.storage_fee);
            const penalty = toNumber(item.penalty_rub) !== 0
              ? toNumber(item.penalty_rub)
              : toNumber(item.penalty);
            const paymentSchedule = toNumber(item.payment_schedule_rub) !== 0
              ? toNumber(item.payment_schedule_rub)
              : toNumber(item.payment_schedule);
            const additionalPayment =
              toNumber(item.additional_payment) + toNumber(item.rebill_logistic_cost);

            return {
              rrdId: item.rrd_id,
              tenantId,
              realizationreportId: item.realizationreport_id,
              dateFrom: new Date(item.date_from),
              dateTo: new Date(item.date_to),
              saleDt: new Date(item.sale_dt ?? item.date_from),
              srid: toText(item.srid),
              docTypeName: toText(item.doc_type_name),
              supplierOperName: toText(item.supplier_oper_name),
              bonusTypeName: toText(item.bonus_type_name),
              rebillLogisticOrg: toText(item.rebill_logistic_org),
              officeName: toOptionalText(item.office_name),
              nmId: item.nm_id,
              quantity: item.quantity,
              retailAmount: toNumber(item.retail_amount).toString(),
              commissionAmount: commission.toString(),
              deliveryRub: toNumber(item.delivery_rub).toString(),
              boxDeliveryBase: toNumber(item.box_delivery_base).toString(),
              boxDeliveryLiter: toNumber(item.box_delivery_liter).toString(),
              boxStorageBase: toNumber(item.box_storage_base).toString(),
              boxStorageLiter: toNumber(item.box_storage_liter).toString(),
              storageFeeRub: storageFee.toString(),
              penaltyRub: penalty.toString(),
              sppRub: toNumber(item.spp_rub).toString(),
              paymentScheduleRub: paymentSchedule.toString(),
              ppvzForPay: toNumber(item.ppvz_for_pay).toString(),
              deduction: toNumber(item.deduction).toString(),
              additionalPayment: additionalPayment.toString(),
              acquiringFee: toNumber(item.acquiring_fee).toString(),
              returnAmount: toNumber(item.return_amount).toString(),
              retailPriceWithdiscRub: toNumber(item.retail_price_withdisc_rub).toString(),
              acceptance: toNumber(item.acceptance).toString(),
              cashbackAmount: toNumber(item.cashback_amount).toString(),
              ppvzSppPrc: toNumber(item.ppvz_spp_prc).toString(),
              ppvzKvwPrcBase: toNumber(item.ppvz_kvw_prc_base).toString(),
              ppvzKvwPrc: toNumber(item.ppvz_kvw_prc).toString(),
              fixationStartDate: item.fixation_start_date ?? null,
              fixationEndDate: item.fixation_end_date ?? null,
              isPaidDeliveryService: toOptionalBoolean(item.is_paid_delivery_service),
              fixedWarehouseCoefficient: toOptionalNumber(item.fixed_warehouse_coefficient)?.toString() ?? null,
            };
          })).onConflictDoUpdate({
            target: [rawApiRealizationReports.tenantId, rawApiRealizationReports.rrdId],
            set: {
              quantity: sql`EXCLUDED.quantity`,
              dateFrom: sql`EXCLUDED.date_from`,
              dateTo: sql`EXCLUDED.date_to`,
              saleDt: sql`EXCLUDED.sale_dt`,
              srid: sql`EXCLUDED.srid`,
              docTypeName: sql`EXCLUDED.doc_type_name`,
              supplierOperName: sql`EXCLUDED.supplier_oper_name`,
              bonusTypeName: sql`EXCLUDED.bonus_type_name`,
              rebillLogisticOrg: sql`EXCLUDED.rebill_logistic_org`,
              officeName: sql`EXCLUDED.office_name`,
              retailAmount: sql`EXCLUDED.retail_amount`,
              commissionAmount: sql`EXCLUDED.commission_amount`,
              deliveryRub: sql`EXCLUDED.delivery_rub`,
              storageFeeRub: sql`EXCLUDED.storage_fee_rub`,
              penaltyRub: sql`EXCLUDED.penalty_rub`,
              sppRub: sql`EXCLUDED.spp_rub`,
              paymentScheduleRub: sql`EXCLUDED.payment_schedule_rub`,
              ppvzForPay: sql`EXCLUDED.ppvz_for_pay`,
              deduction: sql`EXCLUDED.deduction`,
              additionalPayment: sql`EXCLUDED.additional_payment`,
              acquiringFee: sql`EXCLUDED.acquiring_fee`,
              returnAmount: sql`EXCLUDED.return_amount`,
              retailPriceWithdiscRub: sql`EXCLUDED.retail_price_withdisc_rub`,
              acceptance: sql`EXCLUDED.acceptance`,
              cashbackAmount: sql`EXCLUDED.cashback_amount`,
              ppvzSppPrc: sql`EXCLUDED.ppvz_spp_prc`,
              ppvzKvwPrcBase: sql`EXCLUDED.ppvz_kvw_prc_base`,
              ppvzKvwPrc: sql`EXCLUDED.ppvz_kvw_prc`,
              fixationStartDate: sql`EXCLUDED.fixation_start_date`,
              fixationEndDate: sql`EXCLUDED.fixation_end_date`,
              isPaidDeliveryService: sql`EXCLUDED.is_paid_delivery_service`,
              fixedWarehouseCoefficient: sql`EXCLUDED.fixed_warehouse_coefficient`,
            }
          });
         }
        });

        return { records: reports.length, batches };
      });

      await recordSource("sync-products-metadata", "products", async () => {
        const allCards = await ensureMergedCardsLoaded();
        const activeCards = allCards.filter((card) => Number.isFinite(card.nmID) && card.nmID > 0);
        if (activeCards.length === 0) {
          return { status: 'skipped', meta: { reason: 'no_cards' } };
        }

        let batches = 0;
        await withTenantContext(db, tenantId, async (tx) => {
          for (const chunk of chunkArray(activeCards, 500)) {
            batches += 1;
            const inserts = chunk.map((card) => ({
              tenantId,
              nmId: card.nmID,
              vendorCode: card.vendorCode?.trim() || card.title?.trim() || String(card.nmID),
              brand: card.brand?.trim() || 'No Brand',
              category: card.subjectName?.trim() || '',
              photoUrl: getCardPhotoUrl(card),
              isArchived: false,
            }));

            await tx.insert(products).values(inserts).onConflictDoUpdate({
              target: [products.tenantId, products.nmId],
              set: {
                vendorCode: sql`EXCLUDED.vendor_code`,
                photoUrl: sql`EXCLUDED.photo_url`,
                brand: sql`EXCLUDED.brand`,
                category: sql`EXCLUDED.category`,
                isArchived: sql`FALSE`,
              }
            });
          }

          const activeNmIds = activeCards.map((card) => card.nmID);
          if (activeNmIds.length > 0) {
            const nmIdList = sql.join(activeNmIds.map((nmId) => sql`${nmId}`), sql`, `);
            await tx.execute(sql`
              UPDATE products
              SET is_archived = CASE WHEN nm_id IN (${nmIdList}) THEN FALSE ELSE TRUE END
              WHERE tenant_id = ${tenantId}
            `);
          }
        });

        return { records: activeCards.length, batches };
      });

      await recordSource("sync-detailed-content-metadata", "content_metadata", async () => {
        const baseCards = await ensureCardsLoaded();
        const cardsForMetadata = await ensureMergedCardsLoaded();
        if (cardsForMetadata.length === 0) {
          return { status: 'skipped', meta: { reason: 'no_cards' } };
        }

        let batches = 0;
        await withTenantContext(db, tenantId, async (tx) => {
          for (const chunk of chunkArray(cardsForMetadata, 250)) {
            batches += 1;
            const inserts = chunk.map((card) => ({
              tenantId,
              nmId: card.nmID,
              title: card.title || '',
              description: card.description || '',
              photosCount: card.photos?.length || 0,
              hasVideo: Boolean(card.video),
              characteristicsCount: card.characteristics?.length || 0,
              updatedAt: new Date()
            }));

            await tx.insert(rawApiProductMetadata).values(inserts).onConflictDoUpdate({
              target: [rawApiProductMetadata.tenantId, rawApiProductMetadata.nmId],
              set: {
                title: sql`EXCLUDED.title`,
                description: sql`EXCLUDED.description`,
                photosCount: sql`EXCLUDED.photos_count`,
                hasVideo: sql`EXCLUDED.has_video`,
                characteristicsCount: sql`EXCLUDED.characteristics_count`,
                updatedAt: sql`EXCLUDED.updated_at`
              }
            });
          }
        });

        return {
          records: cardsForMetadata.length,
          batches,
          meta: {
            rootCards: baseCards.length,
            mediaCards: mediaCardsCount,
          },
        };
      });

      await recordSource("sync-prices", "prices", async () => {
        const priceList: WbPriceItem[] = await wbApi.getPrices(plainToken);
        if (priceList.length === 0) {
          return { status: 'skipped', meta: { reason: 'empty' } };
        }

        let batches = 0;
        let snapshotRows = 0;
        const shouldPersistSppSnapshot = syncTriggerSource === SPP_SNAPSHOT_TRIGGER_SOURCE;
        const snapshotAt = new Date();
        const { snapshotDate, snapshotSlot } = resolveMskSppSnapshotSlot(snapshotAt);
        const publicPrices = shouldPersistSppSnapshot
          ? await wbApi.getPublicCardPrices(priceList.map((item) => item.nmID), { dest: SPP_PUBLIC_DEST })
          : new Map();

        await withTenantContext(db, tenantId, async (tx) => {
          for (const chunk of chunkArray(priceList, 1000)) {
            batches += 1;
            const now = new Date();
            const normalizedRows = chunk.map((item) => {
              const price = item.price || 0;
              const discount = item.discount || 0;
              const spp = item.spp || 0;
              const sellerPriceAfterDiscount = roundPriceMoney(
                price * (1 - clampDiscountPercent(discount) / 100),
              );
              const priceAfterSpp = roundPriceMoney(
                sellerPriceAfterDiscount * (1 - clampDiscountPercent(spp) / 100),
              );
              const publicPrice = publicPrices.get(item.nmID);
              const customerPrice = publicPrice?.customerPrice && publicPrice.customerPrice > 0
                ? publicPrice.customerPrice
                : priceAfterSpp;
              const impliedSpp = calculateImpliedSpp(sellerPriceAfterDiscount, customerPrice) || spp;
              const snapshotSpp = Math.round(impliedSpp);

              return {
                tenantId,
                nmId: item.nmID,
                price,
                discount,
                spp,
                sellerPriceAfterDiscount,
                customerPrice,
                priceAfterSpp: customerPrice,
                impliedSpp,
                snapshotSpp,
                publicPriceSource: publicPrice ? "wb_card_v4" : "prices_api_fallback",
                updatedAt: now,
              };
            });
            const inserts = normalizedRows.map((item) => ({
              tenantId: item.tenantId,
              nmId: item.nmId,
              price: item.price.toString(),
              discount: item.discount,
              spp: item.spp,
              updatedAt: item.updatedAt,
            }));

            await tx.insert(rawApiPrices).values(inserts).onConflictDoUpdate({
              target: [rawApiPrices.tenantId, rawApiPrices.nmId],
              set: {
                price: sql`EXCLUDED.price`,
                discount: sql`EXCLUDED.discount`,
                spp: sql`EXCLUDED.spp`,
                updatedAt: sql`EXCLUDED.updated_at`
              }
            });

            if (shouldPersistSppSnapshot) {
              const snapshotInserts = normalizedRows.map((item) => ({
                tenantId: item.tenantId,
                nmId: item.nmId,
                snapshotAt,
                snapshotDate,
                snapshotSlot,
                price: item.price.toString(),
                discount: item.discount,
                spp: item.snapshotSpp,
                sellerPriceAfterDiscount: item.sellerPriceAfterDiscount.toString(),
                customerPrice: item.customerPrice.toString(),
                priceAfterSpp: item.priceAfterSpp.toString(),
                impliedSpp: item.impliedSpp.toString(),
                publicPriceSource: item.publicPriceSource,
                publicDest: SPP_PUBLIC_DEST,
                updatedAt: now,
              }));

              await tx.insert(rawApiPriceSnapshots).values(snapshotInserts).onConflictDoUpdate({
                target: [
                  rawApiPriceSnapshots.tenantId,
                  rawApiPriceSnapshots.nmId,
                  rawApiPriceSnapshots.snapshotDate,
                  rawApiPriceSnapshots.snapshotSlot,
                ],
                set: {
                  snapshotAt: sql`EXCLUDED.snapshot_at`,
                  price: sql`EXCLUDED.price`,
                  discount: sql`EXCLUDED.discount`,
                  spp: sql`EXCLUDED.spp`,
                  sellerPriceAfterDiscount: sql`EXCLUDED.seller_price_after_discount`,
                  customerPrice: sql`EXCLUDED.customer_price`,
                  priceAfterSpp: sql`EXCLUDED.price_after_spp`,
                  impliedSpp: sql`EXCLUDED.implied_spp`,
                  publicPriceSource: sql`EXCLUDED.public_price_source`,
                  publicDest: sql`EXCLUDED.public_dest`,
                  updatedAt: sql`EXCLUDED.updated_at`,
                },
              });
              snapshotRows += snapshotInserts.length;
            }
          }
        });

        return {
          records: priceList.length,
          batches,
          meta: shouldPersistSppSnapshot
            ? { snapshotRows, snapshotDate, snapshotSlot, publicPriceRows: publicPrices.size, publicDest: SPP_PUBLIC_DEST }
            : { snapshotRows: 0 },
        };
      });

      await recordSource("sync-orders", "orders", async () => {
        const orders: WbOrderItem[] = await wbApi.getOrders(plainToken, dateFrom, dateTo);
        if (orders.length === 0) {
          return { status: 'skipped', meta: { reason: 'empty' } };
        }

        let batches = 0;
        await withTenantContext(db, tenantId, async (tx) => {
          for (const chunk of chunkArray(orders, 1000)) {
            batches += 1;
            const inserts = chunk.map((item) => ({
              srid: item.srid,
              tenantId,
              nmId: item.nmId,
              date: new Date(item.date),
              totalPrice: (item.totalPrice || 0).toString(),
              isCancel: item.isCancel || false,
              warehouseName: optionalText(item.warehouseName),
              warehouseType: optionalText(item.warehouseType),
              countryName: optionalText(item.countryName),
              oblastOkrugName: optionalText(item.oblastOkrugName),
              regionName: optionalText(item.regionName),
              supplierArticle: optionalText(item.supplierArticle),
              barcode: optionalText(item.barcode),
              category: optionalText(item.category),
              subject: optionalText(item.subject),
              brand: optionalText(item.brand),
              techSize: optionalText(item.techSize),
              incomeId: typeof item.incomeID === "number" && Number.isFinite(item.incomeID) ? item.incomeID : null,
              spp: optionalNumberString(item.spp),
              finishedPrice: optionalNumberString(item.finishedPrice),
              priceWithDisc: optionalNumberString(item.priceWithDisc),
            }));

            await tx.insert(rawApiOrders).values(inserts).onConflictDoUpdate({
              target: [rawApiOrders.tenantId, rawApiOrders.srid],
              set: {
                isCancel: sql`EXCLUDED.is_cancel`,
                totalPrice: sql`EXCLUDED.total_price`,
                warehouseName: sql`EXCLUDED.warehouse_name`,
                warehouseType: sql`EXCLUDED.warehouse_type`,
                countryName: sql`EXCLUDED.country_name`,
                oblastOkrugName: sql`EXCLUDED.oblast_okrug_name`,
                regionName: sql`EXCLUDED.region_name`,
                supplierArticle: sql`EXCLUDED.supplier_article`,
                barcode: sql`EXCLUDED.barcode`,
                category: sql`EXCLUDED.category`,
                subject: sql`EXCLUDED.subject`,
                brand: sql`EXCLUDED.brand`,
                techSize: sql`EXCLUDED.tech_size`,
                incomeId: sql`EXCLUDED.income_id`,
                spp: sql`EXCLUDED.spp`,
                finishedPrice: sql`EXCLUDED.finished_price`,
                priceWithDisc: sql`EXCLUDED.price_with_disc`,
              },
            });
          }
        });

        return { records: orders.length, batches };
      });

      await recordSource("sync-funnel", "funnel", async () => {
        const funnel: WbFunnelItem[] = await wbApi.getNomenclatureReport(plainToken, dateFrom, dateTo);
        const dailyFunnelReports: WbDailyFunnelWindow[] = await wbApi.getDailyNomenclatureReport(plainToken, dateFrom, dateTo);
        if (funnel.length === 0 && dailyFunnelReports.length === 0) {
          return { status: 'skipped', meta: { reason: 'empty' } };
        }

        let batches = 0;
        let dailyRecords = 0;
        await withTenantContext(db, tenantId, async (tx) => {
          await tx.delete(rawApiFunnelStats)
            .where(and(
              eq(rawApiFunnelStats.tenantId, tenantId),
              eq(rawApiFunnelStats.periodStart, selectedPeriodStart),
              eq(rawApiFunnelStats.periodEnd, selectedPeriodEnd),
            ));

          await tx.execute(sql`
            DELETE FROM raw_api_funnel_stats
            WHERE tenant_id = ${tenantId}
              AND period_start::date = period_end::date
              AND period_start::date >= ${selectedPeriodStartDate}::date
              AND period_start::date <= ${selectedPeriodEndDate}::date
          `);

          for (const chunk of chunkArray(funnel, 500)) {
            batches += 1;
            const inserts = chunk.map((item) => ({
              tenantId,
              nmId: item.nmId,
              date: selectedPeriodEnd,
              periodStart: selectedPeriodStart,
              periodEnd: selectedPeriodEnd,
              openCardCount: item.openCardCount || 0,
              addToCartCount: item.addToCartCount || 0,
              orderCount: item.orderCount || 0,
              orderSum: (item.orderSum || 0).toString(),
              buyoutCount: item.buyoutsCount || 0,
              buyoutSum: (item.buyoutsSum || 0).toString(),
              cancelCount: item.cancelCount || 0,
              cancelSum: (item.cancelSum || 0).toString(),
              avgPrice: (item.avgPrice || 0).toString(),
              addToCartPercent: (item.addToCartPercent || 0).toString(),
              cartToOrderPercent: (item.cartToOrderPercent || 0).toString(),
              orderToBuyoutPercent: (item.orderToBuyoutPercent || 0).toString(),
              localizationPercent: item.localizationPercent != null
                ? item.localizationPercent.toString()
                : null,
            }));

            await tx.insert(rawApiFunnelStats).values(inserts).onConflictDoUpdate({
              target: [rawApiFunnelStats.tenantId, rawApiFunnelStats.nmId, rawApiFunnelStats.periodStart, rawApiFunnelStats.periodEnd],
              set: {
                date: sql`EXCLUDED.date`,
                openCardCount: sql`EXCLUDED.open_card_count`,
                addToCartCount: sql`EXCLUDED.add_to_cart_count`,
                orderCount: sql`EXCLUDED.order_count`,
                orderSum: sql`EXCLUDED.order_sum`,
                buyoutCount: sql`EXCLUDED.buyout_count`,
                buyoutSum: sql`EXCLUDED.buyout_sum`,
                cancelCount: sql`EXCLUDED.cancel_count`,
                cancelSum: sql`EXCLUDED.cancel_sum`,
                avgPrice: sql`EXCLUDED.avg_price`,
                addToCartPercent: sql`EXCLUDED.add_to_cart_percent`,
                cartToOrderPercent: sql`EXCLUDED.cart_to_order_percent`,
                orderToBuyoutPercent: sql`EXCLUDED.order_to_buyout_percent`,
                localizationPercent: sql`EXCLUDED.localization_percent`,
              }
            });
          }

          const dailyRows = dailyFunnelReports.flatMap((report) => report.items.map((item) => ({
            tenantId,
            nmId: item.nmId,
            date: new Date(report.periodStart),
            periodStart: new Date(report.periodStart),
            periodEnd: new Date(report.periodEnd),
            openCardCount: item.openCardCount || 0,
            addToCartCount: item.addToCartCount || 0,
            orderCount: item.orderCount || 0,
            orderSum: (item.orderSum || 0).toString(),
            buyoutCount: item.buyoutsCount || 0,
            buyoutSum: (item.buyoutsSum || 0).toString(),
            cancelCount: item.cancelCount || 0,
            cancelSum: (item.cancelSum || 0).toString(),
            avgPrice: (item.avgPrice || 0).toString(),
            addToCartPercent: (item.addToCartPercent || 0).toString(),
            cartToOrderPercent: (item.cartToOrderPercent || 0).toString(),
            orderToBuyoutPercent: (item.orderToBuyoutPercent || 0).toString(),
          })));

          for (const chunk of chunkArray(dailyRows, 500)) {
            batches += 1;
            dailyRecords += chunk.length;
            await tx.insert(rawApiFunnelStats).values(chunk).onConflictDoUpdate({
              target: [rawApiFunnelStats.tenantId, rawApiFunnelStats.nmId, rawApiFunnelStats.periodStart, rawApiFunnelStats.periodEnd],
              set: {
                date: sql`EXCLUDED.date`,
                openCardCount: sql`EXCLUDED.open_card_count`,
                addToCartCount: sql`EXCLUDED.add_to_cart_count`,
                orderCount: sql`EXCLUDED.order_count`,
                orderSum: sql`EXCLUDED.order_sum`,
                buyoutCount: sql`EXCLUDED.buyout_count`,
                buyoutSum: sql`EXCLUDED.buyout_sum`,
                cancelCount: sql`EXCLUDED.cancel_count`,
                cancelSum: sql`EXCLUDED.cancel_sum`,
                avgPrice: sql`EXCLUDED.avg_price`,
                addToCartPercent: sql`EXCLUDED.add_to_cart_percent`,
                cartToOrderPercent: sql`EXCLUDED.cart_to_order_percent`,
                orderToBuyoutPercent: sql`EXCLUDED.order_to_buyout_percent`,
              }
            });
          }
        });

        return { records: funnel.length + dailyRecords, batches, meta: { dailyPeriods: dailyFunnelReports.length, dailyRecords } };
      });

      await recordSource("sync-stocks", "stocks", async () => {
        const stocks: WbStockItem[] = await wbApi.getStocks(plainToken);
        if (stocks.length === 0) {
          return { status: 'skipped', meta: { reason: 'empty' } };
        }

        const aggregatedStocks = new Map<string, {
          tenantId: string;
          nmId: number;
          warehouseName: string;
          amount: number;
          inWayToClient: number;
          inWayFromClient: number;
          date: Date;
        }>();

        for (const item of stocks) {
          const warehouseName = item.warehouseName || 'Unknown';
          const key = `${item.nmId}:${warehouseName}`;
          const existing = aggregatedStocks.get(key);

          if (existing) {
            existing.amount += item.quantity || 0;
            existing.inWayToClient += item.inWayToClient || 0;
            existing.inWayFromClient += item.inWayFromClient || 0;
            continue;
          }

          aggregatedStocks.set(key, {
            tenantId,
            nmId: item.nmId,
            warehouseName,
            amount: item.quantity || 0,
            inWayToClient: item.inWayToClient || 0,
            inWayFromClient: item.inWayFromClient || 0,
            date: new Date(),
          });
        }

        const dedupedStocks = Array.from(aggregatedStocks.values());

        let batches = 0;
        await withTenantContext(db, tenantId, async (tx) => {
          await tx.delete(rawApiStocks).where(eq(rawApiStocks.tenantId, tenantId));

          for (const chunk of chunkArray(dedupedStocks, 500)) {
            batches += 1;
            await tx.insert(rawApiStocks).values(chunk).onConflictDoUpdate({
              target: [rawApiStocks.tenantId, rawApiStocks.nmId, rawApiStocks.warehouseName],
              set: {
                amount: sql`EXCLUDED.amount`,
                inWayToClient: sql`EXCLUDED.in_way_to_client`,
                inWayFromClient: sql`EXCLUDED.in_way_from_client`,
                date: sql`EXCLUDED.date`,
              }
            });
          }
        });

        return { records: dedupedStocks.length, batches };
      });

      await recordSource("sync-warehouse-remains", "warehouse_remains", async () => {
        // WB-side authoritative volume per nmId (matches «Объём, л» in the
        // cabinet's xlsx export). Async report; rate-limited to ~1/min per
        // token, but the polling itself takes a few seconds.
        let remains: Awaited<ReturnType<typeof wbApi.getWarehouseRemains>>;
        try {
          remains = await wbApi.getWarehouseRemains(plainToken, { groupByNm: true });
        } catch (err) {
          logger.warn({ tenantId, err }, '[sync-warehouse-remains] failed, skipping volume update');
          return { status: 'skipped', meta: { reason: 'wb_api_error' } };
        }
        if (remains.length === 0) {
          return { status: 'skipped', meta: { reason: 'empty' } };
        }

        const updatedAt = new Date();
        let updated = 0;
        await withTenantContext(db, tenantId, async (tx) => {
          for (const item of remains) {
            if (item.volume == null || !Number.isFinite(item.volume) || item.volume <= 0) continue;
            const result = await tx.update(products)
              .set({
                wbWarehouseVolumeLiters: item.volume.toString(),
                wbWarehouseVolumeUpdatedAt: updatedAt,
              })
              .where(and(eq(products.tenantId, tenantId), eq(products.nmId, item.nmId)));
            // drizzle update returns no rowCount portably; count as best effort
            updated += 1;
            void result;
          }
        });
        return { records: updated, batches: 1, meta: { items: remains.length } };
      });

      await recordSource("sync-stock-offices", "stock_offices", async () => {
        const stockOffices: WbStockOfficeMetricItem[] = await wbApi.getStockOfficesMetrics(
          plainToken,
          stockAnalyticsDateFrom,
          dateTo,
          {
            stockType: "wb",
          }
        );
        if (stockOffices.length === 0) {
          return { status: "skipped", meta: { reason: "empty" } };
        }
        const dedupedStockOffices = dedupeStockOfficeMetricItems(stockOffices);
        if (dedupedStockOffices.length === 0) {
          return {
            status: "skipped",
            meta: {
              reason: "empty_after_dedupe",
              dedupedFrom: stockOffices.length,
            },
          };
        }

        let batches = 0;
        await withTenantContext(db, tenantId, async (tx) => {
          await tx.delete(rawApiStockOffices).where(and(
            eq(rawApiStockOffices.tenantId, tenantId),
            eq(rawApiStockOffices.snapshotDate, selectedPeriodEnd),
            eq(rawApiStockOffices.stockType, "wb"),
          ));

        for (const chunk of chunkArray(dedupedStockOffices, 500)) {
          batches += 1;
          await tx.insert(rawApiStockOffices).values(chunk.map((item) => ({
            tenantId,
            snapshotDate: selectedPeriodEnd,
            periodStart: stockAnalyticsPeriodStart,
            periodEnd: selectedPeriodEnd,
            stockType: item.stockType || "wb",
            regionName: item.regionName,
            officeId: item.officeId,
            officeName: item.officeName,
            ordersCount: item.ordersCount.toString(),
            ordersSum: item.ordersSum.toString(),
            buyoutCount: item.buyoutCount.toString(),
            buyoutSum: item.buyoutSum.toString(),
            stockCount: item.stockCount,
            stockSum: item.stockSum.toString(),
            toClientCount: item.toClientCount,
            fromClientCount: item.fromClientCount,
            lostOrdersCount: item.lostOrdersCount.toString(),
            lostOrdersSum: item.lostOrdersSum.toString(),
            avgStockTurnoverDays: item.avgStockTurnoverDays === null ? null : item.avgStockTurnoverDays.toString(),
            saleRateDays: item.saleRateDays === null ? null : item.saleRateDays.toString(),
          }))).onConflictDoUpdate({
            target: [
              rawApiStockOffices.tenantId,
              rawApiStockOffices.snapshotDate,
              rawApiStockOffices.stockType,
              rawApiStockOffices.regionName,
              rawApiStockOffices.officeId,
              rawApiStockOffices.officeName,
            ],
            set: {
              periodStart: sql`EXCLUDED.period_start`,
              periodEnd: sql`EXCLUDED.period_end`,
              ordersCount: sql`EXCLUDED.orders_count`,
              ordersSum: sql`EXCLUDED.orders_sum`,
              buyoutCount: sql`EXCLUDED.buyout_count`,
              buyoutSum: sql`EXCLUDED.buyout_sum`,
              stockCount: sql`EXCLUDED.stock_count`,
              stockSum: sql`EXCLUDED.stock_sum`,
              toClientCount: sql`EXCLUDED.to_client_count`,
              fromClientCount: sql`EXCLUDED.from_client_count`,
              lostOrdersCount: sql`EXCLUDED.lost_orders_count`,
              lostOrdersSum: sql`EXCLUDED.lost_orders_sum`,
              avgStockTurnoverDays: sql`EXCLUDED.avg_stock_turnover_days`,
              saleRateDays: sql`EXCLUDED.sale_rate_days`,
            }
          });
        }
        });

        return {
          records: dedupedStockOffices.length,
          batches,
          meta: {
            rangeFrom: stockAnalyticsPeriodStartDate,
            rangeTo: selectedPeriodEndDate,
            configuredLookbackDays: STOCK_ANALYTICS_LOOKBACK_DAYS,
            ...(dedupedStockOffices.length !== stockOffices.length ? { dedupedFrom: stockOffices.length } : {}),
          },
        };
      });

      await recordSource("sync-stock-sizes", "stock_sizes", async () => {
        const salesWindowToExclusive = new Date(selectedPeriodEnd.getTime() + 86_400_000);
        const [groupMemberNmRows, salesNmRows, stockNmRows] = await withTenantContext(db, tenantId, async (tx) => Promise.all([
          tx.execute<{ nmId: number }>(sql`
            SELECT DISTINCT gm.nm_id AS "nmId"
            FROM product_group_members gm
            JOIN product_groups pg ON pg.id = gm.group_id
            WHERE pg.tenant_id = ${tenantId}
              AND gm.nm_id > 0
            ORDER BY gm.nm_id ASC
            LIMIT ${STOCK_SIZES_MAX_NM_IDS}
          `),
          tx.select({
            nmId: rawApiSales.nmId,
            saleCount: sql<number>`COUNT(*)::int`,
          })
            .from(rawApiSales)
            .where(and(
              eq(rawApiSales.tenantId, tenantId),
              eq(rawApiSales.isStorno, false),
              gte(rawApiSales.date, stockAnalyticsPeriodStart),
              lt(rawApiSales.date, salesWindowToExclusive),
            ))
            .groupBy(rawApiSales.nmId)
            .orderBy(sql`COUNT(*) DESC`)
            .limit(STOCK_SIZES_MAX_NM_IDS),
          tx.select({
            nmId: rawApiStocks.nmId,
            stockAmount: sql<number>`SUM(${rawApiStocks.amount})::int`,
          })
            .from(rawApiStocks)
            .where(eq(rawApiStocks.tenantId, tenantId))
            .groupBy(rawApiStocks.nmId)
            .orderBy(sql`SUM(${rawApiStocks.amount}) DESC`)
            .limit(STOCK_SIZES_MAX_NM_IDS),
        ]));

        const stockAmountByNmId = new Map(
          stockNmRows.map((row) => [Number(row.nmId), Number(row.stockAmount ?? 0)] as const),
        );
        const saleCountByNmId = new Map(
          salesNmRows.map((row) => [Number(row.nmId), Number(row.saleCount ?? 0)] as const),
        );
        const candidateNmIds = Array.from(new Set([
          ...stockNmRows.map((row) => row.nmId),
          ...salesNmRows.map((row) => row.nmId),
          ...groupMemberNmRows.map((row) => row.nmId),
        ])).slice(0, STOCK_SIZES_MAX_NM_IDS);

        if (candidateNmIds.length === 0) {
          return { status: "skipped", meta: { reason: "no_nm_candidates" } };
        }

        let stockSizes: WbStockSizeMetricItem[] = await runAbortableSource("stock_sizes", (signal) => (
          wbApi.getStockSizesMetrics(plainToken, {
            dateFrom: stockAnalyticsDateFrom,
            dateTo,
            nmIds: candidateNmIds,
            stockType: "wb",
            includeOffice: true,
            signal,
          })
        ));
        const getReturnedNmIds = (rows: WbStockSizeMetricItem[]) => (
          Array.from(new Set(rows.map((item) => Number(item.nmId)).filter((nmId) => Number.isFinite(nmId) && nmId > 0)))
            .sort((a, b) => a - b)
        );
        const getMissingNmIds = (returnedNmIds: number[]) => {
          const returnedSet = new Set(returnedNmIds);
          return candidateNmIds.filter((nmId) => !returnedSet.has(Number(nmId)));
        };
        let returnedNmIds = getReturnedNmIds(stockSizes);
        let missingNmIds = getMissingNmIds(returnedNmIds);
        const retriedMissingNmIds = missingNmIds
          .slice()
          .sort((a, b) => (
            (stockAmountByNmId.get(Number(b)) ?? 0) - (stockAmountByNmId.get(Number(a)) ?? 0)
            || (saleCountByNmId.get(Number(b)) ?? 0) - (saleCountByNmId.get(Number(a)) ?? 0)
            || Number(a) - Number(b)
          ))
          .slice(0, STOCK_SIZES_MISSING_RETRY_MAX_NM_IDS);
        let retryStockSizes: WbStockSizeMetricItem[] = [];

        if (retriedMissingNmIds.length > 0) {
          retryStockSizes = await runAbortableSource("stock_sizes", (signal) => (
            wbApi.getStockSizesMetrics(plainToken, {
              dateFrom: stockAnalyticsDateFrom,
              dateTo,
              nmIds: retriedMissingNmIds,
              stockType: "wb",
              includeOffice: true,
              signal,
            })
          ));
          stockSizes = [...stockSizes, ...retryStockSizes];
          returnedNmIds = getReturnedNmIds(stockSizes);
          missingNmIds = getMissingNmIds(returnedNmIds);
        }

        const stockSizesCoverageMeta = {
          requestedNmIds: candidateNmIds.length,
          requestedNmIdList: candidateNmIds,
          returnedNmIds: returnedNmIds.length,
          returnedNmIdList: returnedNmIds,
          missingNmIdCount: missingNmIds.length,
          missingNmIds,
          retriedMissingNmIds,
          retryRecords: retryStockSizes.length,
          retryMaxNmIds: STOCK_SIZES_MISSING_RETRY_MAX_NM_IDS,
        };

        if (stockSizes.length === 0) {
          return {
            status: "skipped",
            meta: {
              reason: "empty",
              ...stockSizesCoverageMeta,
            },
          };
        }
        const dedupedStockSizes = dedupeStockSizeMetricItems(stockSizes);
        const dedupedReturnedNmIds = getReturnedNmIds(dedupedStockSizes);
        if (dedupedStockSizes.length === 0) {
          return {
            status: "skipped",
            meta: {
              reason: "empty_after_dedupe",
              ...stockSizesCoverageMeta,
              dedupedFrom: stockSizes.length,
            },
          };
        }

        let batches = 0;
        await withTenantContext(db, tenantId, async (tx) => {
          await tx.delete(rawApiStockSizes).where(and(
            eq(rawApiStockSizes.tenantId, tenantId),
            eq(rawApiStockSizes.snapshotDate, selectedPeriodEnd),
            eq(rawApiStockSizes.stockType, "wb"),
          ));

        for (const chunk of chunkArray(dedupedStockSizes, 500)) {
          batches += 1;
          await tx.insert(rawApiStockSizes).values(chunk.map((item) => ({
            tenantId,
            snapshotDate: selectedPeriodEnd,
            periodStart: stockAnalyticsPeriodStart,
            periodEnd: selectedPeriodEnd,
            stockType: item.stockType || "wb",
            nmId: item.nmId,
            sizeName: item.sizeName,
            chrtId: item.chrtId,
            regionName: item.regionName,
            officeId: item.officeId,
            officeName: item.officeName,
            ordersCount: item.ordersCount.toString(),
            ordersSum: item.ordersSum.toString(),
            buyoutCount: item.buyoutCount.toString(),
            buyoutSum: item.buyoutSum.toString(),
            stockCount: item.stockCount,
            stockSum: item.stockSum.toString(),
            toClientCount: item.toClientCount,
            fromClientCount: item.fromClientCount,
            lostOrdersCount: item.lostOrdersCount.toString(),
            lostOrdersSum: item.lostOrdersSum.toString(),
            avgStockTurnoverDays: item.avgStockTurnoverDays === null ? null : item.avgStockTurnoverDays.toString(),
            saleRateDays: item.saleRateDays === null ? null : item.saleRateDays.toString(),
          }))).onConflictDoUpdate({
            target: [
              rawApiStockSizes.tenantId,
              rawApiStockSizes.snapshotDate,
              rawApiStockSizes.stockType,
              rawApiStockSizes.nmId,
              rawApiStockSizes.sizeName,
              rawApiStockSizes.chrtId,
              rawApiStockSizes.regionName,
              rawApiStockSizes.officeId,
              rawApiStockSizes.officeName,
            ],
            set: {
              periodStart: sql`EXCLUDED.period_start`,
              periodEnd: sql`EXCLUDED.period_end`,
              ordersCount: sql`EXCLUDED.orders_count`,
              ordersSum: sql`EXCLUDED.orders_sum`,
              buyoutCount: sql`EXCLUDED.buyout_count`,
              buyoutSum: sql`EXCLUDED.buyout_sum`,
              stockCount: sql`EXCLUDED.stock_count`,
              stockSum: sql`EXCLUDED.stock_sum`,
              toClientCount: sql`EXCLUDED.to_client_count`,
              fromClientCount: sql`EXCLUDED.from_client_count`,
              lostOrdersCount: sql`EXCLUDED.lost_orders_count`,
              lostOrdersSum: sql`EXCLUDED.lost_orders_sum`,
              avgStockTurnoverDays: sql`EXCLUDED.avg_stock_turnover_days`,
              saleRateDays: sql`EXCLUDED.sale_rate_days`,
            }
          });
        }
        });

        return {
          records: dedupedStockSizes.length,
          batches,
          meta: {
            ...stockSizesCoverageMeta,
            groupMemberNmIds: groupMemberNmRows.length,
            syncedNmIds: dedupedReturnedNmIds.length,
            syncedNmIdList: dedupedReturnedNmIds,
            rangeFrom: stockAnalyticsPeriodStartDate,
            rangeTo: selectedPeriodEndDate,
            configuredLookbackDays: STOCK_ANALYTICS_LOOKBACK_DAYS,
            ...(dedupedStockSizes.length !== stockSizes.length ? { dedupedFrom: stockSizes.length } : {}),
          },
        };
      });

      await recordSource("sync-tariffs", "tariffs", async () => {
        const today = new Date().toISOString().slice(0, 10);
        const errors: Record<string, string> = {};
        const fetchTariffSource = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
          try {
            return await fn();
          } catch (error) {
            errors[label] = serializeError(error);
            logger.warn({ err: error, tenantId, source: label }, 'WB tariff source failed');
            return null;
          }
        };
        const [acceptanceTariffs, boxTariffs, returnTariffs, categoryCommissions] = await Promise.all([
          fetchTariffSource('acceptance', () => wbApi.getAcceptanceTariffs(plainToken)),
          fetchTariffSource('box', () => wbApi.getBoxTariffs(plainToken, today)),
          fetchTariffSource('return', () => wbApi.getReturnTariffs(plainToken, today)),
          fetchTariffSource('commission', () => wbApi.getCategoryCommissions(plainToken)),
        ]);

        let savedCount = 0;
        const successfulSources = [
          acceptanceTariffs,
          boxTariffs,
          returnTariffs,
          categoryCommissions,
        ].filter((data) => data !== null).length;

        await withTenantContext(db, tenantId, async (tx) => {
          for (const [tariffType, data] of [
            ['acceptance', acceptanceTariffs],
            ['box', boxTariffs],
            ['return', returnTariffs],
          ] as const) {
            if (data && Array.isArray(data) && data.length > 0) {
              await tx.insert(wbTariffSnapshots).values({
                tenantId,
                tariffType,
                snapshotDate: today,
                data,
              }).onConflictDoUpdate({
                target: [wbTariffSnapshots.tenantId, wbTariffSnapshots.tariffType, wbTariffSnapshots.snapshotDate],
                set: {
                  data: sql`EXCLUDED.data`,
                  createdAt: sql`NOW()`,
                },
              });
              savedCount++;
            }
          }

          if (categoryCommissions && Array.isArray(categoryCommissions) && categoryCommissions.length > 0) {
            await tx.insert(wbCategoryCommissionSnapshots).values({
              tenantId,
              snapshotDate: today,
              data: categoryCommissions,
            }).onConflictDoUpdate({
              target: [wbCategoryCommissionSnapshots.tenantId, wbCategoryCommissionSnapshots.snapshotDate],
              set: {
                data: sql`EXCLUDED.data`,
                createdAt: sql`NOW()`,
              },
            });
            savedCount++;
          }
        });

        if (successfulSources === 0 && Object.keys(errors).length > 0) {
          throw new Error(`All tariff sources failed: ${JSON.stringify(errors)}`);
        }

        return {
          records: savedCount,
          meta: {
            acceptance: acceptanceTariffs?.length ?? 0,
            box: boxTariffs?.length ?? 0,
            returnTariffs: returnTariffs?.length ?? 0,
            commissions: categoryCommissions?.length ?? 0,
            errors,
          },
        };
      });

      await recordSource("sync-region-sales", "region_sales", async () => {
        // WB API max period: 31 days, rate limit: 1 req / 10 sec
        const regionFrom = from
          ? new Date(from).toISOString().slice(0, 10)
          : subDays(new Date(), 30).toISOString().slice(0, 10);
        const regionTo = to
          ? new Date(to).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        const regionWindows = splitDateOnlyRangeByMaxDays(regionFrom, regionTo, 31);

        const BATCH_SIZE = 200;
        let batches = 0;
        let rawRows = 0;
        const rowsToSave: Array<{
          tenantId: string;
          nmId: number;
          foName: string;
          regionName: string;
          countryName: string;
          saleQty: number;
          saleCostPrice: string;
          saleCostPricePerc: string;
          periodFrom: Date;
          periodTo: Date;
        }> = [];

        for (const window of regionWindows) {
          const regionSales = await wbApi.getRegionSales(plainToken, window.from, window.to);
          rawRows += regionSales.length;

          // Aggregate by nmId + foName (federal district) to reduce row count.
          const aggMap = new Map<string, {
            nmId: number; foName: string; regionName: string; countryName: string;
            saleQty: number; saleCostPrice: number; saleCostPricePerc: number;
          }>();

          for (const item of regionSales) {
            if (!item.nmId || !item.foName) continue;
            const key = `${item.nmId}::${item.foName}`;
            const existing = aggMap.get(key);
            if (existing) {
              existing.saleQty += item.saleItemInvoiceQty;
              existing.saleCostPrice += item.saleInvoiceCostPrice;
              existing.saleCostPricePerc += item.saleInvoiceCostPricePerc;
            } else {
              aggMap.set(key, {
                nmId: item.nmId,
                foName: item.foName,
                regionName: item.regionName || item.foName,
                countryName: item.countryName,
                saleQty: item.saleItemInvoiceQty,
                saleCostPrice: item.saleInvoiceCostPrice,
                saleCostPricePerc: item.saleInvoiceCostPricePerc,
              });
            }
          }

          const aggregated = Array.from(aggMap.values());
          if (aggregated.length === 0) {
            continue;
          }

          rowsToSave.push(...aggregated.map((item) => ({
            tenantId,
            nmId: item.nmId,
            foName: item.foName,
            regionName: item.regionName,
            countryName: item.countryName,
            saleQty: item.saleQty,
            saleCostPrice: item.saleCostPrice.toFixed(2),
            saleCostPricePerc: item.saleCostPricePerc.toFixed(4),
            periodFrom: new Date(window.from),
            periodTo: new Date(window.to),
          })));
        }

        if (rowsToSave.length === 0) {
          return { status: 'skipped', meta: { reason: 'empty', windows: regionWindows.length } };
        }

        await withTenantContext(db, tenantId, async (tx) => {
          await tx.delete(rawApiRegionSales).where(
            and(
              eq(rawApiRegionSales.tenantId, tenantId),
              gte(rawApiRegionSales.periodFrom, new Date(regionFrom)),
              lte(rawApiRegionSales.periodTo, new Date(regionTo)),
            ),
          );

          for (let i = 0; i < rowsToSave.length; i += BATCH_SIZE) {
            const chunk = rowsToSave.slice(i, i + BATCH_SIZE);
            await tx.insert(rawApiRegionSales).values(chunk);
            batches++;
          }
        });

        return {
          records: rowsToSave.length,
          rawRows,
          batches,
          meta: { windows: regionWindows.length },
        };
      });

      await recordSource("sync-sales", "sales", async () => {
        const sales: WbSaleItem[] = await wbApi.getSalesV1(plainToken, from ? new Date(from).toISOString() : subDays(new Date(), 7).toISOString());
        if (sales.length === 0) {
          return { status: 'skipped', meta: { reason: 'empty' } };
        }

        let batches = 0;
        await withTenantContext(db, tenantId, async (tx) => {
          for (const chunk of chunkArray(sales, 500)) {
            batches += 1;
            await tx.insert(rawApiSales).values(chunk.map((item) => ({
              tenantId,
              saleId: item.saleID,
              nmId: item.nmId,
              date: new Date(item.date),
              priceWithDiscount: (item.forPay || 0).toString(),
              warehouseName: item.warehouseName || 'Unknown',
              isStorno: item.isStorno === 1,
            }))).onConflictDoUpdate({
              target: [rawApiSales.tenantId, rawApiSales.nmId, rawApiSales.saleId],
              set: {
                priceWithDiscount: sql`EXCLUDED.price_with_discount`,
                isStorno: sql`EXCLUDED.is_storno`,
              },
            });
          }
        });

        return { records: sales.length, batches };
      });

      await recordSource("sync-paid-storage", "paid_storage", async () => {
        let storage: WbPaidStorageItem[];
        try {
          storage = await runAbortableSource("paid_storage", (signal) => (
            wbApi.getPaidStorage(
              plainToken,
              paidStorageDateFrom,
              dateTo,
              { signal },
            )
          ));
        } catch (error) {
          return await recoverWithRetainedSnapshot("paid_storage", error);
        }
        const dedupedStorage = dedupePaidStorageItems(storage);

        if (dedupedStorage.length === 0) {
          return { status: 'skipped', meta: { reason: 'empty' } };
        }

        let batches = 0;
        await withTenantContext(db, tenantId, async (tx) => {
          for (const chunk of chunkArray(dedupedStorage, 250)) {
            batches += 1;
            await tx.insert(rawApiPaidStorage).values(chunk.map((item) => ({
              tenantId,
              nmId: item.nmId,
              warehouseName: item.warehouseName,
              storageAmount: (item.storageAmount || 0).toString(),
              date: new Date(item.date),
            }))).onConflictDoUpdate({
              target: [rawApiPaidStorage.tenantId, rawApiPaidStorage.nmId, rawApiPaidStorage.warehouseName, rawApiPaidStorage.date],
              set: { storageAmount: sql`EXCLUDED.storage_amount` },
            });
          }
        });

        return {
          records: dedupedStorage.length,
          batches,
          meta: {
            rangeFrom: paidStoragePeriodStartDate,
            rangeTo: selectedPeriodEndDate,
            configuredLookbackDays: PAID_STORAGE_SYNC_LOOKBACK_DAYS,
            ...(dedupedStorage.length !== storage.length ? { dedupedFrom: storage.length } : {}),
          },
        };
      });

      await recordSource("sync-ads", "ads", async () => {
        let inserts: Array<{
          tenantId: string;
          nmId: number;
          date: Date;
          amount: string;
          orderCount: number;
          orderSum: string;
          views?: number;
          clicks?: number;
          type: string;
          placement: string;
        }> = [];
        let sourceMode: 'fullstats' | 'history_upd' = 'history_upd';
        let sourceMeta: Record<string, unknown> | undefined;

        try {
          const history = await runAbortableSource("ads", async (signal) => (
            buildHistoricalAdCostRows({
              tenantId,
              token: plainToken,
              dateFrom: adsDateFrom,
              dateTo,
              signal,
            })
          ));
          inserts = history.rows;
          sourceMeta = {
            source: sourceMode,
            rangeFrom: adsPeriodStartDate,
            rangeTo: selectedPeriodEndDate,
            configuredLookbackDays: ADS_SYNC_LOOKBACK_DAYS,
            historyRowCount: history.historyRowCount,
            campaignCount: history.campaignCount,
            totalAmountRub: history.totalAmountRub,
            unallocatedCampaignCount: history.unallocatedCampaignCount,
            unallocatedAmountRub: history.unallocatedAmountRub,
          };
        } catch (historyError) {
          try {
            sourceMode = 'fullstats';
            const campaigns = await runAbortableSource("ads", async (signal) => (
              ensureAdCampaignsLoaded(signal)
            ));
            const ads = await runAbortableSource("ads", async (signal) => {
              return await wbApi.getAdSpend(plainToken, adsDateFrom, dateTo, { signal, campaigns, groupBy: 'advert_nm_date' });
            });

            inserts = ads.map((item) => ({
              tenantId,
              nmId: item.nmId,
              date: new Date(item.date),
              amount: (item.sum || 0).toString(),
              orderCount: Math.max(0, Math.round(item.orderCount || 0)),
              orderSum: (item.orderSum || 0).toString(),
              views: Math.max(0, Math.round(item.views || 0)),
              clicks: Math.max(0, Math.round(item.clicks || 0)),
              type: 'unified',
              placement: item.advertId ? `campaign:${item.advertId}` : 'overall',
            }));
            sourceMeta = {
              source: sourceMode,
              rangeFrom: adsPeriodStartDate,
              rangeTo: selectedPeriodEndDate,
              configuredLookbackDays: ADS_SYNC_LOOKBACK_DAYS,
              fallbackFromError: serializeError(historyError),
            };
          } catch (fullstatsError) {
            return await recoverOrSkipTransientSource("ads", fullstatsError);
          }
        }

        inserts = dedupeAdCostRows(inserts);

        if (inserts.length === 0) {
          return {
            status: 'skipped',
            meta: {
              reason: 'empty',
              source: sourceMode,
              ...sourceMeta,
            },
          };
        }

        let batches = 0;
        await withTenantContext(db, tenantId, async (tx) => {
          await tx.delete(rawApiAdCosts).where(and(
            eq(rawApiAdCosts.tenantId, tenantId),
            gte(rawApiAdCosts.date, adsPeriodStart),
            lte(rawApiAdCosts.date, selectedPeriodEnd),
          ));

          for (const chunk of chunkArray(inserts, 500)) {
            batches += 1;
            await tx.insert(rawApiAdCosts).values(chunk).onConflictDoUpdate({
              target: [rawApiAdCosts.tenantId, rawApiAdCosts.nmId, rawApiAdCosts.date, rawApiAdCosts.placement],
              set: {
                amount: sql`EXCLUDED.amount`,
                orderCount: sql`EXCLUDED.order_count`,
                orderSum: sql`EXCLUDED.order_sum`,
                views: sql`EXCLUDED.views`,
                clicks: sql`EXCLUDED.clicks`,
                type: sql`EXCLUDED.type`,
              },
            });
          }

          if (sourceMode === 'history_upd') {
            await tx.execute(sql`
              DELETE FROM raw_api_ad_costs u
              WHERE u.tenant_id = ${tenantId}
                AND u.type = 'unified'
                AND u.date >= ${selectedPeriodStartIso}::timestamptz
                AND u.date <= ${selectedPeriodEndIso}::timestamptz
                AND EXISTS (
                  SELECT 1
                  FROM raw_api_ad_costs h
                  WHERE h.tenant_id = u.tenant_id
                    AND h.date = u.date
                    AND h.type LIKE 'history_upd%'
                )
            `);
          }
        });

        return {
          records: inserts.length,
          batches,
          meta: {
            source: sourceMode,
            ...sourceMeta,
          },
        };
      });

      await recordSource("sync-ad-clusters", "ad_clusters", async () => {
        let campaigns: WbAdCampaign[];
        try {
          campaigns = await runAbortableSource("ad_clusters", (signal) => (
            ensureAdCampaignsLoaded(signal)
          ));
        } catch (error) {
          return await recoverOrSkipTransientSource("ad_clusters", error);
        }
        const searchItems = Array.from(new Map(
          campaigns
            .filter((campaign) => campaign.searchPlacement && campaign.nmIds.length > 0)
            .flatMap((campaign) => campaign.nmIds.map((nmId) => ({
              key: `${campaign.advertId}:${nmId}`,
              advertId: campaign.advertId,
              nmId,
            })))
            .map((item) => [item.key, { advertId: item.advertId, nmId: item.nmId }])
        ).values());

        if (searchItems.length === 0) {
          return { status: 'skipped', meta: { reason: 'no_search_campaigns' } };
        }

        let records = 0;
        let batches = 0;
        let failedBatches = 0;

        for (const itemsChunk of chunkArray(searchItems, 100)) {
          try {
            const keywords = await runAbortableSource("ad_clusters", (signal) => (
              wbApi.getSearchClusterStats(plainToken, dateFrom, dateTo, itemsChunk, { signal })
            ));
            if (keywords.length === 0) {
              continue;
            }

            await withTenantContext(db, tenantId, async (tx) => {
              for (const chunk of chunkArray(keywords, 250)) {
                batches += 1;
                const inserts = Array.from(new Map(
                  chunk.map((keyword: WbSearchKeywordStat) => {
                    const date = new Date(keyword.date);
                    const clusterKey = `${keyword.nmId}:${date.toISOString()}:${keyword.keyword}`;
                    return [
                      clusterKey,
                      {
                        tenantId,
                        nmId: keyword.nmId,
                        cluster: keyword.keyword,
                        views: keyword.views || 0,
                        clicks: keyword.clicks || 0,
                        ctr: (keyword.ctr || 0).toString(),
                        amount: (keyword.sum || 0).toString(),
                        orderCount: keyword.orders || keyword.atbs || 0,
                        date,
                      },
                    ] as const;
                  }),
                ).values());

                await tx.insert(rawApiAdClusters).values(inserts).onConflictDoUpdate({
                  target: [rawApiAdClusters.tenantId, rawApiAdClusters.nmId, rawApiAdClusters.date, rawApiAdClusters.cluster],
                  set: {
                    views: sql`EXCLUDED.views`,
                    clicks: sql`EXCLUDED.clicks`,
                    ctr: sql`EXCLUDED.ctr`,
                    amount: sql`EXCLUDED.amount`,
                    orderCount: sql`EXCLUDED.order_count`,
                  },
                });
              }
            });

            records += keywords.length;
          } catch (error) {
            failedBatches += 1;
            logger.error({ err: error, batchSize: itemsChunk.length }, 'Ad clusters batch failed');
          }
        }

        if (records === 0 && failedBatches > 0) {
          return await recoverWithRetainedSnapshot(
            "ad_clusters",
            new Error(`Failed to sync all ${failedBatches} ad cluster batches`)
          );
        }

        return {
          records,
          batches,
          meta: failedBatches > 0 ? { failedBatches } : undefined,
        };
      });

      await recordSource("catalog-reconcile", "catalog_reconcile", async () => {
        const inserted = await reconcileObservedProducts(tenantId);
        if (inserted === 0) {
          return { status: 'skipped', meta: { reason: 'up_to_date' } };
        }

        return {
          records: inserted,
          batches: 1,
          meta: { reason: 'observed_catalog_backfill' },
        };
      });

      await recordSource("detect-and-notify-leaks", "signals", async () => {
        const signals = await AnalyticsEngine.getSignals(tenantId);
        const prioritySignals = signals.filter((signal: SignalSummary) => signal.severity === 'critical' || signal.severity === 'high');

        for (const signal of prioritySignals) {
          await BotService.sendSignal(tenantId, signal);
        }

        return {
          status: prioritySignals.length === 0 ? 'skipped' : 'success',
          records: prioritySignals.length,
          batches: prioritySignals.length > 0 ? 1 : 0,
          meta: prioritySignals.length === 0 ? { reason: 'no_priority_signals' } : undefined,
        };
      });

      const syncRetrySources = resolveSyncRetrySources(sourceResults);
      const shouldScheduleSyncRetry = syncRetrySources.length > 0 && adsRetryAttempt < ADS_RETRY_MAX_ATTEMPTS;
      if (shouldScheduleSyncRetry) {
        const nextAdsRetryAttempt = adsRetryAttempt + 1;
        const adsRetryParentSyncRunId = event.data.adsRetryParentSyncRunId ?? persistedSyncRunId;
        const syncRetryLastErrorCode = resolveSyncRetryLastErrorCode(sourceResults, syncRetrySources);

        await step.run(`schedule-sync-retry-${nextAdsRetryAttempt}`, async () => {
          await inngest.send({
            name: ADS_RETRY_EVENT_NAME,
            data: {
              tenantId,
              from: selectedPeriodStartDate,
              to: selectedPeriodEndDate,
              attempt: nextAdsRetryAttempt,
              requestedSources: syncRetrySources,
              parentSyncRunId: adsRetryParentSyncRunId,
              lastErrorCode: syncRetryLastErrorCode,
            },
          });
        });
      }

      const summary = buildPersistedSyncRunSummary();
      const status = resolveSyncRunStatus(sourceResults);
      const summaryPayload = summary as unknown as Record<string, unknown>;

      if (persistedSyncRunId) {
        await step.run("finalize-sync-run", async () => {
          await withTenantContext(db, tenantId, async (tx) => {
            await tx.update(syncRuns)
              .set({
                status,
                finishedAt: new Date(),
                summary: summaryPayload,
                errorMessage: formatSyncRunErrorMessage(summary),
              })
              .where(eq(syncRuns.id, persistedSyncRunId));
          });
        });
      }

      const realizationRefreshed = sourceResults.some(
        (result) => result.source === 'realization_reports' && result.status === 'success',
      );
      if (realizationRefreshed) {
        await step.run("refresh-daily-pnl-mv", async () => {
          // Atomic debounce: claim the refresh slot only if the last successful refresh
          // was > MV_REFRESH_MIN_INTERVAL_SECONDS ago. Without this, 10 concurrent syncs
          // queue 10 sequential full-MV scans.
          const claim = await withAdminContext(db, async (tx) => tx.execute(sql`
            INSERT INTO mv_refresh_runs (mv_name, last_refreshed_at)
            VALUES ('mv_daily_pnl_final', NOW())
            ON CONFLICT (mv_name)
            DO UPDATE SET last_refreshed_at = NOW()
            WHERE mv_refresh_runs.last_refreshed_at <= NOW() - INTERVAL '60 seconds'
            RETURNING 1
          `));
          const claimed = Array.isArray(claim)
            ? claim.length > 0
            : ((claim as { rows?: unknown[] }).rows?.length ?? 0) > 0;
          if (!claimed) {
            logger.debug({ tenantId }, "[Sync] mv_daily_pnl_final refresh debounced (< 60s since last)");
            return;
          }

          try {
            await withAdminContext(db, async (tx) => {
              await tx.execute(sql`REFRESH MATERIALIZED VIEW mv_daily_pnl_final`);
            });
          } catch (err) {
            // Roll back the claim timestamp so the next sync can retry without waiting 60s.
            await withAdminContext(db, async (tx) => tx.execute(sql`
              UPDATE mv_refresh_runs
              SET last_refreshed_at = last_refreshed_at - INTERVAL '60 seconds'
              WHERE mv_name = 'mv_daily_pnl_final'
            `)).catch(() => undefined);
            logger.error(
              { err, tenantId },
              "[Sync] mv_daily_pnl_final CONCURRENT refresh failed — dashboard may serve stale rollup until next refresh",
            );
          }
        });
      }

      await step.run("invalidate-dashboard-cache", async () => {
        invalidateDashboardCache(tenantId);
      });

      return {
        success: status !== 'failed',
        syncRunId: persistedSyncRunId,
        status,
        summary,
      };
    } catch (error) {
      const message = serializeError(error);
      const summary = buildPersistedSyncRunSummary();

      if (persistedSyncRunId) {
        await step.run("mark-sync-run-failed", async () => {
          await withTenantContext(db, tenantId, async (tx) => {
            await tx.update(syncRuns)
              .set({
                status: 'failed',
                finishedAt: new Date(),
                summary: summary as unknown as Record<string, unknown>,
                errorMessage: formatSyncRunErrorMessage(summary) ?? message,
              })
              .where(eq(syncRuns.id, persistedSyncRunId));
          });
        });
      }

      throw error;
    }
  }
);
