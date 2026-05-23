import { db, withTenantContext } from "@/lib/db";
import { sql, and, eq, notInArray } from "drizzle-orm";
import { rawApiProductMetadata, rawApiStocks, riskSignals } from "@/lib/db/schema";
import { subDays } from "date-fns";
import { calculateTax } from "@/lib/tax/regimes";
import {
  safeNumber,
  parseNumeric,
  parseNullableNumeric,
  safeNullableNumber,
  roundFinancial,
  roundFinancialNullable,
} from "./helpers/numeric";
import * as SignalSavedViewsService from "./services/signal-saved-views";
import * as SignalNotificationsService from "./services/signal-notifications";
import * as SignalAutomationQueriesService from "./services/signal-automation-queries";
import * as SignalCoreService from "./services/signal-core";
import * as SignalSlaExecutionService from "./services/signal-sla-execution";
import * as SignalFeedService from "./services/signal-feed";

import type { SignalDetailViewer } from "./services/signal-automation-queries";

import * as EconomicsService from "./services/economics";
import {
  buildFullLandedCostSql,
  buildOperationalTailComponentSql,
  buildOperationalTailOtherFeesSql,
  buildOperationalTailPayoutBeforeCostSql,
  buildOperationalTailRatesSelectSql,
  buildWbPayoutBeforeCostSql,
} from "./services/economics";
import type { EconomicsCalculationMode } from "./services/economics";
export type {
  EconomicsCalculationMode,
  DataTrustStatus,
  DataTrustCheck,
  DashboardDataTrustAudit,
} from "./services/economics";

type NumericLike = number | string | null | undefined;

type GroupDynamicsRawRow = {
  day: string;
  nmId: number;
  tax_type: string | null;
  tax_rate: NumericLike;
  vat_mode: string | null;
  vat_rate: NumericLike;
  revenue: NumericLike;
  soldQty: NumericLike;
  financeRevenue: NumericLike;
  financeSoldQty: NumericLike;
  opProfit: NumericLike;
  costTotal: NumericLike;
  orderProjectedQty: NumericLike;
  orderProjectedRevenue: NumericLike;
  orderTurnoverBeforeSpp: NumericLike;
  orderRevenueAfterSpp: NumericLike;
  orderProjectedOpProfit: NumericLike;
  orderProjectedCostTotal: NumericLike;
  orderProjectedLogistics: NumericLike;
  orderProjectedLogisticsRate: NumericLike;
  orderProjectedLogisticsSource: string | null;
  orderWarehouseLogistics: NumericLike;
  orderWarehouseLogisticsCoveragePercent: NumericLike;
  commission: NumericLike;
  logistics: NumericLike;
  wbStorageFee: NumericLike;
  wbAcquiringFee: NumericLike;
  wbAdditionalPayment: NumericLike;
  provisionalOtherFees: NumericLike;
  orderQty: NumericLike;
  orderRevenue: NumericLike;
  funnelViewQty: NumericLike;
  funnelAddToCartQty: NumericLike;
  funnelOrderQty: NumericLike;
  funnelOrderRevenue: NumericLike;
  funnelCancelQty: NumericLike;
  funnelBuyoutQty: NumericLike;
  funnelBuyoutRevenue: NumericLike;
  funnelAvgPrice: NumericLike;
  funnelAddToCartPercent: NumericLike;
  funnelCartToOrderPercent: NumericLike;
  funnelOrderToBuyoutPercent: NumericLike;
  buyoutPercentWb: NumericLike;
  manualBuyoutPercent: NumericLike;
  effectiveBuyoutPercent: NumericLike;
  adSpend: NumericLike;
  adOrderSum: NumericLike;
  adViews: NumericLike;
  adClicks: NumericLike;
  adCtrSource: NumericLike;
  storageCost: NumericLike;
  currentSpp: NumericLike;
  currentPrice: NumericLike;
  sellerPriceAfterDiscount: NumericLike;
  priceAfterSpp: NumericLike;
  stockCount: NumericLike;
  toClientCount: NumericLike;
  fromClientCount: NumericLike;
  lostOrdersCount: NumericLike;
  avgStockTurnoverDays: NumericLike;
  saleRateDays: NumericLike;
  [key: string]: unknown;
};

type GroupDayMetrics = {
  revenue: number;
  soldQty: number;
  financeRevenue: number;
  financeSoldQty: number;
  opProfit: number;
  costTotal: number;
  orderProjectedQty: number;
  orderProjectedRevenue: number;
  orderTurnoverBeforeSpp: number;
  orderRevenueAfterSpp: number;
  orderProjectedOpProfit: number;
  orderProjectedCostTotal: number;
  orderProjectedLogistics: number;
  orderProjectedLogisticsRate: number | null;
  orderProjectedLogisticsSource?: string | null;
  orderWarehouseLogistics: number;
  orderWarehouseLogisticsCoveragePercent: number | null;
  orderWarehouseLogisticsCoverageCount?: number;
  orderWarehouseLogisticsCoverageWeight?: number;
  orderProjectedNetProfit: number;
  commission: number;
  logistics: number;
  wbStorageFee: number;
  wbAcquiringFee: number;
  wbAdditionalPayment: number;
  provisionalOtherFees: number;
  orderQty: number | null;
  orderRevenue: number | null;
  adSpend: number;
  adOrderSum: number;
  adViews: number;
  adClicks: number;
  adCtr?: number | null;
  adCtrSource?: number | null;
  adCtrSourceCount?: number;
  storageCost: number;
  currentSpp: number | null;
  currentPrice: number | null;
  sellerPriceAfterDiscount: number | null;
  priceAfterSpp: number | null;
  stockCount: number | null;
  toClientCount: number | null;
  fromClientCount: number | null;
  lostOrdersCount: number | null;
  avgStockTurnoverDays: number | null;
  saleRateDays: number | null;
  funnelViewQty: number | null;
  funnelAddToCartQty: number | null;
  funnelOrderQty: number | null;
  funnelOrderRevenue: number | null;
  funnelCancelQty: number | null;
  funnelBuyoutQty: number | null;
  funnelBuyoutRevenue: number | null;
  funnelAvgPrice: number | null;
  funnelAddToCartPercent: number | null;
  funnelCartToOrderPercent: number | null;
  funnelOrderToBuyoutPercent: number | null;
  funnelImpressionsQty?: number | null;
  funnelImpressionsOpenCard?: number | null;
  buyoutPercentWb?: number | null;
  manualBuyoutPercent?: number | null;
  effectiveBuyoutPercent?: number | null;
  netProfit: number;
  netProfitBeforeAds?: number;
  drr?: number | null;
  buyoutPercent?: number | null;
  avgOrderPrice?: number | null;
  avgBuyoutPrice?: number | null;
  profitPerUnit?: number | null;
};

type GroupSkuDayMetrics = Record<string, unknown> & {
  revenue: number;
  soldQty: number;
  financeRevenue: number;
  financeSoldQty: number;
  opProfit: number;
  costTotal: number;
  orderProjectedQty: number;
  orderProjectedRevenue: number;
  orderTurnoverBeforeSpp: number;
  orderRevenueAfterSpp: number;
  orderProjectedOpProfit: number;
  orderProjectedCostTotal: number;
  orderProjectedLogistics: number;
  orderProjectedLogisticsRate: number | null;
  orderProjectedLogisticsSource?: string | null;
  orderWarehouseLogistics: number;
  orderWarehouseLogisticsCoveragePercent: number | null;
  orderProjectedNetProfit: number;
  commission: number;
  logistics: number;
  wbStorageFee: number;
  wbAcquiringFee: number;
  wbAdditionalPayment: number;
  provisionalOtherFees: number;
  orderQty: number | null;
  orderRevenue: number | null;
  funnelViewQty: number | null;
  funnelAddToCartQty: number | null;
  funnelOrderQty: number | null;
  funnelOrderRevenue: number | null;
  funnelCancelQty: number | null;
  funnelBuyoutQty: number | null;
  funnelBuyoutRevenue: number | null;
  funnelAvgPrice: number | null;
  funnelAddToCartPercent: number | null;
  funnelCartToOrderPercent: number | null;
  funnelOrderToBuyoutPercent: number | null;
  funnelImpressionsQty?: number | null;
  funnelImpressionsOpenCard?: number | null;
  adSpend: number;
  adOrderSum: number;
  adViews: number;
  adClicks: number;
  adCtr?: number | null;
  storageCost: number;
  currentSpp: number | null;
  currentPrice: number | null;
  sellerPriceAfterDiscount: number | null;
  priceAfterSpp: number | null;
  stockCount: number | null;
  toClientCount: number | null;
  fromClientCount: number | null;
  lostOrdersCount: number | null;
  avgStockTurnoverDays: number | null;
  saleRateDays: number | null;
  netProfit: number;
  netProfitBeforeAds?: number;
  drr?: number | null;
  buyoutPercent?: number | null;
  buyoutPercentWb?: number | null;
  manualBuyoutPercent?: number | null;
  effectiveBuyoutPercent?: number | null;
  avgOrderPrice?: number | null;
  avgBuyoutPrice?: number | null;
  profitPerUnit?: number | null;
};

type DetectedRiskSignal = {
  tenantId: string;
  signalKey: string;
  nmId: number;
  type: "negative_margin" | "ads_leak" | "stock_out" | "logistics_spike" | "content_risk" | "seo_risk";
  title: string;
  severity: "critical" | "high" | "medium";
  description: string;
  impactRub: string;
  status: "active";
};

