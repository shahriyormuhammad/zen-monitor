import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { buildNetProfitSql } from '@/server/analytics/helpers/sql-builders';
import { buildFullLandedCostSql } from '@/server/analytics/services/economics';

export type AdvertisingPriority = 'high' | 'medium' | 'low';
export type AdvertisingProductCheckStatus = 'ok' | 'watch' | 'fix';
export type AdvertisingProductReasonCode =
  | 'stock'
  | 'card_content'
  | 'seo'
  | 'price'
  | 'competitor'
  | 'semantic'
  | 'bid_economics'
  | 'traffic_quality'
  | 'group_attribution';
export type AdvertisingAlertCode =
  | 'spend_without_revenue'
  | 'negative_profit_after_ads'
  | 'profit_eaten_by_ads'
  | 'high_acos'
  | 'no_orders_from_clicks'
  | 'expensive_click'
  | 'low_ctr'
  | 'stable';

export type AdvertisingActionItem = {
  id: string;
  priority: AdvertisingPriority;
  code: AdvertisingAlertCode;
  title: string;
  details: string;
  metric: string;
  reasonCode: AdvertisingProductReasonCode | null;
  reasonLabel: string | null;
  nmId: number | null;
  vendorCode: string | null;
  brand: string | null;
  attributionScope: 'sku' | 'group';
  groupId: string | null;
  groupName: string | null;
  groupNmCount: number;
};

export type AdvertisingDailyPoint = {
  day: string;
  adSpend: number;
  revenue: number;
  netProfit: number;
  netProfitBeforeAds: number;
  views: number;
  clicks: number;
  orders: number;
  activeSkuCount: number;
  acosPct: number | null;
  profitMarginPct: number | null;
  cpc: number | null;
  ctrPct: number | null;
};

export type AdvertisingSkuRow = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  attributionScope: 'sku' | 'group';
  groupId: string | null;
  groupName: string | null;
  groupNmCount: number;
  advertisedNmCount: number;
  adSpend: number;
  spendSharePct: number;
  views: number;
  clicks: number;
  clusterOrders: number;
  ctrPct: number | null;
  cpc: number | null;
  revenue: number;
  salesCount: number;
  netProfit: number;
  netProfitBeforeAds: number;
  profitMarginPct: number | null;
  adSpendToProfitBeforeAdsPct: number | null;
  acosPct: number | null;
  roas: number | null;
  productSignals: {
    stockQty: number | null;
    sellerPrice: number | null;
    customerPrice: number | null;
    photosCount: number | null;
    hasVideo: boolean | null;
    characteristicsCount: number | null;
    avgSearchPosition: number | null;
    searchKeywordCount: number;
    competitorAvgPrice: number | null;
    competitorCount: number;
  };
  productCheck: {
    status: AdvertisingProductCheckStatus;
    reasons: string[];
    reasonCodes: AdvertisingProductReasonCode[];
    checks: Array<{
      code: AdvertisingProductReasonCode;
      label: string;
      status: AdvertisingProductCheckStatus;
      message: string;
    }>;
    checklist: string[];
  };
};

export type AdvertisingClusterRow = {
  cluster: string;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpc: number | null;
  skuCount: number;
};

export type AdvertisingPlacementRow = {
  placement: string;
  amount: number;
  sharePct: number;
};

export type AdvertisingOverviewResponse = {
  generatedAt: string;
  dateWindowDays: number;
  hasData: boolean;
  summary: {
    adSpendEffective: number;
    adSpendCostsRaw: number;
    adSpendClustersRaw: number;
    adSpendUnknownPlacement: number;
    revenue: number;
    netProfit: number;
    netProfitBeforeAds: number;
    views: number;
    clicks: number;
    clusterOrders: number;
    activeSkuCount: number;
    riskySkuCount: number;
    acosPct: number | null;
    profitMarginPct: number | null;
    adSpendToProfitBeforeAdsPct: number | null;
    roas: number | null;
    ctrPct: number | null;
    cpc: number | null;
    cpo: number | null;
  };
  daily: AdvertisingDailyPoint[];
  topSku: AdvertisingSkuRow[];
  topClusters: AdvertisingClusterRow[];
  placements: AdvertisingPlacementRow[];
  actionItems: AdvertisingActionItem[];
};

function toUtcDayStart(value: Date) {
  const next = new Date(value);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function addUtcDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullablePositiveNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toInt(value: unknown) {
  return Math.max(0, Math.round(toNumber(value)));
}

function round(value: number, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function toNullablePct(numerator: number, denominator: number, precision = 2) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round((numerator / denominator) * 100, precision);
}

function toNullableRatio(numerator: number, denominator: number, precision = 2) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return round(numerator / denominator, precision);
}

function buildAdBaseCte(tenantId: string, fromIso: string, toExclusiveIso: string) {
  return sql`
    WITH ad_costs_day AS (
      SELECT
        nm_id,
        DATE_TRUNC('day', date) AS day_raw,
        SUM(amount)::numeric AS ad_spend
      FROM raw_api_ad_costs
      WHERE tenant_id = ${tenantId}
        AND date >= ${fromIso}::timestamp
        AND date < ${toExclusiveIso}::timestamp
      GROUP BY nm_id, DATE_TRUNC('day', date)
    ),
    ad_clusters_day AS (
      SELECT
        nm_id,
        DATE_TRUNC('day', date) AS day_raw,
        SUM(amount)::numeric AS ad_spend,
        SUM(views)::bigint AS views,
        SUM(clicks)::bigint AS clicks,
        SUM(order_count)::bigint AS cluster_orders
      FROM raw_api_ad_clusters
      WHERE tenant_id = ${tenantId}
        AND date >= ${fromIso}::timestamp
        AND date < ${toExclusiveIso}::timestamp
      GROUP BY nm_id, DATE_TRUNC('day', date)
    ),
    ad_day AS (
      SELECT
        COALESCE(c.nm_id, cl.nm_id) AS nm_id,
        COALESCE(c.day_raw, cl.day_raw) AS day_raw,
        CASE
          WHEN c.nm_id IS NOT NULL THEN COALESCE(c.ad_spend, 0)
          ELSE COALESCE(cl.ad_spend, 0)
        END::numeric AS ad_spend,
        COALESCE(cl.views, 0)::bigint AS views,
        COALESCE(cl.clicks, 0)::bigint AS clicks,
        COALESCE(cl.cluster_orders, 0)::bigint AS cluster_orders
      FROM ad_costs_day c
      FULL OUTER JOIN ad_clusters_day cl
        ON c.nm_id = cl.nm_id
       AND c.day_raw = cl.day_raw
    )
  `;
}

