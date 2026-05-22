/**
 * Shared types for the Stocks 2.0 service (P87).
 *
 * Returned by `getStocksV2()` and consumed by `/api/views/stocks-v2` route +
 * the new UI client. Kept separate from the service implementation so types
 * can be imported without pulling in the whole service.
 */

import type { AbcBucket, StockStatus } from './forecasting';

export type StockSkuRow = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
  // Layered availability ----------------------------------------------------
  /** Что лежит на WB складах сейчас. */
  wbStock: number;
  /** На каждом физ.складе WB (для heatmap). */
  wbStockByWarehouse: Record<string, number>;
  /** Что физически у нас на собственном складе (sum remainingQuantity). */
  ownStock: number;
  /** Что готово на складе в Китае (sum remainingQuantity). */
  chinaStock: number;
  /** Что в производстве (production_orders status='ordered'|'in_production'). */
  inProduction: number;
  /** Что в пути (production_orders status='shipped'|'customs'). */
  inTransit: number;
  /** Сумма всех слоёв. */
  totalAvailable: number;
  // Demand & forecasting ----------------------------------------------------
  /** Средний дневной спрос (EWMA over last 30d funnel orders). */
  avgDailyDemand: number;
  /** Если есть активный план продаж, это дневной спрос из плана. */
  plannedDailyDemand?: number;
  /** Откуда взят спрос для расчёта покрытия и закупки. */
  demandSource?: 'history' | 'sales_plan';
  /** Std dev of daily demand. */
  sigmaDemand: number;
  /** Сколько дней ещё хватит запаса. Infinity если спрос 0. */
  daysLeft: number;
  abcBucket: AbcBucket;
  // Planning ---------------------------------------------------------------
  /** Срок поставки в днях (lead time). */
  leadTimeDays: number;
  /** Целевой страховой запас. */
  safetyStock: number;
  /** Reorder point. */
  reorderPoint: number;
  /** Сколько докупить чтобы покрыть target days + safety. */
  recommendQty: number;
  /** Полная стоимость партии по себестоимости из раздела "Себестоимость" (recommendQty × costPerUnit). */
  recommendCost: number | null;
  /** Полная себестоимость единицы: закупка + доставка до ФФ + упаковка + фулфилмент + доставка до ВБ. */
  costPerUnit: number | null;
  // Status -----------------------------------------------------------------
  status: StockStatus;
  // Localization -----------------------------------------------------------
  /** Доля локальных заказов (0..100) per nmId из funnel_stats. NULL если данных нет. */
  localizationPercent: number | null;
};

export type StocksV2Kpi = {
  totalSkus: number;
  wbStockTotal: number;
  ownStockTotal: number;
  chinaStockTotal: number;
  /** WB + свой склад + Китай + производство + в пути. */
  allStockTotal: number;
  inProductionTotal: number;
  inTransitTotal: number;
  /** Сумма recommendCost по всем SKU где status=critical. */
  urgentBuyTotalRub: number;
  urgentSkuCount: number;
  warningSkuCount: number;
  okSkuCount: number;
  overstockSkuCount: number;
  /** Худший SKU: SKU с минимальным daysLeft (только для status=critical). */
  worstSku: { nmId: number; vendorCode: string | null; daysLeft: number } | null;
  /** Средний по тенанту processing локализации (если данные есть). */
  avgLocalizationPercent: number | null;
};

export type StocksV2RegionRow = {
  /** Federal district name from raw_api_region_sales.foName. */
  foName: string;
  /** Доля заказов в этом FD от общего. 0..1. */
  demandShare: number;
  /** Сумма WB-остатков по физ.складам в этом FD. */
  wbStockInDistrict: number;
  /** Имена физ.складов WB которые принадлежат этому FD. */
  warehouseNames: string[];
};

export type StocksV2LocalizationTrendPoint = {
  /** ISO date YYYY-MM-DD — начало недели. */
  weekStart: string;
  /** Средневзвешенный ИЛ в этой неделе по тенанту, 0..100. */
  ilPercent: number;
  /** Сколько SKU участвовало в среднем (для контекста). */
  nmCount: number;
};

export type StocksV2Payload = {
  generatedAt: string;
  /** Период за который считали спрос. */
  demandPeriod: { from: string; to: string; days: number };
  /** Глобальные параметры планирования. */
  planning: {
    targetDays: number;
    leadTimeDays: number;
  };
  kpi: StocksV2Kpi;
  items: StockSkuRow[];
  regions: StocksV2RegionRow[];
  /** Динамика среднего ИЛ за последние ~13 недель (по понедельникам). */
  localizationTrend: StocksV2LocalizationTrendPoint[];
};
