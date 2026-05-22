import { sql, type SQL } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { fetchWbReviewsQaItems, type ReviewsQaItem, type ReviewsQaCollectionKind } from '@/server/reviews-qa/wb-feedback';
import type { AgentReportParams, AgentReportResult } from '@/server/agent/reports';

type Range = {
  from: string;
  to: string;
  days: number;
};

type SourceCoverage = {
  sourceUpdatedAt: string | null;
  dateCoverage: { from: string | null; to: string | null };
};

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundMetric(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function parseDateParam(value: string | null | undefined) {
  if (!value?.trim()) {
    return null;
  }
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveTenantId(tenantId: string | null | undefined) {
  if (!tenantId) {
    throw new AppError('tenantId is required', 400);
  }
  return tenantId;
}

function resolveRange(params: AgentReportParams | undefined, fallbackDays = 30): Range {
  const from = parseDateParam(params?.dateFrom ?? params?.from ?? null);
  const to = parseDateParam(params?.dateTo ?? params?.to ?? null);
  if ((from && !to) || (!from && to)) {
    throw new AppError('Both dateFrom/from and dateTo/to are required together', 400);
  }
  if (from && to) {
    if (from.getTime() > to.getTime()) {
      throw new AppError('dateFrom must be <= dateTo', 400);
    }
    return {
      from: toIsoDate(from),
      to: toIsoDate(to),
      days: Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1,
    };
  }

  const rawDays = Number(params?.days ?? fallbackDays);
  const days = Number.isFinite(rawDays) ? Math.min(365, Math.max(1, Math.trunc(rawDays))) : fallbackDays;
  const today = new Date();
  const fromDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - days + 1));
  const toDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return { from: toIsoDate(fromDate), to: toIsoDate(toDate), days };
}

function resolveSince2026Range(params: AgentReportParams | undefined): Range {
  const explicit = Boolean(params?.dateFrom || params?.from || params?.dateTo || params?.to);
  if (explicit) {
    return resolveRange(params, 30);
  }
  const today = new Date();
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const from = new Date(Date.UTC(2026, 0, 1));
  return {
    from: '2026-01-01',
    to: toIsoDate(to),
    days: Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1,
  };
}

function normalizeNmIds(params: AgentReportParams | undefined) {
  return Array.from(new Set(
    [...(params?.nmIds ?? []), params?.nmId ?? 0]
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.trunc(value)),
  ));
}

function clampLimit(params: AgentReportParams | undefined, fallback = 100, max = 500) {
  const numeric = Number(params?.limit ?? fallback);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(1, Math.trunc(numeric))) : fallback;
}

function clampOffset(params: AgentReportParams | undefined, limit = 100) {
  const page = Number(params?.page ?? 0);
  if (Number.isFinite(page) && page > 1) {
    return (Math.trunc(page) - 1) * limit;
  }
  const numeric = Number(params?.offset ?? params?.skip ?? params?.cursor ?? 0);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function normalizeKeywords(params: AgentReportParams | undefined) {
  return Array.from(new Set(
    [params?.keyword, ...(params?.keywords ?? [])]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value)),
  ));
}

function inListSql(values: Array<number | string>) {
  return sql.join(values.map((value) => sql`${value}`), sql`, `);
}

function andInFilter(column: SQL, values: Array<number | string>) {
  return values.length > 0 ? sql`AND ${column} IN (${inListSql(values)})` : sql``;
}

function toTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function reviewRangeFilter(range: Range | null) {
  if (!range) {
    return null;
  }
  const from = Date.parse(`${range.from}T00:00:00.000Z`);
  const to = Date.parse(`${range.to}T23:59:59.999Z`);
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null;
}

async function fetchReviewsQaBucket(args: {
  tenantId: string;
  kind: ReviewsQaCollectionKind;
  isAnswered: boolean;
  limit: number;
  offset: number;
  range: Range | null;
  nmIds: number[];
}) {
  const pageSize = Math.min(500, Math.max(args.limit, 100));
  const maxPages = 12;
  const dateFilter = reviewRangeFilter(args.range);
  const nmIdSet = new Set(args.nmIds);
  const items: ReviewsQaItem[] = [];
  const seenIds = new Set<string>();
  const seenPageSignatures = new Set<string>();
  let skip = args.offset;
  let exact = true;
  let scanned = 0;

  for (let page = 0; page < maxPages && items.length < args.limit; page += 1) {
    const pageItems = await fetchWbReviewsQaItems({
      tenantId: args.tenantId,
      kind: args.kind,
      isAnswered: args.isAnswered,
      take: pageSize,
      skip,
    });
    scanned += pageItems.length;

    if (pageItems.length === 0) {
      break;
    }

    const signature = pageItems.slice(0, 10).map((item) => item.id).join('|');
    if (signature && seenPageSignatures.has(signature)) {
      exact = false;
      break;
    }
    seenPageSignatures.add(signature);

    let oldestKnown = Number.POSITIVE_INFINITY;
    let hasKnownDates = false;
    for (const item of pageItems) {
      const timestamp = toTimestamp(item.createdAt);
      if (timestamp !== null) {
        hasKnownDates = true;
        oldestKnown = Math.min(oldestKnown, timestamp);
      }
      if (dateFilter && (timestamp === null || timestamp < dateFilter.from || timestamp > dateFilter.to)) {
        continue;
      }
      const itemNmId = Number(item.nmId);
      if (args.nmIds.length > 0 && (!Number.isFinite(itemNmId) || !nmIdSet.has(itemNmId))) {
        continue;
      }
      if (seenIds.has(item.id)) {
        continue;
      }
      seenIds.add(item.id);
      items.push(item);
    }

    if (pageItems.length < pageSize) {
      break;
    }
    if (dateFilter && hasKnownDates && Number.isFinite(oldestKnown) && oldestKnown < dateFilter.from) {
      break;
    }
    skip += pageSize;
  }

  return {
    items,
    exact,
    scanned,
    nextOffset: skip + pageSize,
    hasNextPage: items.length >= args.limit,
  };
}