function buildAdScopeCte(tenantId: string, fromIso: string, toExclusiveIso: string) {
  const fullLandedCostSql = buildFullLandedCostSql('mi', 'c.cost_price');
  const profitBeforeTaxSql = '(f.payout_before_cost - f.cost_total - COALESCE(a.ad_spend, 0))';
  const netProfitSql = buildNetProfitSql({
    taxTypeExpr: 't.tax_type',
    taxRateExpr: 't.tax_rate',
    vatModeExpr: 't.vat_mode',
    vatRateExpr: 't.vat_rate',
    revenueExpr: 'f.tax_base_revenue',
    profitBeforeTaxExpr: profitBeforeTaxSql,
  });

  return sql`
    ${buildAdBaseCte(tenantId, fromIso, toExclusiveIso)}
    , group_map AS (
      SELECT
        nm_id,
        group_id,
        group_name,
        group_nm_count
      FROM (
        SELECT
          gm.nm_id,
          pg.id AS group_id,
          pg.name AS group_name,
          COUNT(*) OVER (PARTITION BY pg.id)::int AS group_nm_count,
          ROW_NUMBER() OVER (PARTITION BY gm.nm_id ORDER BY pg.created_at, pg.id) AS rn
        FROM product_group_members gm
        JOIN product_groups pg
          ON pg.id = gm.group_id
         AND pg.tenant_id = ${tenantId}
      ) ranked_groups
      WHERE rn = 1
    ),
    ad_scope_day AS (
      SELECT
        COALESCE(gm.group_id::text, 'sku:' || a.nm_id::text) AS scope_key,
        gm.group_id,
        gm.group_name,
        COALESCE(gm.group_nm_count, 1)::int AS group_nm_count,
        a.day_raw,
        SUM(a.ad_spend)::numeric AS ad_spend,
        SUM(a.views)::bigint AS views,
        SUM(a.clicks)::bigint AS clicks,
        SUM(a.cluster_orders)::bigint AS cluster_orders,
        COUNT(DISTINCT a.nm_id)::int AS active_sku_count
      FROM ad_day a
      LEFT JOIN group_map gm
        ON gm.nm_id = a.nm_id
      GROUP BY
        COALESCE(gm.group_id::text, 'sku:' || a.nm_id::text),
        gm.group_id,
        gm.group_name,
        COALESCE(gm.group_nm_count, 1),
        a.day_raw
    ),
    ad_scopes AS (
      SELECT DISTINCT scope_key, group_id
      FROM ad_scope_day
    ),
    scope_members AS (
      SELECT
        s.scope_key,
        gm.nm_id
      FROM ad_scopes s
      JOIN product_group_members gm
        ON gm.group_id = s.group_id
      WHERE s.group_id IS NOT NULL
      UNION ALL
      SELECT
        s.scope_key,
        REPLACE(s.scope_key, 'sku:', '')::bigint AS nm_id
      FROM ad_scopes s
      WHERE s.group_id IS NULL
    ),
    sales_scope_day AS (
      SELECT
        sm.scope_key,
        DATE_TRUNC('day', rs.date) AS day_raw,
        SUM(rs.price_with_discount)::numeric AS revenue,
        COUNT(*)::bigint AS sales_count
      FROM scope_members sm
      JOIN raw_api_sales rs
        ON rs.tenant_id = ${tenantId}
       AND rs.nm_id = sm.nm_id
       AND rs.is_storno = false
       AND rs.date >= ${fromIso}::timestamp
       AND rs.date < ${toExclusiveIso}::timestamp
      GROUP BY sm.scope_key, DATE_TRUNC('day', rs.date)
    ),
    reconciliation_cutoff AS (
      SELECT COALESCE(MAX(date_to), '1970-01-01'::timestamp) AS cutoff
      FROM raw_api_realization_reports
      WHERE tenant_id = ${tenantId}
    ),
    latest_costs AS (
      SELECT
        scope_nm.nm_id,
        (${sql.raw(fullLandedCostSql)})::numeric AS full_cost
      FROM (
        SELECT DISTINCT nm_id
        FROM scope_members
      ) scope_nm
      LEFT JOIN LATERAL (
        SELECT cost_price
        FROM unit_economics_configs
        WHERE tenant_id = ${tenantId}
          AND nm_id = scope_nm.nm_id
        ORDER BY effective_from DESC
        LIMIT 1
      ) c ON true
      LEFT JOIN unit_economics_manual_inputs mi
        ON mi.tenant_id = ${tenantId}
       AND mi.nm_id = scope_nm.nm_id
    ),
    finance_sku_day AS (
      SELECT
        source_rows.day_raw,
        source_rows.nm_id,
        SUM(source_rows.finance_revenue)::numeric AS finance_revenue,
        SUM(source_rows.tax_base_revenue)::numeric AS tax_base_revenue,
        SUM(source_rows.payout_before_cost)::numeric AS payout_before_cost,
        SUM(source_rows.cost_total)::numeric AS cost_total
      FROM (
        SELECT
          mv.day::date AS day_raw,
          mv.nm_id,
          mv.revenue::numeric AS finance_revenue,
          mv.tax_base_revenue::numeric AS tax_base_revenue,
          mv.payout_before_cost::numeric AS payout_before_cost,
          (mv.quantity_for_cost * COALESCE(lc.full_cost, 0))::numeric AS cost_total
        FROM mv_daily_pnl_final mv
        JOIN (
          SELECT DISTINCT nm_id
          FROM scope_members
        ) scope_nm
          ON scope_nm.nm_id = mv.nm_id
        LEFT JOIN latest_costs lc
          ON lc.nm_id = mv.nm_id
        WHERE mv.tenant_id = ${tenantId}
          AND mv.day >= ${fromIso}::date
          AND mv.day < ${toExclusiveIso}::date

        UNION ALL

        SELECT
          s.date::date AS day_raw,
          s.nm_id,
          s.price_with_discount::numeric AS finance_revenue,
          s.price_with_discount::numeric AS tax_base_revenue,
          (s.price_with_discount - (s.price_with_discount * 0.15) - 50)::numeric AS payout_before_cost,
          COALESCE(lc.full_cost, 0)::numeric AS cost_total
        FROM raw_api_sales s
        CROSS JOIN reconciliation_cutoff rc
        JOIN (
          SELECT DISTINCT nm_id
          FROM scope_members
        ) scope_nm
          ON scope_nm.nm_id = s.nm_id
        LEFT JOIN latest_costs lc
          ON lc.nm_id = s.nm_id
        WHERE s.tenant_id = ${tenantId}
          AND s.date::date > rc.cutoff::date
          AND s.date >= ${fromIso}::timestamp
          AND s.date < ${toExclusiveIso}::timestamp
          AND s.is_storno = false
      ) source_rows
      GROUP BY source_rows.day_raw, source_rows.nm_id
    ),
    finance_scope_day AS (
      SELECT
        sm.scope_key,
        f.day_raw,
        SUM(f.finance_revenue)::numeric AS finance_revenue,
        SUM(f.tax_base_revenue)::numeric AS tax_base_revenue,
        SUM(f.payout_before_cost)::numeric AS payout_before_cost,
        SUM(f.cost_total)::numeric AS cost_total
      FROM scope_members sm
      JOIN finance_sku_day f
        ON f.nm_id = sm.nm_id
      GROUP BY sm.scope_key, f.day_raw
    ),
    finance_net_scope_day AS (
      SELECT
        f.scope_key,
        f.day_raw,
        f.finance_revenue,
        f.tax_base_revenue,
        f.payout_before_cost,
        f.cost_total,
        COALESCE(a.ad_spend, 0)::numeric AS ad_spend,
        (${sql.raw(profitBeforeTaxSql)})::numeric AS profit_before_tax,
        (${sql.raw(netProfitSql)})::numeric AS net_profit
      FROM finance_scope_day f
      LEFT JOIN ad_scope_day a
        ON a.scope_key = f.scope_key
       AND a.day_raw::date = f.day_raw
      JOIN tenants t
        ON t.id = ${tenantId}
    )
  `;
}

