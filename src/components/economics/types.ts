/**
 * Type definitions for the Unit Economics module.
 *
 * Extracted from the legacy `UnitEconomicsTemplateTable.tsx` so that the new
 * UI layer (and hooks/utilities) can reuse them without dragging the rest
 * of the monolithic component along.
 *
 * Important: keep these types backward-compatible with the data shape that
 * `/api/views/economics-template` returns and with the `ManualFields` payload
 * stored in localStorage and `unitEconomicsManualInputs` rows in the DB. The
 * calculations and persistence layer rely on these names verbatim.
 */

export type PriceScenarioId = 'excellent' | 'good' | 'average' | 'poor';

export type TradeScheme = 'fbw' | 'fbs';

export type RowFilterMode = 'all' | 'withSales' | 'withCost' | 'withoutCost' | 'toOrder' | 'selected';

export type ActiveTab = 'fact' | 'costs' | 'price' | 'pnl' | 'batch';

export type WarehouseTariff = {
  date?: string | null;
  coefficient?: number | string | null;
  warehouseId?: number | string | null;
  warehouseName?: string | null;
  allowUnload?: boolean | null;
  boxTypeId?: number | string | null;
  storageCoef?: number | string | null;
  deliveryCoef?: number | string | null;
  deliveryBaseLiter?: number | string | null;
  deliveryAdditionalLiter?: number | string | null;
  storageBaseLiter?: number | string | null;
  storageAdditionalLiter?: number | string | null;
  reverseBaseLiter?: number | string | null;
  reverseAdditionalLiter?: number | string | null;
  reverseCoef?: number | string | null;
  isSortingCenter?: boolean | null;
};

export type WarehouseBoxTariff = {
  warehouseName?: string | null;
  geoName?: string | null;
  boxDeliveryBase?: number | string | null;
  boxDeliveryLiter?: number | string | null;
  boxStorageBase?: number | string | null;
  boxStorageLiter?: number | string | null;
  boxDeliveryCoefExpr?: number | string | null;
  boxStorageCoefExpr?: number | string | null;
  boxDeliveryMarketplaceBase?: number | string | null;
  boxDeliveryMarketplaceLiter?: number | string | null;
  boxDeliveryMarketplaceCoefExpr?: number | string | null;
};

export type WarehouseReturnTariff = {
  warehouseName?: string | null;
  geoName?: string | null;
  deliveryDumpKgtOfficeBase?: number | string | null;
  deliveryDumpKgtOfficeLiter?: number | string | null;
  deliveryDumpKgtReturnExpr?: number | string | null;
  deliveryDumpSrgOfficeBase?: number | string | null;
  deliveryDumpSrgOfficeLiter?: number | string | null;
  deliveryDumpSrgReturnExpr?: number | string | null;
  deliveryDumpSupOfficeBase?: number | string | null;
  deliveryDumpSupOfficeLiter?: number | string | null;
  deliveryDumpSupReturnExpr?: number | string | null;
};

/**
 * Single row delivered by `/api/views/economics-template` for one nmId.
 * Fields beyond the listed ones may exist (the API is generous with extras),
 * hence the index signature for forward compatibility.
 */
export type UnitTemplateRow = {
  nmId?: number | string;
  imtId?: number | string;
  photoUrl?: string | null;
  brand?: string | null;
  barcode?: string | null;
  category?: string | null;
  vendorCode?: string | null;
  soldQuantity?: number | string;
  grossRevenue?: number | string;
  purchasePrice?: number | string;
  costPrice?: number | string;
  commission?: number | string;
  logistics?: number | string;
  totalCost?: number | string;
  netProfit?: number | string;
  adSpend?: number | string;
  views?: number | string;
  volume?: string | null;
  volumeLiters?: number | string | null;
  wbVolumeLiters?: number | string | null;
  length?: string | null;
  width?: string | null;
  height?: string | null;
  categoryCommissionPercent?: number | string | null;
  categoryCommissionPercentFbw?: number | string | null;
  categoryCommissionPercentFbs?: number | string | null;
  buyoutPercentFact?: number | string | null;
  buyoutOrderCountFact?: number | string | null;
  buyoutCountFact?: number | string | null;
  buyoutCancelCountFact?: number | string | null;
  buyoutReturnCountFact?: number | string | null;
  buyoutHistoryDaysFact?: number | string | null;
  buyoutFirstActivityDateFact?: string | null;
  buyoutLastActivityDateFact?: string | null;
  wbStockWarehouses?: Array<{
    warehouseName: string;
    quantity: number;
    source?: 'stocks' | 'stock_sizes';
  }>;
  /** Доля локальных заказов SKU от WB API. Храним для диагностики, не как активный кабинетный ИЛ/ИРП. */
  localizationPercent?: number | null;
  /** Единый кабинетный ИЛ из WB «Поставки → Тарифы» или 13-недельного fallback. */
  cabinetLocalityIndex?: number | string | null;
  /** Единый кабинетный ИРП (%) из WB «Поставки → Тарифы» или 13-недельного fallback. */
  cabinetIrpPercent?: number | string | null;
  cabinetIndicesSource?: 'wb_tariffs' | 'manual' | 'calculated_fallback' | 'none' | string | null;
  cabinetIndicesEffectiveWeek?: string | null;
  cabinetIndicesFetchedAt?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [extra: string]: any;
};