async function fetchPersistedReviewsQaPage(args: {
  tenantId: string;
  kind: ReviewsQaCollectionKind;
  report: 'reviews_summary' | 'questions_summary';
  answerStatus: 'answered' | 'not_answered' | 'all';
  limit: number;
  offset: number;
  range: Range | null;
  afterId: string | null;
  nmIds: number[];
}) {
  const itemType = args.kind === 'reviews' ? 'review' : 'question';
  const dateFilter = args.range
    ? sql`AND created_at_wb >= ${`${args.range.from}T00:00:00.000Z`}::timestamptz AND created_at_wb <= ${`${args.range.to}T23:59:59.999Z`}::timestamptz`
    : sql``;
  const answerFilter = args.answerStatus === 'answered'
    ? sql`AND is_answered = TRUE`
    : args.answerStatus === 'not_answered'
      ? sql`AND is_answered = FALSE`
      : sql``;
  const nmFilter = andInFilter(sql`nm_id`, args.nmIds);
  const cursorRows = args.afterId
    ? await withTenantContext(db, args.tenantId, (tx) => tx.execute(sql`
        SELECT created_at_wb AS "createdAtWb", wb_item_id AS "wbItemId"
        FROM wb_feedback_snapshots
        WHERE tenant_id = ${args.tenantId}
          AND item_type = ${itemType}
          AND wb_item_id = ${args.afterId}
        LIMIT 1
      `))
    : [];
  const cursor = (cursorRows as unknown as Array<{ createdAtWb: Date | string | null; wbItemId: string }>)[0] ?? null;
  const cursorFilter = cursor?.createdAtWb
    ? sql`AND (
        created_at_wb < ${cursor.createdAtWb}::timestamptz
        OR (created_at_wb = ${cursor.createdAtWb}::timestamptz AND wb_item_id < ${cursor.wbItemId})
      )`
    : sql``;
  const offsetSql = args.afterId ? sql`` : sql`OFFSET ${args.offset}`;
  const rows = await withTenantContext(db, args.tenantId, (tx) => tx.execute(sql`
    SELECT
      wb_item_id AS "id",
      nm_id AS "nmId",
      rating,
      text,
      answer_text AS "answerText",
      is_answered AS "isAnswered",
      answer_outcome AS "answerOutcome",
      product_name AS "productName",
      brand_name AS "brandName",
      user_name AS "userName",
      created_at_wb AS "createdAt",
      source_updated_at AS "sourceUpdatedAt"
    FROM wb_feedback_snapshots
    WHERE tenant_id = ${args.tenantId}
      AND item_type = ${itemType}
      ${dateFilter}
      ${answerFilter}
      ${nmFilter}
      ${cursorFilter}
    ORDER BY created_at_wb DESC NULLS LAST, wb_item_id DESC
    LIMIT ${args.limit + 1}
    ${offsetSql}
  `));
  const coverageRows = await withTenantContext(db, args.tenantId, (tx) => tx.execute(sql`
    SELECT
      COUNT(*)::int AS "rowCount",
      MIN(created_at_wb)::date::text AS "dateFrom",
      MAX(created_at_wb)::date::text AS "dateTo",
      MAX(source_updated_at) AS "sourceUpdatedAt"
    FROM wb_feedback_snapshots
    WHERE tenant_id = ${args.tenantId}
      AND item_type = ${itemType}
      ${nmFilter}
  `));
  const coverage = (coverageRows as unknown as Array<{
    rowCount: number;
    dateFrom: string | null;
    dateTo: string | null;
    sourceUpdatedAt: Date | string | null;
  }>)[0] ?? { rowCount: 0, dateFrom: null, dateTo: null, sourceUpdatedAt: null };

  if (coverage.rowCount <= 0) {
    return null;
  }

  const rawRows = rows as unknown as Record<string, unknown>[];
  const pageRows = rawRows.slice(0, args.limit);
  const items = pageRows.map((item) => args.report === 'reviews_summary'
    ? {
        feedbackId: item.id,
        nmId: item.nmId,
        rating: item.rating,
        text: item.text,
        date: toIsoString(item.createdAt),
        answerStatus: item.isAnswered ? item.answerOutcome : 'not_answered',
        moderationStatus: item.answerOutcome,
        hasAnswer: item.isAnswered,
        productName: item.productName,
        brandName: item.brandName,
      }
    : {
        questionId: item.id,
        nmId: item.nmId,
        text: item.text,
        date: toIsoString(item.createdAt),
        answerStatus: item.isAnswered ? 'answered' : 'not_answered',
        hasAnswer: item.isAnswered,
        productName: item.productName,
        brandName: item.brandName,
      });

  return {
    items,
    hasNextPage: rawRows.length > args.limit,
    sourceUpdatedAt: toIsoString(coverage.sourceUpdatedAt),
    dateCoverage: { from: coverage.dateFrom, to: coverage.dateTo },
    rowCount: coverage.rowCount,
  };
}

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

function toDateString(value: unknown) {
  const iso = toIsoString(value);
  return iso ? iso.slice(0, 10) : null;
}

async function loadProcifrySourceCoverage(
  tenantId: string,
  table: 'procifry_search_positions' | 'procifry_competitor_cards' | 'procifry_ab_tests',
  dateFromColumn: 'observed_date' | 'period_from',
  dateToColumn: 'observed_date' | 'period_to',
): Promise<SourceCoverage> {
  const escapedTenantId = tenantId.replaceAll("'", "''");
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql.raw(`
    SELECT
      MIN(${dateFromColumn}) AS "from",
      MAX(${dateToColumn}) AS "to",
      MAX(source_updated_at) AS "sourceUpdatedAt"
    FROM ${table}
    WHERE tenant_id = '${escapedTenantId}'::uuid
  `)));
  const row = (rows as unknown as Array<{
    from: Date | string | null;
    to: Date | string | null;
    sourceUpdatedAt: Date | string | null;
  }>)[0];

  return {
    sourceUpdatedAt: toIsoString(row?.sourceUpdatedAt),
    dateCoverage: {
      from: toDateString(row?.from),
      to: toDateString(row?.to),
    },
  };
}

function externalSourceState(args: {
  source: string;
  coverage: SourceCoverage;
  itemCount: number;
  range: Range;
}) {
  const hasAnyCoverage = Boolean(
    args.coverage.sourceUpdatedAt
    || args.coverage.dateCoverage.from
    || args.coverage.dateCoverage.to,
  );
  const sourceStatus = args.itemCount > 0
    ? 'ready'
    : hasAnyCoverage
      ? 'no_data_for_period'
      : 'source_not_populated';
  const note = sourceStatus === 'ready'
    ? `${args.source}: данные найдены за период ${args.range.from} — ${args.range.to}.`
    : sourceStatus === 'no_data_for_period'
      ? `${args.source}: источник наполнен, но за период ${args.range.from} — ${args.range.to} строк нет.`
      : `${args.source}: таблица подключена в контракте, но источник еще не наполнен; sourceUpdatedAt=null и dateCoverage отсутствует.`;

  return {
    available: true,
    source: args.source,
    sourceConfigured: true,
    sourceStatus,
    sourceUpdatedAt: args.coverage.sourceUpdatedAt,
    dateCoverage: args.coverage.dateCoverage,
    confidence: sourceStatus === 'ready' ? 'partial' : 'missing',
    note,
  };
}

function result(args: {
  report: AgentReportResult['report'];
  tenantId: string;
  range?: Range;
  summaryText: string;
  data: Record<string, unknown>;
  totals?: Record<string, unknown>;
  items?: Record<string, unknown>[];
}): AgentReportResult {
  return {
    report: args.report,
    tenantId: args.tenantId,
    generatedAt: new Date().toISOString(),
    range: args.range,
    period: args.range ? { dateFrom: args.range.from, dateTo: args.range.to } : undefined,
    summaryText: args.summaryText,
    totals: args.totals,
    items: args.items,
    data: args.data,
  };
}