const PRODUCT_REASON_LABELS: Record<AdvertisingProductReasonCode, string> = {
  stock: 'Остаток',
  card_content: 'Карточка',
  seo: 'SEO',
  price: 'Цена',
  competitor: 'Конкуренты',
  semantic: 'Семантика',
  bid_economics: 'Ставка',
  traffic_quality: 'Трафик',
  group_attribution: 'Склейка',
};

function buildActionItems(topSku: AdvertisingSkuRow[], topClusters: AdvertisingClusterRow[]) {
  const items: AdvertisingActionItem[] = [];

  for (const sku of topSku) {
    if (items.length >= 12) {
      break;
    }

    const scopeLabel = sku.attributionScope === 'group' ? 'склейке' : 'SKU';
    const scopeSuffix = sku.attributionScope === 'group' && sku.groupName ? ` Склейка: ${sku.groupName}.` : '';

    if (sku.adSpend >= 1000 && sku.netProfit < 0 && sku.revenue > 0) {
      items.push({
        id: `negative_profit_after_ads:${sku.groupId ?? sku.nmId}`,
        priority: 'high',
        code: 'negative_profit_after_ads',
        title: `Чистая прибыль по ${scopeLabel} ушла в минус`,
        details: `Решение принимается по чистой прибыли после рекламы, а не только по ДРР. Сначала остановить/снизить рекламный расход и проверить цену, себестоимость и кластеры.${scopeSuffix}`,
        metric: `ЧП ${Math.round(sku.netProfit).toLocaleString('ru-RU')} ₽ · реклама ${Math.round(sku.adSpend).toLocaleString('ru-RU')} ₽`,
        reasonCode: 'bid_economics',
        reasonLabel: PRODUCT_REASON_LABELS.bid_economics,
        nmId: sku.nmId,
        vendorCode: sku.vendorCode,
        brand: sku.brand,
        attributionScope: sku.attributionScope,
        groupId: sku.groupId,
        groupName: sku.groupName,
        groupNmCount: sku.groupNmCount,
      });
      continue;
    }

    if (sku.adSpend >= 1500 && sku.revenue <= 0) {
      items.push({
        id: `spend_without_revenue:${sku.groupId ?? sku.nmId}`,
        priority: 'high',
        code: 'spend_without_revenue',
        title: `Расход есть, выручки по ${scopeLabel} нет`,
        details: `Ограничьте ставки, проверьте карточку и остатки, затем перезапустите только рабочие кластеры.${scopeSuffix}`,
        metric: `${Math.round(sku.adSpend).toLocaleString('ru-RU')} ₽ без выручки`,
        reasonCode: 'traffic_quality',
        reasonLabel: PRODUCT_REASON_LABELS.traffic_quality,
        nmId: sku.nmId,
        vendorCode: sku.vendorCode,
        brand: sku.brand,
        attributionScope: sku.attributionScope,
        groupId: sku.groupId,
        groupName: sku.groupName,
        groupNmCount: sku.groupNmCount,
      });
      continue;
    }

    if (
      sku.adSpendToProfitBeforeAdsPct !== null
      && sku.adSpend >= 1000
      && sku.netProfitBeforeAds > 0
      && sku.adSpendToProfitBeforeAdsPct >= 60
    ) {
      items.push({
        id: `profit_eaten_by_ads:${sku.groupId ?? sku.nmId}`,
        priority: sku.adSpendToProfitBeforeAdsPct >= 90 ? 'high' : 'medium',
        code: 'profit_eaten_by_ads',
        title: `Реклама съедает прибыль по ${scopeLabel}`,
        details: `До рекламы ${scopeLabel} прибыльна, но рекламный расход забирает ${sku.adSpendToProfitBeforeAdsPct.toFixed(1)}% прибыли до рекламы. Снижайте ставку или режьте нерелевантные кластеры.${scopeSuffix}`,
        metric: `ЧП до рекламы ${Math.round(sku.netProfitBeforeAds).toLocaleString('ru-RU')} ₽ · после ${Math.round(sku.netProfit).toLocaleString('ru-RU')} ₽`,
        reasonCode: 'bid_economics',
        reasonLabel: PRODUCT_REASON_LABELS.bid_economics,
        nmId: sku.nmId,
        vendorCode: sku.vendorCode,
        brand: sku.brand,
        attributionScope: sku.attributionScope,
        groupId: sku.groupId,
        groupName: sku.groupName,
        groupNmCount: sku.groupNmCount,
      });
      continue;
    }

    if (sku.acosPct !== null && sku.adSpend >= 1000 && sku.acosPct >= 45) {
      items.push({
        id: `high_acos:${sku.groupId ?? sku.nmId}`,
        priority: sku.acosPct >= 65 ? 'high' : 'medium',
        code: 'high_acos',
        title: `Высокая ДРР по ${scopeLabel}`,
        details: `Снизьте ставки и вынесите проблемный артикул/кластер в отдельную кампанию, чтобы не тянуть вниз общий пул.${scopeSuffix}`,
        metric: `ДРР ${sku.acosPct.toFixed(1)}%`,
        reasonCode: 'bid_economics',
        reasonLabel: PRODUCT_REASON_LABELS.bid_economics,
        nmId: sku.nmId,
        vendorCode: sku.vendorCode,
        brand: sku.brand,
        attributionScope: sku.attributionScope,
        groupId: sku.groupId,
        groupName: sku.groupName,
        groupNmCount: sku.groupNmCount,
      });
      continue;
    }

    if (sku.clicks >= 30 && sku.clusterOrders <= 0 && sku.adSpend >= 800) {
      items.push({
        id: `no_orders_from_clicks:${sku.groupId ?? sku.nmId}`,
        priority: 'medium',
        code: 'no_orders_from_clicks',
        title: 'Клики есть, заказов из рекламы нет',
        details: `Пересоберите семантику и минус-фразы, отключите нерелевантные запросы.${scopeSuffix}`,
        metric: `${sku.clicks.toLocaleString('ru-RU')} кликов / 0 заказов`,
        reasonCode: 'semantic',
        reasonLabel: PRODUCT_REASON_LABELS.semantic,
        nmId: sku.nmId,
        vendorCode: sku.vendorCode,
        brand: sku.brand,
        attributionScope: sku.attributionScope,
        groupId: sku.groupId,
        groupName: sku.groupName,
        groupNmCount: sku.groupNmCount,
      });
      continue;
    }

    if (sku.cpc !== null && sku.cpc >= 80 && sku.clicks >= 20) {
      items.push({
        id: `expensive_click:${sku.groupId ?? sku.nmId}`,
        priority: 'medium',
        code: 'expensive_click',
        title: 'Слишком дорогой клик',
        details: `Пересмотрите ставку и разнесите SKU по placement, чтобы не переплачивать в дорогих сегментах.${scopeSuffix}`,
        metric: `CPC ${sku.cpc.toFixed(2)} ₽`,
        reasonCode: 'bid_economics',
        reasonLabel: PRODUCT_REASON_LABELS.bid_economics,
        nmId: sku.nmId,
        vendorCode: sku.vendorCode,
        brand: sku.brand,
        attributionScope: sku.attributionScope,
        groupId: sku.groupId,
        groupName: sku.groupName,
        groupNmCount: sku.groupNmCount,
      });
      continue;
    }

    if (sku.ctrPct !== null && sku.ctrPct < 0.45 && sku.views >= 1500 && sku.adSpend >= 500) {
      items.push({
        id: `low_ctr:${sku.groupId ?? sku.nmId}`,
        priority: 'low',
        code: 'low_ctr',
        title: 'Низкий CTR в кластерах',
        details: `Проверьте релевантность запросов и первый экран карточки, усиливайте только рабочие кластеры.${scopeSuffix}`,
        metric: `CTR ${sku.ctrPct.toFixed(2)}%`,
        reasonCode: 'card_content',
        reasonLabel: PRODUCT_REASON_LABELS.card_content,
        nmId: sku.nmId,
        vendorCode: sku.vendorCode,
        brand: sku.brand,
        attributionScope: sku.attributionScope,
        groupId: sku.groupId,
        groupName: sku.groupName,
        groupNmCount: sku.groupNmCount,
      });
    }
  }

  if (items.length < 12) {
    const cluster = topClusters.find((row) => row.clicks >= 25 && row.orders === 0);
    if (cluster) {
      items.push({
        id: `cluster_rework:${cluster.cluster}`,
        priority: 'medium',
        code: 'no_orders_from_clicks',
        title: 'Кластер с кликами без заказов',
        details: 'Добавьте кластер в минус или понизьте ставку, чтобы снять нецелевой трафик.',
        metric: `«${cluster.cluster}»: ${cluster.clicks.toLocaleString('ru-RU')} кликов`,
        reasonCode: 'semantic',
        reasonLabel: PRODUCT_REASON_LABELS.semantic,
        nmId: null,
        vendorCode: null,
        brand: null,
        attributionScope: 'sku',
        groupId: null,
        groupName: null,
        groupNmCount: 1,
      });
    }
  }

  if (items.length === 0) {
    items.push({
      id: 'stable',
      priority: 'low',
      code: 'stable',
      title: 'Явных критичных отклонений не найдено',
      details: 'Фокус на масштабировании SKU с лучшим ROAS и постепенном расширении рабочих кластеров.',
      metric: 'Стабильный рекламный контур',
      reasonCode: null,
      reasonLabel: null,
      nmId: null,
      vendorCode: null,
      brand: null,
      attributionScope: 'sku',
      groupId: null,
      groupName: null,
      groupNmCount: 1,
    });
  }

  return items;
}

