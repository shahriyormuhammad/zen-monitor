/**
 * Pure cell-value resolver for the Unit Economics wide table.
 *
 * `resolveCellText` maps a column id to a human-readable string value for a
 * given (row, summary, manualFields) triple. It is intentionally side-effect-
 * free so it can be used both in the React table row renderer AND in the Excel
 * export without any DOM / React dependency.
 *
 * Columns that require interactive React elements (photo, article, price) are
 * NOT handled here — the table component renders them inline so it can attach
 * click handlers and state.
 *
 * Keep this file in sync with `UnitEconomicsTemplateTable.tsx:renderReadOnlyCell`
 * (the legacy monolith). Numerical output MUST be identical.
 */

import { clampPercent, formatCurrency, formatNumber, formatPercent, formatText, hasManualValue, toNumber } from '../helpers';
import type { ManualFields, RowSummary, UnitTemplateRow } from '../types';
import { resolveWbVolumeLiters } from './utils';

/** Sentinel — column should render an interactive React element, not plain text. */
export const INTERACTIVE_COLUMN = '__interactive__' as const;

function resolvePurchaseCost(row: UnitTemplateRow, manualFields: ManualFields): number {
  const manualPurchase = toNumber(manualFields.costPrice);
  if (manualPurchase > 0) return manualPurchase;

  const configuredPurchase = toNumber(row.purchasePrice);
  if (configuredPurchase > 0) return configuredPurchase;

  const selectedWarehouseCosts = manualFields.selectedWarehouses
    .map((warehouseId) => toNumber(manualFields.warehouseCosts[warehouseId]))
    .filter((value) => value > 0);
  const hasDetailedCosts = toNumber(manualFields.deliveryToFf) > 0
    || toNumber(manualFields.packagingMaterial) > 0
    || toNumber(manualFields.fulfillment) > 0
    || selectedWarehouseCosts.length > 0;

  if (hasDetailedCosts) return 0;

  return toNumber(row.costPrice);
}

/**
 * Returns the display string for a cell, or `INTERACTIVE_COLUMN` for columns
 * that need a React element (photo, article, price).
 *
 * Returns `'—'` for empty / zero values in optional fields.
 */