export async function buildStocksSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const nmIds = normalizeNmIds(params);
  const limit = clampLimit(params);
  const nmFilter = andInFilter(sql`s.nm_id`, nmIds);
  const draftNmFilter = nmIds.length > 0
    ? sql`AND d.linked_nm_id IN (${inListSql(nmIds)})`
    : sql``;
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    WITH own AS (
      SELECT tenant_id, nm_id, SUM(remaining_quantity)::int AS own_qty
      FROM own_stock_batches
      WHERE tenant_id = ${resolvedTenantId}
        AND nm_id IS NOT NULL
      GROUP BY tenant_id, nm_id
    ),
    prod AS (
      SELECT l.tenant_id, l.nm_id, SUM(GREATEST(l.quantity - l.received_quantity, 0))::int AS in_production_qty
      FROM production_order_lines l
      JOIN production_orders o ON o.id = l.production_order_id AND o.tenant_id = l.tenant_id
      WHERE l.tenant_id = ${resolvedTenantId}
        AND o.status <> 'delivered'
        AND l.nm_id IS NOT NULL
      GROUP BY l.tenant_id, l.nm_id
    ),
    draft_own AS (
      SELECT tenant_id, draft_sku_id, SUM(remaining_quantity)::int AS own_qty
      FROM own_stock_batches
      WHERE tenant_id = ${resolvedTenantId}
        AND draft_sku_id IS NOT NULL
      GROUP BY tenant_id, draft_sku_id
    ),
    draft_prod AS (
      SELECT l.tenant_id, l.draft_sku_id, SUM(GREATEST(l.quantity - l.received_quantity, 0))::int AS in_production_qty
      FROM production_order_lines l
      JOIN production_orders o ON o.id = l.production_order_id AND o.tenant_id = l.tenant_id
      WHERE l.tenant_id = ${resolvedTenantId}
        AND o.status <> 'delivered'
        AND l.draft_sku_id IS NOT NULL
      GROUP BY l.tenant_id, l.draft_sku_id
    ),
    combined AS (
      SELECT
        s.nm_id AS "nmId",
        NULL::uuid AS "draftSkuId",
        FALSE AS "isNewProduct",
        NULL::bigint AS "linkedNmId",
        NULL::text AS "externalSkuKey",
        NULL::text AS "supplierArticle",
        NULL::text AS "sourceArticle",
        NULL::text AS "title",
        NULL::text AS "variant",
        NULL::text AS "color",
        p.vendor_code AS "vendorCode",
        p.barcode,
        NULL::text AS "size",
        s.warehouse_name AS "warehouse",
        s.amount::int AS "qty",
        (s.in_way_to_client + s.in_way_from_client)::int AS "inTransit",
        s.in_way_to_client::int AS "inWayToClient",
        s.in_way_from_client::int AS "inWayFromClient",
        0::int AS "reserved",
        COALESCE(own.own_qty, 0)::int AS "ownStockQty",
        COALESCE(prod.in_production_qty, 0)::int AS "fulfillmentInTransitQty",
        s.date AS "sourceUpdatedAt",
        s.amount::int AS "sortQty"
      FROM raw_api_stocks s
      LEFT JOIN products p ON p.tenant_id = s.tenant_id AND p.nm_id = s.nm_id
      LEFT JOIN own ON own.tenant_id = s.tenant_id AND own.nm_id = s.nm_id
      LEFT JOIN prod ON prod.tenant_id = s.tenant_id AND prod.nm_id = s.nm_id
      WHERE s.tenant_id = ${resolvedTenantId}
        ${nmFilter}

      UNION ALL

      SELECT
        d.linked_nm_id AS "nmId",
        d.id AS "draftSkuId",
        TRUE AS "isNewProduct",
        d.linked_nm_id AS "linkedNmId",
        d.external_sku_key AS "externalSkuKey",
        d.supplier_article AS "supplierArticle",
        d.source_article AS "sourceArticle",
        d.title AS "title",
        d.variant AS "variant",
        d.color AS "color",
        NULL::text AS "vendorCode",
        NULL::text AS "barcode",
        NULL::text AS "size",
        'Procifry: новый товар без WB nmId'::text AS "warehouse",
        0::int AS "qty",
        0::int AS "inTransit",
        0::int AS "inWayToClient",
        0::int AS "inWayFromClient",
        0::int AS "reserved",
        COALESCE(draft_own.own_qty, 0)::int AS "ownStockQty",
        COALESCE(draft_prod.in_production_qty, 0)::int AS "fulfillmentInTransitQty",
        d.updated_at AS "sourceUpdatedAt",
        (COALESCE(draft_own.own_qty, 0) + COALESCE(draft_prod.in_production_qty, 0))::int AS "sortQty"
      FROM procifry_draft_skus d
      LEFT JOIN draft_own ON draft_own.tenant_id = d.tenant_id AND draft_own.draft_sku_id = d.id
      LEFT JOIN draft_prod ON draft_prod.tenant_id = d.tenant_id AND draft_prod.draft_sku_id = d.id
      WHERE d.tenant_id = ${resolvedTenantId}
        AND d.status = 'draft'
        AND (COALESCE(draft_own.own_qty, 0) > 0 OR COALESCE(draft_prod.in_production_qty, 0) > 0)
        ${draftNmFilter}
    )
    SELECT
      "nmId",
      "draftSkuId",
      "isNewProduct",
      "linkedNmId",
      "externalSkuKey",
      "supplierArticle",
      "sourceArticle",
      "title",
      "variant",
      "color",
      "vendorCode",
      barcode,
      "size",
      warehouse,
      qty,
      "inTransit",
      "inWayToClient",
      "inWayFromClient",
      reserved,
      "ownStockQty",
      "fulfillmentInTransitQty",
      "sourceUpdatedAt"
    FROM combined
    ORDER BY "sortQty" DESC, "isNewProduct" DESC, "nmId" ASC NULLS LAST, "warehouse" ASC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  const totalQty = items.reduce((sum, item) => sum + toNumber(item.qty), 0);
  return result({
    report: 'stocks_summary',
    tenantId: resolvedTenantId,
    summaryText: `Остатки: ${items.length} строк, ${Math.round(totalQty)} шт в WB-снимке.`,
    totals: { itemCount: items.length, totalQty },
    items,
    data: { items },
  });
}

export async function buildStockHistoryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const range = resolveSince2026Range(params);
  const nmIds = normalizeNmIds(params);
  const limit = clampLimit(params, 500);
  const nmFilter = andInFilter(sql`h.nm_id`, nmIds);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      h.snapshot_date AS "date",
      h.nm_id AS "nmId",
      p.vendor_code AS "vendorCode",
      h.size_name AS "size",
      h.region_name AS "region",
      h.office_name AS "warehouse",
      h.stock_type AS "stockType",
      h.stock_count::int AS "qty",
      h.to_client_count::int AS "inTransitToClient",
      h.from_client_count::int AS "inTransitFromClient",
      h.lost_orders_count::numeric AS "lostOrders",
      h.avg_stock_turnover_days::numeric AS "avgStockTurnoverDays",
      h.created_at AS "sourceUpdatedAt"
    FROM raw_api_stock_sizes h
    LEFT JOIN products p ON p.tenant_id = h.tenant_id AND p.nm_id = h.nm_id
    WHERE h.tenant_id = ${resolvedTenantId}
      AND h.snapshot_date::date >= ${range.from}::date
      AND h.snapshot_date::date <= ${range.to}::date
      ${nmFilter}
    ORDER BY h.snapshot_date DESC, h.nm_id ASC, h.office_name ASC, h.size_name ASC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  return result({
    report: 'stock_history',
    tenantId: resolvedTenantId,
    range,
    summaryText: `История остатков: ${items.length} строк за ${range.from} — ${range.to}.`,
    totals: { itemCount: items.length },
    items,
    data: { items },
  });
}

export async function buildOosHistoryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const range = resolveSince2026Range(params);
  const nmIds = normalizeNmIds(params);
  const limit = clampLimit(params, 5000, 5000);
  const nmFilter = andInFilter(sql`h.nm_id`, nmIds);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      h.snapshot_date AS "date",
      h.nm_id AS "nmId",
      p.vendor_code AS "vendorCode",
      h.size_name AS "size",
      h.region_name AS "region",
      h.office_name AS "warehouse",
      h.stock_type AS "stockType",
      h.stock_count::int AS "qty",
      h.lost_orders_count::numeric AS "lostOrders",
      h.lost_orders_sum::numeric AS "lostOrdersSum",
      h.created_at AS "sourceUpdatedAt"
    FROM raw_api_stock_sizes h
    LEFT JOIN products p ON p.tenant_id = h.tenant_id AND p.nm_id = h.nm_id
    WHERE h.tenant_id = ${resolvedTenantId}
      AND h.snapshot_date::date >= ${range.from}::date
      AND h.snapshot_date::date <= ${range.to}::date
      AND (h.stock_count <= 0 OR h.lost_orders_count > 0)
      ${nmFilter}
    ORDER BY h.snapshot_date DESC, h.lost_orders_count DESC, h.nm_id ASC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  const lostOrders = items.reduce((sum, item) => sum + toNumber(item.lostOrders), 0);
  return result({
    report: 'oos_history',
    tenantId: resolvedTenantId,
    range,
    summaryText: `OOS история: ${items.length} строк, потерянных заказов ${roundMetric(lostOrders)}.`,
    totals: { itemCount: items.length, lostOrders },
    items,
    data: { items },
  });
}

