/**
 * Stocks 2.0 — main service (P87).
 *
 * Собирает данные из 3-х слоёв (WB / собственный склад / в пути) и считает
 * для каждого SKU:
 *   - средний дневной спрос (EWMA по последним 30 дням funnel-заказов),
 *   - std dev спроса,
 *   - ABC-категорию (по выручке),
 *   - страховой запас (Z × σ × √leadTime, Z от ABC),
 *   - reorder point,
 *   - сколько дней хватит,
 *   - светофор-статус,
 *   - рекомендованный объём закупки + стоимость.
 *
 * Агрегаты + региональный расклад идут в KPI и regions[].
 */

import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import {
  classifyAbc,
  computeDaysLeft,
  computeEwma,
  computeRecommendQuantity,
  computeRop,
  computeSafetyStock,
  computeStdDev,
  computeStockStatus,
  getZScoreForAbc,
} from './forecasting';
import type { StocksV2Kpi, StocksV2Payload, StocksV2RegionRow, StockSkuRow } from './types';
import { resolveWarehouseFo, normalizeWbFoName } from './warehouse-fo';
import { buildFullLandedCostSql } from '../services/economics';
import { getActiveSalesPlanDemandByNm } from '@/server/sales-plan/service';

type GetStocksV2Options = {
  targetDays?: number;
  leadTimeDays?: number;
  demandPeriodDays?: number;
};

const DEFAULT_TARGET_DAYS = 30;
const DEFAULT_LEAD_TIME_DAYS = 46; // 7 FF + 14 production + 25 transit
const DEFAULT_DEMAND_PERIOD_DAYS = 30;