function buildSkuSignalKey(nmId: number, issueCode: string) {
  return `sku:${nmId}:${issueCode}`;
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

function buildManualActiveScenarioBuyoutSql(manualAlias = "mi") {
  const activeScenario = `
    CASE
      WHEN ${manualAlias}.manual_fields ->> 'activePriceScenarioId' IN ('excellent', 'good', 'average', 'poor')
        THEN ${manualAlias}.manual_fields ->> 'activePriceScenarioId'
      ELSE 'average'
    END
  `;

  return buildJsonbNumericSql(`${manualAlias}.manual_fields #>> ARRAY['priceScenarios', ${activeScenario}, 'buyoutPercent']`);
}

function buildDynamicsWbBaseUpToOneLiterSql(volumeExpr: string) {
  return `
    CASE
      WHEN COALESCE(${volumeExpr}, 0) <= 0 THEN 0
      WHEN COALESCE(${volumeExpr}, 0) <= 0.200 THEN 23
      WHEN COALESCE(${volumeExpr}, 0) <= 0.400 THEN 26
      WHEN COALESCE(${volumeExpr}, 0) <= 0.600 THEN 29
      WHEN COALESCE(${volumeExpr}, 0) <= 0.800 THEN 30
      WHEN COALESCE(${volumeExpr}, 0) <= 1.000 THEN 32
      ELSE 0
    END
  `;
}

function buildDynamicsTariffCoefMultiplierSql(tariffItemExpr: string, fieldName: string) {
  const raw = `COALESCE(NULLIF(${tariffItemExpr} ->> '${fieldName}', '')::numeric, 0)`;
  return `
    CASE
      WHEN ${raw} <= 0 THEN 0
      WHEN ${raw} > 10 THEN ${raw} / 100
      ELSE ${raw}
    END
  `;
}

function buildDynamicsLocalityMultiplierSql(localizationExpr: string) {
  return `
    CASE
      WHEN ${localizationExpr} IS NULL THEN 1
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 95 THEN 0.50
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 90 THEN 0.60
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 85 THEN 0.70
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 80 THEN 0.80
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 75 THEN 0.90
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 60 THEN 1.00
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 55 THEN 1.05
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 50 THEN 1.10
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 45 THEN 1.20
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 40 THEN 1.30
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 35 THEN 1.40
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 30 THEN 1.50
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 25 THEN 1.55
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 20 THEN 1.60
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 15 THEN 1.70
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 10 THEN 1.75
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 5 THEN 1.80
      ELSE 2.00
    END
  `;
}

function buildDynamicsKrpPercentSql(localizationExpr: string) {
  return `
    CASE
      WHEN ${localizationExpr} IS NULL THEN 0
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) >= 60 THEN 0
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) < 5 THEN 2.5
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) < 10 THEN 2.45
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) < 15 THEN 2.35
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) < 20 THEN 2.3
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) < 25 THEN 2.25
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) < 30 THEN 2.2
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) < 35 THEN 2.15
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) < 45 THEN 2.1
      WHEN LEAST(100, GREATEST(0, ${localizationExpr})) < 55 THEN 2.05
      ELSE 2
    END
  `;
}

function buildDynamicsForwardLogisticsSql(
  volumeExpr: string,
  tariffItemExpr: string,
  localizationExpr: string,
  priceBeforeWbDiscountExpr: string,
) {
  const volume = `COALESCE(${volumeExpr}, 0)::numeric`;
  const upToOneLiterBase = buildDynamicsWbBaseUpToOneLiterSql(volume);
  const deliveryCoefMultiplier = buildDynamicsTariffCoefMultiplierSql(tariffItemExpr, "boxDeliveryCoefExpr");
  const localityMultiplier = buildDynamicsLocalityMultiplierSql(localizationExpr);
  const krpPercent = buildDynamicsKrpPercentSql(localizationExpr);
  const forwardBase = `
    CASE
      WHEN ${volume} > 0 AND ${volume} <= 1 THEN
        (${upToOneLiterBase}) * (${deliveryCoefMultiplier})
      WHEN ${volume} > 1 THEN
        COALESCE(NULLIF(${tariffItemExpr} ->> 'boxDeliveryBase', '')::numeric, 0)
        + GREATEST(${volume} - 1, 0)
          * COALESCE(NULLIF(${tariffItemExpr} ->> 'boxDeliveryLiter', '')::numeric, 0)
      ELSE 0
    END
  `;

  return `
    (
      (${forwardBase}) * (${localityMultiplier})
      + CASE
          WHEN COALESCE(${priceBeforeWbDiscountExpr}, 0) > 0
            THEN COALESCE(${priceBeforeWbDiscountExpr}, 0) * ((${krpPercent}) / 100)
          ELSE 0
        END
    )
  `;
}

function normalizeAdCtrPercent(clicks: number, views: number, sourceCtr: number | null = null): number | null {
  if (views > 0 && clicks >= 0 && clicks <= views) {
    return safeNumber((clicks / views) * 100);
  }

  if (sourceCtr !== null && sourceCtr > 0 && sourceCtr <= 100) {
    return sourceCtr;
  }

  return null;
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addIsoDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function maxIsoDate(left: string, right: string) {
  return left > right ? left : right;
}


export class AnalyticsEngine {
  static getDailyPnL = EconomicsService.getDailyPnL;
  static getUnitEconomics = EconomicsService.getUnitEconomics;
  static getNetProfitBreakdown = EconomicsService.getNetProfitBreakdown;
  static getOrderHighlights = EconomicsService.getOrderHighlights;
  static getKpis = EconomicsService.getKpis;
  static getDashboardDataTrust = EconomicsService.getDashboardDataTrust;


  /**
   * Получить список активных сигналов (Leaks/Risks)
   */
  static getActiveSignals = SignalCoreService.getActiveSignals;
  static recordSignalTimelineEvent = SignalCoreService.recordSignalTimelineEvent;
  static recordSignalView = SignalCoreService.recordSignalView;
  static getSignalTimeline = SignalCoreService.getSignalTimeline;
  static getSignalWorkflowMembers = SignalCoreService.getSignalWorkflowMembers;
  static getLatestSignalEscalations = SignalCoreService.getLatestSignalEscalations;


  static previewSignalSlaAutomation = SignalSlaExecutionService.previewSignalSlaAutomation;
  static setSignalAutomationSuppression = SignalSlaExecutionService.setSignalAutomationSuppression;
  static clearSignalAutomationSuppression = SignalSlaExecutionService.clearSignalAutomationSuppression;
  static captureSignalFollowUpResolution = SignalSlaExecutionService.captureSignalFollowUpResolution;

  static getSignalsFeed = SignalFeedService.getSignalsFeed;
  static bulkAssignSignalOwner = SignalFeedService.bulkAssignSignalOwner;
  static bulkUpdateSignalWorkflowState = SignalFeedService.bulkUpdateSignalWorkflowState;
  static bulkAddSignalNote = SignalFeedService.bulkAddSignalNote;
  static bulkApplySignalHandoffPreset = SignalFeedService.bulkApplySignalHandoffPreset;

  static runSignalSlaAutomation = SignalSlaExecutionService.runSignalSlaAutomation;
  static runSignalSlaPendingFollowUp = SignalSlaExecutionService.runSignalSlaPendingFollowUp;
  static runSignalSlaPendingFollowUpSweep = SignalSlaExecutionService.runSignalSlaPendingFollowUpSweep;

  static bulkUpdateSignalStatus = SignalFeedService.bulkUpdateSignalStatus;

  static dispatchSignalCollaborationNotification = SignalFeedService.dispatchSignalCollaborationNotification;

  static getSignalDetails(
    tenantId: string,
    signalId: string,
    options?: {
      viewer?: SignalDetailViewer;
    }
  ) {
    return SignalCoreService.getSignalDetails(tenantId, signalId, {
      ...options,
      getUnitEconomics: EconomicsService.getUnitEconomics,
    });
  }

  static assignSignalOwner = SignalCoreService.assignSignalOwner;
  static updateSignalWorkflowState = SignalCoreService.updateSignalWorkflowState;
  static addSignalNote = SignalCoreService.addSignalNote;
  static updateSignalStatus = SignalCoreService.updateSignalStatus;

  /**
   * Детектор Утечек (Risk Signals): Автоматический поиск проблемных SKU и сохранение в БД
   */
  static async getSignals(tenantId: string): Promise<DetectedRiskSignal[]> {
    // Берем данные за последние 14 дней для анализа аномалий
    const dateTo = new Date();
    const dateFrom = subDays(dateTo, 14);

    const data = await this.getUnitEconomics(tenantId, dateFrom, dateTo);
    const stocks = await withTenantContext(db, tenantId, (tx) =>
      tx.select().from(rawApiStocks).where(eq(rawApiStocks.tenantId, tenantId)),
    );

    const signals: DetectedRiskSignal[] = [];

    for (const row of data) {
      const netProfit = parseNumeric(row.netProfit);
      const grossRevenue = parseNumeric(row.grossRevenue);
      const adSpend = parseNumeric(row.adSpend);
      const soldQuantity = Math.round(parseNumeric(row.soldQuantity));
      const acos = grossRevenue > 0 ? (adSpend / grossRevenue) * 100 : 0;

      const avgLogistics = soldQuantity > 0 ? parseNumeric(row.logistics) / soldQuantity : 0;

      // 1. Детектор отрицательной маржи (Negative Margin)
      if (netProfit < 0 && soldQuantity > 0) {
        signals.push({
          tenantId,
          signalKey: buildSkuSignalKey(row.nmId, "negative_margin"),
          nmId: row.nmId,
          type: 'negative_margin',
          title: 'Отрицательная прибыль',
          severity: 'critical',
          description: `Товар уходит в минус на ${Math.abs(netProfit).toLocaleString()} ₽. Проверьте себестоимость и цену.`,
          impactRub: netProfit.toString(),
          status: 'active'
        });
      }

      // 2. Детектор рекламных утечек (Ads Leak)
      if (adSpend > 0 && acos > 45) {
        signals.push({
          tenantId,
          signalKey: buildSkuSignalKey(row.nmId, "ads_leak"),
          nmId: row.nmId,
          type: 'ads_leak',
          title: 'Рекламная утечка',
          severity: 'high',
          description: `ДРР составляет ${acos.toFixed(1)}%. Реклама съедает слишком много прибыли.`,
          impactRub: (-adSpend).toString(),
          status: 'active'
        });
      }

      // 3. Прогноз стока (Stock-out Prediction)
      const currentStock = stocks
        .filter((stock) => stock.nmId === row.nmId)
        .reduce((acc, stock) => acc + parseNumeric(stock.amount), 0);
      const velocity = soldQuantity / 14;
      const daysLeft = velocity > 0 ? currentStock / velocity : 999;

      if (daysLeft < 4 && currentStock > 0) {
        signals.push({
          tenantId,
          signalKey: buildSkuSignalKey(row.nmId, "stock_out"),
          nmId: row.nmId,
          type: 'stock_out',
          title: 'Заканчивается остаток',
          severity: 'high',
          description: `Текущего запаса (${currentStock} шт.) хватит примерно на ${Math.round(daysLeft)} дн. Пора сделать заказ!`,
          impactRub: '0',
          status: 'active'
        });
      }

      // 4. Детектор логистических аномалий (Logistics Spike)
      if (avgLogistics > 250) {
         signals.push({
           tenantId,
           signalKey: buildSkuSignalKey(row.nmId, "logistics_spike"),
           nmId: row.nmId,
           type: 'logistics_spike',
           title: 'Дорогая логистика',
           severity: 'medium',
           description: `Ср. стоимость доставки единицы: ${avgLogistics.toFixed(0)} ₽. Проверьте замеры габаритов (КГТ?) на ВБ.`,
           impactRub: '0',
           status: 'active'
         });
      }
    }

    // 5. SEO & Content Audit
    const metadata = await withTenantContext(db, tenantId, (tx) =>
      tx.select().from(rawApiProductMetadata).where(eq(rawApiProductMetadata.tenantId, tenantId)),
    );

    for (const meta of metadata) {
       // Content Audit
       if (meta.photosCount < 5) {
          signals.push({
            tenantId,
            signalKey: buildSkuSignalKey(meta.nmId, "content:low_photo_count"),
            nmId: meta.nmId,
            type: 'content_risk',
            title: 'Мало фотографий',
            severity: 'medium',
            description: `У вас всего ${meta.photosCount} фото. Для высокого доверия и конверсии ВБ рекомендует минимум 5.`,
            impactRub: '0',
            status: 'active'
          });
       }
       if (!meta.hasVideo) {
          signals.push({
            tenantId,
            signalKey: buildSkuSignalKey(meta.nmId, "content:missing_video"),
            nmId: meta.nmId,
            type: 'content_risk',
            title: 'Нет видео-обзора',
            severity: 'medium',
            description: `Видео увеличивает конверсию в корзину на 20-30%. Рекомендуем добавить ролик.`,
            impactRub: '0',
            status: 'active'
          });
       }

       // SEO Audit
       const titleLen = meta.title?.length || 0;
       if (titleLen > 0 && titleLen < 45) {
          signals.push({
            tenantId,
            signalKey: buildSkuSignalKey(meta.nmId, "seo:short_title"),
            nmId: meta.nmId,
            type: 'seo_risk',
            title: 'Короткий заголовок',
            severity: 'medium',
            description: `Ваш заголовок (${titleLen} симв.) слишком короткий для SEO. Добавьте ключевые слова.`,
            impactRub: '0',
            status: 'active'
          });
       }
    }

    const uniqueSignals = Array.from(new Map(signals.map((signal) => [signal.signalKey, signal])).values());
    const detectedSignalKeys = uniqueSignals.map((signal) => signal.signalKey);
    const detectorHasSourceData = data.length > 0 || stocks.length > 0 || metadata.length > 0;

    if (uniqueSignals.length > 0 || detectorHasSourceData) {
      await withTenantContext(db, tenantId, async (tx) => {
        const existingRows = await tx
          .select({
            id: riskSignals.id,
            signalKey: riskSignals.signalKey,
            status: riskSignals.status,
          })
          .from(riskSignals)
          .where(eq(riskSignals.tenantId, tenantId));
        const existingByKey = new Map(existingRows.map((row) => [row.signalKey, row]));

        for (const signal of uniqueSignals) {
          const existing = existingByKey.get(signal.signalKey);
          if (!existing) {
            await tx.insert(riskSignals).values(signal);
            continue;
          }

          const signalContent = {
            nmId: signal.nmId,
            type: signal.type,
            title: signal.title,
            severity: signal.severity,
            description: signal.description,
            impactRub: signal.impactRub,
          };

          if (existing.status === "ignored") {
            await tx
              .update(riskSignals)
              .set(signalContent)
              .where(and(eq(riskSignals.id, existing.id), eq(riskSignals.tenantId, tenantId)));
            continue;
          }

          await tx
            .update(riskSignals)
            .set({
              ...signalContent,
              status: "active",
              resolvedAt: null,
              ...(existing.status === "active"
                ? {}
                : {
                  workflowState: "new",
                  assigneeUserId: null,
                  assigneeEmail: null,
                  workflowUpdatedAt: null,
                  workflowUpdatedByUserId: null,
                  workflowUpdatedByEmail: null,
                }),
            })
            .where(and(eq(riskSignals.id, existing.id), eq(riskSignals.tenantId, tenantId)));
        }

        if (detectorHasSourceData) {
          const staleActiveWhere = detectedSignalKeys.length > 0
            ? and(
              eq(riskSignals.tenantId, tenantId),
              eq(riskSignals.status, "active"),
              notInArray(riskSignals.signalKey, detectedSignalKeys),
            )
            : and(
              eq(riskSignals.tenantId, tenantId),
              eq(riskSignals.status, "active"),
            );

          await tx
            .update(riskSignals)
            .set({
              status: "resolved",
              resolvedAt: new Date(),
            })
            .where(staleActiveWhere);
        }
      });
    }

    return uniqueSignals;
  }

  /**
   * Глубокая Аналитика Группы (Склейки) с ежедневной детализацией
   */
  static async getGroupDynamics(
    tenantId: string,
    groupId: string,
    dateFrom: Date,
    dateTo: Date,
    options?: {
      calculationMode?: EconomicsCalculationMode | string | null;
      includeOperationalTail?: boolean | null;
    },
  ) {
    const fromStr = dateFrom.toISOString();
    const toStr = dateTo.toISOString();
    const fromDate = toIsoDate(dateFrom);
    const toDate = toIsoDate(dateTo);
    const calculationMode = EconomicsService.resolveEconomicsCalculationMode(options?.calculationMode);
    const includeOperationalTail = options?.includeOperationalTail ?? true;

    // 1. Получаем список артикулов в группе
    const members = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
      SELECT gm.nm_id
      FROM product_group_members gm
      JOIN product_groups pg ON pg.id = gm.group_id
      WHERE gm.group_id = ${groupId}
        AND pg.tenant_id = ${tenantId}
    `));
    const nmIds = (members as unknown as Array<{ nm_id: number }>).map((member) => Number(member.nm_id));
    if (nmIds.length === 0) return { days: [], group: {}, skus: {} };
    const nmIdList = sql.join(nmIds.map((nmId) => sql`${nmId}`), sql`, `);
    const cutoffRows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
      SELECT TO_CHAR(MAX(date_to)::date, 'YYYY-MM-DD') as cutoff_date
      FROM raw_api_realization_reports
      WHERE tenant_id = ${tenantId}
        AND nm_id IN (${nmIdList})
    `));
    const realizationCutoffDate = (
      (cutoffRows as unknown as Array<{ cutoff_date: string | null }>)[0]?.cutoff_date ?? null
    );
    const tailStartCandidate = realizationCutoffDate ? addIsoDays(realizationCutoffDate, 1) : fromDate;
    const operationalTailFrom = includeOperationalTail && tailStartCandidate <= toDate
      ? maxIsoDate(tailStartCandidate, fromDate)
      : null;
    const includesOperationalTail = operationalTailFrom !== null && operationalTailFrom <= toDate;
    const historicalOrderLogisticsSql = buildOperationalTailComponentSql(
      "proj.expected_revenue_after_spp",
      "otr",
      "logistics_rate",
    );
    const tariffCoverageFractionSql = `
      COALESCE(
        LEAST(
          1,
          COALESCE(owl.tariff_order_qty, 0)
          / NULLIF(COALESCE(o.order_qty, owl.warehouse_order_qty, proj.order_qty, 0), 0)
        ),
        0
      )
    `;

    // 2. Основной SQL запрос для сбора ежедневной статистики по всем NM в группе
    const query = sql`
      WITH daily_base AS (
        -- Сетка дней для каждого артикула
        SELECT d::date as day_raw, n.nm_id
        FROM generate_series(${fromStr}::date, ${toStr}::date, '1 day'::interval) d
        CROSS JOIN (SELECT unnest(ARRAY[${nmIdList}]::bigint[]) as nm_id) n
      ),
      reconciliation_cutoff AS MATERIALIZED (
        SELECT COALESCE(MAX(date_to), '1970-01-01'::timestamp) as cutoff
        FROM raw_api_realization_reports
        WHERE tenant_id = ${tenantId}
          AND nm_id IN (${nmIdList})
      ),
      sku_operational_tail_rates AS MATERIALIZED (
        SELECT
          r.nm_id,
          ${sql.raw(buildOperationalTailRatesSelectSql("r"))}
        FROM raw_api_realization_reports r
        WHERE r.tenant_id = ${tenantId}
          AND r.nm_id IN (${nmIdList})
          AND COALESCE(r.sale_dt, r.date_from) >= (NOW() - INTERVAL '90 days')
        GROUP BY r.nm_id
      ),
      historical_logistics_by_sku AS MATERIALIZED (
        SELECT
          r.nm_id,
          AVG(r.delivery_rub) FILTER (WHERE COALESCE(r.delivery_rub, 0) > 0)::numeric as logistics_per_order
        FROM raw_api_realization_reports r
        WHERE r.tenant_id = ${tenantId}
          AND r.nm_id IN (${nmIdList})
          AND COALESCE(r.sale_dt, r.date_from) >= (NOW() - INTERVAL '90 days')
        GROUP BY r.nm_id
      ),
      historical_logistics_by_group AS MATERIALIZED (
        SELECT
          AVG(r.delivery_rub) FILTER (WHERE COALESCE(r.delivery_rub, 0) > 0)::numeric as logistics_per_buyout
        FROM raw_api_realization_reports r
        WHERE r.tenant_id = ${tenantId}
          AND r.nm_id IN (${nmIdList})
          AND COALESCE(r.sale_dt, r.date_from) >= (NOW() - INTERVAL '90 days')
      ),
      historical_order_logistics_rates AS MATERIALIZED (
        SELECT
          l.nm_id,
          l.logistics_per_order
        FROM historical_logistics_by_sku l
      ),
      latest_costs AS MATERIALIZED (
        SELECT
          cost_source.nm_id,
          (${sql.raw(buildFullLandedCostSql("mi", "c.cost_price"))})::numeric as full_cost
        FROM (
          SELECT unnest(ARRAY[${nmIdList}]::bigint[]) as nm_id
        ) cost_source
        LEFT JOIN LATERAL (
           SELECT cost_price FROM unit_economics_configs
           WHERE nm_id = cost_source.nm_id AND tenant_id = ${tenantId}
           ORDER BY effective_from DESC LIMIT 1
        ) c ON true
        LEFT JOIN unit_economics_manual_inputs mi
          ON mi.tenant_id = ${tenantId}
         AND mi.nm_id = cost_source.nm_id
      ),
      realization_dist AS (
        -- Распределяем отчеты на фактическое количество дней
        SELECT
          gs.day_raw::date,
          r.nm_id,
          (
            (
              CASE
                WHEN COALESCE(r.retail_amount, 0) <> 0 OR COALESCE(r.ppvz_for_pay, 0) <> 0
                  THEN r.quantity
                ELSE 0
              END
            )::numeric / GREATEST(1, (COALESCE(r.sale_dt, r.date_to)::date - COALESCE(r.sale_dt, r.date_from)::date + 1))
          ) as sold_qty,
          (r.retail_amount / GREATEST(1, (COALESCE(r.sale_dt, r.date_to)::date - COALESCE(r.sale_dt, r.date_from)::date + 1))) as revenue,
          ((${sql.raw(buildWbPayoutBeforeCostSql("r"))}) / GREATEST(1, (COALESCE(r.sale_dt, r.date_to)::date - COALESCE(r.sale_dt, r.date_from)::date + 1))) as op_profit,
          (COALESCE(r.commission_amount, 0) / GREATEST(1, (COALESCE(r.sale_dt, r.date_to)::date - COALESCE(r.sale_dt, r.date_from)::date + 1))) as commission,
          (COALESCE(r.delivery_rub, 0) / GREATEST(1, (COALESCE(r.sale_dt, r.date_to)::date - COALESCE(r.sale_dt, r.date_from)::date + 1))) as logistics,
          (COALESCE(r.storage_fee_rub, 0) / GREATEST(1, (COALESCE(r.sale_dt, r.date_to)::date - COALESCE(r.sale_dt, r.date_from)::date + 1))) as wb_storage_fee,
          (COALESCE(r.acquiring_fee, 0) / GREATEST(1, (COALESCE(r.sale_dt, r.date_to)::date - COALESCE(r.sale_dt, r.date_from)::date + 1))) as wb_acquiring_fee,
          0::numeric as wb_additional_payment, -- возмещение перевозки исключено из P&L (см. migration 0107)
          0::numeric as provisional_other_fees,
          (
            (
              (CASE
                WHEN COALESCE(r.retail_amount, 0) <> 0 OR COALESCE(r.ppvz_for_pay, 0) <> 0
                  THEN r.quantity
                ELSE 0
              END) * COALESCE(lc.full_cost, 0)
            ) / GREATEST(1, (COALESCE(r.sale_dt, r.date_to)::date - COALESCE(r.sale_dt, r.date_from)::date + 1))
          ) as cost_total
        FROM raw_api_realization_reports r
        CROSS JOIN LATERAL generate_series(COALESCE(r.sale_dt, r.date_from)::date, COALESCE(r.sale_dt, r.date_to)::date, '1 day'::interval) gs(day_raw)
        LEFT JOIN latest_costs lc ON lc.nm_id = r.nm_id
        WHERE r.tenant_id = ${tenantId}
          AND r.nm_id IN (${nmIdList})
          AND gs.day_raw::date >= ${fromStr}::date
          AND gs.day_raw::date <= ${toStr}::date
      ),
      provisional_sales AS (
        -- Operational finance tail beyond the last reconciled realization cutoff.
        -- Uses recent per-SKU WB fee rates and residual reserve instead of one margin ratio.
        SELECT
          s.date::date as day_raw,
          s.nm_id,
          COUNT(*)::numeric as sold_qty,
          SUM(s.price_with_discount)::numeric as revenue,
          SUM((${sql.raw(buildOperationalTailPayoutBeforeCostSql("s.price_with_discount", "m"))}))::numeric as op_profit,
          SUM((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "commission_rate"))}))::numeric as commission,
          SUM((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "logistics_rate"))}))::numeric as logistics,
          SUM((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "wb_storage_fee_rate"))}))::numeric as wb_storage_fee,
          SUM((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "acquiring_rate"))}))::numeric as wb_acquiring_fee,
          SUM((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "additional_payment_rate"))}))::numeric as wb_additional_payment,
          SUM((${sql.raw(buildOperationalTailComponentSql("s.price_with_discount", "m", "residual_rate", 0.25))}))::numeric as provisional_other_fees,
          SUM(COALESCE(lc.full_cost, 0))::numeric as cost_total
        FROM raw_api_sales s
        CROSS JOIN reconciliation_cutoff rc
        LEFT JOIN sku_operational_tail_rates m ON m.nm_id = s.nm_id
        LEFT JOIN latest_costs lc ON lc.nm_id = s.nm_id
        WHERE s.tenant_id = ${tenantId}
          AND s.nm_id IN (${nmIdList})
          ${includeOperationalTail ? sql`AND s.date > rc.cutoff` : sql`AND FALSE`}
          AND s.date::date >= ${fromStr}::date
          AND s.date::date <= ${toStr}::date
          AND s.is_storno = false
        GROUP BY 1, 2
      ),
      finance_sales AS (
        -- Unified finance layer: reconciled realization + provisional sales tail
        SELECT
          day_raw,
          nm_id,
          SUM(sold_qty) as sold_qty,
          SUM(revenue) as revenue,
          SUM(op_profit) as op_profit,
          SUM(commission) as commission,
          SUM(logistics) as logistics,
          SUM(wb_storage_fee) as wb_storage_fee,
          SUM(wb_acquiring_fee) as wb_acquiring_fee,
          SUM(wb_additional_payment) as wb_additional_payment,
          SUM(provisional_other_fees) as provisional_other_fees,
          SUM(cost_total) as cost_total
        FROM (
          SELECT day_raw, nm_id, sold_qty, revenue, op_profit, commission, logistics, wb_storage_fee, wb_acquiring_fee, wb_additional_payment, provisional_other_fees, cost_total FROM realization_dist
          UNION ALL
          SELECT day_raw, nm_id, sold_qty, revenue, op_profit, commission, logistics, wb_storage_fee, wb_acquiring_fee, wb_additional_payment, provisional_other_fees, cost_total FROM provisional_sales
        ) t
        GROUP BY 1, 2
      ),
      tariff_localization AS MATERIALIZED (
        SELECT
          b.day_raw,
          b.nm_id,
          latest.localization_percent::numeric as localization_percent
        FROM daily_base b
        LEFT JOIN LATERAL (
          SELECT f.localization_percent
          FROM raw_api_funnel_stats f
          WHERE f.tenant_id = ${tenantId}
            AND f.nm_id = b.nm_id
            AND f.localization_percent IS NOT NULL
            AND f.period_start::date <> f.period_end::date
            AND f.period_start::date <= b.day_raw
          ORDER BY f.period_start DESC, f.period_end DESC, f.created_at DESC
          LIMIT 1
        ) latest ON true
      ),
      tariff_price_snapshots AS MATERIALIZED (
        SELECT
          b.day_raw,
          b.nm_id,
          COALESCE(NULLIF(ps.seller_price_after_discount, 0), ps.price)::numeric as price_before_wb_discount
        FROM daily_base b
        LEFT JOIN LATERAL (
          SELECT
            price,
            seller_price_after_discount
          FROM raw_api_price_snapshots ps
          WHERE ps.tenant_id = ${tenantId}
            AND ps.nm_id = b.nm_id
          ORDER BY
            CASE WHEN ps.snapshot_date::date <= b.day_raw THEN 0 ELSE 1 END,
            CASE WHEN ps.snapshot_date::date <= b.day_raw THEN ps.snapshot_date::date END DESC,
            CASE WHEN ps.snapshot_date::date > b.day_raw THEN ps.snapshot_date::date END ASC,
            ps.snapshot_at DESC
          LIMIT 1
        ) ps ON true
      ),
      aggregated_orders AS (
        SELECT
          date::date as day_raw,
          nm_id,
          COUNT(*)::numeric as order_qty,
          SUM(total_price)::numeric as order_revenue
        FROM raw_api_orders
        WHERE tenant_id = ${tenantId}
          AND nm_id IN (${nmIdList})
          AND date::date >= ${fromStr}::date
          AND date::date <= ${toStr}::date
          AND is_cancel = false
        GROUP BY 1, 2
      ),
      orders_by_warehouse AS (
        SELECT
          date::date as day_raw,
          nm_id,
          NULLIF(TRIM(warehouse_name), '') as warehouse_name,
          COUNT(*)::numeric as order_qty
        FROM raw_api_orders
        WHERE tenant_id = ${tenantId}
          AND nm_id IN (${nmIdList})
          AND date::date >= ${fromStr}::date
          AND date::date <= ${toStr}::date
          AND is_cancel = false
          AND NULLIF(TRIM(warehouse_name), '') IS NOT NULL
        GROUP BY 1, 2, 3
      ),
      order_warehouse_logistics AS (
        SELECT
          b.day_raw,
          b.nm_id,
          COALESCE(SUM(ow.order_qty), 0)::numeric as warehouse_order_qty,
          COUNT(DISTINCT ow.warehouse_name) FILTER (WHERE ow.warehouse_name IS NOT NULL)::numeric as warehouse_count,
          COALESCE(SUM(
            CASE
              WHEN tariff.item IS NOT NULL AND p.wb_warehouse_volume_liters IS NOT NULL THEN ow.order_qty
              ELSE 0
            END
          ), 0)::numeric as tariff_order_qty,
          COALESCE(SUM(
            CASE
              WHEN tariff.item IS NOT NULL AND p.wb_warehouse_volume_liters IS NOT NULL THEN
                ow.order_qty * (
                  ${sql.raw(buildDynamicsForwardLogisticsSql(
                    "p.wb_warehouse_volume_liters",
                    "tariff.item",
                    "tl.localization_percent",
                    "tps.price_before_wb_discount",
                  ))}
                )
              ELSE 0
            END
          ), 0)::numeric as warehouse_order_logistics
        FROM daily_base b
        LEFT JOIN orders_by_warehouse ow
          ON ow.day_raw = b.day_raw
         AND ow.nm_id = b.nm_id
        LEFT JOIN products p
          ON p.tenant_id = ${tenantId}
         AND p.nm_id = b.nm_id
        LEFT JOIN tariff_localization tl
          ON tl.day_raw = b.day_raw
         AND tl.nm_id = b.nm_id
        LEFT JOIN tariff_price_snapshots tps
          ON tps.day_raw = b.day_raw
         AND tps.nm_id = b.nm_id
        LEFT JOIN LATERAL (
          SELECT item
          FROM wb_tariff_snapshots ts
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(ts.data) = 'array' THEN ts.data ELSE '[]'::jsonb END
          ) item
          WHERE ts.tenant_id = ${tenantId}
            AND ts.tariff_type = 'box'
            AND ts.snapshot_date <= TO_CHAR(b.day_raw, 'YYYY-MM-DD')
            AND (
              LOWER(TRIM(item ->> 'warehouseName')) = LOWER(TRIM(ow.warehouse_name))
              OR LOWER(TRIM(COALESCE(item ->> 'geoName', ''))) = LOWER(TRIM(ow.warehouse_name))
            )
          ORDER BY ts.snapshot_date DESC
          LIMIT 1
        ) tariff ON ow.warehouse_name IS NOT NULL
        GROUP BY 1, 2
      ),
      active_fixation_logistics_by_office AS MATERIALIZED (
        SELECT
          b.day_raw,
          r.nm_id,
          LOWER(TRIM(REGEXP_REPLACE(r.office_name, '\\s+WB$', '', 'i'))) as office_key,
          AVG(COALESCE(r.delivery_rub, 0))::numeric as logistics_per_buyout
        FROM daily_base b
        JOIN raw_api_realization_reports r
          ON r.tenant_id = ${tenantId}
         AND r.nm_id = b.nm_id
         AND r.fixation_start_date IS NOT NULL
         AND r.fixation_end_date IS NOT NULL
         AND b.day_raw >= r.fixation_start_date
         AND b.day_raw <= r.fixation_end_date
         AND NULLIF(TRIM(r.office_name), '') IS NOT NULL
         AND COALESCE(r.delivery_rub, 0) > 0
        GROUP BY 1, 2, 3
      ),
      active_fixation_logistics_by_sku AS MATERIALIZED (
        SELECT
          b.day_raw,
          r.nm_id,
          AVG(COALESCE(r.delivery_rub, 0))::numeric as logistics_per_buyout
        FROM daily_base b
        JOIN raw_api_realization_reports r
          ON r.tenant_id = ${tenantId}
         AND r.nm_id = b.nm_id
         AND r.fixation_start_date IS NOT NULL
         AND r.fixation_end_date IS NOT NULL
         AND b.day_raw >= r.fixation_start_date
         AND b.day_raw <= r.fixation_end_date
         AND COALESCE(r.delivery_rub, 0) > 0
        GROUP BY 1, 2
      ),
      historical_logistics_by_office AS MATERIALIZED (
        SELECT
          r.nm_id,
          LOWER(TRIM(REGEXP_REPLACE(r.office_name, '\\s+WB$', '', 'i'))) as office_key,
          AVG(COALESCE(r.delivery_rub, 0))::numeric as logistics_per_buyout
        FROM raw_api_realization_reports r
        WHERE r.tenant_id = ${tenantId}
          AND r.nm_id IN (${nmIdList})
          AND NULLIF(TRIM(r.office_name), '') IS NOT NULL
          AND COALESCE(r.delivery_rub, 0) > 0
          AND COALESCE(r.sale_dt, r.date_from) >= (NOW() - INTERVAL '90 days')
        GROUP BY 1, 2
      ),
      nearest_stock_size_snapshot_dates AS MATERIALIZED (
        SELECT
          b.day_raw,
          b.nm_id,
          nearest.snapshot_date
        FROM daily_base b
        LEFT JOIN LATERAL (
          SELECT ss.snapshot_date::date as snapshot_date
          FROM raw_api_stock_sizes ss
          WHERE ss.tenant_id = ${tenantId}
            AND ss.nm_id = b.nm_id
            AND ss.stock_type = 'wb'
          GROUP BY ss.snapshot_date::date
          ORDER BY
            CASE WHEN ss.snapshot_date::date = b.day_raw THEN 0 ELSE 1 END,
            ABS(ss.snapshot_date::date - b.day_raw) ASC,
            CASE WHEN ss.snapshot_date::date > b.day_raw THEN 0 ELSE 1 END,
            ss.snapshot_date::date DESC
          LIMIT 1
        ) nearest ON true
      ),
      latest_stock_office_rows AS MATERIALIZED (
        SELECT
          b.day_raw,
          b.nm_id,
          NULLIF(TRIM(ss.office_name), '') as office_name,
          SUM(COALESCE(ss.stock_count, 0))::numeric as stock_qty
        FROM daily_base b
        JOIN nearest_stock_size_snapshot_dates ns
          ON ns.day_raw = b.day_raw
         AND ns.nm_id = b.nm_id
         AND ns.snapshot_date IS NOT NULL
        JOIN raw_api_stock_sizes ss
          ON ss.tenant_id = ${tenantId}
         AND ss.nm_id = b.nm_id
         AND ss.stock_type = 'wb'
         AND ss.snapshot_date::date = ns.snapshot_date
        WHERE NULLIF(TRIM(ss.office_name), '') IS NOT NULL
          AND COALESCE(ss.stock_count, 0) > 0
        GROUP BY 1, 2, 3
      ),
      stock_weighted_fixation_logistics AS MATERIALIZED (
        SELECT
          ls.day_raw,
          ls.nm_id,
          (
            SUM(ls.stock_qty * COALESCE(
              afl.logistics_per_buyout,
              hlo.logistics_per_buyout,
              afs.logistics_per_buyout
            ))
            / NULLIF(SUM(ls.stock_qty) FILTER (
              WHERE COALESCE(
                afl.logistics_per_buyout,
                hlo.logistics_per_buyout,
                afs.logistics_per_buyout
              ) IS NOT NULL
            ), 0)
          )::numeric as logistics_per_buyout
        FROM latest_stock_office_rows ls
        LEFT JOIN active_fixation_logistics_by_office afl
          ON afl.day_raw = ls.day_raw
         AND afl.nm_id = ls.nm_id
         AND afl.office_key = LOWER(TRIM(REGEXP_REPLACE(ls.office_name, '\\s+WB$', '', 'i')))
        LEFT JOIN historical_logistics_by_office hlo
          ON hlo.nm_id = ls.nm_id
         AND hlo.office_key = LOWER(TRIM(REGEXP_REPLACE(ls.office_name, '\\s+WB$', '', 'i')))
        LEFT JOIN active_fixation_logistics_by_sku afs
          ON afs.day_raw = ls.day_raw
         AND afs.nm_id = ls.nm_id
        GROUP BY 1, 2
      ),
      stock_weighted_tariff_logistics AS MATERIALIZED (
        SELECT
          ls.day_raw,
          ls.nm_id,
          (
            SUM(
              ls.stock_qty * (
                ${sql.raw(buildDynamicsForwardLogisticsSql(
                  "p.wb_warehouse_volume_liters",
                  "tariff.item",
                  "tl.localization_percent",
                  "tps.price_before_wb_discount",
                ))}
              )
            ) / NULLIF(SUM(ls.stock_qty), 0)
          )::numeric as logistics_per_buyout
        FROM latest_stock_office_rows ls
        JOIN products p
          ON p.tenant_id = ${tenantId}
         AND p.nm_id = ls.nm_id
         AND p.wb_warehouse_volume_liters IS NOT NULL
        LEFT JOIN tariff_localization tl
          ON tl.day_raw = ls.day_raw
         AND tl.nm_id = ls.nm_id
        LEFT JOIN tariff_price_snapshots tps
          ON tps.day_raw = ls.day_raw
         AND tps.nm_id = ls.nm_id
        JOIN LATERAL (
          SELECT item
          FROM wb_tariff_snapshots ts
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(ts.data) = 'array' THEN ts.data ELSE '[]'::jsonb END
          ) item
          WHERE ts.tenant_id = ${tenantId}
            AND ts.tariff_type = 'box'
            AND ts.snapshot_date <= TO_CHAR(ls.day_raw, 'YYYY-MM-DD')
            AND (
              LOWER(TRIM(item ->> 'warehouseName')) = LOWER(TRIM(ls.office_name))
              OR LOWER(TRIM(COALESCE(item ->> 'geoName', ''))) = LOWER(TRIM(ls.office_name))
            )
          ORDER BY ts.snapshot_date DESC
          LIMIT 1
        ) tariff ON true
        GROUP BY 1, 2
      ),
      aggregated_raw_sales AS (
        SELECT
          date::date as day_raw,
          nm_id,
          COUNT(*)::numeric as raw_buyout_qty,
          SUM(price_with_discount)::numeric as raw_buyout_revenue
        FROM raw_api_sales
        WHERE tenant_id = ${tenantId}
          AND nm_id IN (${nmIdList})
          AND date::date >= ${fromStr}::date
          AND date::date <= ${toStr}::date
          AND is_storno = false
        GROUP BY 1, 2
      ),
      exact_daily_funnel_stats AS (
        SELECT
          period_start::date as day_raw,
          nm_id,
          MAX(open_card_count)::numeric as view_qty,
          MAX(add_to_cart_count)::numeric as add_to_cart_qty,
          MAX(order_count)::numeric as order_qty,
          MAX(order_sum)::numeric as order_revenue,
          MAX(cancel_count)::numeric as cancel_qty,
          MAX(buyout_count)::numeric as buyout_qty,
          MAX(buyout_sum)::numeric as buyout_revenue,
          MAX(avg_price)::numeric as avg_price,
          MAX(add_to_cart_percent)::numeric as add_to_cart_percent,
          MAX(cart_to_order_percent)::numeric as cart_to_order_percent,
          MAX(order_to_buyout_percent)::numeric as order_to_buyout_percent
        FROM raw_api_funnel_stats
        WHERE tenant_id = ${tenantId}
          AND nm_id IN (${nmIdList})
          AND period_start::date = period_end::date
          AND period_start::date >= ${fromStr}::date
          AND period_start::date <= ${toStr}::date
        GROUP BY 1, 2
      ),
      manual_buyout_inputs AS (
        SELECT
          mi.nm_id,
          (${sql.raw(buildManualActiveScenarioBuyoutSql("mi"))})::numeric as manual_buyout_percent
        FROM unit_economics_manual_inputs mi
        WHERE mi.tenant_id = ${tenantId}
          AND mi.nm_id IN (${nmIdList})
      ),
      buyout_history_13w AS (
        SELECT
          h.nm_id,
          CASE
            WHEN h.closed_qty >= 100
              AND h.history_days >= 30
              AND COALESCE((h.order_qty - h.closed_qty) / NULLIF(h.order_qty, 0), 0) <= 0.4
            THEN (h.buyout_qty / NULLIF(h.closed_qty, 0)) * 100
            ELSE NULL
          END::numeric as wb_buyout_percent
        FROM (
          SELECT
            nm_id,
            COUNT(DISTINCT period_start::date)::numeric as history_days,
            SUM(COALESCE(order_count, 0))::numeric as order_qty,
            SUM(COALESCE(buyout_count, 0))::numeric as buyout_qty,
            SUM(COALESCE(buyout_count, 0) + COALESCE(cancel_count, 0))::numeric as closed_qty
          FROM raw_api_funnel_stats
          WHERE tenant_id = ${tenantId}
            AND nm_id IN (${nmIdList})
            AND period_start::date = period_end::date
            AND period_start::date >= (${toStr}::date - INTERVAL '91 days')
            AND period_start::date <= ${toStr}::date
          GROUP BY nm_id
        ) h
      ),
      ad_cost_rows AS (
        SELECT
          date::date as day_raw,
          nm_id,
          COALESCE(amount, 0)::numeric as amount,
          COALESCE(order_sum, 0)::numeric as order_sum
        FROM raw_api_ad_costs
        WHERE tenant_id = ${tenantId}
          AND nm_id IN (${nmIdList})
          AND date::date >= ${fromStr}::date
          AND date::date <= ${toStr}::date
      ),
      aggregated_ads_costs_spend AS (
        SELECT
          day_raw,
          nm_id,
          SUM(amount)::numeric as ad_spend
        FROM ad_cost_rows
        GROUP BY 1, 2
      ),
      aggregated_ads_costs_attr AS (
        SELECT
          day_raw,
          nm_id,
          MAX(order_sum)::numeric as ad_order_sum
        FROM ad_cost_rows
        GROUP BY 1, 2
      ),
      aggregated_ads_costs AS (
        SELECT
          s.day_raw,
          s.nm_id,
          COALESCE(s.ad_spend, 0)::numeric as ad_spend,
          COALESCE(a.ad_order_sum, 0)::numeric as ad_order_sum
        FROM aggregated_ads_costs_spend s
        LEFT JOIN aggregated_ads_costs_attr a
          ON a.day_raw = s.day_raw
         AND a.nm_id = s.nm_id
      ),
      aggregated_ads_clusters AS (
        SELECT
          date::date as day_raw,
          nm_id,
          SUM(amount)::numeric as ad_spend,
          SUM(views)::numeric as ad_views,
          SUM(clicks)::numeric as ad_clicks,
          AVG(ctr) FILTER (WHERE ctr >= 0 AND ctr <= 100)::numeric as ad_ctr_source
        FROM raw_api_ad_clusters
        WHERE tenant_id = ${tenantId}
          AND nm_id IN (${nmIdList})
          AND date::date >= ${fromStr}::date
          AND date::date <= ${toStr}::date
        GROUP BY 1, 2
      ),
      aggregated_ads AS (
        SELECT
          COALESCE(c.day_raw, cl.day_raw) as day_raw,
          COALESCE(c.nm_id, cl.nm_id) as nm_id,
          CASE
            WHEN c.nm_id IS NOT NULL THEN COALESCE(c.ad_spend, 0)
            ELSE COALESCE(cl.ad_spend, 0)
          END::numeric as ad_spend,
          CASE
            WHEN c.nm_id IS NOT NULL THEN COALESCE(c.ad_order_sum, 0)
            ELSE 0
          END::numeric as ad_order_sum,
          COALESCE(cl.ad_views, 0)::numeric as ad_views,
          COALESCE(cl.ad_clicks, 0)::numeric as ad_clicks,
          cl.ad_ctr_source
        FROM aggregated_ads_costs c
        FULL OUTER JOIN aggregated_ads_clusters cl
          ON c.day_raw = cl.day_raw
          AND c.nm_id = cl.nm_id
      ),
      aggregated_storage AS (
        SELECT
          date::date as day_raw,
          nm_id,
          SUM(storage_amount)::numeric as storage_cost
        FROM raw_api_paid_storage
        WHERE tenant_id = ${tenantId}
          AND nm_id IN (${nmIdList})
          AND date::date >= ${fromStr}::date
          AND date::date <= ${toStr}::date
        GROUP BY 1, 2
      ),
      daily_actual_order_logistics AS (
        SELECT
          pnl_day as day_raw,
          nm_id,
          AVG(delivery_rub) FILTER (WHERE delivery_rub > 0)::numeric as logistics_per_order
        FROM (
          SELECT
            r.nm_id,
            COALESCE(r.delivery_rub, 0)::numeric as delivery_rub,
            CASE
              WHEN COALESCE(r.delivery_rub, 0) <> 0
                AND COALESCE(r.retail_amount, 0) = 0
                AND COALESCE(r.ppvz_for_pay, 0) = 0
                AND COALESCE(r.srid, '') <> ''
                AND o.date IS NOT NULL
              THEN DATE_TRUNC('day', o.date)::date
              ELSE DATE_TRUNC('day', COALESCE(r.sale_dt, r.date_from))::date
            END as pnl_day
          FROM raw_api_realization_reports r
          LEFT JOIN raw_api_orders o
            ON o.tenant_id = r.tenant_id
           AND o.srid = r.srid
          WHERE r.tenant_id = ${tenantId}
            AND r.nm_id IN (${nmIdList})
            AND COALESCE(r.sale_dt, r.date_from)::date >= (${fromStr}::date - INTERVAL '30 days')
            AND COALESCE(r.sale_dt, r.date_from)::date <= (${toStr}::date + INTERVAL '30 days')
        ) t
        WHERE pnl_day >= ${fromStr}::date
          AND pnl_day <= ${toStr}::date
        GROUP BY 1, 2
      ),
      latest_price_snapshots AS (
        SELECT
          b.day_raw,
          b.nm_id,
          CASE
            WHEN ps.public_price_source = 'wb_card_v4' THEN ps.implied_spp
            ELSE ps.spp
          END::numeric as current_spp,
          ps.price::numeric as current_price,
          ps.seller_price_after_discount::numeric as seller_price_after_discount,
          ps.price_after_spp::numeric as price_after_spp
        FROM daily_base b
        LEFT JOIN LATERAL (
          SELECT
            public_price_source,
            implied_spp,
            spp,
            price,
            seller_price_after_discount,
            price_after_spp
          FROM raw_api_price_snapshots ps
          WHERE ps.tenant_id = ${tenantId}
            AND ps.nm_id = b.nm_id
          ORDER BY
            CASE WHEN ps.snapshot_date::date <= b.day_raw THEN 0 ELSE 1 END,
            CASE WHEN ps.snapshot_date::date <= b.day_raw THEN ps.snapshot_date::date END DESC,
            CASE WHEN ps.snapshot_date::date > b.day_raw THEN ps.snapshot_date::date END ASC,
            ps.snapshot_at DESC
          LIMIT 1
        ) ps ON true
      ),
      stock_size_snapshots AS (
        SELECT
          b.day_raw,
          b.nm_id,
          SUM(ss.stock_count)::numeric as stock_count,
          SUM(ss.to_client_count)::numeric as to_client_count,
          SUM(ss.from_client_count)::numeric as from_client_count,
          SUM(ABS(ss.lost_orders_count))::numeric as lost_orders_count,
          (AVG(ss.avg_stock_turnover_days) FILTER (WHERE ss.avg_stock_turnover_days IS NOT NULL))::numeric as avg_stock_turnover_days,
          (AVG(ss.sale_rate_days) FILTER (WHERE ss.sale_rate_days IS NOT NULL))::numeric as sale_rate_days
        FROM daily_base b
        LEFT JOIN nearest_stock_size_snapshot_dates ns
          ON ns.day_raw = b.day_raw
         AND ns.nm_id = b.nm_id
        LEFT JOIN raw_api_stock_sizes ss
          ON ss.tenant_id = ${tenantId}
         AND ss.nm_id = b.nm_id
         AND ss.stock_type = 'wb'
         AND ss.snapshot_date::date = ns.snapshot_date
        GROUP BY 1, 2
      ),
      stats_agg AS (
        SELECT
          b.day_raw,
          b.nm_id,
          COALESCE(fs.revenue, 0) as finance_revenue,
          COALESCE(fs.sold_qty, 0) as finance_sold_qty,
          COALESCE(fs.op_profit, 0) as op_profit,
          proj.expected_buyout_qty as order_projected_qty,
          proj.expected_revenue_after_spp as order_projected_revenue,
          proj.order_turnover_before_spp,
          proj.order_revenue_after_spp,
          (
            COALESCE(proj.expected_revenue_after_spp, 0)
            - ${sql.raw(buildOperationalTailComponentSql("proj.expected_revenue_after_spp", "otr", "commission_rate"))}
            - ${sql.raw(buildOperationalTailOtherFeesSql("proj.expected_revenue_after_spp", "otr"))}
          ) as order_projected_op_profit,
          COALESCE(
            NULLIF(swfl.logistics_per_buyout, 0) * COALESCE(proj.expected_buyout_qty, 0),
            NULLIF(afl.logistics_per_buyout, 0) * COALESCE(proj.expected_buyout_qty, 0),
            NULLIF(dal.logistics_per_order, 0) * COALESCE(proj.expected_buyout_qty, 0),
            NULLIF(holr.logistics_per_order, 0) * COALESCE(proj.expected_buyout_qty, 0),
            NULLIF(hgl.logistics_per_buyout, 0) * COALESCE(proj.expected_buyout_qty, 0),
            NULLIF(${sql.raw(historicalOrderLogisticsSql)}, 0),
            NULLIF(swtl.logistics_per_buyout, 0) * COALESCE(proj.expected_buyout_qty, 0),
            CASE
              WHEN COALESCE(owl.tariff_order_qty, 0) > 0 AND COALESCE(proj.order_qty, 0) > 0
                THEN (
                  (owl.warehouse_order_logistics / NULLIF(owl.tariff_order_qty, 0))
                  * proj.expected_buyout_qty
                  * (${sql.raw(tariffCoverageFractionSql)})
                )
                + (
                  ${sql.raw(historicalOrderLogisticsSql)}
                  * GREATEST(0, 1 - (${sql.raw(tariffCoverageFractionSql)}))
                )
              ELSE NULL
            END,
            0
          ) as order_projected_logistics,
          COALESCE(
            NULLIF(swfl.logistics_per_buyout, 0),
            NULLIF(afl.logistics_per_buyout, 0),
            NULLIF(dal.logistics_per_order, 0),
            NULLIF(holr.logistics_per_order, 0),
            NULLIF(hgl.logistics_per_buyout, 0),
            CASE
              WHEN COALESCE(proj.expected_buyout_qty, 0) > 0
                THEN NULLIF(${sql.raw(historicalOrderLogisticsSql)}, 0) / NULLIF(proj.expected_buyout_qty, 0)
              ELSE NULL
            END,
            NULLIF(swtl.logistics_per_buyout, 0),
            CASE
              WHEN COALESCE(owl.tariff_order_qty, 0) > 0
                THEN owl.warehouse_order_logistics / NULLIF(owl.tariff_order_qty, 0)
              ELSE NULL
            END
          ) as order_projected_logistics_rate,
          CASE
            WHEN NULLIF(swfl.logistics_per_buyout, 0) IS NOT NULL THEN 'остатки × фиксация/история склада'
            WHEN NULLIF(afl.logistics_per_buyout, 0) IS NOT NULL THEN 'активная фиксация SKU'
            WHEN NULLIF(dal.logistics_per_order, 0) IS NOT NULL THEN 'факт WB по дню заказа'
            WHEN NULLIF(holr.logistics_per_order, 0) IS NOT NULL THEN 'история SKU'
            WHEN NULLIF(hgl.logistics_per_buyout, 0) IS NOT NULL THEN 'история склейки'
            WHEN NULLIF(${sql.raw(historicalOrderLogisticsSql)}, 0) IS NOT NULL THEN 'ставка хвоста P&L'
            WHEN NULLIF(swtl.logistics_per_buyout, 0) IS NOT NULL THEN 'остатки × тариф WB'
            WHEN COALESCE(owl.tariff_order_qty, 0) > 0 THEN 'заказы × тариф WB'
            ELSE 'нет данных'
          END as order_projected_logistics_source,
          COALESCE(owl.warehouse_order_logistics, 0) as order_warehouse_logistics,
          CASE
            WHEN COALESCE(o.order_qty, 0) > 0
              THEN LEAST(100, (COALESCE(owl.tariff_order_qty, 0) / NULLIF(o.order_qty, 0)) * 100)
            ELSE NULL
          END as order_warehouse_logistics_coverage_percent,
          (proj.expected_buyout_qty * COALESCE(pc.full_cost, 0)) as order_projected_cost_total,
          COALESCE(fs.commission, 0) as commission,
          COALESCE(fs.logistics, 0) as logistics,
          COALESCE(fs.wb_storage_fee, 0) as wb_storage_fee,
          COALESCE(fs.wb_acquiring_fee, 0) as wb_acquiring_fee,
          COALESCE(fs.wb_additional_payment, 0) as wb_additional_payment,
          COALESCE(fs.provisional_other_fees, 0) as provisional_other_fees,
          COALESCE(fs.cost_total, 0) as cost_total,
          o.order_qty as raw_order_qty,
          o.order_revenue as raw_order_revenue,
          COALESCE(rs.raw_buyout_qty, 0) as raw_buyout_qty,
          COALESCE(rs.raw_buyout_revenue, 0) as raw_buyout_revenue,
          f.view_qty as funnel_view_qty,
          f.add_to_cart_qty as funnel_add_to_cart_qty,
          f.order_qty as funnel_order_qty,
          f.order_revenue as funnel_order_revenue,
          f.cancel_qty as funnel_cancel_qty,
          f.buyout_qty as funnel_buyout_qty,
          f.buyout_revenue as funnel_buyout_revenue,
          f.avg_price as funnel_avg_price,
          f.add_to_cart_percent as funnel_add_to_cart_percent,
          f.cart_to_order_percent as funnel_cart_to_order_percent,
          f.order_to_buyout_percent as funnel_order_to_buyout_percent,
          bh.wb_buyout_percent,
          mbi.manual_buyout_percent,
          COALESCE(bh.wb_buyout_percent, mbi.manual_buyout_percent) as effective_buyout_percent,
          COALESCE(a.ad_spend, 0) as ad_spend,
          COALESCE(a.ad_order_sum, 0) as ad_order_sum,
          COALESCE(a.ad_views, 0) as ad_views,
          COALESCE(a.ad_clicks, 0) as ad_clicks,
          a.ad_ctr_source,
          COALESCE(st.storage_cost, 0) as storage_cost,
          ps.current_spp,
          ps.current_price,
          ps.seller_price_after_discount,
          ps.price_after_spp,
          ss.stock_count,
          ss.to_client_count,
          ss.from_client_count,
          ss.lost_orders_count,
          ss.avg_stock_turnover_days,
          ss.sale_rate_days
        FROM daily_base b
        LEFT JOIN finance_sales fs ON b.day_raw = fs.day_raw AND b.nm_id = fs.nm_id
        LEFT JOIN aggregated_orders o ON b.day_raw = o.day_raw AND b.nm_id = o.nm_id
        LEFT JOIN order_warehouse_logistics owl ON b.day_raw = owl.day_raw AND b.nm_id = owl.nm_id
        LEFT JOIN aggregated_raw_sales rs ON b.day_raw = rs.day_raw AND b.nm_id = rs.nm_id
        LEFT JOIN exact_daily_funnel_stats f ON b.day_raw = f.day_raw AND b.nm_id = f.nm_id
        LEFT JOIN aggregated_ads a ON b.day_raw = a.day_raw AND b.nm_id = a.nm_id
        LEFT JOIN aggregated_storage st ON b.day_raw = st.day_raw AND b.nm_id = st.nm_id
        LEFT JOIN daily_actual_order_logistics dal ON dal.day_raw = b.day_raw AND dal.nm_id = b.nm_id
        LEFT JOIN stock_weighted_fixation_logistics swfl ON swfl.day_raw = b.day_raw AND swfl.nm_id = b.nm_id
        LEFT JOIN active_fixation_logistics_by_sku afl ON afl.day_raw = b.day_raw AND afl.nm_id = b.nm_id
        LEFT JOIN sku_operational_tail_rates otr ON otr.nm_id = b.nm_id
        LEFT JOIN historical_order_logistics_rates holr ON holr.nm_id = b.nm_id
        LEFT JOIN historical_logistics_by_group hgl ON true
        LEFT JOIN stock_weighted_tariff_logistics swtl ON swtl.day_raw = b.day_raw AND swtl.nm_id = b.nm_id
        LEFT JOIN buyout_history_13w bh ON bh.nm_id = b.nm_id
        LEFT JOIN manual_buyout_inputs mbi ON mbi.nm_id = b.nm_id
        LEFT JOIN latest_costs pc ON pc.nm_id = b.nm_id
        LEFT JOIN latest_price_snapshots ps ON b.day_raw = ps.day_raw AND b.nm_id = ps.nm_id
        LEFT JOIN stock_size_snapshots ss ON b.day_raw = ss.day_raw AND b.nm_id = ss.nm_id
        LEFT JOIN LATERAL (
          SELECT
            base.order_qty,
            base.order_revenue,
            base.order_turnover_before_spp,
            base.order_revenue_after_spp,
            (base.order_qty * base.buyout_ratio)::numeric as expected_buyout_qty,
            (base.order_revenue_after_spp * base.buyout_ratio)::numeric as expected_revenue_after_spp
          FROM (
            SELECT
              raw.order_qty,
              raw.order_revenue,
              CASE
                WHEN raw.order_qty > 0
                  AND COALESCE(ps.seller_price_after_discount, ps.current_price) IS NOT NULL
                THEN raw.order_qty * COALESCE(ps.seller_price_after_discount, ps.current_price)
                ELSE raw.order_revenue
              END::numeric as order_turnover_before_spp,
              CASE
                WHEN raw.order_qty > 0
                  AND ps.price_after_spp IS NOT NULL
                THEN raw.order_qty * ps.price_after_spp
                WHEN raw.order_qty > 0
                  AND COALESCE(ps.seller_price_after_discount, ps.current_price) IS NOT NULL
                  AND ps.current_spp IS NOT NULL
                THEN raw.order_qty
                  * COALESCE(ps.seller_price_after_discount, ps.current_price)
                  * GREATEST(0, 1 - (ps.current_spp / 100))
                ELSE raw.order_revenue
              END::numeric as order_revenue_after_spp,
              (
                LEAST(
                  100,
                  GREATEST(
                    0,
                    COALESCE(
                      bh.wb_buyout_percent,
                      mbi.manual_buyout_percent,
                      NULLIF(f.order_to_buyout_percent, 0),
                      100
                    )
                  )
                ) / 100
              )::numeric as buyout_ratio
            FROM (
              SELECT
                COALESCE(f.order_qty, o.order_qty, 0)::numeric as order_qty,
                COALESCE(f.order_revenue, o.order_revenue, 0)::numeric as order_revenue
            ) raw
          ) base
        ) proj ON true
      )
      SELECT
        TO_CHAR(day_raw, 'DD.MM.YYYY') as "day",
        nm_id as "nmId",
        SUM(raw_buyout_revenue) as revenue,
        SUM(raw_buyout_qty) as "soldQty",
        SUM(finance_revenue) as "financeRevenue",
        SUM(finance_sold_qty) as "financeSoldQty",
        SUM(op_profit) as "opProfit",
        SUM(order_projected_qty) as "orderProjectedQty",
        SUM(order_projected_revenue) as "orderProjectedRevenue",
        SUM(order_turnover_before_spp) as "orderTurnoverBeforeSpp",
        SUM(order_revenue_after_spp) as "orderRevenueAfterSpp",
        SUM(order_projected_op_profit) as "orderProjectedOpProfit",
        SUM(order_projected_cost_total) as "orderProjectedCostTotal",
        SUM(order_projected_logistics) as "orderProjectedLogistics",
        CASE
          WHEN SUM(order_projected_qty) > 0
            THEN SUM(order_projected_logistics) / NULLIF(SUM(order_projected_qty), 0)
          ELSE AVG(order_projected_logistics_rate) FILTER (WHERE order_projected_logistics_rate IS NOT NULL)
        END as "orderProjectedLogisticsRate",
        STRING_AGG(DISTINCT order_projected_logistics_source, ', ' ORDER BY order_projected_logistics_source) FILTER (
          WHERE order_projected_logistics_source IS NOT NULL
            AND order_projected_logistics_source <> 'нет данных'
        ) as "orderProjectedLogisticsSource",
        SUM(order_warehouse_logistics) as "orderWarehouseLogistics",
        AVG(order_warehouse_logistics_coverage_percent) FILTER (WHERE order_warehouse_logistics_coverage_percent IS NOT NULL) as "orderWarehouseLogisticsCoveragePercent",
        SUM(commission) as "commission",
        SUM(logistics) as "logistics",
        SUM(wb_storage_fee) as "wbStorageFee",
        SUM(wb_acquiring_fee) as "wbAcquiringFee",
        SUM(wb_additional_payment) as "wbAdditionalPayment",
        SUM(provisional_other_fees) as "provisionalOtherFees",
        SUM(cost_total) as "costTotal",
        SUM(raw_order_qty) FILTER (WHERE raw_order_qty IS NOT NULL) as "orderQty",
        SUM(raw_order_revenue) FILTER (WHERE raw_order_revenue IS NOT NULL) as "orderRevenue",
        SUM(funnel_view_qty) FILTER (WHERE funnel_view_qty IS NOT NULL) as "funnelViewQty",
        SUM(funnel_add_to_cart_qty) FILTER (WHERE funnel_add_to_cart_qty IS NOT NULL) as "funnelAddToCartQty",
        SUM(funnel_order_qty) FILTER (WHERE funnel_order_qty IS NOT NULL) as "funnelOrderQty",
        SUM(funnel_order_revenue) FILTER (WHERE funnel_order_revenue IS NOT NULL) as "funnelOrderRevenue",
        SUM(funnel_cancel_qty) FILTER (WHERE funnel_cancel_qty IS NOT NULL) as "funnelCancelQty",
        SUM(funnel_buyout_qty) FILTER (WHERE funnel_buyout_qty IS NOT NULL) as "funnelBuyoutQty",
        SUM(funnel_buyout_revenue) FILTER (WHERE funnel_buyout_revenue IS NOT NULL) as "funnelBuyoutRevenue",
        AVG(funnel_avg_price) FILTER (WHERE funnel_avg_price IS NOT NULL) as "funnelAvgPrice",
        AVG(funnel_add_to_cart_percent) FILTER (WHERE funnel_add_to_cart_percent IS NOT NULL) as "funnelAddToCartPercent",
        AVG(funnel_cart_to_order_percent) FILTER (WHERE funnel_cart_to_order_percent IS NOT NULL) as "funnelCartToOrderPercent",
        AVG(funnel_order_to_buyout_percent) FILTER (WHERE funnel_order_to_buyout_percent IS NOT NULL) as "funnelOrderToBuyoutPercent",
        AVG(wb_buyout_percent) FILTER (WHERE wb_buyout_percent IS NOT NULL) as "buyoutPercentWb",
        AVG(manual_buyout_percent) FILTER (WHERE manual_buyout_percent IS NOT NULL) as "manualBuyoutPercent",
        AVG(effective_buyout_percent) FILTER (WHERE effective_buyout_percent IS NOT NULL) as "effectiveBuyoutPercent",
        SUM(ad_spend) as "adSpend",
        SUM(ad_order_sum) as "adOrderSum",
        SUM(ad_views) as "adViews",
        SUM(ad_clicks) as "adClicks",
        AVG(ad_ctr_source) FILTER (WHERE ad_ctr_source IS NOT NULL) as "adCtrSource",
        SUM(storage_cost) as "storageCost",
        AVG(current_spp) FILTER (WHERE current_spp IS NOT NULL) as "currentSpp",
        AVG(current_price) FILTER (WHERE current_price IS NOT NULL) as "currentPrice",
        AVG(seller_price_after_discount) FILTER (WHERE seller_price_after_discount IS NOT NULL) as "sellerPriceAfterDiscount",
        AVG(price_after_spp) FILTER (WHERE price_after_spp IS NOT NULL) as "priceAfterSpp",
        SUM(stock_count) FILTER (WHERE stock_count IS NOT NULL) as "stockCount",
        SUM(to_client_count) FILTER (WHERE to_client_count IS NOT NULL) as "toClientCount",
        SUM(from_client_count) FILTER (WHERE from_client_count IS NOT NULL) as "fromClientCount",
        SUM(lost_orders_count) FILTER (WHERE lost_orders_count IS NOT NULL) as "lostOrdersCount",
        AVG(avg_stock_turnover_days) FILTER (WHERE avg_stock_turnover_days IS NOT NULL) as "avgStockTurnoverDays",
        AVG(sale_rate_days) FILTER (WHERE sale_rate_days IS NOT NULL) as "saleRateDays",
        MAX(t.tax_type) as tax_type,
        MAX(t.tax_rate) as tax_rate,
        MAX(t.vat_mode) as vat_mode,
        MAX(t.vat_rate) as vat_rate
      FROM stats_agg s
      JOIN tenants t ON t.id = ${tenantId}
      GROUP BY 1, 2, day_raw
      ORDER BY day_raw ASC
    `;

    const rawData = await withTenantContext(db, tenantId, async (tx) => {
      await tx.execute(sql`SET LOCAL jit = off`);
      return tx.execute(query);
    });
    const rows = rawData as unknown as GroupDynamicsRawRow[];

    // 3. Формируем финальную структуру: агрегация Группы и данные по SKU
    const days = [...new Set(rows.map((row) => String(row.day)))];
    const skus: Record<number, Record<string, GroupSkuDayMetrics>> = {};
    const groupDaily: Record<string, GroupDayMetrics> = {};
    const groupBuyoutWeights: Record<string, {
      wbSum: number;
      wbWeight: number;
      manualSum: number;
      manualWeight: number;
      effectiveSum: number;
      effectiveWeight: number;
    }> = {};

    // Инициализация groupDaily
    days.forEach((day) => {
      groupDaily[day] = {
        revenue: 0, soldQty: 0, financeRevenue: 0, financeSoldQty: 0, opProfit: 0, costTotal: 0,
        orderProjectedQty: 0, orderProjectedRevenue: 0, orderTurnoverBeforeSpp: 0, orderRevenueAfterSpp: 0,
        orderProjectedOpProfit: 0, orderProjectedCostTotal: 0, orderProjectedLogistics: 0,
        orderProjectedLogisticsRate: null,
        orderProjectedLogisticsSource: null,
        orderWarehouseLogistics: 0, orderWarehouseLogisticsCoveragePercent: null,
        orderWarehouseLogisticsCoverageCount: 0, orderWarehouseLogisticsCoverageWeight: 0,
        orderProjectedNetProfit: 0,
        commission: 0, logistics: 0, wbStorageFee: 0, wbAcquiringFee: 0, wbAdditionalPayment: 0, provisionalOtherFees: 0,
        orderQty: null, orderRevenue: null, adSpend: 0, adOrderSum: 0, adViews: 0, adClicks: 0, storageCost: 0,
        currentSpp: null,
        currentPrice: null,
        sellerPriceAfterDiscount: null,
        priceAfterSpp: null,
        stockCount: null,
        toClientCount: null,
        fromClientCount: null,
        lostOrdersCount: null,
        avgStockTurnoverDays: null,
        saleRateDays: null,
        funnelViewQty: null,
        funnelAddToCartQty: null,
        funnelOrderQty: null,
        funnelOrderRevenue: null,
        funnelCancelQty: null,
        funnelBuyoutQty: null,
        funnelBuyoutRevenue: null,
        funnelAvgPrice: null,
        funnelAddToCartPercent: null,
        funnelCartToOrderPercent: null,
        funnelOrderToBuyoutPercent: null,
        funnelImpressionsQty: null,
        funnelImpressionsOpenCard: null,
        netProfit: 0,
        adCtrSource: null,
        adCtrSourceCount: 0
      };
      groupBuyoutWeights[day] = {
        wbSum: 0,
        wbWeight: 0,
        manualSum: 0,
        manualWeight: 0,
        effectiveSum: 0,
        effectiveWeight: 0,
      };
    });

    rows.forEach((r) => {
      const day = String(r.day);
      const nmId = Number(r.nmId);
      if (!skus[nmId]) skus[nmId] = {};
      const gd = groupDaily[day]!;

      const taxRatePercent = safeNumber(parseNumeric(r.tax_rate));
      const vatRatePercent = safeNumber(parseNumeric(r.vat_rate));
      const rRevenue = safeNumber(parseNumeric(r.revenue));
      const rSoldQty = safeNumber(parseNumeric(r.soldQty));
      const rFinanceRevenue = safeNumber(parseNumeric(r.financeRevenue));
      const rFinanceSoldQty = safeNumber(parseNumeric(r.financeSoldQty));
      const rOpProfit = safeNumber(parseNumeric(r.opProfit));
      const rCostTotal = safeNumber(parseNumeric(r.costTotal));
      const rOrderProjectedQty = safeNumber(parseNumeric(r.orderProjectedQty));
      const rOrderProjectedRevenue = safeNumber(parseNumeric(r.orderProjectedRevenue));
      const rOrderTurnoverBeforeSpp = safeNumber(parseNumeric(r.orderTurnoverBeforeSpp));
      const rOrderRevenueAfterSpp = safeNumber(parseNumeric(r.orderRevenueAfterSpp));
      const rOrderProjectedOpProfit = safeNumber(parseNumeric(r.orderProjectedOpProfit));
      const rOrderProjectedCostTotal = safeNumber(parseNumeric(r.orderProjectedCostTotal));
      const rOrderProjectedLogistics = safeNumber(parseNumeric(r.orderProjectedLogistics));
      const rOrderProjectedLogisticsRate = r.orderProjectedLogisticsRate === null || r.orderProjectedLogisticsRate === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.orderProjectedLogisticsRate));
      const rOrderProjectedLogisticsSource = typeof r.orderProjectedLogisticsSource === "string"
        ? r.orderProjectedLogisticsSource
        : null;
      const rOrderWarehouseLogistics = safeNumber(parseNumeric(r.orderWarehouseLogistics));
      const rOrderWarehouseLogisticsCoveragePercent = r.orderWarehouseLogisticsCoveragePercent === null || r.orderWarehouseLogisticsCoveragePercent === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.orderWarehouseLogisticsCoveragePercent));
      const rCommission = safeNumber(parseNumeric(r.commission));
      const rLogistics = safeNumber(parseNumeric(r.logistics));
      const rWbStorageFee = safeNumber(parseNumeric(r.wbStorageFee));
      const rWbAcquiringFee = safeNumber(parseNumeric(r.wbAcquiringFee));
      const rWbAdditionalPayment = safeNumber(parseNumeric(r.wbAdditionalPayment));
      const rProvisionalOtherFees = safeNumber(parseNumeric(r.provisionalOtherFees));
      const rOrderQty = r.orderQty === null || r.orderQty === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.orderQty));
      const rOrderRevenue = r.orderRevenue === null || r.orderRevenue === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.orderRevenue));
      const rFunnelViewQty = r.funnelViewQty === null || r.funnelViewQty === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.funnelViewQty));
      const rFunnelAddToCartQty = r.funnelAddToCartQty === null || r.funnelAddToCartQty === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.funnelAddToCartQty));
      const rExactFunnelOrderQty = r.funnelOrderQty === null || r.funnelOrderQty === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.funnelOrderQty));
      const rExactFunnelOrderRevenue = r.funnelOrderRevenue === null || r.funnelOrderRevenue === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.funnelOrderRevenue));
      const rExactFunnelCancelQty = r.funnelCancelQty === null || r.funnelCancelQty === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.funnelCancelQty));
      const rExactFunnelBuyoutQty = r.funnelBuyoutQty === null || r.funnelBuyoutQty === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.funnelBuyoutQty));
      const rExactFunnelBuyoutRevenue = r.funnelBuyoutRevenue === null || r.funnelBuyoutRevenue === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.funnelBuyoutRevenue));
      const rExactFunnelAvgPrice = r.funnelAvgPrice === null || r.funnelAvgPrice === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.funnelAvgPrice));
      const rFunnelAddToCartPercent = r.funnelAddToCartPercent === null || r.funnelAddToCartPercent === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.funnelAddToCartPercent));
      const rFunnelCartToOrderPercent = r.funnelCartToOrderPercent === null || r.funnelCartToOrderPercent === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.funnelCartToOrderPercent));
      const rFunnelOrderToBuyoutPercent = r.funnelOrderToBuyoutPercent === null || r.funnelOrderToBuyoutPercent === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.funnelOrderToBuyoutPercent));
      const rBuyoutPercentWb = r.buyoutPercentWb === null || r.buyoutPercentWb === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.buyoutPercentWb));
      const rManualBuyoutPercent = r.manualBuyoutPercent === null || r.manualBuyoutPercent === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.manualBuyoutPercent));
      const rEffectiveBuyoutPercent = r.effectiveBuyoutPercent === null || r.effectiveBuyoutPercent === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.effectiveBuyoutPercent));
      const rAdSpend = safeNumber(parseNumeric(r.adSpend));
      const rAdOrderSumRaw = safeNumber(parseNumeric(r.adOrderSum));
      const rAdOrderSum = Math.max(
        0,
        rOrderTurnoverBeforeSpp > 0
          ? Math.min(rAdOrderSumRaw, rOrderTurnoverBeforeSpp)
          : rAdOrderSumRaw,
      );
      const rAdViews = safeNumber(parseNumeric(r.adViews));
      const rAdClicks = safeNumber(parseNumeric(r.adClicks));
      const rAdCtrSource = r.adCtrSource === null || r.adCtrSource === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.adCtrSource));
      const rAdCtr = normalizeAdCtrPercent(rAdClicks, rAdViews, rAdCtrSource);
      const rStorageCost = safeNumber(parseNumeric(r.storageCost));
      const rCurrentSpp = r.currentSpp === null || r.currentSpp === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.currentSpp));
      const rCurrentPrice = r.currentPrice === null || r.currentPrice === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.currentPrice));
      const rSellerPriceAfterDiscount = r.sellerPriceAfterDiscount === null || r.sellerPriceAfterDiscount === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.sellerPriceAfterDiscount));
      const rPriceAfterSpp = r.priceAfterSpp === null || r.priceAfterSpp === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.priceAfterSpp));
      const rStockCount = r.stockCount === null || r.stockCount === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.stockCount));
      const rToClientCount = r.toClientCount === null || r.toClientCount === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.toClientCount));
      const rFromClientCount = r.fromClientCount === null || r.fromClientCount === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.fromClientCount));
      const rLostOrdersCountRaw = r.lostOrdersCount === null || r.lostOrdersCount === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.lostOrdersCount));
      const rLostOrdersCount = rLostOrdersCountRaw === null
        ? null
        : Math.max(0, rLostOrdersCountRaw);
      const rAvgStockTurnoverDays = r.avgStockTurnoverDays === null || r.avgStockTurnoverDays === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.avgStockTurnoverDays));
      const rSaleRateDays = r.saleRateDays === null || r.saleRateDays === undefined
        ? null
        : safeNullableNumber(parseNullableNumeric(r.saleRateDays));
      const rFunnelOrderQty = rExactFunnelOrderQty ?? rOrderQty;
      const rFunnelOrderRevenue = rExactFunnelOrderRevenue ?? rOrderRevenue;
      const rFunnelCancelQty = rExactFunnelCancelQty;
      const rFunnelBuyoutQty = rExactFunnelBuyoutQty ?? rSoldQty;
      const rFunnelBuyoutRevenue = rExactFunnelBuyoutRevenue ?? rRevenue;
      const rFunnelAvgPrice = rExactFunnelAvgPrice
        ?? (
          rFunnelBuyoutQty !== null
          && rFunnelBuyoutRevenue !== null
          && rFunnelBuyoutQty > 0
            ? safeNumber(rFunnelBuyoutRevenue / rFunnelBuyoutQty)
            : null
        );

      const profitBeforeTax = safeNumber(rOpProfit - rCostTotal - rAdSpend);
      const taxCalc = calculateTax({
        taxType: r.tax_type,
        taxRatePercent,
        vatMode: r.vat_mode,
        vatRatePercent,
        revenue: rFinanceRevenue,
        profitBeforeTax,
      });
      const netProfit = safeNumber(taxCalc.netProfit);
      const orderProjectedProfitBeforeTax = safeNumber(
        rOrderProjectedOpProfit - rOrderProjectedLogistics - rOrderProjectedCostTotal - rAdSpend - rStorageCost,
      );
      const orderProjectedTaxCalc = calculateTax({
        taxType: r.tax_type,
        taxRatePercent,
        vatMode: r.vat_mode,
        vatRatePercent,
        revenue: rOrderProjectedRevenue,
        profitBeforeTax: orderProjectedProfitBeforeTax,
      });
      const orderProjectedNetProfit = safeNumber(orderProjectedTaxCalc.netProfit);

      // SKU-level data (strictly numeric & rounded)
      skus[nmId][day] = {
        ...r,
        revenue: Math.round(rRevenue),
        soldQty: roundFinancial(rSoldQty),
        financeRevenue: Math.round(rFinanceRevenue),
        financeSoldQty: roundFinancial(rFinanceSoldQty),
        opProfit: Math.round(rOpProfit),
        costTotal: Math.round(rCostTotal),
        orderProjectedQty: roundFinancial(rOrderProjectedQty),
        orderProjectedRevenue: Math.round(rOrderProjectedRevenue),
        orderTurnoverBeforeSpp: Math.round(rOrderTurnoverBeforeSpp),
        orderRevenueAfterSpp: Math.round(rOrderRevenueAfterSpp),
        orderProjectedOpProfit: Math.round(rOrderProjectedOpProfit),
        orderProjectedCostTotal: Math.round(rOrderProjectedCostTotal),
        orderProjectedLogistics: Math.round(rOrderProjectedLogistics),
        orderProjectedLogisticsRate: roundFinancialNullable(rOrderProjectedLogisticsRate),
        orderProjectedLogisticsSource: rOrderProjectedLogisticsSource,
        orderWarehouseLogistics: Math.round(rOrderWarehouseLogistics),
        orderWarehouseLogisticsCoveragePercent: roundFinancialNullable(rOrderWarehouseLogisticsCoveragePercent),
        orderProjectedNetProfit: Math.round(orderProjectedNetProfit),
        commission: Math.round(rCommission),
        logistics: Math.round(rLogistics),
        wbStorageFee: Math.round(rWbStorageFee),
        wbAcquiringFee: Math.round(rWbAcquiringFee),
        wbAdditionalPayment: Math.round(rWbAdditionalPayment),
        provisionalOtherFees: Math.round(rProvisionalOtherFees),
        orderQty: roundFinancialNullable(rOrderQty),
        orderRevenue: rOrderRevenue === null ? null : Math.round(rOrderRevenue),
        funnelViewQty: rFunnelViewQty === null ? null : Math.round(rFunnelViewQty),
        funnelAddToCartQty: rFunnelAddToCartQty === null ? null : Math.round(rFunnelAddToCartQty),
        funnelOrderQty: roundFinancialNullable(rFunnelOrderQty),
        funnelOrderRevenue: rFunnelOrderRevenue === null ? null : Math.round(rFunnelOrderRevenue),
        funnelCancelQty: roundFinancialNullable(rFunnelCancelQty),
        funnelBuyoutQty: roundFinancialNullable(rFunnelBuyoutQty),
        funnelBuyoutRevenue: rFunnelBuyoutRevenue === null ? null : Math.round(rFunnelBuyoutRevenue),
        funnelAvgPrice: rFunnelAvgPrice === null ? null : Math.round(rFunnelAvgPrice),
        funnelAddToCartPercent: roundFinancialNullable(rFunnelAddToCartPercent),
        funnelCartToOrderPercent: roundFinancialNullable(rFunnelCartToOrderPercent),
        funnelOrderToBuyoutPercent: roundFinancialNullable(rFunnelOrderToBuyoutPercent),
        buyoutPercentWb: roundFinancialNullable(rBuyoutPercentWb),
        manualBuyoutPercent: roundFinancialNullable(rManualBuyoutPercent),
        effectiveBuyoutPercent: roundFinancialNullable(rEffectiveBuyoutPercent),
        adSpend: Math.round(rAdSpend),
        adOrderSum: Math.round(rAdOrderSum),
        adViews: Math.round(rAdViews),
        adClicks: Math.round(rAdClicks),
        adCtr: roundFinancialNullable(rAdCtr),
        storageCost: roundFinancial(rStorageCost),
        currentSpp: roundFinancialNullable(rCurrentSpp),
        currentPrice: rCurrentPrice === null ? null : Math.round(rCurrentPrice),
        sellerPriceAfterDiscount: rSellerPriceAfterDiscount === null ? null : Math.round(rSellerPriceAfterDiscount),
        priceAfterSpp: rPriceAfterSpp === null ? null : Math.round(rPriceAfterSpp),
        stockCount: roundFinancialNullable(rStockCount),
        toClientCount: roundFinancialNullable(rToClientCount),
        fromClientCount: roundFinancialNullable(rFromClientCount),
        lostOrdersCount: roundFinancialNullable(rLostOrdersCount),
        avgStockTurnoverDays: roundFinancialNullable(rAvgStockTurnoverDays),
        saleRateDays: roundFinancialNullable(rSaleRateDays),
        netProfit: Math.round(netProfit)
      };

      // Group-level aggregation (strictly numeric & will be rounded finally or kept as sum)
      gd.revenue += rRevenue;
      gd.soldQty += rSoldQty;
      gd.financeRevenue += rFinanceRevenue;
      gd.financeSoldQty += rFinanceSoldQty;
      gd.opProfit += rOpProfit;
      gd.costTotal += rCostTotal;
      gd.orderProjectedQty += rOrderProjectedQty;
      gd.orderProjectedRevenue += rOrderProjectedRevenue;
      gd.orderTurnoverBeforeSpp += rOrderTurnoverBeforeSpp;
      gd.orderRevenueAfterSpp += rOrderRevenueAfterSpp;
      gd.orderProjectedOpProfit += rOrderProjectedOpProfit;
      gd.orderProjectedCostTotal += rOrderProjectedCostTotal;
      gd.orderProjectedNetProfit += orderProjectedNetProfit;
      gd.commission += rCommission;
      gd.logistics += rLogistics;
      gd.wbStorageFee += rWbStorageFee;
      gd.wbAcquiringFee += rWbAcquiringFee;
      gd.wbAdditionalPayment += rWbAdditionalPayment;
      gd.provisionalOtherFees += rProvisionalOtherFees;
      if (rOrderQty !== null && rOrderRevenue !== null) {
        gd.orderQty = (gd.orderQty ?? 0) + rOrderQty;
        gd.orderRevenue = (gd.orderRevenue ?? 0) + rOrderRevenue;
      }
      if (rFunnelViewQty !== null) {
        gd.funnelViewQty = (gd.funnelViewQty ?? 0) + rFunnelViewQty;
      }
      if (rFunnelAddToCartQty !== null) {
        gd.funnelAddToCartQty = (gd.funnelAddToCartQty ?? 0) + rFunnelAddToCartQty;
      }
      if (rFunnelOrderQty !== null) {
        gd.funnelOrderQty = (gd.funnelOrderQty ?? 0) + rFunnelOrderQty;
      }
      gd.orderProjectedLogistics += rOrderProjectedLogistics;
      gd.orderWarehouseLogistics += rOrderWarehouseLogistics;
      if (rOrderWarehouseLogisticsCoveragePercent !== null) {
        const coverageWeight = rOrderQty !== null && rOrderQty > 0
          ? rOrderQty
          : (rFunnelOrderQty !== null && rFunnelOrderQty > 0 ? rFunnelOrderQty : 1);
        gd.orderWarehouseLogisticsCoveragePercent = (gd.orderWarehouseLogisticsCoveragePercent ?? 0)
          + rOrderWarehouseLogisticsCoveragePercent * coverageWeight;
        gd.orderWarehouseLogisticsCoverageWeight = (gd.orderWarehouseLogisticsCoverageWeight ?? 0) + coverageWeight;
        gd.orderWarehouseLogisticsCoverageCount = (gd.orderWarehouseLogisticsCoverageCount ?? 0) + 1;
      }
      if (rFunnelOrderRevenue !== null) {
        gd.funnelOrderRevenue = (gd.funnelOrderRevenue ?? 0) + rFunnelOrderRevenue;
      }
      if (rFunnelCancelQty !== null) {
        gd.funnelCancelQty = (gd.funnelCancelQty ?? 0) + rFunnelCancelQty;
      }
      if (rFunnelBuyoutQty !== null) {
        gd.funnelBuyoutQty = (gd.funnelBuyoutQty ?? 0) + rFunnelBuyoutQty;
      }
      if (rFunnelBuyoutRevenue !== null) {
        gd.funnelBuyoutRevenue = (gd.funnelBuyoutRevenue ?? 0) + rFunnelBuyoutRevenue;
      }
      if (rFunnelAvgPrice !== null) {
        gd.funnelAvgPrice = rFunnelAvgPrice;
      }
      const rawBuyoutPercentWeight = rFunnelOrderQty !== null && rFunnelOrderQty > 0
        ? rFunnelOrderQty
        : rOrderProjectedQty;
      const buyoutPercentWeight = rawBuyoutPercentWeight > 0 ? rawBuyoutPercentWeight : 1;
      const weights = groupBuyoutWeights[day]!;
      if (rBuyoutPercentWb !== null) {
        weights.wbSum += rBuyoutPercentWb * buyoutPercentWeight;
        weights.wbWeight += buyoutPercentWeight;
      }
      if (rManualBuyoutPercent !== null) {
        weights.manualSum += rManualBuyoutPercent * buyoutPercentWeight;
        weights.manualWeight += buyoutPercentWeight;
      }
      if (rEffectiveBuyoutPercent !== null) {
        weights.effectiveSum += rEffectiveBuyoutPercent * buyoutPercentWeight;
        weights.effectiveWeight += buyoutPercentWeight;
      }
      gd.adSpend += rAdSpend;
      gd.adOrderSum += rAdOrderSum;
      gd.adViews += rAdViews;
      gd.adClicks += rAdClicks;
      if (rAdCtrSource !== null) {
        gd.adCtrSource = (gd.adCtrSource ?? 0) + rAdCtrSource;
        gd.adCtrSourceCount = (gd.adCtrSourceCount ?? 0) + 1;
      }
      gd.storageCost += rStorageCost;
      if (rStockCount !== null) {
        gd.stockCount = (gd.stockCount ?? 0) + rStockCount;
      }
      if (rToClientCount !== null) {
        gd.toClientCount = (gd.toClientCount ?? 0) + rToClientCount;
      }
      if (rFromClientCount !== null) {
        gd.fromClientCount = (gd.fromClientCount ?? 0) + rFromClientCount;
      }
      if (rLostOrdersCount !== null) {
        gd.lostOrdersCount = (gd.lostOrdersCount ?? 0) + rLostOrdersCount;
      }
      gd.netProfit += netProfit;
    });

    // Final rounding for group totals
    days.forEach((day) => {
      const g = groupDaily[day]!;
      const buyoutWeights = groupBuyoutWeights[day]!;
      const netProfitWithoutAds = safeNumber(g.netProfit + g.adSpend);
      const profitabilityRevenue = g.financeRevenue > 0 ? g.financeRevenue : g.revenue;
      const profitabilitySoldQty = g.financeSoldQty > 0 ? g.financeSoldQty : g.soldQty;
      const drrRevenueBase = g.adOrderSum > 0
        ? g.adOrderSum
        : (g.funnelOrderRevenue && g.funnelOrderRevenue > 0
          ? g.funnelOrderRevenue
          : (g.orderRevenue && g.orderRevenue > 0 ? g.orderRevenue : null));
      const drr = drrRevenueBase && drrRevenueBase > 0 ? safeNumber((g.adSpend / drrRevenueBase) * 100) : null;
      const funnelAddToCartPercent = g.funnelViewQty && g.funnelViewQty > 0 && g.funnelAddToCartQty !== null
        ? safeNumber((g.funnelAddToCartQty / g.funnelViewQty) * 100)
        : null;
      const funnelCartToOrderPercent = g.funnelAddToCartQty && g.funnelAddToCartQty > 0 && g.funnelOrderQty !== null
        ? safeNumber((g.funnelOrderQty / g.funnelAddToCartQty) * 100)
        : null;
      const sourceCtr = g.adCtrSourceCount && g.adCtrSourceCount > 0 && typeof g.adCtrSource === "number"
        ? safeNumber(g.adCtrSource / g.adCtrSourceCount)
        : null;
      const adCtr = normalizeAdCtrPercent(g.adClicks, g.adViews, sourceCtr);
      const funnelOrderToBuyoutPercent = g.funnelOrderQty && g.funnelOrderQty > 0 && g.funnelBuyoutQty !== null
        ? safeNumber((g.funnelBuyoutQty / g.funnelOrderQty) * 100)
        : null;
      const closedOutcomes = (g.funnelBuyoutQty ?? 0) + (g.funnelCancelQty ?? 0);
      const buyoutPercent = closedOutcomes > 0 && g.funnelBuyoutQty !== null
        ? safeNumber((g.funnelBuyoutQty / closedOutcomes) * 100)
        : funnelOrderToBuyoutPercent;
      const avgOrderPrice = g.funnelOrderQty && g.funnelOrderQty > 0 && g.funnelOrderRevenue !== null
        ? safeNumber(g.funnelOrderRevenue / g.funnelOrderQty)
        : (
            g.orderQty && g.orderQty > 0 && g.orderRevenue !== null
              ? safeNumber(g.orderRevenue / g.orderQty)
              : null
          );
      const avgBuyoutPrice = profitabilitySoldQty > 0 ? safeNumber(profitabilityRevenue / profitabilitySoldQty) : null;
      const profitPerUnit = profitabilitySoldQty > 0 ? safeNumber(g.netProfit / profitabilitySoldQty) : null;
      const orderProjectedLogisticsRate = g.orderProjectedQty > 0
        ? safeNumber(g.orderProjectedLogistics / g.orderProjectedQty)
        : null;

      g.revenue = Math.round(g.revenue);
      g.soldQty = roundFinancial(g.soldQty);
      g.financeRevenue = Math.round(g.financeRevenue);
      g.financeSoldQty = roundFinancial(g.financeSoldQty);
      g.opProfit = Math.round(g.opProfit);
      g.costTotal = Math.round(g.costTotal);
      g.orderProjectedQty = roundFinancial(g.orderProjectedQty);
      g.orderProjectedRevenue = Math.round(g.orderProjectedRevenue);
      g.orderTurnoverBeforeSpp = Math.round(g.orderTurnoverBeforeSpp);
      g.orderRevenueAfterSpp = Math.round(g.orderRevenueAfterSpp);
      g.orderProjectedOpProfit = Math.round(g.orderProjectedOpProfit);
      g.orderProjectedCostTotal = Math.round(g.orderProjectedCostTotal);
      g.orderProjectedLogistics = Math.round(g.orderProjectedLogistics);
      g.orderProjectedLogisticsRate = roundFinancialNullable(orderProjectedLogisticsRate);
      g.orderWarehouseLogistics = Math.round(g.orderWarehouseLogistics);
      g.orderWarehouseLogisticsCoveragePercent = g.orderWarehouseLogisticsCoverageWeight && g.orderWarehouseLogisticsCoverageWeight > 0
        ? roundFinancial((g.orderWarehouseLogisticsCoveragePercent ?? 0) / g.orderWarehouseLogisticsCoverageWeight)
        : null;
      delete g.orderWarehouseLogisticsCoverageCount;
      delete g.orderWarehouseLogisticsCoverageWeight;
      g.orderProjectedNetProfit = Math.round(g.orderProjectedNetProfit);
      g.commission = Math.round(g.commission);
      g.logistics = Math.round(g.logistics);
      g.wbStorageFee = Math.round(g.wbStorageFee);
      g.wbAcquiringFee = Math.round(g.wbAcquiringFee);
      g.wbAdditionalPayment = Math.round(g.wbAdditionalPayment);
      g.provisionalOtherFees = Math.round(g.provisionalOtherFees);
      g.orderQty = roundFinancialNullable(g.orderQty);
      g.orderRevenue = g.orderRevenue === null ? null : Math.round(g.orderRevenue);
      g.funnelViewQty = g.funnelViewQty === null ? null : Math.round(g.funnelViewQty);
      g.funnelAddToCartQty = g.funnelAddToCartQty === null ? null : Math.round(g.funnelAddToCartQty);
      g.funnelOrderQty = roundFinancialNullable(g.funnelOrderQty);
      g.funnelOrderRevenue = g.funnelOrderRevenue === null ? null : Math.round(g.funnelOrderRevenue);
      g.funnelCancelQty = roundFinancialNullable(g.funnelCancelQty);
      g.funnelBuyoutQty = roundFinancialNullable(g.funnelBuyoutQty);
      g.funnelBuyoutRevenue = g.funnelBuyoutRevenue === null ? null : Math.round(g.funnelBuyoutRevenue);
      g.funnelAvgPrice = g.funnelBuyoutQty !== null && g.funnelBuyoutQty > 0 && g.funnelBuyoutRevenue !== null
        ? Math.round(safeNumber(g.funnelBuyoutRevenue / g.funnelBuyoutQty))
        : (g.funnelAvgPrice === null ? null : Math.round(g.funnelAvgPrice));
      g.funnelAddToCartPercent = roundFinancialNullable(funnelAddToCartPercent);
      g.funnelCartToOrderPercent = roundFinancialNullable(funnelCartToOrderPercent);
      g.funnelOrderToBuyoutPercent = roundFinancialNullable(funnelOrderToBuyoutPercent);
      g.adSpend = Math.round(g.adSpend);
      g.adViews = Math.round(g.adViews);
      g.adClicks = Math.round(g.adClicks);
      g.adCtr = roundFinancialNullable(adCtr);
      g.storageCost = roundFinancial(g.storageCost);
      g.stockCount = roundFinancialNullable(g.stockCount);
      g.toClientCount = roundFinancialNullable(g.toClientCount);
      g.fromClientCount = roundFinancialNullable(g.fromClientCount);
      g.lostOrdersCount = roundFinancialNullable(g.lostOrdersCount);
      g.netProfit = Math.round(g.netProfit);
      g.netProfitBeforeAds = Math.round(netProfitWithoutAds);
      g.drr = roundFinancialNullable(drr);
      g.buyoutPercent = roundFinancialNullable(buyoutPercent);
      g.buyoutPercentWb = buyoutWeights.wbWeight > 0
        ? roundFinancialNullable(buyoutWeights.wbSum / buyoutWeights.wbWeight)
        : null;
      g.manualBuyoutPercent = buyoutWeights.manualWeight > 0
        ? roundFinancialNullable(buyoutWeights.manualSum / buyoutWeights.manualWeight)
        : null;
      g.effectiveBuyoutPercent = buyoutWeights.effectiveWeight > 0
        ? roundFinancialNullable(buyoutWeights.effectiveSum / buyoutWeights.effectiveWeight)
        : null;
      g.avgOrderPrice = avgOrderPrice === null ? null : Math.round(avgOrderPrice);
      g.avgBuyoutPrice = avgBuyoutPrice === null ? null : Math.round(avgBuyoutPrice);
      g.profitPerUnit = profitPerUnit === null ? null : Math.round(profitPerUnit);
    });

    Object.values(skus).forEach((series) => {
      Object.values(series).forEach((entry) => {
        const netProfitWithoutAds = safeNumber(entry.netProfit + entry.adSpend);
        const profitabilityRevenue = entry.financeRevenue > 0 ? entry.financeRevenue : entry.revenue;
        const profitabilitySoldQty = entry.financeSoldQty > 0 ? entry.financeSoldQty : entry.soldQty;
        const drrRevenueBase = entry.adOrderSum && entry.adOrderSum > 0
          ? entry.adOrderSum
          : (entry.funnelOrderRevenue && entry.funnelOrderRevenue > 0
            ? entry.funnelOrderRevenue
            : (entry.orderRevenue && entry.orderRevenue > 0 ? entry.orderRevenue : null));
        const drr = drrRevenueBase && drrRevenueBase > 0 ? safeNumber((entry.adSpend / drrRevenueBase) * 100) : null;
        const closedOutcomes = (entry.funnelBuyoutQty ?? 0) + (entry.funnelCancelQty ?? 0);
        const buyoutPercent = closedOutcomes > 0 && entry.funnelBuyoutQty !== null && entry.funnelBuyoutQty !== undefined
          ? safeNumber((entry.funnelBuyoutQty / closedOutcomes) * 100)
          : (entry.funnelOrderToBuyoutPercent ?? null);
        const avgOrderPrice = entry.funnelOrderQty && entry.funnelOrderQty > 0 && entry.funnelOrderRevenue !== null && entry.funnelOrderRevenue !== undefined
          ? safeNumber(entry.funnelOrderRevenue / entry.funnelOrderQty)
          : (
              entry.orderQty && entry.orderQty > 0 && entry.orderRevenue !== null && entry.orderRevenue !== undefined
                ? safeNumber(entry.orderRevenue / entry.orderQty)
                : null
            );
        const avgBuyoutPrice = profitabilitySoldQty > 0 ? safeNumber(profitabilityRevenue / profitabilitySoldQty) : null;
        const profitPerUnit = profitabilitySoldQty > 0 ? safeNumber(entry.netProfit / profitabilitySoldQty) : null;
        const funnelAvgPrice = entry.funnelBuyoutQty && entry.funnelBuyoutQty > 0 && entry.funnelBuyoutRevenue !== null
          ? safeNumber(entry.funnelBuyoutRevenue / entry.funnelBuyoutQty)
          : entry.funnelAvgPrice;
        const entryAdCtrSource = typeof entry.adCtr === "number" ? entry.adCtr : null;
        const adCtr = normalizeAdCtrPercent(entry.adClicks, entry.adViews, entryAdCtrSource);

        entry.netProfitBeforeAds = Math.round(netProfitWithoutAds);
        entry.drr = roundFinancialNullable(drr);
        entry.adCtr = roundFinancialNullable(adCtr);
        entry.buyoutPercent = roundFinancialNullable(buyoutPercent);
        entry.avgOrderPrice = avgOrderPrice === null ? null : Math.round(avgOrderPrice);
        entry.avgBuyoutPrice = avgBuyoutPrice === null ? null : Math.round(avgBuyoutPrice);
        entry.profitPerUnit = profitPerUnit === null ? null : Math.round(profitPerUnit);
        entry.funnelAvgPrice = funnelAvgPrice === null || funnelAvgPrice === undefined ? null : Math.round(funnelAvgPrice);
      });
    });

    // Показы и переходы по дням из per-nm воронки ЛК (raw_api_sales_funnel_nm_daily).
    // Источник отдельный от funnel_view_qty (переходы из funnel_stats), поэтому CTR
    // воронки = переходы/показы считаем из ЭТОЙ таблицы (само-согласованно).
    // Ключ дня — TO_CHAR(date,'DD.MM.YYYY'), как в основном запросе.
    try {
      const imprRows = (await withTenantContext(db, tenantId, async (tx) => tx.execute(sql`
        SELECT
          TO_CHAR(date, 'DD.MM.YYYY') as day,
          nm_id as "nmId",
          SUM(view_count)::numeric as views,
          SUM(open_card_count)::numeric as transitions
        FROM raw_api_sales_funnel_nm_daily
        WHERE tenant_id = ${tenantId}
          AND nm_id IN (${nmIdList})
          AND date::date >= ${fromDate}::date
          AND date::date <= ${toDate}::date
        GROUP BY date, nm_id
      `))) as unknown as Array<{ day: string; nmId: number | string; views: number | string; transitions: number | string }>;

      const imprByDay = new Map<string, { views: number; transitions: number }>();
      for (const row of imprRows) {
        const day = String(row.day);
        const nmId = Number(row.nmId);
        const views = safeNumber(parseNumeric(row.views));
        const transitions = safeNumber(parseNumeric(row.transitions));
        const agg = imprByDay.get(day) ?? { views: 0, transitions: 0 };
        agg.views += views;
        agg.transitions += transitions;
        imprByDay.set(day, agg);
        const skuDay = skus[nmId]?.[day];
        if (skuDay) {
          skuDay.funnelImpressionsQty = Math.round(views);
          skuDay.funnelImpressionsOpenCard = Math.round(transitions);
        }
      }
      for (const [day, agg] of imprByDay) {
        const gd = groupDaily[day];
        if (gd) {
          gd.funnelImpressionsQty = Math.round(agg.views);
          gd.funnelImpressionsOpenCard = Math.round(agg.transitions);
        }
      }
    } catch (error) {
      console.error('[getGroupDynamics] sales-funnel impressions join failed', error);
    }

    return {
      days,
      group: groupDaily,
      skus,
      meta: {
        finance: {
          mode: "operational_actual",
          calculationMode,
          label: includesOperationalTail ? "Факт WB + оперативный хвост" : "Факт WB",
          realizationCutoffDate,
          includesOperationalTail,
          operationalTailFrom,
          operationalTailTo: includesOperationalTail ? toDate : null,
        },
      },
    };
  }

  static getSignalNotifications = SignalNotificationsService.getSignalNotifications;
  static markSignalNotificationsRead = SignalNotificationsService.markSignalNotificationsRead;
  static acknowledgeSignalNotifications = SignalNotificationsService.acknowledgeSignalNotifications;

  static getSignalAutomationRuns = SignalAutomationQueriesService.getSignalAutomationRuns;
  static getSignalAutomationRunDetails = SignalAutomationQueriesService.getSignalAutomationRunDetails;
  static getSignalAutomationSuppressions = SignalAutomationQueriesService.getSignalAutomationSuppressions;
  static getSignalAutomationControlEvents = SignalAutomationQueriesService.getSignalAutomationControlEvents;
  static getMatchingSignalAutomationSuppressions = SignalAutomationQueriesService.getMatchingSignalAutomationSuppressions;
  static recordSignalAutomationControlEvent = SignalAutomationQueriesService.recordSignalAutomationControlEvent;

  static resolveSignalSavedViewSharedOwner = SignalSavedViewsService.resolveSignalSavedViewSharedOwner;
  static getSignalSavedViewNextPosition = SignalSavedViewsService.getSignalSavedViewNextPosition;
  static getSignalSavedViewForMutation = SignalSavedViewsService.getSignalSavedViewForMutation;
  static getSignalSavedViews = SignalSavedViewsService.getSignalSavedViews;
  static saveSignalSavedView = SignalSavedViewsService.saveSignalSavedView;
  static updateSignalSavedView = SignalSavedViewsService.updateSignalSavedView;
  static setSignalSavedViewDefault = SignalSavedViewsService.setSignalSavedViewDefault;
  static toggleSignalSavedViewPin = SignalSavedViewsService.toggleSignalSavedViewPin;
  static moveSignalSavedView = SignalSavedViewsService.moveSignalSavedView;
  static deleteSignalSavedView = SignalSavedViewsService.deleteSignalSavedView;
}
