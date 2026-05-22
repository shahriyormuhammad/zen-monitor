import { sql } from 'drizzle-orm';

import {
  AGENT_REPORTS,
  assertAgentClientAccess,
  assertAgentTenantAccess,
  assertAgentWorkerReportAccess,
  type AgentApiClient,
  type AgentReportId,
} from '@/lib/agent-api';
import { db, withTenantContext } from '@/lib/db';
import { AppError } from '@/lib/errors';

type CatalogSource = {
  table: string;
  dateColumn?: string;
  dateToColumn?: string;
  updatedColumn?: string;
};

type ReportCatalogEntry = {
  id: AgentReportId;
  description: string;
  params: Array<{ name: string; required: boolean; type: string; description: string }>;
  fields: string[];
  sources: CatalogSource[];
  available: boolean;
  unavailableReason?: string;
};

type ActionCatalogEntry = {
  id: string;
  available: boolean;
  approvalRequired: boolean;
  description: string;
  workerIds: readonly string[];
};

const COMMON_PARAMS = [
  { name: 'tenantId', required: true, type: 'uuid', description: 'Procifry tenant/cabinet UUID.' },
  { name: 'params.dateFrom / params.dateTo', required: false, type: 'YYYY-MM-DD', description: 'Inclusive date range. Defaults depend on report.' },
  { name: 'params.nmIds', required: false, type: 'number[]', description: 'Optional SKU filter.' },
  { name: 'params.limit', required: false, type: 'number', description: '1..500 by default, up to 5000 for oos_history/stock history.' },
  { name: 'params.offset / params.cursor', required: false, type: 'number|string', description: 'Pagination for reviews_summary/questions_summary.' },
];