function toNumeric(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toIsoDayUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildJsonbNumericSql(valueExpr: string) {
  return `
    CASE
      WHEN NULLIF(TRIM(${valueExpr}), '') ~ '^-?[0-9]+([,.][0-9]+)?$'
        THEN REPLACE(TRIM(${valueExpr}), ',', '.')::numeric
      ELSE NULL
    END
  `;
}

export async function getStocksV2(
  tenantId: string,
  options: GetStocksV2Options = {},
): Promise<StocksV2Payload> {
  if (!tenantId) throw new Error('Missing tenantId');

  const targetDays = options.targetDays ?? DEFAULT_TARGET_DAYS;
  const leadTimeDays = options.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS;
  const demandPeriodDays = options.demandPeriodDays ?? DEFAULT_DEMAND_PERIOD_DAYS;

  const now = new Date();
  const demandTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const demandFrom = new Date(demandTo.getTime() - demandPeriodDays * 86_400_000);
  const planDemandTo = new Date(demandTo.getTime() + Math.max(0, targetDays - 1) * 86_400_000);

  // 1) products + (последний) WB volume + full landed cost from "Себестоимость"
  const skuRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      p.nm_id::bigint AS nm_id,
      p.vendor_code,
      p.brand,
      p.category,
      p.photo_url,
      p.wb_warehouse_volume_liters,
      uec.cost_price AS configured_cost_price,
      (${sql.raw(buildJsonbNumericSql("uemi.manual_fields ->> 'costPrice'"))})::numeric AS manual_cost_price,
      (${sql.raw(buildFullLandedCostSql('uemi', 'uec.cost_price'))})::numeric AS full_cost_price
    FROM products p
    LEFT JOIN LATERAL (
      SELECT cost_price FROM unit_economics_configs
      WHERE tenant_id = p.tenant_id AND nm_id = p.nm_id
      ORDER BY effective_from DESC NULLS LAST LIMIT 1
    ) uec ON TRUE
    LEFT JOIN unit_economics_manual_inputs uemi
      ON uemi.tenant_id = p.tenant_id AND uemi.nm_id = p.nm_id
    WHERE p.tenant_id = ${tenantId}
      AND p.is_archived = FALSE
      AND p.is_hidden = FALSE
  `));

  // 2) WB stocks per (nmId, warehouseName) — самый свежий snapshot per склад.
  const wbStocksRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT DISTINCT ON (nm_id, warehouse_name)
      nm_id::bigint AS nm_id,
      warehouse_name,
      amount,
      in_way_to_client,
      in_way_from_client
    FROM raw_api_stocks
    WHERE tenant_id = ${tenantId}
    ORDER BY nm_id, warehouse_name, date DESC
  `));

  // 3) Собственные физические склады: РФ + Китай, sum remainingQuantity per nmId.
  const ownStockRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      nm_id::bigint AS nm_id,
      CASE WHEN stock_location = 'china' THEN 'china' ELSE 'own' END AS stock_location,
      COALESCE(SUM(remaining_quantity), 0)::int AS qty
    FROM own_stock_batches
    WHERE tenant_id = ${tenantId} AND remaining_quantity > 0
    GROUP BY nm_id, CASE WHEN stock_location = 'china' THEN 'china' ELSE 'own' END
  `));

  // 4) В производстве и в пути: sum quantity per nmId по статусам.
  const productionRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      pol.nm_id::bigint AS nm_id,
      po.status,
      COALESCE(SUM(pol.quantity - pol.received_quantity), 0)::int AS pending_qty
    FROM production_order_lines pol
    JOIN production_orders po ON po.id = pol.production_order_id
    WHERE po.tenant_id = ${tenantId}
      AND po.status IN ('ordered', 'in_production', 'shipped', 'customs')
    GROUP BY pol.nm_id, po.status
  `));

  // 5) Daily orders за demandPeriodDays для EWMA + std dev.
  const dailyDemandRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      nm_id::bigint AS nm_id,
      period_start::date AS day,
      SUM(order_count)::int AS orders
    FROM raw_api_funnel_stats
    WHERE tenant_id = ${tenantId}
      AND period_start::date = period_end::date
      AND period_start >= ${demandFrom.toISOString()}::timestamp
      AND period_start <= ${demandTo.toISOString()}::timestamp
    GROUP BY nm_id, period_start::date
    ORDER BY nm_id, day
  `));

  // 6) Revenue per nmId за demandPeriodDays (для ABC).
  const revenueRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      nm_id::bigint AS nm_id,
      COALESCE(SUM(ppvz_for_pay), 0)::numeric AS revenue
    FROM raw_api_realization_reports
    WHERE tenant_id = ${tenantId}
      AND sale_dt >= ${demandFrom.toISOString()}::timestamp
      AND sale_dt <= ${demandTo.toISOString()}::timestamp
    GROUP BY nm_id
  `));

  // 7) Region sales: agregate by foName. Schema uses sale_qty / period_from.
  const regionRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      fo_name,
      COALESCE(SUM(sale_qty), 0)::int AS qty
    FROM raw_api_region_sales
    WHERE tenant_id = ${tenantId}
      AND period_from >= ${demandFrom.toISOString()}::timestamp
    GROUP BY fo_name
  `));

  // 8) Localization percent — свежий сводный снимок per nmId + объём заказов
  //    для средневзвешенной агрегации. WB показывает по магазину именно
  //    взвешенное по заказам, а не простое среднее по SKU.
  //
  //    КРИТИЧНО: фильтр `period_start != period_end` исключает дневные
  //    слайсы (sync парсит daily-funnel report и пишет туда
  //    localization_percent = 0). Без этого фильтра DISTINCT ON может
  //    хватить дневную с 0% (когда у обеих period_end = сегодня),
  //    тянет агрегат вниз и ломает сходимость с WB кабинетом.
  const localizationRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT DISTINCT ON (nm_id)
      nm_id::bigint AS nm_id,
      localization_percent::numeric AS pct,
      order_count::int AS orders
    FROM raw_api_funnel_stats
    WHERE tenant_id = ${tenantId}
      AND localization_percent IS NOT NULL
      AND period_start::date <> period_end::date
    ORDER BY nm_id, period_end DESC, period_start ASC
  `));

  // 9a) Динамика ИЛ за 13 недель — для тренда на странице /localization.
  //     Берём последний снимок локализации каждого nmId на каждой неделе,
  //     затем средневзвешенное по orders (как делает WB кабинет).
  //     WB обновляет ИЛ раз в неделю и считает по 13-недельному окну (ИРП).
  const localizationTrendRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH weekly_per_nm AS (
      SELECT DISTINCT ON (nm_id, date_trunc('week', period_end))
        nm_id,
        date_trunc('week', period_end) AS week_start,
        localization_percent::numeric AS pct,
        order_count::int AS orders
      FROM raw_api_funnel_stats
      WHERE tenant_id = ${tenantId}
        AND localization_percent IS NOT NULL
        AND period_end >= NOW() - INTERVAL '91 days'
        AND period_start::date <> period_end::date
      ORDER BY nm_id, date_trunc('week', period_end), period_end DESC, period_start ASC
    )
    SELECT
      week_start,
      CASE
        WHEN SUM(orders) > 0 THEN (SUM(pct * orders) / SUM(orders))
        ELSE AVG(pct)
      END::numeric AS avg_pct,
      COUNT(*)::int AS nm_count
    FROM weekly_per_nm
    GROUP BY week_start
    ORDER BY week_start ASC
  `));

  // 9b) Auto-mapping склад→ФО из БД (доминирующий регион заказов с этого склада
  //    через raw_api_stock_sizes, затем регион→ФО через raw_api_region_sales).
  //    Используется как override для хардкод-словаря в warehouse-fo.ts.
  const officeFoRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    WITH region_to_fo AS (
      SELECT region_name, MAX(fo_name) AS fo_name
      FROM raw_api_region_sales
      WHERE tenant_id = ${tenantId}
        AND fo_name IS NOT NULL AND fo_name != ''
      GROUP BY region_name
    ),
    office_orders AS (
      SELECT office_name, region_name, SUM(orders_count::numeric) AS orders
      FROM raw_api_stock_sizes
      WHERE tenant_id = ${tenantId}
        AND stock_type = 'wb'
        AND orders_count > 0
        AND office_name IS NOT NULL AND office_name != ''
      GROUP BY office_name, region_name
    ),
    office_top AS (
      SELECT DISTINCT ON (office_name)
        office_name, region_name
      FROM office_orders
      ORDER BY office_name, orders DESC
    )
      SELECT o.office_name, rtf.fo_name
      FROM office_top o
      JOIN region_to_fo rtf ON rtf.region_name = o.region_name
    `));

  // 10) Активный sales plan. Если он есть, именно он управляет спросом для
  //     сезонных товаров и закупки; история остаётся fallback'ом.
  const plannedDemandByNm = await getActiveSalesPlanDemandByNm(
    tenantId,
    toIsoDayUtc(demandTo),
    toIsoDayUtc(planDemandTo),
  );

  // ---- Build maps ---------------------------------------------------------
  const wbStocksByNm = new Map<number, { byWarehouse: Record<string, number>; total: number }>();
  for (const row of wbStocksRows as unknown as Array<{ nm_id: unknown; warehouse_name: unknown; amount: unknown }>) {
    const nm = Number(row.nm_id);
    const wh = String(row.warehouse_name ?? 'Unknown');
    const qty = toNumeric(row.amount);
    if (!Number.isFinite(nm) || nm <= 0) continue;
    const entry = wbStocksByNm.get(nm) ?? { byWarehouse: {}, total: 0 };
    entry.byWarehouse[wh] = (entry.byWarehouse[wh] ?? 0) + qty;
    entry.total += qty;
    wbStocksByNm.set(nm, entry);
  }

  const ownStockByNm = new Map<number, number>();
  const chinaStockByNm = new Map<number, number>();
  for (const row of ownStockRows as unknown as Array<{ nm_id: unknown; stock_location: unknown; qty: unknown }>) {
    const nmId = Number(row.nm_id);
    const qty = toNumeric(row.qty);
    if (String(row.stock_location) === 'china') {
      chinaStockByNm.set(nmId, qty);
    } else {
      ownStockByNm.set(nmId, qty);
    }
  }

  const inProductionByNm = new Map<number, number>();
  const inTransitByNm = new Map<number, number>();
  for (const row of productionRows as unknown as Array<{ nm_id: unknown; status: unknown; pending_qty: unknown }>) {
    const nm = Number(row.nm_id);
    const status = String(row.status);
    const qty = toNumeric(row.pending_qty);
    if (status === 'ordered' || status === 'in_production') {
      inProductionByNm.set(nm, (inProductionByNm.get(nm) ?? 0) + qty);
    } else if (status === 'shipped' || status === 'customs') {
      inTransitByNm.set(nm, (inTransitByNm.get(nm) ?? 0) + qty);
    }
  }

  const dailyDemandByNm = new Map<number, number[]>();
  for (const row of dailyDemandRows as unknown as Array<{ nm_id: unknown; orders: unknown }>) {
    const nm = Number(row.nm_id);
    const orders = toNumeric(row.orders);
    if (!dailyDemandByNm.has(nm)) dailyDemandByNm.set(nm, []);
    dailyDemandByNm.get(nm)!.push(orders);
  }

  const revenueByNm = new Map<number, number>();
  for (const row of revenueRows as unknown as Array<{ nm_id: unknown; revenue: unknown }>) {
    revenueByNm.set(Number(row.nm_id), toNumeric(row.revenue));
  }

  const localizationByNm = new Map<number, { pct: number; orders: number }>();
  for (const row of localizationRows as unknown as Array<{
    nm_id: unknown; pct: unknown; orders: unknown;
  }>) {
    localizationByNm.set(Number(row.nm_id), {
      pct: toNumeric(row.pct),
      orders: Math.max(0, Math.trunc(toNumeric(row.orders))),
    });
  }

  // ABC classification ------------------------------------------------------
  const itemsForAbc: Array<{ nmId: number; revenue: number }> = [];
  for (const row of skuRows as unknown as Array<{ nm_id: unknown }>) {
    const nm = Number(row.nm_id);
    itemsForAbc.push({ nmId: nm, revenue: revenueByNm.get(nm) ?? 0 });
  }
  const abcByNm = classifyAbc(itemsForAbc);

  // ---- Per-SKU rows -------------------------------------------------------
  const items: StockSkuRow[] = [];
  for (const row of skuRows as unknown as Array<{
    nm_id: unknown; vendor_code: unknown; brand: unknown; category: unknown;
    photo_url: unknown; configured_cost_price: unknown; manual_cost_price: unknown; full_cost_price: unknown;
  }>) {
    const nmId = Number(row.nm_id);
    if (!Number.isFinite(nmId) || nmId <= 0) continue;

    const wbEntry = wbStocksByNm.get(nmId);
    const wbStock = wbEntry?.total ?? 0;
    const ownStock = ownStockByNm.get(nmId) ?? 0;
    const chinaStock = chinaStockByNm.get(nmId) ?? 0;
    const inProduction = inProductionByNm.get(nmId) ?? 0;
    const inTransit = inTransitByNm.get(nmId) ?? 0;
    const totalAvailable = wbStock + ownStock + chinaStock + inProduction + inTransit;

    const dailyArr = dailyDemandByNm.get(nmId) ?? [];
    const historicalAvgDailyDemand = computeEwma(dailyArr, 0.3);
    const plannedDailyDemand = plannedDemandByNm.get(nmId) ?? 0;
    const avgDailyDemand = plannedDailyDemand > 0 ? plannedDailyDemand : historicalAvgDailyDemand;
    const demandSource = plannedDailyDemand > 0 ? 'sales_plan' : 'history';
    const sigmaDemand = computeStdDev(dailyArr);
    const daysLeft = computeDaysLeft(totalAvailable, avgDailyDemand);
    const abcBucket = abcByNm.get(nmId) ?? 'unrated';

    const z = getZScoreForAbc(abcBucket);
    const safetyStock = computeSafetyStock(z, sigmaDemand, leadTimeDays);
    const reorderPoint = computeRop(avgDailyDemand, leadTimeDays, safetyStock);
    const recommendQty = computeRecommendQuantity(targetDays, avgDailyDemand, safetyStock, totalAvailable);

    const manualCost = toNumeric(row.manual_cost_price);
    const configuredCost = toNumeric(row.configured_cost_price);
    const fullCost = toNumeric(row.full_cost_price);
    const costPerUnit = fullCost > 0 ? fullCost : manualCost > 0 ? manualCost : configuredCost > 0 ? configuredCost : null;
    const recommendCost = costPerUnit != null && recommendQty > 0
      ? Math.round(recommendQty * costPerUnit * 100) / 100
      : null;

    const status = computeStockStatus(daysLeft, leadTimeDays, totalAvailable);
    const locEntry = localizationByNm.get(nmId);
    const localizationPercent = locEntry ? Math.round(locEntry.pct * 10) / 10 : null;

    items.push({
      nmId,
      vendorCode: typeof row.vendor_code === 'string' ? row.vendor_code : null,
      brand: typeof row.brand === 'string' ? row.brand : null,
      category: typeof row.category === 'string' ? row.category : null,
      photoUrl: typeof row.photo_url === 'string' ? row.photo_url : null,
      wbStock,
      wbStockByWarehouse: wbEntry?.byWarehouse ?? {},
      ownStock,
      chinaStock,
      inProduction,
      inTransit,
      totalAvailable,
      avgDailyDemand: Math.round(avgDailyDemand * 100) / 100,
      plannedDailyDemand: plannedDailyDemand > 0 ? Math.round(plannedDailyDemand * 100) / 100 : undefined,
      demandSource,
      sigmaDemand: Math.round(sigmaDemand * 100) / 100,
      daysLeft: Number.isFinite(daysLeft) ? Math.round(daysLeft * 10) / 10 : Number.POSITIVE_INFINITY,
      abcBucket,
      leadTimeDays,
      safetyStock,
      reorderPoint,
      recommendQty,
      recommendCost,
      costPerUnit,
      status,
      localizationPercent,
    });
  }

  // ---- KPI ---------------------------------------------------------------
  const wbStockTotal = items.reduce((sum, it) => sum + it.wbStock, 0);
  const ownStockTotal = items.reduce((sum, it) => sum + it.ownStock, 0);
  const chinaStockTotal = items.reduce((sum, it) => sum + it.chinaStock, 0);
  const inProductionTotal = items.reduce((sum, it) => sum + it.inProduction, 0);
  const inTransitTotal = items.reduce((sum, it) => sum + it.inTransit, 0);
  const allStockTotal = wbStockTotal + ownStockTotal + chinaStockTotal + inProductionTotal + inTransitTotal;

  const criticalItems = items.filter((it) => it.status === 'critical');
  const warningItems = items.filter((it) => it.status === 'warning');
  const okItems = items.filter((it) => it.status === 'ok');
  const overstockItems = items.filter((it) => it.status === 'overstock');

  const urgentBuyTotalRub = criticalItems.reduce(
    (sum, it) => sum + (it.recommendCost ?? 0),
    0,
  );

  let worstSku: StocksV2Kpi['worstSku'] = null;
  for (const it of criticalItems) {
    if (worstSku == null || it.daysLeft < worstSku.daysLeft) {
      worstSku = { nmId: it.nmId, vendorCode: it.vendorCode, daysLeft: it.daysLeft };
    }
  }

  // Средневзвешенное по объёму заказов — WB показывает в кабинете именно так.
  // Если у всех SKU order_count = 0 (свежий магазин без продаж), фолбэк на
  // простое среднее, чтобы не получить NaN.
  let weightedNumerator = 0;
  let weightedDenominator = 0;
  let plainSum = 0;
  let plainCount = 0;
  for (const entry of localizationByNm.values()) {
    weightedNumerator += entry.pct * entry.orders;
    weightedDenominator += entry.orders;
    plainSum += entry.pct;
    plainCount += 1;
  }
  const avgLocalizationPercent = weightedDenominator > 0
    ? Math.round((weightedNumerator / weightedDenominator) * 10) / 10
    : plainCount > 0
      ? Math.round((plainSum / plainCount) * 10) / 10
      : null;

  const kpi: StocksV2Kpi = {
    totalSkus: items.length,
    wbStockTotal,
    ownStockTotal,
    chinaStockTotal,
    inProductionTotal,
    inTransitTotal,
    allStockTotal,
    urgentBuyTotalRub: Math.round(urgentBuyTotalRub * 100) / 100,
    urgentSkuCount: criticalItems.length,
    warningSkuCount: warningItems.length,
    okSkuCount: okItems.length,
    overstockSkuCount: overstockItems.length,
    worstSku,
    avgLocalizationPercent,
  };

  // ---- Regions -----------------------------------------------------------
  // Демангд по ФО — нормализуем имена WB API (Юг+СКФО объединяем в один).
  const demandByFo = new Map<string, number>();
  let totalRegionalDemand = 0;
  for (const row of regionRows as unknown as Array<{ fo_name: unknown; qty: unknown }>) {
    const rawFo = typeof row.fo_name === 'string' && row.fo_name.length > 0 ? row.fo_name : 'Без региона';
    const foName = rawFo === 'Без региона' ? 'Другие' : normalizeWbFoName(rawFo);
    const qty = toNumeric(row.qty);
    demandByFo.set(foName, (demandByFo.get(foName) ?? 0) + qty);
    totalRegionalDemand += qty;
  }

  // Остатки по ФО — мапим warehouseName → ФО.
  // Приоритет: 1) auto-mapping из БД (доминирующий регион заказов); 2) хардкод
  // словарь по триггерам в названии (warehouse-fo.ts).
  const officeFoFromDb = new Map<string, string>();
  for (const row of officeFoRows as unknown as Array<{ office_name: unknown; fo_name: unknown }>) {
    const office = typeof row.office_name === 'string' ? row.office_name : '';
    const rawFo = typeof row.fo_name === 'string' ? row.fo_name : '';
    if (!office || !rawFo) continue;
    officeFoFromDb.set(office, normalizeWbFoName(rawFo));
  }
  const resolveFo = (warehouseName: string): string => {
    const fromDb = officeFoFromDb.get(warehouseName);
    if (fromDb) return fromDb;
    return resolveWarehouseFo(warehouseName);
  };

  const stocksByFo = new Map<string, number>();
  const warehousesByFo = new Map<string, Set<string>>();
  for (const entry of wbStocksByNm.values()) {
    for (const [wh, qty] of Object.entries(entry.byWarehouse)) {
      const fo = resolveFo(wh);
      if (fo === 'Виртуальный') continue;
      stocksByFo.set(fo, (stocksByFo.get(fo) ?? 0) + qty);
      if (!warehousesByFo.has(fo)) warehousesByFo.set(fo, new Set());
      warehousesByFo.get(fo)!.add(wh);
    }
  }

  // Объединяем ФО из обоих источников (демангд + остатки).
  const allFos = new Set<string>([...demandByFo.keys(), ...stocksByFo.keys()]);
  const regions: StocksV2RegionRow[] = Array.from(allFos)
    .map((foName) => ({
      foName,
      demandShare: totalRegionalDemand > 0 ? (demandByFo.get(foName) ?? 0) / totalRegionalDemand : 0,
      wbStockInDistrict: stocksByFo.get(foName) ?? 0,
      warehouseNames: Array.from(warehousesByFo.get(foName) ?? []).sort((a, b) => a.localeCompare(b, 'ru')),
    }))
    .sort((a, b) => b.demandShare - a.demandShare);

  // ---- Localization trend ------------------------------------------------
  const localizationTrend = (localizationTrendRows as unknown as Array<{
    week_start: unknown; avg_pct: unknown; nm_count: unknown;
  }>)
    .map((row) => {
      const ws = row.week_start instanceof Date
        ? row.week_start.toISOString().slice(0, 10)
        : typeof row.week_start === 'string'
          ? row.week_start.slice(0, 10)
          : '';
      return {
        weekStart: ws,
        ilPercent: Math.round(toNumeric(row.avg_pct) * 10) / 10,
        nmCount: Math.trunc(toNumeric(row.nm_count)),
      };
    })
    .filter((p) => p.weekStart);

  return {
    generatedAt: new Date().toISOString(),
    demandPeriod: {
      from: toIsoDayUtc(demandFrom),
      to: toIsoDayUtc(demandTo),
      days: demandPeriodDays,
    },
    planning: {
      targetDays,
      leadTimeDays,
    },
    kpi,
    items,
    regions,
    localizationTrend,
  };
}
