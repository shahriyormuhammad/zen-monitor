'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Search, X } from 'lucide-react';
import {
  DEFAULT_WAREHOUSES,
  MAX_WAREHOUSES,
  WB_REVERSE_BASE_ADDITIONAL_LITER,
  WB_REVERSE_BASE_FIRST_LITER,
  WB_STORAGE_BASE_UP_TO_ONE_LITER,
  normalizeLocalityIndexMultiplier,
} from '../constants';
import {
  formatCurrency,
  formatNumber,
  normalizeDecimalInput,
  normalizeWarehouseKey,
  toNumber,
} from '../helpers';
import type { ManualFields, RowSummary } from '../types';
import { buildWarehouseOptions, isDefaultWarehouseId } from '../warehouse-options';
import type { WarehouseRatesAggregate } from './warehouse-rates';
import { NumberInput } from './NumberInput';

function getReverseSourceLabel(source: 'wb_volume' | null): string {
  if (source === 'wb_volume') return 'WB 20.03, без коэф/ИЛ/ИРП';
  return '—';
}

function formatMultiplierPercent(value: number): string {
  return value > 0 ? `${Math.round(value * 100)}%` : '—';
}

function formatRubOrDash(value: number): string {
  return value > 0 ? formatCurrency(value, 2) : '—';
}

// Amber-tinted manual input — visible in both light and dark themes via alpha.
const MANUAL_INPUT_CLASS =
  'border-amber-500/50 bg-amber-500/15 placeholder:text-amber-700/70 dark:placeholder:text-amber-300/70 focus:border-amber-500 focus:bg-amber-500/20 focus:ring-amber-400/30';

type WarehousesPanelProps = {
  manualFields: ManualFields;
  onUpdate: (next: ManualFields) => void;
  /** When true, cost-source controls are shown read-only; edit them in /costs. */
  costInputsReadOnly?: boolean;
  /** Computed rates for selected warehouses (rendered in the «тарифы» block). */
  warehouseRates: WarehouseRatesAggregate;
  /** SKU volume in liters — used to label the formula description. */
  volumeLiters: number;
  /** Effective buyout used by formulas: auto WB fact when eligible, otherwise manual fallback. */
  buyoutPercent: number;
  /** Whether the buyout came from the user (manual) or auto-derived from WB facts. */
  isBuyoutManual: boolean;
  buyoutSource: RowSummary['buyoutSource'];
  buyoutOrderCount?: number;
  buyoutBuyoutCount?: number;
  buyoutCancelCount?: number;
  buyoutClosedCount?: number;
  buyoutOpenCount?: number;
  buyoutOpenShare?: number;
  buyoutAutoWarning?: string | null;
  /** «fbw» / «fbs» — tariff context (FBS skips ИЛ and ИРП). */
  tradeScheme: 'fbw' | 'fbs';
  /** Computed ИРП surcharge per 1 unit (₽) = priceBeforeWbDiscount × ИРП %. */
  irpPercent: number;
  irpSource: 'manual' | 'auto' | 'none';
  autoIrpPercent: number;
  irpSurcharge: number;
  /** WB-reported localization share (0..100) or null if SKU has no funnel data yet. */
  localizationPercent: number | null;
  /** Active ИЛ source — 'manual' (user value), 'auto' (derived from WB), or 'none'. */
  localityIndexSource: 'manual' | 'auto' | 'none';
  /** Auto-derived ИЛ coefficient from localization (rendered as "авто" hint). */
  autoLocalityIndex: number;
  /** Optional date strings for tariff freshness labels. */
  acceptanceTariffsDate?: string | null;
  returnTariffsDate?: string | null;
  /** Warehouse names synced from WB data/tariff snapshots. */
  wbWarehouseNames?: string[];
  /** Per-SKU top WB warehouses with positive stock, sorted by stock desc. */
  suggestedStockWarehouses?: Array<{ warehouseName: string; quantity: number }>;
};