export async function buildReviewsQaSummaryReport(
  report: 'reviews_summary' | 'questions_summary',
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const limit = clampLimit(params, 100, 500);
  const offset = clampOffset(params, limit);
  const nmIds = normalizeNmIds(params);
  const kind = report === 'reviews_summary' ? 'reviews' : 'questions';
  const hasExplicitRange = Boolean(
    params?.dateFrom?.trim()
    || params?.dateTo?.trim()
    || params?.from?.trim()
    || params?.to?.trim(),
  );
  const range = hasExplicitRange ? resolveRange(params, 30) : null;
  const answerStatus = params?.answerStatus === 'answered' || params?.answerStatus === 'not_answered'
    ? params.answerStatus
    : 'all';
  const afterId = params?.afterId?.trim() || null;
  const persisted = await fetchPersistedReviewsQaPage({
    tenantId: resolvedTenantId,
    kind,
    report,
    answerStatus,
    limit,
    offset,
    range,
    afterId,
    nmIds,
  });
  if (persisted) {
    return result({
      report,
      tenantId: resolvedTenantId,
      range: range ?? undefined,
      summaryText: `${report === 'reviews_summary' ? 'Отзывы' : 'Вопросы'} WB: ${persisted.items.length} строк из сохраненного снимка, смещение ${offset}.`,
      totals: {
        itemCount: persisted.items.length,
        answered: persisted.items.filter((item) => Boolean(item.hasAnswer)).length,
        offset,
        limit,
        hasNextPage: persisted.hasNextPage,
        exact: true,
        scanned: persisted.items.length,
        nmIds,
      },
      items: persisted.items,
      data: {
        source: 'wb_feedback_snapshots',
        sourceUpdatedAt: persisted.sourceUpdatedAt,
        dateCoverage: persisted.dateCoverage,
        pagination: {
          limit,
          offset,
          cursor: String(offset),
          nextCursor: persisted.hasNextPage ? String(offset + limit) : null,
          page: params?.page ?? null,
          afterId,
          nmIds,
        },
        items: persisted.items,
      },
    });
  }

  const fetched = answerStatus === 'all'
    ? await Promise.all([
        fetchReviewsQaBucket({ tenantId: resolvedTenantId, kind, isAnswered: false, limit, offset, range, nmIds }),
        fetchReviewsQaBucket({ tenantId: resolvedTenantId, kind, isAnswered: true, limit, offset, range, nmIds }),
      ]).then(([unanswered, answered]) => ({
        items: [...unanswered.items, ...answered.items],
        exact: unanswered.exact && answered.exact,
        scanned: unanswered.scanned + answered.scanned,
        nextOffset: Math.max(unanswered.nextOffset, answered.nextOffset),
        hasNextPage: unanswered.hasNextPage || answered.hasNextPage,
      }))
    : await fetchReviewsQaBucket({
        tenantId: resolvedTenantId,
        kind,
        isAnswered: answerStatus === 'answered',
        limit,
        offset,
        range,
        nmIds,
      });
  const sortedFetched = fetched.items
    .sort((left, right) => Date.parse(right.createdAt ?? '') - Date.parse(left.createdAt ?? ''))
  const afterIndex = afterId
    ? sortedFetched.findIndex((item) => item.id === afterId)
    : -1;
  const pageItems = afterIndex >= 0 ? sortedFetched.slice(afterIndex + 1) : sortedFetched;
  const items = pageItems
    .slice(0, limit)
    .map((item) => report === 'reviews_summary'
      ? {
          feedbackId: item.id,
          nmId: item.nmId,
          rating: item.rating,
          text: item.text,
          date: item.createdAt,
          answerStatus: item.isAnswered ? item.answerOutcome : 'not_answered',
          moderationStatus: item.answerOutcome,
          hasAnswer: item.isAnswered,
          productName: item.productName,
          brandName: item.brandName,
        }
      : {
          questionId: item.id,
          nmId: item.nmId,
          text: item.text,
          date: item.createdAt,
          answerStatus: item.isAnswered ? 'answered' : 'not_answered',
          hasAnswer: item.isAnswered,
          productName: item.productName,
          brandName: item.brandName,
        });
  const hasNextPage = fetched.hasNextPage || items.length >= limit;
  return result({
    report,
    tenantId: resolvedTenantId,
    range: range ?? undefined,
    summaryText: `${report === 'reviews_summary' ? 'Отзывы' : 'Вопросы'} WB: ${items.length} строк из текущего запроса WB, смещение ${offset}.`,
    totals: {
      itemCount: items.length,
      answered: items.filter((item) => Boolean(item.hasAnswer)).length,
      offset,
      limit,
      hasNextPage,
      exact: fetched.exact,
      scanned: fetched.scanned,
      nmIds,
    },
    items,
    data: {
      source: 'wb_feedbacks_live_api',
      pagination: {
        limit,
        offset,
        cursor: String(offset),
        nextCursor: hasNextPage ? String(fetched.nextOffset) : null,
        page: params?.page ?? null,
        afterId,
        afterIdApplied: afterId ? afterIndex >= 0 : null,
        answerStatus,
        nmIds,
        exact: fetched.exact,
        scanned: fetched.scanned,
        note: fetched.exact
          ? 'WB API pagination scanned without repeated pages.'
          : 'WB API returned repeated page for changed skip/offset; older rows are not provably reachable through this endpoint.',
      },
      items,
    },
  });
}

export async function buildCardContentSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const nmIds = normalizeNmIds(params);
  const limit = clampLimit(params);
  const nmFilter = andInFilter(sql`catalog.nm_id`, nmIds);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    WITH catalog AS (
      SELECT nm_id FROM products WHERE tenant_id = ${resolvedTenantId}
      UNION
      SELECT nm_id FROM raw_api_product_metadata WHERE tenant_id = ${resolvedTenantId}
    )
    SELECT
      catalog.nm_id AS "nmId",
      p.vendor_code AS "vendorCode",
      m.title,
      m.description,
      p.category AS "subject",
      p.brand,
      m.characteristics_count::int AS "characteristics",
      m.photos_count::int AS "photos",
      m.has_video AS "video",
      NULL::numeric AS "contentRating",
      m.updated_at AS "updatedAt"
    FROM catalog
    LEFT JOIN products p ON p.tenant_id = ${resolvedTenantId} AND p.nm_id = catalog.nm_id
    LEFT JOIN raw_api_product_metadata m ON m.tenant_id = ${resolvedTenantId} AND m.nm_id = catalog.nm_id
    WHERE COALESCE(p.is_hidden, FALSE) = FALSE
      ${nmFilter}
    ORDER BY COALESCE(m.updated_at, p.created_at) DESC NULLS LAST, catalog.nm_id ASC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  return result({
    report: 'card_content_summary',
    tenantId: resolvedTenantId,
    summaryText: `Карточки: ${items.length} строк контента.`,
    totals: { itemCount: items.length },
    items,
    data: { items },
  });
}

export async function buildCardGroupSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const limit = clampLimit(params);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      g.id AS "groupId",
      NULL::bigint AS "parentImtId",
      g.name,
      COALESCE(json_agg(m.nm_id ORDER BY m.nm_id) FILTER (WHERE m.nm_id IS NOT NULL), '[]'::json) AS "nmIds",
      COALESCE(json_agg(DISTINCT p.category) FILTER (WHERE p.category IS NOT NULL), '[]'::json) AS "subjects",
      COALESCE(json_agg(DISTINCT p.brand) FILTER (WHERE p.brand IS NOT NULL), '[]'::json) AS "brands",
      COUNT(*) FILTER (WHERE COALESCE(p.is_archived, FALSE) = FALSE)::int AS "activeCount",
      COUNT(*) FILTER (WHERE COALESCE(p.is_archived, FALSE) = TRUE)::int AS "inactiveCount",
      g.created_at AS "createdAt"
    FROM product_groups g
    LEFT JOIN product_group_members m ON m.group_id = g.id
    LEFT JOIN products p ON p.tenant_id = g.tenant_id AND p.nm_id = m.nm_id
    WHERE g.tenant_id = ${resolvedTenantId}
    GROUP BY g.id, g.name, g.created_at
    ORDER BY g.created_at DESC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  return result({
    report: 'card_group_summary',
    tenantId: resolvedTenantId,
    summaryText: `Склейки/группы: ${items.length} групп.`,
    totals: { itemCount: items.length },
    items,
    data: { items },
  });
}