export type PriceScenarioDraft = {
  sellerPriceBeforeDiscount: string;
  sellerDiscount: string;
  wbDiscount: string;
  buyoutPercent: string;
};

/**
 * The full set of manual user-entered values per nmId.
 *
 * Persisted both to:
 *  - localStorage (key: `economics-template-manual:${tenantId}:${nmId}`),
 *  - PostgreSQL (`unit_economics_manual_inputs`) via `saveUnitEconomicsManualFields`.
 *
 * Adding/removing fields here is a backwards-compatibility break; see
 * `parseManualFieldsPayload` for safe defaults that handle missing fields.
 */
export type ManualFields = {
  costPrice: string;
  deliveryToFf: string;
  packagingMaterial: string;
  fulfillment: string;
  /** ИРП — Индекс Распределения Продаж — ручной override авторасчёта от WB localizationPercent. */
  irpPercent: string;
  /** ИЛ — Индекс Локализации — коэффициент к forward (0.5..2.0).
   * Field name is legacy; values >2 are treated as old percent-delta input.
   * Field optional in legacy payloads (parseManualFieldsPayload defaults to ''). */
  localityIndexPercent: string;
  purchaseQtyTotal: string;
  taxPercent: string;
  turnoverDays: string;
  /** Manual target DRR in orders (%). If set, marketingInternal is derived from revenue in orders. */
  drrPercent: string;
  marketingInternal: string;
  marketingExternal: string;
  contentCost: string;
  otherCosts: string;
  cpoPlan: string;
  cpsPlan: string;
  selectedWarehouses: string[];
  warehouseCosts: Record<string, string>;
  customWarehouses: Array<{ id: string; label: string }>;
  /** User cleared warehouses manually, so top-WB auto selection should not reapply. */
  warehouseAutoSelectionDisabled: boolean;
  activePriceScenarioId: PriceScenarioId;
  tradeScheme: TradeScheme;
  priceScenarios: Record<PriceScenarioId, PriceScenarioDraft>;
};

/**
 * Computed financial summary for a single (row, manualFields) combination.
 *
 * Every field here is derived; nothing in `RowSummary` is user-entered.
 * Used by the SummaryBar, all detail tabs, and the Excel export.
 */
