export const WB_SYNC_SOURCE_SEQUENCE = [
  "realization_reports",
  "products",
  "content_metadata",
  "prices",
  "orders",
  "funnel",
  "stocks",
  "warehouse_remains",
  "stock_offices",
  "stock_sizes",
  "region_sales",
  "tariffs",
  "sales",
  "paid_storage",
  "ads",
  "ad_clusters",
  "catalog_reconcile",
  "signals",
] as const;

export type WbSyncSource = (typeof WB_SYNC_SOURCE_SEQUENCE)[number];

export const WB_SYNC_FAST_SOURCES: readonly WbSyncSource[] = [
  "orders",
  "sales",
];

export const WB_SYNC_ONBOARDING_SOURCES: readonly WbSyncSource[] = [
  "products",
  "prices",
  "stocks",
  "orders",
  "sales",
  "catalog_reconcile",
];

export const WB_SYNC_MEDIUM_SOURCES: readonly WbSyncSource[] = [
  "stocks",
  "stock_offices",
  "prices",
  "funnel",
  "region_sales",
  "tariffs",
  // Ads moved here from NIGHTLY-only — daily-by-2h cadence keeps WB ads API
  // load well within rate limits while making the «Реклама» KPI on the
  // overview dashboard reflect today's activity within ≤ 2 h instead of
  // waiting until tomorrow morning's nightly sync.
  "ads",
];

export const WB_SYNC_PRICE_SNAPSHOT_SOURCES: readonly WbSyncSource[] = [
  "prices",
];

export const WB_SYNC_WEEKLY_FINANCE_RETRY_SOURCES: readonly WbSyncSource[] = [
  "realization_reports",
];

export const WB_SYNC_NIGHTLY_SOURCES: readonly WbSyncSource[] = WB_SYNC_SOURCE_SEQUENCE;