function buildProductCheck(sku: Omit<AdvertisingSkuRow, 'spendSharePct' | 'productCheck'>): AdvertisingSkuRow['productCheck'] {
  const reasons: string[] = [];
  const checks: AdvertisingSkuRow['productCheck']['checks'] = [];
  const checklist = new Set<string>();
  let status: AdvertisingProductCheckStatus = 'ok';
  const signals = sku.productSignals;

  function add(
    nextStatus: AdvertisingProductCheckStatus,
    code: AdvertisingProductReasonCode,
    reason: string,
    tags: string[],
  ) {
    reasons.push(reason);
    checks.push({
      code,
      label: PRODUCT_REASON_LABELS[code],
      status: nextStatus,
      message: reason,
    });
    tags.forEach((tag) => checklist.add(tag));
    if (nextStatus === 'fix' || status === 'ok') {
      status = nextStatus;
    }
  }

  if (sku.adSpend >= 1500 && sku.revenue <= 0) {
    add(
      'fix',
      'traffic_quality',
      `${Math.round(sku.adSpend).toLocaleString('ru-RU')} ₽ расхода без выручки: сначала проверить карточку, цену, остатки и нерелевантные кластеры.`,
      ['Карточка', 'Цена', 'Остатки', 'Кластеры'],
    );
  }

  if (sku.adSpend >= 1000 && sku.netProfit < 0 && sku.revenue > 0) {
    add(
      'fix',
      'bid_economics',
      `Чистая прибыль после рекламы ${Math.round(sku.netProfit).toLocaleString('ru-RU')} ₽: реклама и экономика склейки не проходят, даже если есть выручка.`,
      ['Маржа', 'Ставка', 'Цена'],
    );
  } else if (
    sku.adSpendToProfitBeforeAdsPct !== null
    && sku.adSpend >= 1000
    && sku.netProfitBeforeAds > 0
    && sku.adSpendToProfitBeforeAdsPct >= 60
  ) {
    add(
      sku.adSpendToProfitBeforeAdsPct >= 90 ? 'fix' : 'watch',
      'bid_economics',
      `Реклама забирает ${sku.adSpendToProfitBeforeAdsPct.toFixed(1)}% прибыли до рекламы: масштабировать нельзя без снижения ставки или цены/маржи.`,
      ['Маржа', 'Ставка'],
    );
  }

  if (signals.stockQty !== null && signals.stockQty <= 0 && sku.adSpend > 0) {
    add(
      'fix',
      'stock',
      'Остаток по рекламируемой склейке нулевой: рекламу нельзя масштабировать до пополнения.',
      ['Остатки', 'Пауза'],
    );
  } else if (signals.stockQty !== null && signals.stockQty <= 5 && sku.adSpend >= 500) {
    add(
      'watch',
      'stock',
      `Остаток ${signals.stockQty.toLocaleString('ru-RU')} шт.: перед ростом ставки проверить пополнение и риск OOS.`,
      ['Остатки', 'Поставка'],
    );
  }

  if (sku.clicks >= 30 && sku.clusterOrders <= 0) {
    add(
      'fix',
      'semantic',
      `${sku.clicks.toLocaleString('ru-RU')} кликов без заказов: трафик пришёл, но карточка или предложение не конвертит.`,
      ['Цена', 'Отзывы', 'Кластеры'],
    );
  }

  if (sku.ctrPct !== null && sku.ctrPct < 0.45 && sku.views >= 1500) {
    add(
      sku.adSpend >= 500 ? 'fix' : 'watch',
      'card_content',
      `CTR ${sku.ctrPct.toFixed(2)}% при ${sku.views.toLocaleString('ru-RU')} показах: проверить первый экран, фото, SEO и релевантность запросов.`,
      ['Фото/CTR', 'SEO', 'Кластеры'],
    );
  }

  if (signals.photosCount !== null && signals.photosCount < 5) {
    add(
      sku.adSpend >= 500 ? 'fix' : 'watch',
      'card_content',
      `В карточке ${signals.photosCount} фото: для рекламы мало визуальных аргументов на первом экране.`,
      ['Фото/CTR', 'Карточка'],
    );
  }

  if (signals.hasVideo === false && sku.adSpend >= 500) {
    add(
      'watch',
      'card_content',
      'В карточке нет видео: для платного трафика стоит проверить видео/обзор, особенно при низком CTR.',
      ['Видео', 'Карточка'],
    );
  }

  if (signals.characteristicsCount !== null && signals.characteristicsCount <= 0) {
    add(
      'watch',
      'seo',
      'Характеристики карточки не заполнены: SEO и фильтры WB могут терять релевантный трафик.',
      ['SEO', 'Характеристики'],
    );
  }

  if (sku.acosPct !== null && sku.acosPct >= 45 && sku.adSpend >= 1000) {
    add(
      sku.acosPct >= 65 ? 'fix' : 'watch',
      'bid_economics',
      `ДРР ${sku.acosPct.toFixed(1)}%: реклама давит экономику, перед ростом ставки проверить цену, маржу и промо.`,
      ['Цена', 'Маржа', 'Промо'],
    );
  }

  if (sku.cpc !== null && sku.cpc >= 80 && sku.clicks >= 20) {
    add(
      'watch',
      'bid_economics',
      `CPC ${sku.cpc.toFixed(2)} ₽: клик дорогой, нужно отделить рабочие запросы от дорогих нерелевантных.`,
      ['Ставка', 'Кластеры'],
    );
  }

  if (
    signals.sellerPrice !== null
    && signals.competitorAvgPrice !== null
    && signals.competitorCount >= 2
    && signals.sellerPrice > signals.competitorAvgPrice * 1.1
  ) {
    add(
      'watch',
      'competitor',
      `Цена выше среднего конкурентов примерно на ${(((signals.sellerPrice / signals.competitorAvgPrice) - 1) * 100).toFixed(0)}%: реклама может покупать клики без конверсии.`,
      ['Цена', 'Конкуренты'],
    );
  }

  if (signals.avgSearchPosition !== null && signals.avgSearchPosition > 30 && sku.adSpend >= 500) {
    add(
      'watch',
      'seo',
      `Средняя позиция ${signals.avgSearchPosition.toFixed(1)} по ${signals.searchKeywordCount} ключам: SEO/ставка недобирают видимость.`,
      ['SEO', 'Позиции'],
    );
  }

  if (sku.attributionScope === 'group' && sku.advertisedNmCount < sku.groupNmCount) {
    add(
      status === 'ok' ? 'watch' : status,
      'group_attribution',
      `Решение считается по склейке: реклама идёт на ${sku.advertisedNmCount} из ${sku.groupNmCount} SKU, продажи могут уходить на соседний артикул.`,
      ['Склейка', 'SKU'],
    );
  }

  return {
    status,
    reasons: reasons.slice(0, 4),
    reasonCodes: Array.from(new Set(checks.map((check) => check.code))).slice(0, 6),
    checks: checks.slice(0, 6),
    checklist: Array.from(checklist).slice(0, 6),
  };
}