export const AGENT_REPORT_CATALOG: ReportCatalogEntry[] = [
  {
    id: 'dashboard_summary',
    description: 'High-level dashboard KPIs and top selling products.',
    params: COMMON_PARAMS,
    fields: ['revenue', 'profit', 'ads', 'orders', 'marginPct', 'buyoutRatePct', 'topSelling'],
    sources: [
      { table: 'raw_api_realization_reports', dateColumn: 'date_from', dateToColumn: 'date_to', updatedColumn: 'created_at' },
      { table: 'raw_api_orders', dateColumn: 'date', updatedColumn: 'created_at' },
      { table: 'raw_api_ad_costs', dateColumn: 'date', updatedColumn: 'created_at' },
    ],
    available: true,
  },
  {
    id: 'unit_economics_summary',
    description: 'Unit economics by SKU with costs, tax, ads, logistics and net profit.',
    params: COMMON_PARAMS,
    fields: ['nmId', 'vendorCode', 'grossRevenue', 'commission', 'logistics', 'adSpend', 'costTotal', 'taxAmount', 'netProfit', 'attribution.nm0'],
    sources: [{ table: 'raw_api_realization_reports', dateColumn: 'date_from', dateToColumn: 'date_to', updatedColumn: 'created_at' }],
    available: true,
  },
  {
    id: 'sync_status',
    description: 'WB sync runs and redistribution run status.',
    params: [{ name: 'tenantId', required: true, type: 'uuid', description: 'Tenant UUID.' }],
    fields: ['syncRuns', 'redistributionRuns'],
    sources: [{ table: 'sync_runs', dateColumn: 'requested_at', updatedColumn: 'finished_at' }],
    available: true,
  },
  {
    id: 'cost_snapshot',
    description: 'Current cost snapshot by SKU.',
    params: COMMON_PARAMS,
    fields: ['tenantId', 'nmId', 'vendorCode', 'purchasePrice', 'lastFullCostPerUnit', 'updatedAt'],
    sources: [{ table: 'unit_economics_configs', dateColumn: 'effective_from', updatedColumn: 'created_at' }],
    available: true,
  },
  {
    id: 'cost_breakdown_detail',
    description: 'Detailed cost breakdown by SKU and tenant.',
    params: COMMON_PARAMS,
    fields: ['nmId', 'components', 'fullCostPerUnit', 'dataFreshness'],
    sources: [{ table: 'raw_api_realization_reports', dateColumn: 'date_from', dateToColumn: 'date_to', updatedColumn: 'created_at' }],
    available: true,
  },
  {
    id: 'cost_warehouse_delivery_config',
    description: 'Current enabled warehouse delivery-to-WB cost config for economics-v2.',
    params: [
      { name: 'tenantId', required: true, type: 'uuid', description: 'Tenant UUID.' },
      { name: 'params.nmId / params.nmIds', required: true, type: 'number | number[]', description: 'SKU list to inspect.' },
    ],
    fields: ['nmId', 'vendorCode', 'warehouses', 'unitEconomicsDeliveryToWbMode', 'unitEconomicsDeliveryToWb', 'localityIndexPercent', 'irpPercent', 'updatedAt'],
    sources: [{ table: 'unit_economics_manual_inputs', dateColumn: 'updated_at', updatedColumn: 'updated_at' }],
    available: true,
  },
  {
    id: 'sales_funnel_summary',
    description: 'Open card, add to cart, orders, buyouts and conversion metrics.',
    params: COMMON_PARAMS,
    fields: ['nmId', 'openCardCount', 'addToCartCount', 'ordersCount', 'buyoutsCount', 'cartConversionPct', 'buyoutPct'],
    sources: [{ table: 'raw_api_funnel_stats', dateColumn: 'period_start', updatedColumn: 'created_at' }],
    available: true,
  },
  {
    id: 'advertising_by_nm_summary',
    description: 'Advertising spend and attributable order sums by nmId.',
    params: COMMON_PARAMS,
    fields: ['nmId', 'adSpend', 'rawCostSpend', 'clusterSpend', 'spendSource', 'ordersCount', 'ordersSumRub', 'drrPct', 'campaignIds'],
    sources: [{ table: 'raw_api_ad_costs', dateColumn: 'date', updatedColumn: 'created_at' }],
    available: true,
  },
  {
    id: 'stocks_summary',
    description: 'Current WB warehouse stocks plus own warehouse / fulfillment stock and China in-transit quantities.',
    params: COMMON_PARAMS,
    fields: [
      'nmId',
      'isNewProduct',
      'draftSkuId',
      'linkedNmId',
      'externalSkuKey',
      'supplierArticle',
      'sourceArticle',
      'barcode',
      'size',
      'warehouse',
      'qty: WB warehouse stock by warehouse',
      'inTransit: WB in-way-to/from-client stock',
      'reserved',
      'ownStockQty: own warehouse / fulfillment / UI "Свой склад"',
      'fulfillmentInTransitQty: China in-transit / production batches / UI "В пути"',
      'sourceUpdatedAt',
    ],
    sources: [{ table: 'raw_api_stocks', dateColumn: 'date', updatedColumn: 'created_at' }],
    available: true,
  },
  {
    id: 'stock_history',
    description: 'Daily stock history from stock-size snapshots. Defaults from 2026-01-01.',
    params: COMMON_PARAMS,
    fields: ['date', 'nmId', 'size', 'region', 'warehouse', 'stockType', 'qty', 'lostOrders'],
    sources: [{ table: 'raw_api_stock_sizes', dateColumn: 'snapshot_date', updatedColumn: 'created_at' }],
    available: true,
  },
  {
    id: 'oos_history',
    description: 'Daily OOS/lost-order rows from stock-size snapshots. Defaults from 2026-01-01.',
    params: COMMON_PARAMS,
    fields: ['date', 'nmId', 'size', 'warehouse', 'qty', 'lostOrders', 'lostOrdersSum'],
    sources: [{ table: 'raw_api_stock_sizes', dateColumn: 'snapshot_date', updatedColumn: 'created_at' }],
    available: true,
  },
  {
    id: 'reviews_summary',
    description: 'WB reviews from persisted snapshots with live API fallback.',
    params: COMMON_PARAMS,
    fields: ['feedbackId', 'nmId', 'rating', 'text', 'date', 'answerStatus', 'moderationStatus', 'hasAnswer'],
    sources: [{ table: 'wb_feedback_snapshots', dateColumn: 'created_at_wb', updatedColumn: 'source_updated_at' }],
    available: true,
  },
  {
    id: 'questions_summary',
    description: 'WB questions from persisted snapshots with live API fallback.',
    params: COMMON_PARAMS,
    fields: ['questionId', 'nmId', 'text', 'date', 'answerStatus', 'hasAnswer'],
    sources: [{ table: 'wb_feedback_snapshots', dateColumn: 'created_at_wb', updatedColumn: 'source_updated_at' }],
    available: true,
  },
  {
    id: 'card_content_summary',
    description: 'Card content metadata: title, description, subject, media and content counters.',
    params: COMMON_PARAMS,
    fields: ['nmId', 'vendorCode', 'title', 'description', 'subject', 'brand', 'characteristics', 'photos', 'video', 'contentRating', 'updatedAt'],
    sources: [{ table: 'raw_api_product_metadata', dateColumn: 'updated_at', updatedColumn: 'updated_at' }],
    available: true,
  },
  {
    id: 'card_group_summary',
    description: 'Internal product groups/skleiki.',
    params: COMMON_PARAMS,
    fields: ['groupId', 'parentImtId', 'name', 'nmIds', 'subjects', 'brands', 'activeCount', 'inactiveCount'],
    sources: [{ table: 'product_groups', dateColumn: 'created_at', updatedColumn: 'created_at' }],
    available: true,
  },
  {
    id: 'price_history',
    description: 'Seller price, customer price, seller discount and SPP/WB discount history.',
    params: COMMON_PARAMS,
    fields: ['date', 'nmId', 'sellerPrice', 'sellerPriceAfterDiscount', 'customerPrice', 'priceAfterSpp', 'sellerDiscount', 'spp', 'impliedSpp'],
    sources: [{ table: 'raw_api_price_snapshots', dateColumn: 'snapshot_date', updatedColumn: 'updated_at' }],
    available: true,
  },
  {
    id: 'advertising_campaigns',
    description: 'Known internal advertising strategies/rules by campaign id.',
    params: COMMON_PARAMS,
    fields: ['campaignId', 'name', 'type', 'status', 'nmIds', 'budget', 'bid', 'dateFrom', 'dateTo', 'historicalStatus'],
    sources: [{ table: 'advertising_auto_bid_strategies', dateColumn: 'created_at', updatedColumn: 'updated_at' }],
    available: true,
  },
  {
    id: 'advertising_campaign_stats',
    description: 'Advertising daily stats by campaign/nmId where campaign id is known.',
    params: COMMON_PARAMS,
    fields: ['campaignId', 'nmId', 'date', 'impressions', 'clicks', 'ctr', 'cpc', 'spend', 'rawCostSpend', 'clusterSpend', 'spendSource', 'orders', 'revenue', 'associatedRevenue', 'assistRevenue'],
    sources: [{ table: 'raw_api_ad_costs', dateColumn: 'date', updatedColumn: 'created_at' }],
    available: true,
  },
  {
    id: 'search_positions_summary',
    description: 'Search positions by keyword.',
    params: COMMON_PARAMS,
    fields: ['keyword', 'nmId', 'position', 'frequency', 'impressions', 'date', 'organicOrAd', 'sourceUpdatedAt', 'confidence'],
    sources: [{ table: 'procifry_search_positions', dateColumn: 'observed_date', updatedColumn: 'source_updated_at' }],
    available: true,
  },
  {
    id: 'competitor_cards_summary',
    description: 'Competitor card comparison.',
    params: COMMON_PARAMS,
    fields: ['competitorNmId', 'ourNmId', 'subject', 'keyword', 'price', 'rating', 'reviews', 'orders', 'revenue', 'stocks', 'photos', 'videos', 'positions'],
    sources: [{ table: 'procifry_competitor_cards', dateColumn: 'observed_date', updatedColumn: 'source_updated_at' }],
    available: true,
  },
  {
    id: 'ab_tests_summary',
    description: 'WB/creative A/B tests.',
    params: COMMON_PARAMS,
    fields: ['testId', 'nmId', 'variant', 'impressions', 'clicks', 'ctr', 'carts', 'orders', 'revenue', 'profit', 'significance', 'status'],
    sources: [{ table: 'procifry_ab_tests', dateColumn: 'period_from', dateToColumn: 'period_to', updatedColumn: 'source_updated_at' }],
    available: true,
  },
  {
    id: 'finance_realization_detail',
    description: 'WB realization report detail with finance columns.',
    params: COMMON_PARAMS,
    fields: ['rrdId', 'realizationReportId', 'retailAmount', 'retailPriceWithDiscountRub', 'toSellerRub', 'commissionAmount', 'logisticsRub', 'acquiringFee', 'deduction', 'penaltyRub'],
    sources: [{ table: 'raw_api_realization_reports', dateColumn: 'date_from', dateToColumn: 'date_to', updatedColumn: 'created_at' }],
    available: true,
  },
  {
    id: 'orders_sales_summary',
    description: 'Orders and sales by day/nmId.',
    params: COMMON_PARAMS,
    fields: ['date', 'nmId', 'orders', 'ordersSum', 'sales', 'salesSum'],
    sources: [
      { table: 'raw_api_orders', dateColumn: 'date', updatedColumn: 'created_at' },
      { table: 'raw_api_sales', dateColumn: 'date', updatedColumn: 'created_at' },
    ],
    available: true,
  },
  {
    id: 'fulfillment_summary',
    description: 'Internal production batches / UI "В производстве"; this is not own warehouse stock.',
    params: COMMON_PARAMS,
    fields: [
      'nmId',
      'isNewProduct',
      'draftSkuId',
      'linkedNmId',
      'externalSkuKey',
      'supplierArticle',
      'sourceArticle',
      'orderTitle',
      'status: ordered/in_production/shipped/customs/delivered',
      'quantity: production batch quantity',
      'receivedQuantity: accepted quantity',
      'inTransitOrProductionQty: quantity minus receivedQuantity',
      'estimatedDeliveryAt',
    ],
    sources: [{ table: 'production_orders', dateColumn: 'created_at', updatedColumn: 'updated_at' }],
    available: true,
  },
  {
    id: 'tariffs_rules_summary',
    description: 'WB tariffs and commission snapshots for watchdog workers.',
    params: COMMON_PARAMS,
    fields: ['kind', 'type', 'date', 'rowCount', 'sourceUpdatedAt'],
    sources: [
      { table: 'wb_tariff_snapshots', dateColumn: 'created_at', updatedColumn: 'created_at' },
      { table: 'wb_category_commission_snapshots', dateColumn: 'created_at', updatedColumn: 'created_at' },
    ],
    available: true,
  },
  {
    id: 'worker_artifacts_summary',
    description: 'Procifry worker artifacts written through the RBAC API.',
    params: COMMON_PARAMS,
    fields: ['id', 'workerId', 'artifactType', 'accessMode', 'title', 'confidence', 'approvalRequestId', 'createdAt'],
    sources: [{ table: 'procifry_worker_artifacts', dateColumn: 'created_at', updatedColumn: 'updated_at' }],
    available: true,
  },
  {
    id: 'niche_category_summary',
    description: 'Internal category/niche rollup. MPStats is not connected yet.',
    params: COMMON_PARAMS,
    fields: ['category', 'skuCount', 'orders', 'ordersSum', 'buyouts', 'buyoutsSum'],
    sources: [{ table: 'raw_api_funnel_stats', dateColumn: 'period_start', updatedColumn: 'created_at' }],
    available: true,
  },
];