/**
 * Editable warehouse selector + delivery-cost editor for a single SKU.
 * Mirrors the legacy warehouse panel (UnitEconomicsTemplateTable
 * lines ~3851-3991).
 *
 * The component owns its UI-only state (panel open/closed, warehouse dropdown)
 * but delegates all data mutations to `onUpdate(nextManualFields)`.
 */
export function WarehousesPanel({
  manualFields,
  onUpdate,
  costInputsReadOnly = false,
  warehouseRates,
  volumeLiters,
  buyoutPercent,
  isBuyoutManual,
  buyoutSource,
  buyoutOrderCount = 0,
  buyoutBuyoutCount = 0,
  buyoutCancelCount = 0,
  buyoutClosedCount = 0,
  buyoutOpenCount = 0,
  buyoutOpenShare = 0,
  buyoutAutoWarning = null,
  tradeScheme,
  irpPercent,
  irpSource,
  autoIrpPercent,
  irpSurcharge,
  localizationPercent,
  localityIndexSource,
  autoLocalityIndex,
  acceptanceTariffsDate,
  returnTariffsDate,
  wbWarehouseNames = [],
  suggestedStockWarehouses = [],
}: WarehousesPanelProps) {
  const [warehousePanelOpen, setWarehousePanelOpen] = useState(true);
  const [warehouseRatesPanelOpen, setWarehouseRatesPanelOpen] = useState(true);
  const [warehousePickerOpen, setWarehousePickerOpen] = useState(false);
  const [warehouseSearchQuery, setWarehouseSearchQuery] = useState('');

  const suggestedWarehouseNames = useMemo(
    () => suggestedStockWarehouses
      .map((warehouse) => warehouse.warehouseName.trim())
      .filter((name, index, array) => name.length > 0 && array.indexOf(name) === index),
    [suggestedStockWarehouses],
  );

  const warehouseOptions = useMemo(
    () => buildWarehouseOptions([...suggestedWarehouseNames, ...wbWarehouseNames], manualFields.customWarehouses),
    [manualFields.customWarehouses, suggestedWarehouseNames, wbWarehouseNames],
  );

  const warehouseLabelMap = useMemo(
    () => new Map([
      ...DEFAULT_WAREHOUSES.map((warehouse) => [warehouse.id, warehouse.label] as const),
      ...warehouseOptions.map((warehouse) => [warehouse.id, warehouse.label] as const),
    ]),
    [warehouseOptions],
  );
  const activeLocalityIndex = tradeScheme !== 'fbw'
    ? 1
    : localityIndexSource === 'manual'
      ? normalizeLocalityIndexMultiplier(toNumber(manualFields.localityIndexPercent))
      : localityIndexSource === 'auto'
        ? autoLocalityIndex
        : 1;
  const ratesByWarehouseId = useMemo(
    () => new Map(warehouseRates.rates.map((rate) => [rate.warehouseId, rate] as const)),
    [warehouseRates.rates],
  );
  const matchedWarehouseRateCount = useMemo(
    () => warehouseRates.rates.filter((rate) => rate.hasTariff).length,
    [warehouseRates.rates],
  );
  const quickWarehouseOptions = useMemo(
    () => warehouseOptions.slice(0, MAX_WAREHOUSES),
    [warehouseOptions],
  );
  const suggestedWarehouseOptions = useMemo(() => {
    const byNormalizedLabel = new Map(
      warehouseOptions.map((warehouse) => [normalizeWarehouseKey(warehouse.label), warehouse] as const),
    );
    return suggestedWarehouseNames
      .map((label) => byNormalizedLabel.get(normalizeWarehouseKey(label)))
      .filter((warehouse): warehouse is NonNullable<typeof warehouse> => Boolean(warehouse))
      .slice(0, 6);
  }, [suggestedWarehouseNames, warehouseOptions]);
  const filteredWarehouseOptions = useMemo(() => {
    const normalizedQuery = normalizeWarehouseKey(warehouseSearchQuery);
    if (!normalizedQuery) {
      return warehouseOptions;
    }
    return warehouseOptions.filter((warehouse) => normalizeWarehouseKey(warehouse.label).includes(normalizedQuery));
  }, [warehouseOptions, warehouseSearchQuery]);

  const selectedWarehouseCosts = manualFields.selectedWarehouses
    .map((warehouseId) => toNumber(manualFields.warehouseCosts[warehouseId]))
    .filter((value) => value > 0);
  const deliveryToMarketplaceComputed = selectedWarehouseCosts.length > 0
    ? selectedWarehouseCosts.reduce((sum, value) => sum + value, 0) / selectedWarehouseCosts.length
    : 0;

  const toggleWarehouseSelection = (warehouseId: string) => {
    if (costInputsReadOnly) return;
    const warehouse = warehouseOptions.find((option) => option.id === warehouseId);
    if (!warehouse) {
      return;
    }
    const isSelected = manualFields.selectedWarehouses.includes(warehouse.id);
    if (isSelected) {
      removeWarehouseSelection(warehouse.id);
      return;
    }
    if (manualFields.selectedWarehouses.length >= MAX_WAREHOUSES) {
      return;
    }

    const hasSavedWarehouse = manualFields.customWarehouses.some((item) => item.id === warehouse.id);
    const nextCustomWarehouses = isDefaultWarehouseId(warehouse.id) || hasSavedWarehouse
      ? manualFields.customWarehouses
      : [...manualFields.customWarehouses, { id: warehouse.id, label: warehouse.label }];

    onUpdate({
      ...manualFields,
      warehouseAutoSelectionDisabled: false,
      customWarehouses: nextCustomWarehouses,
      selectedWarehouses: [...manualFields.selectedWarehouses, warehouse.id],
    });
  };

  const applySuggestedStockWarehouses = useCallback(() => {
    if (costInputsReadOnly || suggestedWarehouseOptions.length === 0) return;

    const nextSelected = [...manualFields.selectedWarehouses];
    const nextCustomWarehouses = [...manualFields.customWarehouses];

    for (const warehouse of suggestedWarehouseOptions) {
      if (nextSelected.includes(warehouse.id)) {
        continue;
      }
      if (nextSelected.length >= MAX_WAREHOUSES) {
        break;
      }
      const hasSavedWarehouse = nextCustomWarehouses.some((item) => item.id === warehouse.id);
      if (!isDefaultWarehouseId(warehouse.id) && !hasSavedWarehouse) {
        nextCustomWarehouses.push({ id: warehouse.id, label: warehouse.label });
      }
      nextSelected.push(warehouse.id);
    }

    onUpdate({
      ...manualFields,
      warehouseAutoSelectionDisabled: false,
      customWarehouses: nextCustomWarehouses,
      selectedWarehouses: nextSelected,
    });
    setWarehouseRatesPanelOpen(true);
  }, [costInputsReadOnly, manualFields, onUpdate, suggestedWarehouseOptions]);

  useEffect(() => {
    if (costInputsReadOnly) return;
    if (manualFields.warehouseAutoSelectionDisabled) return;
    if (manualFields.selectedWarehouses.length > 0) return;
    if (suggestedWarehouseOptions.length === 0) return;
    const timer = window.setTimeout(() => {
      applySuggestedStockWarehouses();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    applySuggestedStockWarehouses,
    costInputsReadOnly,
    manualFields.selectedWarehouses.length,
    manualFields.warehouseAutoSelectionDisabled,
    suggestedWarehouseOptions.length,
  ]);

  const updateWarehouseCost = (warehouseId: string, value: string) => {
    if (costInputsReadOnly) return;
    onUpdate({
      ...manualFields,
      warehouseCosts: { ...manualFields.warehouseCosts, [warehouseId]: value },
    });
  };

  const removeWarehouseSelection = (warehouseId: string) => {
    if (costInputsReadOnly) return;
    const nextSelected = manualFields.selectedWarehouses.filter((id) => id !== warehouseId);
    onUpdate({ ...manualFields, warehouseAutoSelectionDisabled: true, selectedWarehouses: nextSelected });
  };

  const clearAllWarehouses = () => {
    if (costInputsReadOnly) return;
    onUpdate({ ...manualFields, warehouseAutoSelectionDisabled: true, selectedWarehouses: [], warehouseCosts: {} });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-500/30 bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setWarehousePanelOpen((value) => !value)}
        className="flex w-full items-center justify-between bg-emerald-50 px-4 py-3 text-left"
      >
        <div>
          <p className="text-sm font-bold text-foreground">Блок складов (до {MAX_WAREHOUSES})</p>
          <p className="text-xs font-medium text-muted-foreground">
            {costInputsReadOnly
              ? `Источник: раздел «Себестоимость». Выбрано ${manualFields.selectedWarehouses.length} из ${MAX_WAREHOUSES}.`
              : `Выбрано ${manualFields.selectedWarehouses.length} из ${MAX_WAREHOUSES}. Доставка до ВБ считается как средняя по выбранным складам.`}
          </p>
        </div>
        {warehousePanelOpen
          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {warehousePanelOpen ? (
        <div className="space-y-3 border-t border-border bg-card px-3 py-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {quickWarehouseOptions.map((warehouse) => {
              const checked = manualFields.selectedWarehouses.includes(warehouse.id);
              const disabled = !checked && manualFields.selectedWarehouses.length >= MAX_WAREHOUSES;
              return (
                <button
                  key={warehouse.id}
                  type="button"
                  onClick={() => toggleWarehouseSelection(warehouse.id)}
                  disabled={costInputsReadOnly || disabled}
                  title={costInputsReadOnly ? 'Редактируется в разделе «Себестоимость»' : undefined}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                    checked
                      ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                  } ${disabled && !costInputsReadOnly ? 'cursor-not-allowed opacity-50' : costInputsReadOnly ? 'cursor-not-allowed' : ''}`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 rounded border ${
                      checked ? 'border-emerald-600 bg-emerald-600' : 'border-border bg-card'
                    }`}
                  />
                  <span className="truncate">{warehouse.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!costInputsReadOnly ? (
              <button
                type="button"
                onClick={() => setWarehousePickerOpen((value) => !value)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Добавить склад
              </button>
            ) : null}
            {!costInputsReadOnly && suggestedWarehouseOptions.length > 0 ? (
              <button
                type="button"
                onClick={applySuggestedStockWarehouses}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
              >
                <Plus className="h-3.5 w-3.5" />
                Топ WB по остатку
              </button>
            ) : null}
            <span className="text-xs font-semibold text-muted-foreground">
              {wbWarehouseNames.length > 0
                ? `Из ВБ: ${wbWarehouseNames.length}`
                : 'ВБ-список ещё пуст, показан базовый список'}
            </span>
          </div>
          {suggestedStockWarehouses.length > 0 ? (
            <p className="text-xs font-semibold text-muted-foreground">
              Факт WB: {suggestedStockWarehouses
                .slice(0, 6)
                .map((warehouse) => `${warehouse.warehouseName} ${formatNumber(warehouse.quantity, 0)} шт`)
                .join(', ')}
            </p>
          ) : null}

          {manualFields.selectedWarehouses.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-emerald-500/20 bg-emerald-50/60 px-3 py-2 sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">WB-тарифы</p>
                <p className="text-xs font-black text-foreground">{matchedWarehouseRateCount} / {manualFields.selectedWarehouses.length}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Лог до клиента</p>
                <p className="text-xs font-black text-foreground">{formatRubOrDash(warehouseRates.avgWbLogisticsPerUnit)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Лог от клиента</p>
                <p className="text-xs font-black text-foreground">{formatRubOrDash(warehouseRates.avgWbReverseLogisticsPerUnit)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Хранение WB</p>
                <p className="text-xs font-black text-foreground">{formatRubOrDash(warehouseRates.avgWbStoragePerUnit)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Доставка до ВБ</p>
                <p className="text-xs font-black text-foreground">{deliveryToMarketplaceComputed > 0 ? formatCurrency(deliveryToMarketplaceComputed, 2) : '—'}</p>
              </div>
            </div>
          ) : null}

          {warehousePickerOpen && !costInputsReadOnly ? (
            <div className="space-y-2 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={warehouseSearchQuery}
                  onChange={(event) => setWarehouseSearchQuery(event.target.value)}
                  placeholder="Найти склад ВБ"
                  className="w-full rounded-lg border border-border bg-card py-2 pl-8 pr-3 text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
                />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-card">
                {filteredWarehouseOptions.length > 0 ? (
                  filteredWarehouseOptions.map((warehouse) => {
                    const checked = manualFields.selectedWarehouses.includes(warehouse.id);
                    const disabled = !checked && manualFields.selectedWarehouses.length >= MAX_WAREHOUSES;
                    return (
                      <button
                        key={`picker-${warehouse.id}`}
                        type="button"
                        onClick={() => toggleWarehouseSelection(warehouse.id)}
                        disabled={disabled}
                        className={`flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left text-xs font-semibold last:border-b-0 ${
                          checked
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'text-muted-foreground hover:bg-muted/40'
                        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <span className="truncate">{warehouse.label}</span>
                        <span className={checked ? 'text-rose-600' : 'text-emerald-600'}>
                          {checked ? 'Убрать' : 'Добавить'}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="px-3 py-2 text-xs font-semibold text-muted-foreground">Ничего не найдено</p>
                )}
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-foreground">
                Доставка до складов ВБ: {manualFields.selectedWarehouses.length} / {MAX_WAREHOUSES}
              </p>
              <p className="text-xs font-semibold text-muted-foreground">
                Средняя до ВБ: {deliveryToMarketplaceComputed > 0 ? formatCurrency(deliveryToMarketplaceComputed, 2) : '—'}
              </p>
            </div>

            {manualFields.selectedWarehouses.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {manualFields.selectedWarehouses.map((warehouseId) => {
                  const rate = ratesByWarehouseId.get(warehouseId);
                  return (
                    <div
                      key={`selected-${warehouseId}`}
                      className="rounded-lg border border-border bg-card px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-foreground">
                            {warehouseLabelMap.get(warehouseId) ?? warehouseId}
                          </p>
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            До склада, ₽/ед
                          </p>
                        </div>
                        <input
                          value={manualFields.warehouseCosts[warehouseId] ?? ''}
                          placeholder="0"
                          readOnly={costInputsReadOnly}
                          onChange={(event) => updateWarehouseCost(warehouseId, normalizeDecimalInput(event.target.value))}
                          className={`w-20 rounded-lg border px-2 py-1.5 text-right font-mono text-xs font-semibold text-foreground focus:outline-none focus:ring-4 ${
                            costInputsReadOnly
                              ? 'border-border bg-muted text-muted-foreground focus:ring-0'
                              : MANUAL_INPUT_CLASS
                          }`}
                        />
                        {!costInputsReadOnly ? (
                          <button
                            type="button"
                            onClick={() => removeWarehouseSelection(warehouseId)}
                            className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-rose-500"
                            aria-label={`Убрать склад ${warehouseLabelMap.get(warehouseId) ?? warehouseId}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                      {rate?.hasTariff ? (
                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 text-[10px] font-semibold text-muted-foreground">
                          <span>К лог: <b className="text-foreground">{formatMultiplierPercent(rate.deliveryCoefMultiplier)}</b></span>
                          <span>К хран: <b className="text-foreground">{formatMultiplierPercent(rate.storageCoefMultiplier)}</b></span>
                          <span>WB лог: <b className="text-foreground">{formatRubOrDash(rate.wbLogisticsPerUnit)}</b></span>
                          <span>Хран: <b className="text-foreground">{formatRubOrDash(rate.wbStoragePerUnit)}</b></span>
                        </div>
                      ) : (
                        <p className="mt-2 border-t border-border pt-2 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                          Нет совпадения в WB-тарифах
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs font-semibold text-muted-foreground">
                {costInputsReadOnly
                  ? 'Склады ещё не выбраны в разделе «Себестоимость».'
                  : 'Добавьте склады из списка WB, затем введите сумму доставки до каждого склада.'}
              </p>
            )}
          </div>

          {!costInputsReadOnly ? (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={clearAllWarehouses}
                className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted/40"
              >
                Очистить склады
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Sub-panel: WB rates per warehouse */}
      <div className="border-t border-border">
        <button
          type="button"
          onClick={() => setWarehouseRatesPanelOpen((value) => !value)}
          className="flex w-full items-center justify-between bg-sky-50 px-4 py-3 text-left"
        >
          <div>
            <p className="text-sm font-bold text-foreground">Склады: логистика и хранение WB</p>
            <p className="text-xs font-medium text-muted-foreground">
              Расчёт на 1 ед по литражу {volumeLiters > 0 ? `${volumeLiters.toFixed(2)} л` : '—'}.
              {volumeLiters > 0 && volumeLiters <= 1 ? ' Применяется формула WB до 1 л.' : volumeLiters > 1 ? ' Применяется формула WB свыше 1 л.' : ''}
              {acceptanceTariffsDate ? ` Дата acceptance: ${acceptanceTariffsDate}.` : ''}
              {returnTariffsDate ? ` Дата return: ${returnTariffsDate}.` : ''}
            </p>
          </div>
          {warehouseRatesPanelOpen
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {warehouseRatesPanelOpen ? (
          <div className="space-y-4 border-t border-border bg-card px-4 py-4">
            {manualFields.selectedWarehouses.length === 0 ? (
              <p className="text-xs font-semibold text-muted-foreground">
                Сначала выберите склады в блоке выше.
              </p>
            ) : (
              <>
                <div className="rounded-xl border border-border bg-muted/40 px-3 py-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    По выбранным складам
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {warehouseRates.rates.map((warehouse) => (
                      <div
                        key={warehouse.warehouseId}
                        className="rounded-lg border border-border bg-card px-3 py-2"
                      >
                        <p className="truncate text-xs font-semibold text-foreground">{warehouse.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {warehouse.tariffWarehouseName
                            ? `WB acceptance: ${warehouse.tariffWarehouseName}`
                            : (warehouse.returnTariffWarehouseName
                              ? `WB return: ${warehouse.returnTariffGeoName ?? warehouse.returnTariffWarehouseName}`
                              : 'Нет совпадения в WB-тарифах')}
                        </p>
                        {warehouse.hasTariff ? (
                          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                            {warehouse.isUpToOneLiter
                              ? <>
                                  Лог до клиента {formatNumber(warehouse.forwardBase, 2)} ₽ × {Math.round(warehouse.deliveryCoefMultiplier * 100)}% (порог WB за единицу);
                                  лог от клиента {formatNumber(warehouse.wbReverseLogisticsPerUnit, 2)} ₽ ({getReverseSourceLabel(warehouse.reverseSource)});
                                  хран {formatNumber(warehouse.storageBase, 2)} ₽ × {Math.round(warehouse.storageCoefMultiplier * 100)}%.
                                </>
                              : <>
                                  Лог до клиента {formatNumber(warehouse.forwardBase, 2)} + {formatNumber(warehouse.forwardAdditionalLiter, 2)} × {formatNumber(warehouse.extraLiters, 2)} (тариф уже с коэф склада);
                                  лог от клиента {formatNumber(warehouse.reverseBase, 2)} + {formatNumber(warehouse.reverseAdditionalLiter, 2)} × {formatNumber(warehouse.extraLiters, 2)} = {formatNumber(warehouse.wbReverseLogisticsPerUnit, 2)} ₽ ({getReverseSourceLabel(warehouse.reverseSource)});
                                  хран {formatNumber(warehouse.storageBase, 2)} + {formatNumber(warehouse.storageAdditionalLiter, 2)} × {formatNumber(warehouse.extraLiters, 2)}.
                                </>}
                          </p>
                        ) : null}
                        <div className="mt-2 space-y-1 text-[11px] font-medium text-foreground">
                          <p>Логистика до клиента: {warehouse.wbLogisticsPerUnit > 0 ? formatCurrency(warehouse.wbLogisticsPerUnit, 2) : '—'}</p>
                          <p>Логистика от клиента: {warehouse.wbReverseLogisticsPerUnit > 0 ? formatCurrency(warehouse.wbReverseLogisticsPerUnit, 2) : '—'}</p>
                          <p>Хранение: {warehouse.wbStoragePerUnit > 0 ? formatCurrency(warehouse.wbStoragePerUnit, 2) : '—'}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Средняя логистика до клиента WB</p>
                    <p className="mt-1 text-sm font-bold text-foreground">
                      {warehouseRates.avgWbLogisticsPerUnit > 0 ? formatCurrency(warehouseRates.avgWbLogisticsPerUnit, 2) : '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Среднее хранение WB</p>
                    <p className="mt-1 text-sm font-bold text-foreground">
                      {warehouseRates.avgWbStoragePerUnit > 0 ? formatCurrency(warehouseRates.avgWbStoragePerUnit, 2) : '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Средняя логистика от клиента</p>
                    <p className="mt-1 text-sm font-bold text-foreground">
                      {warehouseRates.avgWbReverseLogisticsPerUnit > 0 ? formatCurrency(warehouseRates.avgWbReverseLogisticsPerUnit, 2) : '—'}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 md:col-span-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Выкуп для расчёта логистики МП</p>
                    <p className="mt-1 text-sm font-bold text-foreground">
                      {buyoutSource !== 'none'
                        ? `${buyoutPercent.toFixed(1)}% ${isBuyoutManual ? '(ручной)' : '(авто из факта WB)'}`
                        : '—'}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      База WB: выкупы {Math.round(buyoutBuyoutCount)}, отмены {Math.round(buyoutCancelCount)}, заказы {Math.round(buyoutOrderCount)}.
                      Закрыто: {Math.round(buyoutClosedCount)}, незакрыто: {Math.round(buyoutOpenCount)} ({(buyoutOpenShare * 100).toFixed(0)}%).
                    </p>
                    {buyoutAutoWarning ? (
                      <p className="mt-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                        {buyoutAutoWarning}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Формула WB: forward + (1 − выкуп) × reverse
                      {tradeScheme === 'fbw' ? ' + priceBeforeWbDiscount × ИРП' : ''},
                      где forward для ≤1 л = порог WB за единицу × коэф склада{tradeScheme === 'fbw' ? ' × ИЛ' : ''}, а для &gt;1 л база/литр уже приходят из WB с коэф склада,
                      reverse с 20.03.2026 считается только от литража: для ≤1 л по порогу WB за единицу, для &gt;1 л {formatNumber(WB_REVERSE_BASE_FIRST_LITER, 0)} + {formatNumber(WB_REVERSE_BASE_ADDITIONAL_LITER, 0)} × extra, без коэф склада, ИЛ и ИРП.
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 md:col-span-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ИЛ — Индекс Локализации (множитель к forward)</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <NumberInput
                        value={manualFields.localityIndexPercent}
                        placeholder={localityIndexSource === 'auto' ? autoLocalityIndex.toFixed(2) : '1'}
                        widthClass="w-20"
                        onChange={(value) => onUpdate({ ...manualFields, localityIndexPercent: value })}
                      />
                      <span className="text-xs font-medium text-muted-foreground">
                        {tradeScheme === 'fbw' ? 'forward × ИЛ. Вводите коэффициент WB, например 1.01 или 0.50; авто — оценка по локализации.' : 'Не применяется в FBS'}
                      </span>
                      {tradeScheme === 'fbw' && localityIndexSource === 'auto' && localizationPercent != null ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                          авто ИЛ {autoLocalityIndex.toFixed(2)} (WB локализация {localizationPercent.toFixed(0)}%)
                        </span>
                      ) : null}
                      {tradeScheme === 'fbw' && localityIndexSource === 'manual' && localizationPercent != null ? (
                        <span className="text-[10px] text-muted-foreground">
                          WB локализация {localizationPercent.toFixed(0)}%, авто ИЛ = {autoLocalityIndex.toFixed(2)}
                        </span>
                      ) : null}
                      {tradeScheme === 'fbw' && localityIndexSource === 'none' && localizationPercent != null ? (
                        <span className="text-[10px] text-muted-foreground">
                          WB локализация {localizationPercent.toFixed(0)}%, авто ИЛ = {autoLocalityIndex.toFixed(2)}
                        </span>
                      ) : null}
                      {tradeScheme === 'fbw' && localityIndexSource === 'none' && localizationPercent == null ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                          нет данных WB — введите вручную
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      ИЛ для расчёта: {tradeScheme === 'fbw' ? activeLocalityIndex.toFixed(2) : '1.00'}.
                      {' '}
                      Базовые WB-параметры: первый литр {formatNumber(WB_REVERSE_BASE_FIRST_LITER, 0)} ₽, доп. литр {formatNumber(WB_REVERSE_BASE_ADDITIONAL_LITER, 0)} ₽,
                      хранение до 1 л {formatNumber(WB_STORAGE_BASE_UP_TO_ONE_LITER, 2)} ₽/день.
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 md:col-span-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">ИРП — Индекс Распределения Продаж (надбавка от цены)</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <NumberInput
                        value={manualFields.irpPercent}
                        placeholder={irpSource === 'auto' ? autoIrpPercent.toFixed(2) : '0'}
                        widthClass="w-20"
                        onChange={(value) => onUpdate({ ...manualFields, irpPercent: value })}
                      />
                      <span className="text-xs font-medium text-muted-foreground">
                        {tradeScheme === 'fbw' ? '+ priceBeforeWbDiscount × ИРП/100. Авто — оценка по WB-сетке от локализации.' : 'Не применяется в FBS'}
                      </span>
                      {tradeScheme === 'fbw' && irpSource === 'auto' && localizationPercent != null ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                          авто {autoIrpPercent.toFixed(2)}% (WB локализация {localizationPercent.toFixed(0)}%)
                        </span>
                      ) : null}
                      {tradeScheme === 'fbw' && irpSource === 'manual' && localizationPercent != null ? (
                        <span className="text-[10px] text-muted-foreground">
                          WB локализация {localizationPercent.toFixed(0)}%, авто = {autoIrpPercent.toFixed(2)}%
                        </span>
                      ) : null}
                      {tradeScheme === 'fbw' && irpSource === 'none' && localizationPercent != null ? (
                        <span className="text-[10px] text-muted-foreground">
                          WB локализация {localizationPercent.toFixed(0)}%, авто = {autoIrpPercent.toFixed(2)}%
                        </span>
                      ) : null}
                      {tradeScheme === 'fbw' && irpSource === 'none' && localizationPercent == null ? (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                          нет данных WB — введите вручную
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      ИРП для расчёта: {tradeScheme === 'fbw' ? `${formatNumber(irpPercent, 2)}%` : '0%'}.
                      {' '}Добавка за 1 ед: {tradeScheme === 'fbw' && irpSurcharge > 0 ? formatCurrency(irpSurcharge, 2) : '0 ₽'}.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