export function resolveCellText(
  columnId: string,
  row: UnitTemplateRow,
  summary: RowSummary,
  manualFields: ManualFields,
): string | typeof INTERACTIVE_COLUMN {
  // Dynamic warehouse columns
  if (columnId.startsWith('warehouse:')) {
    if (columnId === 'warehouse:summary') {
      return manualFields.selectedWarehouses.length > 0
        ? `Выбрано: ${manualFields.selectedWarehouses.length}`
        : 'Склады не выбраны';
    }
    return '—';
  }

  switch (columnId) {
    // Interactive React elements — caller must render these
    case 'photo':
    case 'article':
    case 'price':
      return INTERACTIVE_COLUMN;

    // Identity / metadata
    case 'seller_article':
      return formatText(row.vendorCode);
    case 'category':
      return formatText(row.category);

    // Geometry
    case 'volume': {
      const explicitVolume = formatText(row.volume);
      if (explicitVolume !== '—') return explicitVolume;
      return summary.volumeLiters > 0 ? `${summary.volumeLiters.toFixed(2)} л` : '—';
    }
    case 'wb_volume': {
      const wbVol = resolveWbVolumeLiters(row);
      return wbVol > 0 ? `${wbVol.toFixed(2)} л` : '—';
    }
    case 'length':
      return formatText(row.length);
    case 'width':
      return formatText(row.width);
    case 'height':
      return formatText(row.height);

    // Cost structure (per-unit)
    case 'cost_price_1': {
      const purchaseCost = resolvePurchaseCost(row, manualFields);
      return purchaseCost > 0 ? formatCurrency(purchaseCost, 2) : '—';
    }
    case 'cost_price_2':
      return summary.batchCostPriceTotal > 0 ? formatCurrency(summary.batchCostPriceTotal, 2) : '—';
    case 'delivery_to_ff_1':
      return toNumber(manualFields.deliveryToFf) > 0 ? formatCurrency(toNumber(manualFields.deliveryToFf), 2) : '—';
    case 'delivery_to_ff_2':
      return summary.batchDeliveryToFfTotal > 0 ? formatCurrency(summary.batchDeliveryToFfTotal, 2) : '—';
    case 'packaging_1':
      return toNumber(manualFields.packagingMaterial) > 0 ? formatCurrency(toNumber(manualFields.packagingMaterial), 2) : '—';
    case 'packaging_2':
      return summary.batchPackagingTotal > 0 ? formatCurrency(summary.batchPackagingTotal, 2) : '—';
    case 'fulfillment_1':
      return toNumber(manualFields.fulfillment) > 0 ? formatCurrency(toNumber(manualFields.fulfillment), 2) : '—';
    case 'fulfillment_2':
      return summary.batchFulfillmentTotal > 0 ? formatCurrency(summary.batchFulfillmentTotal, 2) : '—';
    case 'delivery_to_mp_1':
      return summary.deliveryToMarketplaceComputed > 0 ? formatCurrency(summary.deliveryToMarketplaceComputed, 2) : '—';
    case 'delivery_to_mp_2':
      return summary.batchDeliveryToMarketplaceTotal > 0 ? formatCurrency(summary.batchDeliveryToMarketplaceTotal, 2) : '—';
    case 'full_cost':
      return summary.fullCost > 0 ? formatCurrency(summary.fullCost, 2) : '—';
    case 'purchase_price':
      return summary.batchCostTotal > 0 ? formatCurrency(summary.batchCostTotal, 2) : '—';

    // WB warehouse cost estimates (per-unit averages)
    case 'warehouse_logistics':
      return summary.avgWbLogisticsPerUnit > 0 ? formatCurrency(summary.avgWbLogisticsPerUnit, 2) : '—';
    case 'warehouse_storage':
      return summary.avgWbStoragePerUnit > 0 ? formatCurrency(summary.avgWbStoragePerUnit, 2) : '—';

    // Visual separator column
    case 'separator':
      return '';

    // Price scenario
    case 'wb_price_before_discount':
      return summary.priceBeforeWbDiscount > 0 ? formatCurrency(summary.priceBeforeWbDiscount, 2) : '—';
    case 'price_after_wb':
      return summary.priceAfterWb > 0 ? formatCurrency(summary.priceAfterWb, 2) : '—';
    case 'seller_discount':
      return formatPercent(summary.sellerDiscountPercent, 1);
    case 'wb_discount':
      return formatPercent(summary.wbDiscountPercent, 1);
    case 'buyout': {
      const activeScenario = manualFields.priceScenarios[manualFields.activePriceScenarioId];
      return hasManualValue(activeScenario?.buyoutPercent)
        ? formatPercent(clampPercent(toNumber(activeScenario?.buyoutPercent)), 1)
        : '—';
    }
    case 'buyout_auto':
      return summary.buyoutSource === 'auto'
        ? `${formatPercent(summary.buyoutAutoPercent, 1)}*`
        : '—';

    // Marketplace fees
    case 'marketplace_fee_percent_1':
      return summary.commissionPercent > 0 ? formatPercent(summary.commissionPercent, 1) : '—';
    case 'marketplace_fee_percent_2':
      return summary.batchCommissionTotal > 0 ? formatCurrency(summary.batchCommissionTotal, 2) : '—';
    case 'marketplace_percent_total':
      return summary.batchMarketplacePercentTotal > 0 ? formatPercent(summary.batchMarketplacePercentTotal, 1) : '—';
    case 'marketplace_fee_rub':
      return summary.commission > 0 ? formatCurrency(summary.commission, 2) : '—';

    // Logistics
    case 'marketplace_logistics_avg':
      return summary.logisticsPerUnit > 0 ? formatCurrency(summary.logisticsPerUnit, 2) : '—';
    case 'marketplace_logistics_to_spp':
      return summary.batchLogisticsToSppPercent > 0 ? formatPercent(summary.batchLogisticsToSppPercent, 1) : '—';
    case 'marketplace_logistics_total':
      return summary.logisticsTotalComputed > 0 ? formatCurrency(summary.logisticsTotalComputed, 2) : '—';
    case 'marketplace_logistics_2':
      return summary.batchLogisticsTotal > 0 ? formatCurrency(summary.batchLogisticsTotal, 2) : '—';

    // Storage
    case 'marketplace_storage_avg':
      return summary.storagePerUnit > 0 ? formatCurrency(summary.storagePerUnit, 2) : '—';
    case 'marketplace_storage_total_1':
      return summary.storageTotalComputed > 0 ? formatCurrency(summary.storageTotalComputed, 2) : '—';
    case 'marketplace_storage_total_2':
      return summary.batchStorageTotal > 0 ? formatCurrency(summary.batchStorageTotal, 2) : '—';

    // Acquiring & total MP
    case 'acquiring_3':
      return summary.acquiring > 0 ? formatCurrency(summary.acquiring, 2) : '—';
    case 'acquiring':
      return summary.batchAcquiringTotal > 0 ? formatCurrency(summary.batchAcquiringTotal, 2) : '—';
    case 'marketplace_plus_storage_total':
      return summary.marketplacePlusStorageTotal > 0 ? formatCurrency(summary.marketplacePlusStorageTotal, 2) : '—';

    // Settlement & tax (per-unit)
    case 'to_settlement_account_1':
      return summary.toSettlementAccount > 0 ? formatCurrency(summary.toSettlementAccount, 2) : '—';
    case 'tax_percent_1':
    // falls through
    case 'tax_percent_2':
      return summary.taxPercent > 0 ? formatPercent(summary.taxPercent, 1) : '—';
    case 'tax_rub_1':
      return summary.taxRub > 0 ? formatCurrency(summary.taxRub, 2) : '—';
    case 'revenue_after_tax_1':
      return summary.revenueAfterTax > 0 ? formatCurrency(summary.revenueAfterTax, 2) : '—';
    case 'profit_rub':
      return formatCurrency(summary.netProfit, 2);

    // Batch (purchase-quantity level)
    case 'sales_sum_per_rc':
      return summary.batchRevenue > 0 ? formatCurrency(summary.batchRevenue, 2) : '—';
    case 'to_settlement_account_2':
      return summary.batchToSettlementAccount > 0 ? formatCurrency(summary.batchToSettlementAccount, 2) : '—';
    case 'tax_rub_2':
      return summary.batchTaxRub > 0 ? formatCurrency(summary.batchTaxRub, 2) : '—';
    case 'revenue_after_tax_2':
      return summary.batchRevenueAfterTax > 0 ? formatCurrency(summary.batchRevenueAfterTax, 2) : '—';
    case 'marginal_profit':
      return formatCurrency(summary.batchMarginalProfit, 2);
    case 'gross_profit':
      return formatCurrency(summary.batchGrossProfit, 2);

    // Marketing
    case 'marketing_internal':
      return summary.marketingInternal > 0 ? formatCurrency(summary.marketingInternal, 2) : '0 ₽';
    case 'marketing_external':
      return summary.marketingExternal > 0 ? formatCurrency(summary.marketingExternal, 2) : '0 ₽';
    case 'content_cost':
      return summary.contentCost > 0 ? formatCurrency(summary.contentCost, 2) : '0 ₽';
    case 'other_costs':
      return summary.otherCosts > 0 ? formatCurrency(summary.otherCosts, 2) : '0 ₽';
    case 'drr_percent':
      return summary.drrPercent > 0 ? formatPercent(summary.drrPercent, 2) : '0.00%';
    case 'drr_percent_buyouts':
      return summary.drrPercentBuyouts > 0 ? formatPercent(summary.drrPercentBuyouts, 2) : '0.00%';
    case 'cpo_plan':
      return summary.cpoPlan > 0 ? formatCurrency(summary.cpoPlan, 2) : '0 ₽';
    case 'cps_plan':
      return summary.cpsPlan > 0 ? formatCurrency(summary.cpsPlan, 2) : '0 ₽';

    // P&L ratios
    case 'markup_from_price_to_spp': {
      // Наценка = wb_price / full_cost. Typical 1-10. If full_cost is tiny
      // (or near zero) ratio explodes; show with «×» prefix and clamp the
      // fractional digits so the column doesn't show «4118» without a comma
      // (decimals get dropped by toLocaleString when the integer part has
      // 4+ digits and we still ask for 3 fractional digits — confusing).
      const ratio = summary.markupFromPriceToSppRatio;
      if (!Number.isFinite(ratio) || ratio <= 0) return '—';
      // Below 100 — keep 2 decimal places, e.g. «×5.81». Otherwise integer.
      const formatted = ratio < 100
        ? `×${formatNumber(ratio, 2)}`
        : `×${formatNumber(Math.round(ratio), 0)}`;
      return formatted;
    }
    case 'margin':
      return summary.marginPercent ? formatPercent(summary.marginPercent) : '—';
    case 'profitability':
      return summary.profitabilityPercent ? formatPercent(summary.profitabilityPercent) : '—';
    case 'invested_rub_profit_percent':
      return summary.batchProfitabilityPercent ? formatPercent(summary.batchProfitabilityPercent) : '—';

    // Batch volume metrics
    case 'purchase_qty_total':
      return summary.purchaseQtyTotal > 0 ? summary.purchaseQtyTotal.toLocaleString('ru-RU') : '—';
    case 'gross_profit_per_unit':
      return summary.batchGrossProfitPerUnit ? formatCurrency(summary.batchGrossProfitPerUnit, 2) : '—';
    case 'revenue_in_orders':
      return summary.batchRevenueInOrders > 0 ? formatCurrency(summary.batchRevenueInOrders, 2) : '—';
    case 'turnover':
      return summary.batchRevenue > 0 ? formatCurrency(summary.batchRevenue, 2) : '—';
    case 'turnover_days':
      return summary.turnoverDays > 0 ? `${formatNumber(summary.turnoverDays, 0)} дн` : '—';

    default:
      return '—';
  }
}