export const AGENT_ACTION_CATALOG: ActionCatalogEntry[] = [
  {
    id: 'advertising_action',
    available: true,
    approvalRequired: false,
    description: 'Execute autonomous advertising actions via /api/agent/v1/advertising/action.',
    workerIds: ['wb-ads-analyst', 'wb-growth-manager', 'wb-ads', 'wb-chief'],
  },
  {
    id: 'warehouse_delivery_cost_update',
    available: true,
    approvalRequired: true,
    description: 'Update enabled warehouse delivery-to-WB costs in economics-v2.',
    workerIds: ['wb-economics-analyst', 'wb-growth-manager', 'wb-economics', 'wb-chief', 'wb-procifry-operator'],
  },
  {
    id: 'unit_economics_indices_update',
    available: true,
    approvalRequired: true,
    description: 'Update IL/IRP (locality/sales distribution indices) in economics-v2.',
    workerIds: ['wb-economics-analyst', 'wb-growth-manager', 'wb-economics', 'wb-chief', 'wb-procifry-operator'],
  },
  {
    id: 'fulfillment_stock_update',
    available: true,
    approvalRequired: true,
    description: 'Update own fulfillment stock and production/in-transit batches, including new products without WB nmId via draftSkuId/externalSkuKey.',
    workerIds: ['wb-assortment-ops', 'wb-growth-manager', 'wb-ops', 'wb-chief', 'wb-procifry-operator'],
  },
];