export async function buildPriceHistoryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const range = resolveRange(params, 30);
  const nmIds = normalizeNmIds(params);
  const limit = clampLimit(params, 500);
  const nmFilter = andInFilter(sql`ps.nm_id`, nmIds);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      ps.snapshot_date AS "date",
      ps.snapshot_at AS "sourceUpdatedAt",
      ps.nm_id AS "nmId",
      p.vendor_code AS "vendorCode",
      ps.price::numeric AS "sellerPrice",
      ps.seller_price_after_discount::numeric AS "sellerPriceAfterDiscount",
      ps.customer_price::numeric AS "customerPrice",
      ps.price_after_spp::numeric AS "priceAfterSpp",
      ps.discount::int AS "sellerDiscount",
      ps.spp::int AS "spp",
      ps.implied_spp::numeric AS "impliedSpp",
      NULL::numeric AS "wbClubDiscount",
      NULL::text AS "promo"
    FROM raw_api_price_snapshots ps
    LEFT JOIN products p ON p.tenant_id = ps.tenant_id AND p.nm_id = ps.nm_id
    WHERE ps.tenant_id = ${resolvedTenantId}
      AND ps.snapshot_date >= ${range.from}::date
      AND ps.snapshot_date <= ${range.to}::date
      ${nmFilter}
    ORDER BY ps.snapshot_at DESC, ps.nm_id ASC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  return result({
    report: 'price_history',
    tenantId: resolvedTenantId,
    range,
    summaryText: `История цен: ${items.length} строк.`,
    totals: { itemCount: items.length },
    items,
    data: { items },
  });
}

export async function buildAdvertisingCampaignsReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const limit = clampLimit(params);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT * FROM (
      SELECT
        s.advert_id AS "campaignId",
        s.name,
        'auto_bid_strategy'::text AS "type",
        CASE WHEN s.is_enabled THEN 'active' ELSE 'paused' END AS "status",
        json_build_array(s.nm_id) AS "nmIds",
        NULL::numeric AS "budget",
        s.target_cpm_rub::numeric AS "bid",
        s.strategy_started_at AS "dateFrom",
        NULL::timestamp with time zone AS "dateTo",
        s.last_status AS "historicalStatus",
        s.updated_at AS "sourceUpdatedAt"
      FROM advertising_auto_bid_strategies s
      WHERE s.tenant_id = ${resolvedTenantId}
      UNION ALL
      SELECT
        p.advert_id AS "campaignId",
        p.name,
        'pacing_rule'::text AS "type",
        CASE WHEN p.is_enabled THEN 'active' ELSE 'paused' END AS "status",
        json_build_array(p.nm_id) AS "nmIds",
        p.daily_budget_rub::numeric AS "budget",
        NULL::numeric AS "bid",
        p.created_at AS "dateFrom",
        NULL::timestamp with time zone AS "dateTo",
        p.last_status AS "historicalStatus",
        p.updated_at AS "sourceUpdatedAt"
      FROM advertising_bid_pacing_rules p
      WHERE p.tenant_id = ${resolvedTenantId}
    ) rows
    ORDER BY "sourceUpdatedAt" DESC NULLS LAST
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  return result({
    report: 'advertising_campaigns',
    tenantId: resolvedTenantId,
    summaryText: `Рекламные кампании/правила: ${items.length} строк.`,
    totals: { itemCount: items.length },
    items,
    data: { source: 'internal_advertising_workspace', items },
  });
}

export async function buildAdvertisingCampaignStatsReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const range = resolveRange(params, 30);
  const nmIds = normalizeNmIds(params);
  const limit = clampLimit(params, 500);
  const costNmFilter = andInFilter(sql`a.nm_id`, nmIds);
  const clusterNmFilter = andInFilter(sql`c.nm_id`, nmIds);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    WITH costs AS (
      SELECT
        CASE WHEN a.placement LIKE 'campaign:%' THEN REPLACE(a.placement, 'campaign:', '')::bigint ELSE NULL END AS campaign_id,
        a.nm_id,
        a.date::date AS stat_date,
        COALESCE(SUM(a.amount), 0)::numeric AS spend,
        COALESCE(SUM(a.order_count), 0)::int AS orders,
        COALESCE(SUM(a.order_sum), 0)::numeric AS revenue,
        COALESCE(SUM(a.views), 0)::int AS raw_impressions,
        COALESCE(SUM(a.clicks), 0)::int AS raw_clicks
      FROM raw_api_ad_costs a
      WHERE a.tenant_id = ${resolvedTenantId}
        AND a.date::date >= ${range.from}::date
        AND a.date::date <= ${range.to}::date
        ${costNmFilter}
      GROUP BY 1, a.nm_id, a.date::date
    ),
    clusters AS (
      SELECT
        c.nm_id,
        c.date::date AS stat_date,
        COALESCE(SUM(c.views), 0)::int AS impressions,
        COALESCE(SUM(c.clicks), 0)::int AS clicks,
        COALESCE(SUM(c.amount), 0)::numeric AS cluster_spend
      FROM raw_api_ad_clusters c
      WHERE c.tenant_id = ${resolvedTenantId}
        AND c.date::date >= ${range.from}::date
        AND c.date::date <= ${range.to}::date
        ${clusterNmFilter}
      GROUP BY c.nm_id, c.date::date
    ),
    costs_with_totals AS (
      SELECT
        costs.*,
        SUM(costs.spend) OVER (PARTITION BY costs.nm_id, costs.stat_date) AS nm_day_cost_spend
      FROM costs
    )
    SELECT
      costs_with_totals.campaign_id AS "campaignId",
      costs_with_totals.nm_id AS "nmId",
      costs_with_totals.stat_date AS "date",
      CASE WHEN COALESCE(clusters.impressions, 0) > 0 THEN clusters.impressions ELSE costs_with_totals.raw_impressions END::int AS "impressions",
      CASE WHEN COALESCE(clusters.clicks, 0) > 0 THEN clusters.clicks ELSE costs_with_totals.raw_clicks END::int AS "clicks",
      CASE
        WHEN COALESCE(clusters.impressions, 0) > 0
          THEN ROUND((clusters.clicks::numeric / clusters.impressions::numeric) * 100, 4)
        WHEN COALESCE(costs_with_totals.raw_impressions, 0) > 0
          THEN ROUND((costs_with_totals.raw_clicks::numeric / costs_with_totals.raw_impressions::numeric) * 100, 4)
        ELSE 0
      END AS "ctr",
      CASE WHEN (CASE WHEN COALESCE(clusters.clicks, 0) > 0 THEN clusters.clicks ELSE costs_with_totals.raw_clicks END) > 0 THEN ROUND((
        CASE
          WHEN COALESCE(clusters.cluster_spend, 0) > COALESCE(costs_with_totals.nm_day_cost_spend, 0) * 1.05
            AND COALESCE(costs_with_totals.nm_day_cost_spend, 0) > 0
            THEN clusters.cluster_spend * (costs_with_totals.spend / costs_with_totals.nm_day_cost_spend)
          ELSE costs_with_totals.spend
        END
      )::numeric / (CASE WHEN COALESCE(clusters.clicks, 0) > 0 THEN clusters.clicks ELSE costs_with_totals.raw_clicks END)::numeric, 2) ELSE 0 END AS "cpc",
      CASE
        WHEN COALESCE(clusters.cluster_spend, 0) > COALESCE(costs_with_totals.nm_day_cost_spend, 0) * 1.05
          AND COALESCE(costs_with_totals.nm_day_cost_spend, 0) > 0
          THEN ROUND((clusters.cluster_spend * (costs_with_totals.spend / costs_with_totals.nm_day_cost_spend))::numeric, 2)
        ELSE costs_with_totals.spend
      END AS "spend",
      costs_with_totals.spend AS "rawCostSpend",
      costs_with_totals.raw_impressions AS "rawCostImpressions",
      costs_with_totals.raw_clicks AS "rawCostClicks",
      COALESCE(clusters.cluster_spend, 0)::numeric AS "clusterSpend",
      CASE
        WHEN COALESCE(clusters.cluster_spend, 0) > COALESCE(costs_with_totals.nm_day_cost_spend, 0) * 1.05
          AND COALESCE(costs_with_totals.nm_day_cost_spend, 0) > 0
          THEN 'raw_api_ad_clusters'
        ELSE 'raw_api_ad_costs'
      END AS "spendSource",
      NULL::int AS "baskets",
      costs_with_totals.orders AS "orders",
      costs_with_totals.revenue AS "revenue",
      costs_with_totals.revenue AS "associatedRevenue",
      NULL::numeric AS "assistRevenue",
      CASE WHEN costs_with_totals.campaign_id IS NULL THEN 'missing_campaign_id' ELSE 'campaign_id_from_raw_api_ad_costs_placement' END AS "campaignAttribution",
      CASE
        WHEN COALESCE(clusters.impressions, 0) > 0 THEN 'raw_api_ad_clusters_by_nm_date'
        WHEN COALESCE(costs_with_totals.raw_impressions, 0) > 0 THEN 'raw_api_ad_costs_fullstats'
        WHEN clusters.nm_id IS NULL THEN 'missing_raw_api_ad_clusters'
        ELSE 'impressions_missing_in_source'
      END AS "impressionsSource"
    FROM costs_with_totals
    LEFT JOIN clusters
      ON clusters.nm_id = costs_with_totals.nm_id
     AND clusters.stat_date = costs_with_totals.stat_date
    ORDER BY "date" DESC, "spend" DESC
    LIMIT ${limit}
  `));
  const diagnosticsRows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM raw_api_ad_costs a WHERE a.tenant_id = ${resolvedTenantId} AND a.date::date >= ${range.from}::date AND a.date::date <= ${range.to}::date ${costNmFilter}) AS "costRows",
      (SELECT COUNT(*)::int FROM raw_api_ad_clusters c WHERE c.tenant_id = ${resolvedTenantId} AND c.date::date >= ${range.from}::date AND c.date::date <= ${range.to}::date ${clusterNmFilter}) AS "clusterRows",
      (SELECT COALESCE(SUM(a.amount), 0)::numeric FROM raw_api_ad_costs a WHERE a.tenant_id = ${resolvedTenantId} AND a.date::date >= ${range.from}::date AND a.date::date <= ${range.to}::date ${costNmFilter}) AS "rawCostSpend",
      (SELECT COALESCE(SUM(a.views), 0)::int FROM raw_api_ad_costs a WHERE a.tenant_id = ${resolvedTenantId} AND a.date::date >= ${range.from}::date AND a.date::date <= ${range.to}::date ${costNmFilter}) AS "rawCostImpressions",
      (SELECT COALESCE(SUM(a.clicks), 0)::int FROM raw_api_ad_costs a WHERE a.tenant_id = ${resolvedTenantId} AND a.date::date >= ${range.from}::date AND a.date::date <= ${range.to}::date ${costNmFilter}) AS "rawCostClicks",
      (SELECT COALESCE(SUM(c.amount), 0)::numeric FROM raw_api_ad_clusters c WHERE c.tenant_id = ${resolvedTenantId} AND c.date::date >= ${range.from}::date AND c.date::date <= ${range.to}::date ${clusterNmFilter}) AS "rawClusterSpend",
      (SELECT COALESCE(SUM(c.views), 0)::int FROM raw_api_ad_clusters c WHERE c.tenant_id = ${resolvedTenantId} AND c.date::date >= ${range.from}::date AND c.date::date <= ${range.to}::date ${clusterNmFilter}) AS "rawClusterImpressions",
      (SELECT COALESCE(SUM(c.clicks), 0)::int FROM raw_api_ad_clusters c WHERE c.tenant_id = ${resolvedTenantId} AND c.date::date >= ${range.from}::date AND c.date::date <= ${range.to}::date ${clusterNmFilter}) AS "rawClusterClicks",
      (SELECT MAX(a.created_at) FROM raw_api_ad_costs a WHERE a.tenant_id = ${resolvedTenantId} AND a.date::date >= ${range.from}::date AND a.date::date <= ${range.to}::date ${costNmFilter}) AS "costSourceUpdatedAt",
      (SELECT MAX(c.created_at) FROM raw_api_ad_clusters c WHERE c.tenant_id = ${resolvedTenantId} AND c.date::date >= ${range.from}::date AND c.date::date <= ${range.to}::date ${clusterNmFilter}) AS "clusterSourceUpdatedAt"
  `));
  const items = rows as unknown as Record<string, unknown>[];
  const spend = items.reduce((sum, item) => sum + toNumber(item.spend), 0);
  const diagnostics = (diagnosticsRows as unknown as Record<string, unknown>[])[0] ?? {};
  const rawCostSpend = toNumber(diagnostics.rawCostSpend);
  const rawClusterSpend = toNumber(diagnostics.rawClusterSpend);
  const spendDiff = roundMetric(spend - rawCostSpend);
  const spendSource = rawClusterSpend > rawCostSpend * 1.05 ? 'raw_api_ad_clusters' : 'raw_api_ad_costs';
  return result({
    report: 'advertising_campaign_stats',
    tenantId: resolvedTenantId,
    range,
    summaryText: `Статистика рекламы: ${items.length} строк, расход ${roundMetric(spend)} ₽.`,
    totals: {
      itemCount: items.length,
      spend: roundMetric(spend),
      rawCostSpend: roundMetric(rawCostSpend),
      rawClusterSpend: roundMetric(rawClusterSpend),
      spendDiff,
      spendSource,
    },
    items,
    data: {
      source: 'raw_api_ad_costs + raw_api_ad_clusters',
      diagnostics: {
        ...diagnostics,
        rawCostSpend: roundMetric(rawCostSpend),
        rawClusterSpend: roundMetric(rawClusterSpend),
        reportSpend: roundMetric(spend),
        spendDiff,
        spendSource,
        note: 'Spend is allocated from raw_api_ad_clusters.amount when cluster spend is materially higher than raw_api_ad_costs; otherwise raw_api_ad_costs is authoritative.',
      },
      items,
    },
  });
}

export async function buildFinanceRealizationDetailReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const range = resolveRange(params, 30);
  const nmIds = normalizeNmIds(params);
  const limit = clampLimit(params, 500);
  const nmFilter = andInFilter(sql`r.nm_id`, nmIds);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      r.rrd_id AS "rrdId",
      r.realizationreport_id AS "realizationReportId",
      r.date_from AS "dateFrom",
      r.date_to AS "dateTo",
      r.sale_dt AS "saleDt",
      r.nm_id AS "nmId",
      p.vendor_code AS "vendorCode",
      r.quantity::int AS "quantity",
      r.retail_amount::numeric AS "retailAmount",
      r.retail_price_withdisc_rub::numeric AS "retailPriceWithDiscountRub",
      r.ppvz_for_pay::numeric AS "toSellerRub",
      r.commission_amount::numeric AS "commissionAmount",
      r.delivery_rub::numeric AS "logisticsRub",
      r.storage_fee_rub::numeric AS "storageFeeRub",
      r.acquiring_fee::numeric AS "acquiringFee",
      r.deduction::numeric AS "deduction",
      r.penalty_rub::numeric AS "penaltyRub",
      r.acceptance::numeric AS "acceptance",
      r.additional_payment::numeric AS "additionalPayment",
      r.return_amount::numeric AS "returnAmount",
      r.spp_rub::numeric AS "sppRub",
      r.payment_schedule_rub::numeric AS "paymentScheduleRub",
      r.cashback_amount::numeric AS "cashbackAmount",
      r.ppvz_spp_prc::numeric AS "ppvzSppPrc",
      r.ppvz_kvw_prc_base::numeric AS "ppvzKvwPrcBase",
      r.ppvz_kvw_prc::numeric AS "ppvzKvwPrc",
      r.box_delivery_base::numeric AS "boxDeliveryBase",
      r.box_delivery_liter::numeric AS "boxDeliveryLiter",
      r.box_storage_base::numeric AS "boxStorageBase",
      r.box_storage_liter::numeric AS "boxStorageLiter",
      r.created_at AS "sourceUpdatedAt"
    FROM raw_api_realization_reports r
    LEFT JOIN products p ON p.tenant_id = r.tenant_id AND p.nm_id = r.nm_id
    WHERE r.tenant_id = ${resolvedTenantId}
      AND COALESCE(r.sale_dt, r.date_from)::date >= ${range.from}::date
      AND COALESCE(r.sale_dt, r.date_from)::date <= ${range.to}::date
      ${nmFilter}
    ORDER BY COALESCE(r.sale_dt, r.date_from) DESC, r.rrd_id DESC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  const toSellerRub = items.reduce((sum, item) => sum + toNumber(item.toSellerRub), 0);
  return result({
    report: 'finance_realization_detail',
    tenantId: resolvedTenantId,
    range,
    summaryText: `Детализация реализации: ${items.length} строк, к перечислению ${roundMetric(toSellerRub)} ₽.`,
    totals: { itemCount: items.length, toSellerRub: roundMetric(toSellerRub) },
    items,
    data: { items },
  });
}