export async function getAdvertisingOverview(
  tenantId: string,
  dateFrom: Date,
  dateTo: Date,
): Promise<AdvertisingOverviewResponse> {
  const from = toUtcDayStart(dateFrom);
  const to = toUtcDayStart(dateTo);
  const toExclusive = addUtcDays(to, 1);
  const dateWindowDays = Math.max(1, Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1);

  const fromIso = from.toISOString();
  const toExclusiveIso = toExclusive.toISOString();

  return withTenantContext(db, tenantId, async (tx) => {
  const dailyRows = await tx.execute(sql`
    ${buildAdScopeCte(tenantId, fromIso, toExclusiveIso)}
    SELECT
      TO_CHAR(a.day_raw, 'YYYY-MM-DD') AS day_key,
      SUM(a.ad_spend)::numeric AS ad_spend,
      SUM(a.views)::bigint AS views,
      SUM(a.clicks)::bigint AS clicks,
      SUM(a.cluster_orders)::bigint AS cluster_orders,
      SUM(COALESCE(s.revenue, 0))::numeric AS revenue,
      SUM(COALESCE(fn.net_profit, 0))::numeric AS net_profit,
      SUM(CASE WHEN fn.scope_key IS NULL THEN 0 ELSE fn.net_profit + a.ad_spend END)::numeric AS net_profit_before_ads,
      SUM(a.active_sku_count)::int AS active_sku_count
    FROM ad_scope_day a
    LEFT JOIN sales_scope_day s
      ON s.scope_key = a.scope_key
     AND s.day_raw = a.day_raw
    LEFT JOIN finance_net_scope_day fn
      ON fn.scope_key = a.scope_key
     AND fn.day_raw = a.day_raw
    GROUP BY a.day_raw
    ORDER BY a.day_raw
  `);

  const sourceRows = await tx.execute(sql`
    SELECT
      COALESCE(SUM(amount), 0)::numeric AS ad_spend_costs_raw
    FROM raw_api_ad_costs
    WHERE tenant_id = ${tenantId}
      AND date >= ${fromIso}::timestamp
      AND date < ${toExclusiveIso}::timestamp
  `);

  const clusterSourceRows = await tx.execute(sql`
    SELECT
      COALESCE(SUM(amount), 0)::numeric AS ad_spend_clusters_raw
    FROM raw_api_ad_clusters
    WHERE tenant_id = ${tenantId}
      AND date >= ${fromIso}::timestamp
      AND date < ${toExclusiveIso}::timestamp
  `);

  const placementRowsRaw = await tx.execute(sql`
    SELECT
      COALESCE(NULLIF(TRIM(placement), ''), 'Не указан') AS placement,
      SUM(amount)::numeric AS amount
    FROM raw_api_ad_costs
    WHERE tenant_id = ${tenantId}
      AND date >= ${fromIso}::timestamp
      AND date < ${toExclusiveIso}::timestamp
    GROUP BY COALESCE(NULLIF(TRIM(placement), ''), 'Не указан')
    ORDER BY SUM(amount) DESC
    LIMIT 12
  `);

  const topSkuRows = await tx.execute(sql`
    ${buildAdScopeCte(tenantId, fromIso, toExclusiveIso)}
    , scope_stats AS (
      SELECT
        a.scope_key,
        a.group_id,
        a.group_name,
        MAX(a.group_nm_count)::int AS group_nm_count,
        SUM(a.ad_spend)::numeric AS ad_spend,
        SUM(a.views)::bigint AS views,
        SUM(a.clicks)::bigint AS clicks,
        SUM(a.cluster_orders)::bigint AS cluster_orders,
        SUM(a.active_sku_count)::int AS advertised_nm_count
      FROM ad_scope_day a
      GROUP BY a.scope_key, a.group_id, a.group_name
    ),
    scope_sales AS (
      SELECT
        scope_key,
        SUM(revenue)::numeric AS revenue,
        SUM(sales_count)::bigint AS sales_count
      FROM sales_scope_day
      GROUP BY scope_key
    ),
    scope_finance AS (
      SELECT
        scope_key,
        SUM(net_profit)::numeric AS net_profit,
        SUM(net_profit + ad_spend)::numeric AS net_profit_before_ads,
        SUM(profit_before_tax)::numeric AS profit_before_tax,
        SUM(finance_revenue)::numeric AS finance_revenue
      FROM finance_net_scope_day
      GROUP BY scope_key
    ),
    primary_ad AS (
      SELECT DISTINCT ON (scope_key)
        scope_key,
        nm_id AS primary_nm_id
      FROM (
        SELECT
          COALESCE(gm.group_id::text, 'sku:' || a.nm_id::text) AS scope_key,
          a.nm_id,
          SUM(a.ad_spend)::numeric AS ad_spend
        FROM ad_day a
        LEFT JOIN group_map gm
          ON gm.nm_id = a.nm_id
        GROUP BY COALESCE(gm.group_id::text, 'sku:' || a.nm_id::text), a.nm_id
      ) ranked_primary
      ORDER BY scope_key, ad_spend DESC, nm_id
    ),
    stock_scope AS (
      SELECT
        sm.scope_key,
        SUM(COALESCE(st.amount, 0) + COALESCE(st.in_way_to_client, 0) + COALESCE(st.in_way_from_client, 0))::numeric AS stock_qty
      FROM scope_members sm
      LEFT JOIN raw_api_stocks st
        ON st.tenant_id = ${tenantId}
       AND st.nm_id = sm.nm_id
      GROUP BY sm.scope_key
    ),
    search_scope AS (
      SELECT
        sm.scope_key,
        AVG(sp.position) FILTER (WHERE sp.position IS NOT NULL AND sp.position > 0)::numeric AS avg_search_position,
        COUNT(*)::int AS search_keyword_count
      FROM scope_members sm
      JOIN procifry_search_positions sp
        ON sp.tenant_id = ${tenantId}
       AND sp.nm_id = sm.nm_id
       AND sp.observed_date >= ${fromIso}::date
       AND sp.observed_date < ${toExclusiveIso}::date
      GROUP BY sm.scope_key
    ),
    competitor_scope AS (
      SELECT
        sm.scope_key,
        AVG(cc.price) FILTER (WHERE cc.price IS NOT NULL AND cc.price > 0)::numeric AS competitor_avg_price,
        COUNT(*)::int AS competitor_count
      FROM scope_members sm
      JOIN procifry_competitor_cards cc
        ON cc.tenant_id = ${tenantId}
       AND cc.our_nm_id = sm.nm_id
       AND cc.observed_date >= ${fromIso}::date
       AND cc.observed_date < ${toExclusiveIso}::date
      GROUP BY sm.scope_key
    )
    SELECT
      pa.primary_nm_id AS nm_id,
      s.group_id,
      s.group_name,
      s.group_nm_count,
      s.advertised_nm_count,
      s.ad_spend,
      s.views,
      s.clicks,
      s.cluster_orders,
      COALESCE(ss.revenue, 0)::numeric AS revenue,
      COALESCE(ss.sales_count, 0)::bigint AS sales_count,
      COALESCE(sf.net_profit, 0)::numeric AS net_profit,
      COALESCE(sf.net_profit_before_ads, 0)::numeric AS net_profit_before_ads,
      COALESCE(sf.finance_revenue, 0)::numeric AS finance_revenue,
      stock.stock_qty,
      ROUND((COALESCE(price.price, 0) * (100 - COALESCE(price.discount, 0)) / 100.0)::numeric, 2) AS seller_price,
      ROUND((COALESCE(price.price, 0) * (100 - COALESCE(price.discount, 0)) * (100 - COALESCE(price.spp, 0)) / 10000.0)::numeric, 2) AS customer_price,
      meta.photos_count,
      meta.has_video,
      meta.characteristics_count,
      search.avg_search_position,
      COALESCE(search.search_keyword_count, 0)::int AS search_keyword_count,
      competitor.competitor_avg_price,
      COALESCE(competitor.competitor_count, 0)::int AS competitor_count,
      p.vendor_code,
      p.brand,
      p.photo_url
    FROM scope_stats s
    JOIN primary_ad pa
      ON pa.scope_key = s.scope_key
    LEFT JOIN scope_sales ss
      ON ss.scope_key = s.scope_key
    LEFT JOIN scope_finance sf
      ON sf.scope_key = s.scope_key
    LEFT JOIN products p
      ON p.tenant_id = ${tenantId}
     AND p.nm_id = pa.primary_nm_id
     AND COALESCE(p.is_hidden, FALSE) = FALSE
    LEFT JOIN raw_api_product_metadata meta
      ON meta.tenant_id = ${tenantId}
     AND meta.nm_id = pa.primary_nm_id
    LEFT JOIN raw_api_prices price
      ON price.tenant_id = ${tenantId}
     AND price.nm_id = pa.primary_nm_id
    LEFT JOIN stock_scope stock
      ON stock.scope_key = s.scope_key
    LEFT JOIN search_scope search
      ON search.scope_key = s.scope_key
    LEFT JOIN competitor_scope competitor
      ON competitor.scope_key = s.scope_key
    ORDER BY s.ad_spend DESC
    LIMIT 80
  `);

  const activeSkuCountRows = await tx.execute(sql`
    ${buildAdBaseCte(tenantId, fromIso, toExclusiveIso)}
    SELECT COUNT(DISTINCT nm_id)::int AS active_sku_count
    FROM ad_day
  `);

  const clusterRowsRaw = await tx.execute(sql`
    SELECT
      cluster,
      SUM(amount)::numeric AS ad_spend,
      SUM(views)::bigint AS views,
      SUM(clicks)::bigint AS clicks,
      SUM(order_count)::bigint AS orders,
      COUNT(DISTINCT nm_id)::int AS sku_count
    FROM raw_api_ad_clusters
    WHERE tenant_id = ${tenantId}
      AND date >= ${fromIso}::timestamp
      AND date < ${toExclusiveIso}::timestamp
    GROUP BY cluster
    ORDER BY SUM(amount) DESC
    LIMIT 40
  `);

  const daily: AdvertisingDailyPoint[] = dailyRows.map((row) => {
    const adSpend = toNumber((row as Record<string, unknown>).ad_spend);
    const revenue = toNumber((row as Record<string, unknown>).revenue);
    const netProfit = toNumber((row as Record<string, unknown>).net_profit);
    const netProfitBeforeAds = toNumber((row as Record<string, unknown>).net_profit_before_ads);
    const clicks = toInt((row as Record<string, unknown>).clicks);
    const views = toInt((row as Record<string, unknown>).views);
    const orders = toInt((row as Record<string, unknown>).cluster_orders);
    return {
      day: String((row as Record<string, unknown>).day_key ?? ''),
      adSpend: round(adSpend, 2),
      revenue: round(revenue, 2),
      netProfit: round(netProfit, 2),
      netProfitBeforeAds: round(netProfitBeforeAds, 2),
      views,
      clicks,
      orders,
      activeSkuCount: toInt((row as Record<string, unknown>).active_sku_count),
      acosPct: toNullablePct(adSpend, revenue),
      profitMarginPct: toNullablePct(netProfit, revenue),
      cpc: toNullableRatio(adSpend, clicks),
      ctrPct: toNullablePct(clicks, views),
    };
  });

  const adSpendEffective = round(daily.reduce((sum, row) => sum + row.adSpend, 0), 2);
  const totalRevenue = round(daily.reduce((sum, row) => sum + row.revenue, 0), 2);
  const totalNetProfit = round(daily.reduce((sum, row) => sum + row.netProfit, 0), 2);
  const totalNetProfitBeforeAds = round(daily.reduce((sum, row) => sum + row.netProfitBeforeAds, 0), 2);
  const totalViews = daily.reduce((sum, row) => sum + row.views, 0);
  const totalClicks = daily.reduce((sum, row) => sum + row.clicks, 0);
  const totalClusterOrders = daily.reduce((sum, row) => sum + row.orders, 0);

  const adSpendCostsRaw = round(toNumber((sourceRows[0] as Record<string, unknown> | undefined)?.ad_spend_costs_raw), 2);
  const adSpendClustersRaw = round(toNumber((clusterSourceRows[0] as Record<string, unknown> | undefined)?.ad_spend_clusters_raw), 2);

  const topSkuPre: Omit<AdvertisingSkuRow, 'spendSharePct' | 'productCheck'>[] = topSkuRows.map((row) => {
    const adSpend = toNumber((row as Record<string, unknown>).ad_spend);
    const revenue = toNumber((row as Record<string, unknown>).revenue);
    const netProfit = toNumber((row as Record<string, unknown>).net_profit);
    const netProfitBeforeAds = toNumber((row as Record<string, unknown>).net_profit_before_ads);
    const clicks = toInt((row as Record<string, unknown>).clicks);
    const views = toInt((row as Record<string, unknown>).views);
    return {
      nmId: toInt((row as Record<string, unknown>).nm_id),
      vendorCode: ((row as Record<string, unknown>).vendor_code as string | null) ?? null,
      brand: ((row as Record<string, unknown>).brand as string | null) ?? null,
      photoUrl: ((row as Record<string, unknown>).photo_url as string | null) ?? null,
      attributionScope: ((row as Record<string, unknown>).group_id ? 'group' : 'sku') as 'sku' | 'group',
      groupId: ((row as Record<string, unknown>).group_id as string | null) ?? null,
      groupName: ((row as Record<string, unknown>).group_name as string | null) ?? null,
      groupNmCount: Math.max(1, toInt((row as Record<string, unknown>).group_nm_count)),
      advertisedNmCount: Math.max(1, toInt((row as Record<string, unknown>).advertised_nm_count)),
      adSpend: round(adSpend, 2),
      views,
      clicks,
      clusterOrders: toInt((row as Record<string, unknown>).cluster_orders),
      ctrPct: toNullablePct(clicks, views),
      cpc: toNullableRatio(adSpend, clicks),
      revenue: round(revenue, 2),
      salesCount: toInt((row as Record<string, unknown>).sales_count),
      netProfit: round(netProfit, 2),
      netProfitBeforeAds: round(netProfitBeforeAds, 2),
      profitMarginPct: toNullablePct(netProfit, revenue),
      adSpendToProfitBeforeAdsPct: toNullablePct(adSpend, netProfitBeforeAds),
      acosPct: toNullablePct(adSpend, revenue),
      roas: toNullableRatio(revenue, adSpend),
      productSignals: {
        stockQty: (row as Record<string, unknown>).stock_qty == null
          ? null
          : toInt((row as Record<string, unknown>).stock_qty),
        sellerPrice: toNullablePositiveNumber((row as Record<string, unknown>).seller_price),
        customerPrice: toNullablePositiveNumber((row as Record<string, unknown>).customer_price),
        photosCount: (row as Record<string, unknown>).photos_count == null
          ? null
          : toInt((row as Record<string, unknown>).photos_count),
        hasVideo: typeof (row as Record<string, unknown>).has_video === 'boolean'
          ? ((row as Record<string, unknown>).has_video as boolean)
          : null,
        characteristicsCount: (row as Record<string, unknown>).characteristics_count == null
          ? null
          : toInt((row as Record<string, unknown>).characteristics_count),
        avgSearchPosition: toNullablePositiveNumber((row as Record<string, unknown>).avg_search_position),
        searchKeywordCount: toInt((row as Record<string, unknown>).search_keyword_count),
        competitorAvgPrice: toNullablePositiveNumber((row as Record<string, unknown>).competitor_avg_price),
        competitorCount: toInt((row as Record<string, unknown>).competitor_count),
      },
    };
  });

  const topSku = topSkuPre.slice(0, 40).map((row) => ({
    ...row,
    spendSharePct: adSpendEffective > 0 ? round((row.adSpend / adSpendEffective) * 100, 2) : 0,
    productCheck: buildProductCheck(row),
  }));

  const topClusters: AdvertisingClusterRow[] = clusterRowsRaw.map((row) => {
    const adSpend = toNumber((row as Record<string, unknown>).ad_spend);
    const clicks = toInt((row as Record<string, unknown>).clicks);
    const views = toInt((row as Record<string, unknown>).views);
    const orders = toInt((row as Record<string, unknown>).orders);
    return {
      cluster: String((row as Record<string, unknown>).cluster ?? ''),
      adSpend: round(adSpend, 2),
      views,
      clicks,
      orders,
      ctrPct: toNullablePct(clicks, views),
      cpc: toNullableRatio(adSpend, clicks),
      skuCount: toInt((row as Record<string, unknown>).sku_count),
    };
  });

  const placementsPre = placementRowsRaw.map((row) => ({
    placement: String((row as Record<string, unknown>).placement ?? 'Не указан'),
    amount: round(toNumber((row as Record<string, unknown>).amount), 2),
  }));
  const placementTotal = placementsPre.reduce((sum, row) => sum + row.amount, 0);
  const placements: AdvertisingPlacementRow[] = placementsPre.map((row) => ({
    ...row,
    sharePct: placementTotal > 0 ? round((row.amount / placementTotal) * 100, 2) : 0,
  }));

  const actionItems = buildActionItems(topSku, topClusters);
  const riskySkuCount = new Set(actionItems.map((item) => item.groupId ?? item.nmId).filter(Boolean)).size;
  const activeSkuCount = toInt((activeSkuCountRows[0] as Record<string, unknown> | undefined)?.active_sku_count);

  return {
    generatedAt: new Date().toISOString(),
    dateWindowDays,
    hasData: adSpendEffective > 0 || adSpendCostsRaw > 0 || adSpendClustersRaw > 0 || totalRevenue > 0,
    summary: {
      adSpendEffective,
      adSpendCostsRaw,
      adSpendClustersRaw,
      adSpendUnknownPlacement: round(placements.filter((row) => row.placement === 'Не указан').reduce((sum, row) => sum + row.amount, 0), 2),
      revenue: totalRevenue,
      netProfit: totalNetProfit,
      netProfitBeforeAds: totalNetProfitBeforeAds,
      views: totalViews,
      clicks: totalClicks,
      clusterOrders: totalClusterOrders,
      activeSkuCount,
      riskySkuCount,
      acosPct: toNullablePct(adSpendEffective, totalRevenue),
      profitMarginPct: toNullablePct(totalNetProfit, totalRevenue),
      adSpendToProfitBeforeAdsPct: toNullablePct(adSpendEffective, totalNetProfitBeforeAds),
      roas: toNullableRatio(totalRevenue, adSpendEffective),
      ctrPct: toNullablePct(totalClicks, totalViews),
      cpc: toNullableRatio(adSpendEffective, totalClicks),
      cpo: toNullableRatio(adSpendEffective, totalClusterOrders),
    },
    daily,
    topSku,
    topClusters,
    placements,
    actionItems,
  };
  }); // withTenantContext
}