export type RowSummary = {
  // Sales actuals
  soldQuantity: number;
  grossRevenue: number;
  // Projection (per-unit, current scenario)
  projectedRevenue: number;
  commission: number;
  netProfit: number;
  // Geometry
  volumeLiters: number;
  // Cost structure (per-unit)
  deliveryToMarketplaceComputed: number;
  fullCost: number;
  avgWbLogisticsPerUnit: number;
  avgWbStoragePerUnit: number;
  averagePrice: number;
  // Active price scenario breakdown
  sellerPriceBeforeDiscount: number;
  priceBeforeWbDiscount: number;
  priceAfterWb: number;
  sellerDiscountPercent: number;
  wbDiscountPercent: number;
  buyoutManualPercent: number;
  buyoutAutoPercent: number;
  buyoutHistoryDays: number;
  buyoutSource: 'auto' | 'manual' | 'none';
  buyoutPercent: number;
  buyoutOrderCount: number;
  buyoutBuyoutCount: number;
  buyoutCancelCount: number;
  buyoutReturnCount: number;
  buyoutClosedCount: number;
  buyoutOpenCount: number;
  buyoutOpenShare: number;
  buyoutAutoReason: 'ok' | 'no_history' | 'no_fact' | 'low_closed_base' | 'high_open_share';
  buyoutAutoWarning: string | null;
  /** ИРП (Индекс Распределения Продаж) — % надбавка от цены до скидки WB. */
  irpPercent: number;
  /** Фактический ИРП для отображения в UI; может быть >0 даже когда в формуле не применяется. */
  irpDisplayPercent: number;
  /** Источник ИРП: кабинетное значение, ручной override, fallback-расчёт или нет данных. */
  irpSource: 'cabinet' | 'manual' | 'auto' | 'none';
  /** Надбавка ИРП в ₽: priceBeforeWbDiscount × irpPercent / 100. */
  irpSurcharge: number;
  /** Индекс локализации ИЛ — коэффициент к forward (legacy field name). */
  localityIndexPercent: number;
  /**
   * Источник ИЛ (множитель к forward):
   *  - 'cabinet'  — единый кабинетный ИЛ из WB «Поставки → Тарифы» / fallback;
   *  - 'manual'   — пользователь ввёл `manualFields.localityIndexPercent` руками;
   *  - 'auto'     — legacy fallback по `row.localizationPercent` через WB-сетку;
   *  - 'none'     — нет ни ручного, ни авто (FBS, или нет данных от WB).
   */
  localityIndexSource: 'cabinet' | 'manual' | 'auto' | 'none';
  /**
   * Доля локальных заказов от WB API (или null если SKU ещё не попал в funnel
   * sync). Сохраняется отдельно от `irpPercent` чтобы UI мог показать
   * подпись «локализация 62%» рядом с авто-значением.
   */
  localizationPercent: number | null;
  commissionPercent: number;
  tradeScheme: TradeScheme;
  // Logistics & storage (per-unit, post-buyout)
  logisticsPerUnit: number;
  reverseLogisticsPerUnit: number;
  returnToSellerPerUnit: number;
  /** Forward logistics shown to user: direct logistics with ИЛ plus ИРП surcharge. */
  logisticsToClientWithIrp: number;
  logisticsTotalComputed: number;
  storagePerUnit: number;
  storageTotalComputed: number;
  markupFromPriceToSppRatio: number;
  // Per-unit P&L
  acquiring: number;
  marketplacePlusStorageTotal: number;
  toSettlementAccount: number;
  taxPercent: number;
  taxRub: number;
  revenueAfterTax: number;
  // Batch (purchase qty * per-unit) totals
  batchRevenue: number;
  batchRevenueInOrders: number;
  batchCostPriceTotal: number;
  batchCostTotal: number;
  batchDeliveryToFfTotal: number;
  batchPackagingTotal: number;
  batchFulfillmentTotal: number;
  batchDeliveryToMarketplaceTotal: number;
  batchCommissionTotal: number;
  batchLogisticsTotal: number;
  batchStorageTotal: number;
  batchAcquiringTotal: number;
  batchLogisticsToSppPercent: number;
  batchMarketplacePlusStorageTotal: number;
  batchToSettlementAccount: number;
  batchTaxRub: number;
  batchRevenueAfterTax: number;
  batchMarginalProfit: number;
  batchGrossProfit: number;
  batchProfitabilityPercent: number;
  batchMarketplacePercentTotal: number;
  batchGrossProfitPerUnit: number;
  // Marketing inputs (echoed for tab convenience)
  purchaseQtyTotal: number;
  marketingInternal: number;
  marketingExternal: number;
  contentCost: number;
  otherCosts: number;
  drrPercent: number;
  drrPercentBuyouts: number;
  cpoPlan: number;
  cpsPlan: number;
  turnoverDays: number;
  // Diagnostics
  checkZero: number;
  marketplacePercentTotal: number;
  marginPercent: number;
  profitabilityPercent: number;
  grossProfitPerUnit: number;
};

/** Per-warehouse computed tariff rates (used by TabCosts warehouse breakdown). */
export type WarehouseRate = {
  warehouseId: string;
  label: string;
  hasTariff: boolean;
  tariffWarehouseName: string | null;
  boxTypeId: number | null;
  boxDeliveryBase: number;
  boxDeliveryLiter: number;
  boxStorageBase: number;
  boxStorageLiter: number;
  boxDeliveryCoefExpr: number;
  boxStorageCoefExpr: number;
  boxReverseBase: number;
  boxReverseLiter: number;
  boxReverseCoefExpr: number;
  reverseFallbackBase: number;
  reverseFallbackCoef: number;
  returnTariffWarehouseName: string | null;
  returnTariffGeoName: string | null;
  returnToSellerBase: number;
  returnToSellerLiter: number;
  returnToSellerExpr: number;
  returnToSellerSource: 'sup' | 'srg' | 'kgt' | null;
  isUpToOneLiter: boolean;
  logisticsBaseUpToOneLiter: number;
  extraLiters: number;
  wbLogisticsPerUnit: number;
  wbStoragePerUnit: number;
  wbReverseLogisticsPerUnit: number;
  wbReturnToSellerPerUnit: number;
};

/** Aggregate tariff metadata that lives at the page (not per-row) level. */
export type TariffContext = {
  acceptanceTariffs: WarehouseTariff[];
  acceptanceTariffsDate: string | null;
  boxTariffs: WarehouseBoxTariff[];
  boxTariffsDate: string | null;
  returnTariffs: WarehouseReturnTariff[];
  returnTariffsDate: string | null;
  defaultTaxPercent: number | null;
};