type Coverage = {
  sourceUpdatedAt: string | null;
  dateCoverage: { from: string | null; to: string | null };
};

function toIsoString(value: unknown) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function canReadReport(client: AgentApiClient, report: AgentReportId) {
  try {
    assertAgentClientAccess(client, report, []);
    assertAgentWorkerReportAccess(client, report);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.status === 403) {
      return false;
    }
    throw error;
  }
}

function canUseAction(client: AgentApiClient, action: ActionCatalogEntry) {
  if (!client.workerId) {
    return false;
  }
  const requiredRole = action.approvalRequired ? 'request_approval' : 'execute_approved_actions';
  const hasRequiredRole = client.roles === null || client.roles.includes(requiredRole);
  return hasRequiredRole && action.workerIds.includes(client.workerId);
}

function catalogSourceStatus(entry: ReportCatalogEntry, coverage: Coverage) {
  if (!entry.available) {
    return 'unavailable';
  }
  if (entry.sources.length === 0) {
    return 'live_or_computed';
  }
  return coverage.sourceUpdatedAt || coverage.dateCoverage.from || coverage.dateCoverage.to
    ? 'ready'
    : 'connected_empty';
}

async function loadCoverage(tenantId: string, sources: CatalogSource[]): Promise<Coverage> {
  if (sources.length === 0) {
    return { sourceUpdatedAt: null, dateCoverage: { from: null, to: null } };
  }

  const parts = sources.map((source) => {
    const dateFromExpr = source.dateColumn ? source.dateColumn : 'NULL';
    const dateToExpr = source.dateToColumn ?? source.dateColumn ?? 'NULL';
    const updatedExpr = source.updatedColumn ? source.updatedColumn : 'NULL';
    return `
      SELECT
        MIN(${dateFromExpr})::timestamptz AS min_date,
        MAX(${dateToExpr})::timestamptz AS max_date,
        MAX(${updatedExpr})::timestamptz AS updated_at
      FROM ${source.table}
      WHERE tenant_id = '${tenantId.replaceAll("'", "''")}'::uuid
    `;
  }).join(' UNION ALL ');

  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql.raw(`
    SELECT
      MIN(min_date) AS "from",
      MAX(max_date) AS "to",
      MAX(updated_at) AS "sourceUpdatedAt"
    FROM (${parts}) coverage
  `)));
  const row = (rows as unknown as Array<{
    from: Date | string | null;
    to: Date | string | null;
    sourceUpdatedAt: Date | string | null;
  }>)[0];
  return {
    sourceUpdatedAt: toIsoString(row?.sourceUpdatedAt),
    dateCoverage: {
      from: toIsoString(row?.from),
      to: toIsoString(row?.to),
    },
  };
}