export async function buildOrdersSalesSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const range = resolveRange(params, 30);
  const nmIds = normalizeNmIds(params);
  const limit = clampLimit(params, 500);
  const nmFilter = andInFilter(sql`base.nm_id`, nmIds);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    WITH base AS (
      SELECT tenant_id, nm_id, date::date AS day, COUNT(*)::int AS orders, SUM(total_price)::numeric AS orders_sum, 0::int AS sales, 0::numeric AS sales_sum
      FROM raw_api_orders
      WHERE tenant_id = ${resolvedTenantId}
        AND is_cancel = FALSE
        AND date::date >= ${range.from}::date
        AND date::date <= ${range.to}::date
      GROUP BY tenant_id, nm_id, date::date
      UNION ALL
      SELECT tenant_id, nm_id, date::date AS day, 0::int AS orders, 0::numeric AS orders_sum, COUNT(*)::int AS sales, SUM(price_with_discount)::numeric AS sales_sum
      FROM raw_api_sales
      WHERE tenant_id = ${resolvedTenantId}
        AND is_storno = FALSE
        AND date::date >= ${range.from}::date
        AND date::date <= ${range.to}::date
      GROUP BY tenant_id, nm_id, date::date
    )
    SELECT
      base.day AS "date",
      base.nm_id AS "nmId",
      p.vendor_code AS "vendorCode",
      SUM(base.orders)::int AS "orders",
      SUM(base.orders_sum)::numeric AS "ordersSum",
      SUM(base.sales)::int AS "sales",
      SUM(base.sales_sum)::numeric AS "salesSum"
    FROM base
    LEFT JOIN products p ON p.tenant_id = base.tenant_id AND p.nm_id = base.nm_id
    WHERE TRUE ${nmFilter}
    GROUP BY base.day, base.nm_id, p.vendor_code
    ORDER BY base.day DESC, "orders" DESC, "sales" DESC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  return result({
    report: 'orders_sales_summary',
    tenantId: resolvedTenantId,
    range,
    summaryText: `Заказы/продажи: ${items.length} строк.`,
    totals: {
      itemCount: items.length,
      orders: items.reduce((sum, item) => sum + toNumber(item.orders), 0),
      sales: items.reduce((sum, item) => sum + toNumber(item.sales), 0),
    },
    items,
    data: { items },
  });
}

export async function buildFulfillmentSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const limit = clampLimit(params, 500);
  const nmIds = normalizeNmIds(params);
  const nmFilter = nmIds.length > 0
    ? sql`AND COALESCE(l.nm_id, d.linked_nm_id) IN (${inListSql(nmIds)})`
    : sql``;
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      COALESCE(l.nm_id, d.linked_nm_id) AS "nmId",
      l.draft_sku_id AS "draftSkuId",
      (l.nm_id IS NULL OR d.status = 'draft') AS "isNewProduct",
      d.linked_nm_id AS "linkedNmId",
      d.external_sku_key AS "externalSkuKey",
      d.supplier_article AS "supplierArticle",
      d.source_article AS "sourceArticle",
      d.title AS "title",
      d.comment AS "comment",
      d.variant AS "variant",
      d.color AS "color",
      p.vendor_code AS "vendorCode",
      o.title AS "orderTitle",
      o.status,
      l.quantity::int AS "quantity",
      l.received_quantity::int AS "receivedQuantity",
      GREATEST(l.quantity - l.received_quantity, 0)::int AS "inTransitOrProductionQty",
      o.ordered_at AS "orderedAt",
      o.estimated_delivery_at AS "estimatedDeliveryAt",
      o.updated_at AS "sourceUpdatedAt"
    FROM production_order_lines l
    JOIN production_orders o ON o.id = l.production_order_id AND o.tenant_id = l.tenant_id
    LEFT JOIN procifry_draft_skus d ON d.id = l.draft_sku_id AND d.tenant_id = l.tenant_id
    LEFT JOIN products p ON p.tenant_id = l.tenant_id AND p.nm_id = COALESCE(l.nm_id, d.linked_nm_id)
    WHERE l.tenant_id = ${resolvedTenantId}
      ${nmFilter}
    ORDER BY o.updated_at DESC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  return result({
    report: 'fulfillment_summary',
    tenantId: resolvedTenantId,
    summaryText: `Фулфилмент/поставки: ${items.length} строк.`,
    totals: { itemCount: items.length },
    items,
    data: { items },
  });
}

export async function buildTariffsRulesSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const limit = clampLimit(params, 100);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      'tariff'::text AS "kind",
      tariff_type AS "type",
      snapshot_date AS "date",
      jsonb_array_length(CASE WHEN jsonb_typeof(data) = 'array' THEN data ELSE '[]'::jsonb END)::int AS "rowCount",
      created_at AS "sourceUpdatedAt"
    FROM wb_tariff_snapshots
    WHERE tenant_id = ${resolvedTenantId}
    UNION ALL
    SELECT
      'commission'::text AS "kind",
      'category_commission'::text AS "type",
      snapshot_date AS "date",
      jsonb_array_length(CASE WHEN jsonb_typeof(data) = 'array' THEN data ELSE '[]'::jsonb END)::int AS "rowCount",
      created_at AS "sourceUpdatedAt"
    FROM wb_category_commission_snapshots
    WHERE tenant_id = ${resolvedTenantId}
    ORDER BY "sourceUpdatedAt" DESC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  return result({
    report: 'tariffs_rules_summary',
    tenantId: resolvedTenantId,
    summaryText: `Тарифы/правила WB: ${items.length} снимков.`,
    totals: { itemCount: items.length },
    items,
    data: { items },
  });
}

export async function buildWorkerArtifactsSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const limit = clampLimit(params, 100);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      id,
      worker_id AS "workerId",
      client_id AS "clientId",
      cabinet_oid AS "cabinetOid",
      artifact_type AS "artifactType",
      action_type AS "actionType",
      access_mode AS "accessMode",
      title,
      tags,
      confidence,
      source,
      source_updated_at AS "sourceUpdatedAt",
      period_from AS "periodFrom",
      period_to AS "periodTo",
      approval_request_id AS "approvalRequestId",
      created_at AS "createdAt"
    FROM procifry_worker_artifacts
    WHERE tenant_id = ${resolvedTenantId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  return result({
    report: 'worker_artifacts_summary',
    tenantId: resolvedTenantId,
    summaryText: `Worker artifacts: ${items.length} последних записей.`,
    totals: { itemCount: items.length },
    items,
    data: { items },
  });
}

export async function buildNicheCategorySummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const range = resolveRange(params, 30);
  const limit = clampLimit(params, 100);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      COALESCE(p.category, 'unknown') AS "category",
      COUNT(DISTINCT p.nm_id)::int AS "skuCount",
      COALESCE(SUM(f.order_count), 0)::int AS "orders",
      COALESCE(SUM(f.order_sum), 0)::numeric AS "ordersSum",
      COALESCE(SUM(f.buyout_count), 0)::int AS "buyouts",
      COALESCE(SUM(f.buyout_sum), 0)::numeric AS "buyoutsSum"
    FROM products p
    LEFT JOIN raw_api_funnel_stats f
      ON f.tenant_id = p.tenant_id
     AND f.nm_id = p.nm_id
     AND f.period_start::date >= ${range.from}::date
     AND f.period_start::date <= ${range.to}::date
    WHERE p.tenant_id = ${resolvedTenantId}
      AND p.is_hidden = FALSE
    GROUP BY COALESCE(p.category, 'unknown')
    ORDER BY "ordersSum" DESC, "orders" DESC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  return result({
    report: 'niche_category_summary',
    tenantId: resolvedTenantId,
    range,
    summaryText: `Категории/ниши: ${items.length} строк. MPStats как внешний источник пока не подключён.`,
    totals: { itemCount: items.length },
    items,
    data: { source: 'internal_wb_data_only', mpstatsAvailable: false, items },
  });
}

export async function buildSearchPositionsSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const range = resolveRange(params, 30);
  const nmIds = normalizeNmIds(params);
  const keywords = normalizeKeywords(params);
  const limit = clampLimit(params, 100);
  const nmFilter = andInFilter(sql`p.nm_id`, nmIds);
  const keywordFilter = andInFilter(sql`lower(p.keyword)`, keywords);
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      p.observed_date AS "date",
      p.cabinet_oid AS "cabinetOid",
      p.keyword,
      p.nm_id AS "nmId",
      p.position,
      p.frequency,
      p.impressions,
      p.organic_or_ad AS "organicOrAd",
      p.source,
      p.source_updated_at AS "sourceUpdatedAt",
      p.confidence,
      p.payload
    FROM procifry_search_positions p
    WHERE p.tenant_id = ${resolvedTenantId}
      AND p.observed_date >= ${range.from}::date
      AND p.observed_date <= ${range.to}::date
      ${nmFilter}
      ${keywordFilter}
    ORDER BY p.observed_date DESC, p.keyword ASC, p.position ASC NULLS LAST, p.nm_id ASC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  const coverage = await loadProcifrySourceCoverage(
    resolvedTenantId,
    'procifry_search_positions',
    'observed_date',
    'observed_date',
  );
  const sourceState = externalSourceState({
    source: 'procifry_search_positions',
    coverage,
    itemCount: items.length,
    range,
  });
  return result({
    report: 'search_positions_summary',
    tenantId: resolvedTenantId,
    range,
    summaryText: `Поисковые позиции: ${items.length} строк за ${range.from} — ${range.to}. ${sourceState.note}`,
    totals: { itemCount: items.length, sourceStatus: sourceState.sourceStatus },
    items,
    data: {
      ...sourceState,
      items,
    },
  });
}

export async function buildCompetitorCardsSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const range = resolveRange(params, 30);
  const nmIds = normalizeNmIds(params);
  const keywords = normalizeKeywords(params);
  const competitorNmId = Number(params?.competitorNmId ?? 0);
  const limit = clampLimit(params, 100);
  const nmFilter = nmIds.length > 0
    ? sql`AND (c.our_nm_id IN (${inListSql(nmIds)}) OR c.competitor_nm_id IN (${inListSql(nmIds)}))`
    : sql``;
  const keywordFilter = andInFilter(sql`lower(c.keyword)`, keywords);
  const competitorFilter = Number.isFinite(competitorNmId) && competitorNmId > 0
    ? sql`AND c.competitor_nm_id = ${Math.trunc(competitorNmId)}`
    : sql``;
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      c.observed_date AS "date",
      c.cabinet_oid AS "cabinetOid",
      c.our_nm_id AS "ourNmId",
      c.competitor_nm_id AS "competitorNmId",
      c.keyword,
      c.subject,
      c.title,
      c.brand,
      c.price,
      c.rating,
      c.reviews_count AS "reviews",
      c.orders_count AS "orders",
      c.revenue,
      c.stock_qty AS "stocks",
      c.photos,
      c.videos,
      c.positions,
      c.source,
      c.source_updated_at AS "sourceUpdatedAt",
      c.confidence,
      c.payload
    FROM procifry_competitor_cards c
    WHERE c.tenant_id = ${resolvedTenantId}
      AND c.observed_date >= ${range.from}::date
      AND c.observed_date <= ${range.to}::date
      ${nmFilter}
      ${keywordFilter}
      ${competitorFilter}
    ORDER BY c.observed_date DESC, c.orders_count DESC NULLS LAST, c.revenue DESC NULLS LAST, c.competitor_nm_id ASC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  const coverage = await loadProcifrySourceCoverage(
    resolvedTenantId,
    'procifry_competitor_cards',
    'observed_date',
    'observed_date',
  );
  const sourceState = externalSourceState({
    source: 'procifry_competitor_cards',
    coverage,
    itemCount: items.length,
    range,
  });
  return result({
    report: 'competitor_cards_summary',
    tenantId: resolvedTenantId,
    range,
    summaryText: `Карточки конкурентов: ${items.length} строк за ${range.from} — ${range.to}. ${sourceState.note}`,
    totals: { itemCount: items.length, sourceStatus: sourceState.sourceStatus },
    items,
    data: {
      ...sourceState,
      items,
    },
  });
}

export async function buildAbTestsSummaryReport(
  tenantId: string | null | undefined,
  params: AgentReportParams | undefined,
): Promise<AgentReportResult> {
  const resolvedTenantId = resolveTenantId(tenantId);
  const range = resolveRange(params, 30);
  const nmIds = normalizeNmIds(params);
  const testId = params?.testId?.trim() || null;
  const limit = clampLimit(params, 100);
  const nmFilter = andInFilter(sql`t.nm_id`, nmIds);
  const testFilter = testId ? sql`AND t.test_id = ${testId}` : sql``;
  const rows = await withTenantContext(db, resolvedTenantId, (tx) => tx.execute(sql`
    SELECT
      t.test_id AS "testId",
      t.cabinet_oid AS "cabinetOid",
      t.nm_id AS "nmId",
      t.variant,
      t.period_from AS "periodFrom",
      t.period_to AS "periodTo",
      t.impressions,
      t.clicks,
      COALESCE(t.ctr, CASE WHEN t.impressions > 0 THEN ROUND((t.clicks::numeric / t.impressions::numeric) * 100, 4) ELSE NULL END) AS "ctr",
      t.carts,
      t.orders,
      t.revenue,
      t.profit,
      t.significance,
      t.status,
      t.source,
      t.source_updated_at AS "sourceUpdatedAt",
      t.confidence,
      t.payload
    FROM procifry_ab_tests t
    WHERE t.tenant_id = ${resolvedTenantId}
      AND t.period_from <= ${range.to}::date
      AND t.period_to >= ${range.from}::date
      ${nmFilter}
      ${testFilter}
    ORDER BY t.period_to DESC, t.test_id ASC, t.nm_id ASC, t.variant ASC
    LIMIT ${limit}
  `));
  const items = rows as unknown as Record<string, unknown>[];
  const coverage = await loadProcifrySourceCoverage(
    resolvedTenantId,
    'procifry_ab_tests',
    'period_from',
    'period_to',
  );
  const sourceState = externalSourceState({
    source: 'procifry_ab_tests',
    coverage,
    itemCount: items.length,
    range,
  });
  return result({
    report: 'ab_tests_summary',
    tenantId: resolvedTenantId,
    range,
    summaryText: `A/B тесты: ${items.length} строк за ${range.from} — ${range.to}. ${sourceState.note}`,
    totals: { itemCount: items.length, sourceStatus: sourceState.sourceStatus },
    items,
    data: {
      ...sourceState,
      items,
    },
  });
}