export async function buildAgentCatalog(client: AgentApiClient, tenantId?: string | null) {
  if (tenantId) {
    assertAgentTenantAccess(client, tenantId);
  }

  const reports = await Promise.all(AGENT_REPORT_CATALOG
    .filter((entry) => AGENT_REPORTS.includes(entry.id))
    .filter((entry) => canReadReport(client, entry.id))
    .map(async (entry) => {
      const coverage = tenantId
        ? await loadCoverage(tenantId, entry.sources)
        : { sourceUpdatedAt: null, dateCoverage: { from: null, to: null } };

      return {
        id: entry.id,
        description: entry.description,
        available: entry.available,
        unavailableReason: entry.unavailableReason ?? null,
        sourceStatus: catalogSourceStatus(entry, coverage),
        params: entry.params,
        fields: entry.fields,
        freshness: {
          sourceTables: entry.sources.map((source) => source.table),
          sourceUpdatedAt: coverage.sourceUpdatedAt,
        },
        dateCoverage: coverage.dateCoverage,
      };
    }));

  return {
    generatedAt: new Date().toISOString(),
    tenantId: tenantId ?? null,
    reports,
    actions: AGENT_ACTION_CATALOG
      .filter((entry) => canUseAction(client, entry))
      .map((entry) => ({
        id: entry.id,
        available: entry.available,
        approvalRequired: entry.approvalRequired,
        description: entry.description,
      })),
  };
}
