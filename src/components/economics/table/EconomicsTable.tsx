'use client';

import Image from 'next/image';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, EyeOff, FileSpreadsheet, FileUp, Loader2, Palette, Search, Trash2 } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { buildRowSummary } from '../row-summary';
import { clampPercent, hasManualValue, normalizeDecimalInput, parseFirstNumber, toNumber } from '../helpers';
import {
  cloneManualFields,
  hasServerManualPayload,
  parseManualFieldsFromUnknown,
  readManualFields,
  saveManualFields,
} from '../manual-fields-io';
import { resolveVolumeLiters, type AcceptanceTariffCandidate, type ReturnTariffCandidate } from '../tariff-helpers';
import type {
  ManualFields,
  RowFilterMode,
  RowSummary,
  UnitTemplateRow,
  WarehouseBoxTariff,
  WarehouseTariff,
  WarehouseReturnTariff,
} from '../types';
import { EMPTY_MANUAL_FIELDS, resolveIrpFromLocalization, resolveLocalityIndexMultiplierFromLocalization } from '../constants';
import { COLUMNS, STRONG_GROUP_SEPARATOR_COLUMNS, resolveStickyIdentityColumnClass, resolveStrictWidthClasses } from './columns';
import { TableHeader } from './TableHeader';
import { HiddenProductsPanel } from './HiddenProductsPanel';
import { buildVariantFamilyKey, compareBySellerArticle } from './utils';
import { computeWarehouseRates } from './warehouse-rates';
import {
  buildAcceptanceTariffMap,
  buildAcceptanceTariffMapFromBox,
  buildReturnTariffMap,
} from './tariff-maps';
import { resolveCellText, INTERACTIVE_COLUMN } from './cellValue';
import { SkuMetaBlock } from './SkuMetaBlock';
import { WarehousesPanel } from './WarehousesPanel';
import { ScenarioRow } from './ScenarioRow';
import { VariantPickerModal } from './VariantPickerModal';
import { exportEconomicsExcel, parseEconomicsExcel } from './excelExport';
import { NumberInput } from './NumberInput';
import { PRICE_SCENARIOS } from '../constants';

/* ─────────────────────────── constants ────────────────────────────── */

// Explicit slate-300 — theme `border-border` was too soft on busy data rows.
// Strong group separators get a 2px sky-400 border for additional emphasis.
const GRID_BORDER = 'border-slate-300';
const SEPARATOR_FILL = 'bg-muted';
const MANUAL_FIELDS_DEBOUNCE_MS = 500;

type DetailMode = 'warehouses' | 'finance' | null;

/* ─────────────────────────── types ────────────────────────────────── */

type EconomicsTableProps = {
  data: UnitTemplateRow[];
  manualInputsByNm?: Record<string, Record<string, unknown>>;
  /**
   * `tariffs/box` — recommended source for warehouse logistics coefs (per
   * official WB docs «Тарифы складов → Тарифы на остаток»). Used as primary;
   * `acceptanceTariffs` is kept only as a fallback if box snapshot is empty.
   */
  boxTariffs?: WarehouseBoxTariff[] | null;
  acceptanceTariffs?: WarehouseTariff[] | null;
  returnTariffs?: WarehouseReturnTariff[] | null;
  wbWarehouseNames?: string[] | null;
  defaultTaxPercent?: number | null;
  focusNmId?: number | null;
};

/* ─────────────────────────── helpers ──────────────────────────────── */

function formatRub(value: number, fractionDigits = 0) {
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} ₽`;
}

function formatPlainNumber(value: number, fractionDigits = 0) {
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/* ─────────────────────── inline-editable cells ───────────────────── */

type EditableCellDeps = {
  soldQuantity: number;
  summary: RowSummary;
  onUpdate: (next: ManualFields) => void;
};

/**
 * For the active row, certain columns become inline NumberInput's directly
 * inside the table (matches the legacy monolith UX, lines ~2945-3170).
 * Returns the input JSX, or `fallback` for non-editable columns.
 */
function renderEditableCell(
  columnId: string,
  nmId: number,
  manualFields: ManualFields,
  fallback: string,
  deps: EditableCellDeps,
): React.ReactNode {
  const { soldQuantity, summary, onUpdate } = deps;
  const update = (key: keyof ManualFields, value: string) => {
    onUpdate({ ...manualFields, [key]: value });
  };
  const updateBuyout = (value: string) => {
    const id = manualFields.activePriceScenarioId;
    onUpdate({
      ...manualFields,
      priceScenarios: {
        ...manualFields.priceScenarios,
        [id]: { ...manualFields.priceScenarios[id], buyoutPercent: value },
      },
    });
  };

  switch (columnId) {
    case 'buyout':
      return (
        <NumberInput
          value={manualFields.priceScenarios[manualFields.activePriceScenarioId]?.buyoutPercent ?? ''}
          placeholder="0"
          onChange={updateBuyout}
          widthClass="w-20"
        />
      );
    case 'drr_percent':
      return (
        <NumberInput
          value={manualFields.drrPercent}
          placeholder="0"
          onChange={(v) => update('drrPercent', v)}
          widthClass="w-20"
        />
      );
    case 'marketing_internal':
      if (hasManualValue(manualFields.drrPercent)) {
        return (
          <span className="inline-flex min-h-9 items-center justify-end rounded-xl bg-muted px-3 py-1 text-[13px] font-semibold tabular-nums text-foreground">
            {summary.marketingInternal > 0
              ? summary.marketingInternal.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : '0'} ₽
          </span>
        );
      }
      return (
        <NumberInput
          value={manualFields.marketingInternal}
          placeholder="0"
          onChange={(v) => update('marketingInternal', v)}
          widthClass="w-24"
        />
      );
    case 'marketing_external':
      return (
        <NumberInput
          value={manualFields.marketingExternal}
          placeholder="0"
          onChange={(v) => update('marketingExternal', v)}
          widthClass="w-24"
        />
      );
    case 'content_cost':
      return (
        <NumberInput
          value={manualFields.contentCost}
          placeholder="0"
          onChange={(v) => update('contentCost', v)}
          widthClass="w-24"
        />
      );
    case 'other_costs':
      return (
        <NumberInput
          value={manualFields.otherCosts}
          placeholder="0"
          onChange={(v) => update('otherCosts', v)}
          widthClass="w-24"
        />
      );
    // CPO and CPS are computed in row-summary from internal WB ads only.
    // No manual input — the
    //  fallback path renders the computed value via cellValue.ts.
    case 'purchase_qty_total':
      return (
        <NumberInput
          value={manualFields.purchaseQtyTotal}
          placeholder={soldQuantity > 0 ? String(soldQuantity) : '0'}
          onChange={(v) => update('purchaseQtyTotal', v)}
          widthClass="w-24"
        />
      );
    case 'turnover_days':
      return (
        <NumberInput
          value={manualFields.turnoverDays}
          placeholder="30"
          onChange={(v) => update('turnoverDays', v)}
          widthClass="w-20"
        />
      );
    default:
      // Touch nmId so eslint stops complaining about unused param when arity changes
      void nmId;
      return fallback;
  }
}

/* ─────────────────────────── component ────────────────────────────── */

/**
 * Modular wide economics table with expandable warehouse/finance detail panels.
 *
 * Slice 3 of the UnitEconomicsTemplateTable decomposition (P83):
 * clicking the Артикул WB cell opens the warehouses detail panel; clicking the
 * price cell opens the finance detail panel (5 tabs: fact/costs/price/pnl/batch).
 * Manual edits are pushed to localStorage immediately and debounced-saved to
 * the server. The cost price additionally goes through `updateCostPrice`.
 */
export function EconomicsTable({
  data,
  manualInputsByNm = {},
  boxTariffs = [],
  acceptanceTariffs = [],
  returnTariffs = [],
  wbWarehouseNames = [],
  defaultTaxPercent = null,
  focusNmId = null,
}: EconomicsTableProps) {
  const { tenantId } = useStore();
  const router = useRouter();

  /* ── tariff maps ──────────────────────────────────────────────────── */

  // Primary: acceptance/coefficients — это «Тарифы на поставку» в WB-кабинете
  // (вкладка по умолчанию, фиксируется при выборе даты поставки на 60-90 дней).
  // Содержит deliveryCoef/storageCoef для расчёта стоимости логистики при
  // планировании отгрузки (PLAN_TEMPLATE-режим). Fallback: tariffs/box (вкладка
  // «Тарифы на остаток») — используется только если acceptance-снапшот пуст.
  // Reverse leg for >1 л is always enriched from tariffs/box when available:
  // WB exposes it as boxDeliveryMarketplaceBase/Liter, while acceptance does
  // not carry the buyer -> SC tariff fields.
  const normalizedTariffMap = useMemo(() => {
    const fromAcceptance = buildAcceptanceTariffMap(acceptanceTariffs ?? []);
    const fromBox = buildAcceptanceTariffMapFromBox(boxTariffs ?? []);
    if (fromAcceptance.size > 0) {
      for (const [key, boxTariff] of fromBox.entries()) {
        const acceptanceTariff = fromAcceptance.get(key);
        if (!acceptanceTariff) {
          fromAcceptance.set(key, boxTariff);
          continue;
        }
        fromAcceptance.set(key, {
          ...acceptanceTariff,
          reverseBaseLiter: boxTariff.reverseBaseLiter,
          reverseAdditionalLiter: boxTariff.reverseAdditionalLiter,
          reverseCoef: boxTariff.reverseCoef,
        });
      }
      return fromAcceptance;
    }
    return fromBox;
  }, [acceptanceTariffs, boxTariffs]);

  const normalizedReturnTariffMap = useMemo(
    () => buildReturnTariffMap(returnTariffs ?? []),
    [returnTariffs],
  );

  /* ── rows / hidden ────────────────────────────────────────────────── */

  const [locallyHiddenNmIds, setLocallyHiddenNmIds] = useState<number[]>([]);
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);
  const [restoringNmId, setRestoringNmId] = useState<number | null>(null);
  const [hidingNmId, setHidingNmId] = useState<number | null>(null);
  const [selectedNmIds, setSelectedNmIds] = useState<number[]>([]);
  const [isBulkHiding, setIsBulkHiding] = useState(false);
  const hiddenNmIdSet = useMemo(() => new Set(locallyHiddenNmIds), [locallyHiddenNmIds]);
  const selectedNmIdSet = useMemo(() => new Set(selectedNmIds), [selectedNmIds]);

  const rows = useMemo(
    () =>
      data
        .filter((item) => toNumber(item?.nmId) > 0)
        .filter((item) => !hiddenNmIdSet.has(toNumber(item?.nmId)))
        .sort(compareBySellerArticle),
    [data, hiddenNmIdSet],
  );

  const rowsByNm = useMemo(() => {
    const map = new Map<number, UnitTemplateRow>();
    for (const item of rows) {
      const itemNmId = toNumber(item?.nmId);
      if (itemNmId > 0) map.set(itemNmId, item);
    }
    return map;
  }, [rows]);

  /* ── manual fields cache + persistence ────────────────────────────── */

  const [manualFieldsCache, setManualFieldsCache] = useState<Record<number, ManualFields>>({});
  const manualSaveQueueRef = useRef<Map<number, Promise<void>>>(new Map());
  // Pending debounced manual saves: per nmId we keep both timer & latest payload.
  // On unmount we FLUSH (not cancel) so a quick page switch never loses input.
  const manualSavePendingRef = useRef<
    Map<number, { timeout: ReturnType<typeof setTimeout>; payload: ManualFields }>
  >(new Map());

  /* ── search / filter ──────────────────────────────────────────────── */

  const [searchQuery, setSearchQuery] = useState('');
  const [rowFilterMode, setRowFilterMode] = useState<RowFilterMode>('all');

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((item) => {
      const itemNmId = toNumber(item?.nmId);
      const manualFields = manualFieldsCache[itemNmId] ?? EMPTY_MANUAL_FIELDS;
      const soldQty = toNumber(item?.soldQuantity);
      const hasCost = toNumber(manualFields.costPrice) > 0
        || toNumber(item?.costPrice) > 0
        || toNumber(item?.purchasePrice) > 0;
      const purchaseQty = toNumber(manualFields.purchaseQtyTotal);
      if (rowFilterMode === 'withSales' && soldQty <= 0) return false;
      if (rowFilterMode === 'withCost' && !hasCost) return false;
      if (rowFilterMode === 'withoutCost' && hasCost) return false;
      if (rowFilterMode === 'toOrder' && purchaseQty <= 0) return false;
      if (rowFilterMode === 'selected' && !selectedNmIdSet.has(itemNmId)) return false;
      if (!q) return true;
      return (
        String(item?.nmId ?? '').toLowerCase().includes(q) ||
        String(item?.vendorCode ?? '').toLowerCase().includes(q) ||
        String(item?.brand ?? '').toLowerCase().includes(q) ||
        String(item?.barcode ?? '').toLowerCase().includes(q) ||
        String(item?.category ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery, rowFilterMode, manualFieldsCache, selectedNmIdSet]);

  const filteredNmIds = useMemo(
    () => filteredRows.map((item) => toNumber(item?.nmId)).filter((nmId) => nmId > 0),
    [filteredRows],
  );

  const selectedFilteredCount = useMemo(
    () => filteredNmIds.filter((nmId) => selectedNmIdSet.has(nmId)).length,
    [filteredNmIds, selectedNmIdSet],
  );

  const allFilteredSelected = filteredNmIds.length > 0 && selectedFilteredCount === filteredNmIds.length;

  const orderCandidateNmIds = useMemo(
    () =>
      filteredRows
        .map((item) => toNumber(item?.nmId))
        .filter((nmId) => nmId > 0 && toNumber(manualFieldsCache[nmId]?.purchaseQtyTotal) > 0),
    [filteredRows, manualFieldsCache],
  );

  useEffect(() => {
    const visibleNmIds = new Set(rows.map((item) => toNumber(item?.nmId)).filter((nmId) => nmId > 0));
    setSelectedNmIds((prev) => {
      const next = prev.filter((nmId) => visibleNmIds.has(nmId));
      return next.length === prev.length ? prev : next;
    });
  }, [rows]);

  const toggleRowSelected = useCallback((nmId: number) => {
    if (nmId <= 0) return;
    setSelectedNmIds((prev) => (
      prev.includes(nmId)
        ? prev.filter((id) => id !== nmId)
        : [...prev, nmId]
    ));
  }, []);

  const toggleFilteredSelection = useCallback(() => {
    if (filteredNmIds.length === 0) return;
    const filteredSet = new Set(filteredNmIds);
    if (allFilteredSelected) {
      setSelectedNmIds((prev) => prev.filter((nmId) => !filteredSet.has(nmId)));
      return;
    }
    setSelectedNmIds((prev) => Array.from(new Set([...prev, ...filteredNmIds])));
  }, [allFilteredSelected, filteredNmIds]);

  const selectOrderCandidates = useCallback(() => {
    if (orderCandidateNmIds.length === 0) return;
    setSelectedNmIds((prev) => Array.from(new Set([...prev, ...orderCandidateNmIds])));
  }, [orderCandidateNmIds]);

  /* ── active row + detail panel ────────────────────────────────────── */

  const [activeNmId, setActiveNmId] = useState<number>(0);
  const [detailMode, setDetailMode] = useState<DetailMode>(null);
  // Finance details now render as 4 scenario rows (no separate tab UI)

  useEffect(() => {
    if (!focusNmId || focusNmId <= 0 || rows.length === 0) {
      return;
    }
    if (!rows.some((item) => toNumber(item?.nmId) === focusNmId)) {
      return;
    }

    setSearchQuery(String(focusNmId));
    setActiveNmId(focusNmId);
    setDetailMode('finance');
  }, [focusNmId, rows]);

  useEffect(() => {
    if (filteredRows.length === 0) {
      setActiveNmId(0);
      setDetailMode(null);
      return;
    }
    const hasActive = filteredRows.some((item) => toNumber(item?.nmId) === activeNmId);
    if (!hasActive) {
      setActiveNmId(toNumber(filteredRows[0]?.nmId));
      setDetailMode(null);
    }
  }, [activeNmId, filteredRows]);

  // Bootstrap from server payload + localStorage
  useEffect(() => {
    const next: Record<number, ManualFields> = {};
    for (const item of rows) {
      const itemNmId = toNumber(item?.nmId);
      if (itemNmId <= 0) continue;
      const serverPayload = manualInputsByNm[String(itemNmId)];
      if (hasServerManualPayload(serverPayload)) {
        const parsed = parseManualFieldsFromUnknown(serverPayload);
        next[itemNmId] = parsed;
        saveManualFields(tenantId, itemNmId, parsed);
      } else {
        next[itemNmId] = readManualFields(tenantId, itemNmId);
      }
    }
    setManualFieldsCache(next);
  }, [manualInputsByNm, rows, tenantId]);

  // Flush pending saves on unmount — NOT cancel — so a fast page switch
  // (e.g. user types a value and clicks "Дашборд" before the 500 ms debounce
  // fires) doesn't lose the latest input.
  // We can't await here, but the network request goes out either way.

  const getManualFieldsForRow = useCallback(
    (nmId: number): ManualFields => manualFieldsCache[nmId] ?? EMPTY_MANUAL_FIELDS,
    [manualFieldsCache],
  );

  const queueManualFieldsSave = useCallback(
    (targetNmId: number, draft: ManualFields): Promise<void> => {
      if (!tenantId || targetNmId <= 0) return Promise.resolve();
      const payload = cloneManualFields(draft);
      const previous = manualSaveQueueRef.current.get(targetNmId) ?? Promise.resolve();
      const queued = previous.catch(() => undefined).then(async () => {
        const { saveUnitEconomicsManualFields } = await import('@/app/(dashboard)/economics/actions');
        try {
          await saveUnitEconomicsManualFields(tenantId, targetNmId, payload);
        } catch (err) {
          // Keep the visible error so silent failures stay diagnosable in prod.
          console.error('[EconomicsTable] saveUnitEconomicsManualFields failed', {
            tenantId,
            nmId: targetNmId,
            error: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }
      });
      manualSaveQueueRef.current.set(targetNmId, queued);
      void queued.catch(() => undefined).finally(() => {
        if (manualSaveQueueRef.current.get(targetNmId) === queued) {
          manualSaveQueueRef.current.delete(targetNmId);
        }
      });
      return queued;
    },
    [tenantId],
  );

  const persistManualFieldsForNm = useCallback(
    (targetNmId: number, next: ManualFields) => {
      if (targetNmId <= 0) return;
      setManualFieldsCache((prev) => ({ ...prev, [targetNmId]: next }));
      saveManualFields(tenantId, targetNmId, next);

      const existing = manualSavePendingRef.current.get(targetNmId);
      if (existing) clearTimeout(existing.timeout);
      const timeout = setTimeout(() => {
        manualSavePendingRef.current.delete(targetNmId);
        void queueManualFieldsSave(targetNmId, next);
      }, MANUAL_FIELDS_DEBOUNCE_MS);
      manualSavePendingRef.current.set(targetNmId, { timeout, payload: next });
    },
    [tenantId, queueManualFieldsSave],
  );

  // FLUSH pending saves on unmount AND on tab/page hide.
  //
  // Why both: Next.js App Router uses soft-navigation; clicking a sidebar link
  // does NOT unmount this component, so the unmount-only handler never fires.
  // `visibilitychange` + `pagehide` cover every "user is leaving" scenario:
  // tab switch, browser close, page navigation in either direction.
  useEffect(() => {
    const flushAll = () => {
      const pending = manualSavePendingRef.current;
      for (const [nmId, { timeout, payload }] of pending.entries()) {
        clearTimeout(timeout);
        void queueManualFieldsSave(nmId, payload);
      }
      pending.clear();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushAll();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushAll);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushAll);
      flushAll();
    };
    // We intentionally depend on the stable callbacks; effect should run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── global WB discount ───────────────────────────────────────────── */
  const [globalWbDiscount, setGlobalWbDiscount] = useState('');
  const [isApplyingGlobalWbDiscount, setIsApplyingGlobalWbDiscount] = useState(false);

  const applyGlobalWbDiscountToAllRows = useCallback(async () => {
    if (!tenantId || rows.length === 0 || isApplyingGlobalWbDiscount) return;
    const rawDiscount = normalizeDecimalInput(globalWbDiscount).trim();
    if (!rawDiscount) {
      window.alert('Укажите скидку WB в процентах.');
      return;
    }

    const discountValue = String(clampPercent(toNumber(rawDiscount)));
    const targetNmIds = rows
      .map((item) => toNumber(item?.nmId))
      .filter((nmId) => nmId > 0);

    if (targetNmIds.length === 0) return;

    setIsApplyingGlobalWbDiscount(true);
    setGlobalWbDiscount(discountValue);

    try {
      for (const nmId of targetNmIds) {
        const pending = manualSavePendingRef.current.get(nmId);
        if (pending) {
          clearTimeout(pending.timeout);
          manualSavePendingRef.current.delete(nmId);
        }
      }

      const inFlightSaves = targetNmIds
        .map((nmId) => manualSaveQueueRef.current.get(nmId))
        .filter((promise): promise is Promise<void> => Boolean(promise));
      if (inFlightSaves.length > 0) {
        await Promise.allSettled(inFlightSaves);
      }

      const nextByNm = new Map<number, ManualFields>();
      for (const nmId of targetNmIds) {
        const next = cloneManualFields(manualFieldsCache[nmId] ?? EMPTY_MANUAL_FIELDS);
        for (const scenario of PRICE_SCENARIOS) {
          next.priceScenarios[scenario.id] = {
            ...next.priceScenarios[scenario.id],
            wbDiscount: discountValue,
          };
        }
        nextByNm.set(nmId, next);
        saveManualFields(tenantId, nmId, next);
      }

      setManualFieldsCache((prev) => {
        const next = { ...prev };
        for (const [nmId, manualFields] of nextByNm.entries()) {
          next[nmId] = manualFields;
        }
        return next;
      });

      const { saveUnitEconomicsManualFieldsBulk } = await import('@/app/(dashboard)/economics/actions');
      await saveUnitEconomicsManualFieldsBulk(
        tenantId,
        Array.from(nextByNm.entries()).map(([nmId, manualFields]) => ({ nmId, manualFields })),
      );

      setImportSuccess(`Скидка WB ${discountValue}% проставлена: ${nextByNm.size} SKU.`);
      setTimeout(() => setImportSuccess(null), 6000);
      router.refresh();
    } catch (err) {
      console.error('[EconomicsTable] apply global WB discount error', err);
      window.alert('Не удалось проставить скидку WB по всем SKU. Повторите попытку.');
    } finally {
      setIsApplyingGlobalWbDiscount(false);
    }
  }, [
    tenantId,
    rows,
    isApplyingGlobalWbDiscount,
    globalWbDiscount,
    manualFieldsCache,
    router,
  ]);

  /* ── recalc / export / variant picker ─────────────────────────────── */
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [variantPickerOpen, setVariantPickerOpen] = useState(false);
  const [isApplyingVariants, setIsApplyingVariants] = useState(false);

  /* ── hide / restore row ───────────────────────────────────────────── */

  const restoreRow = useCallback(
    async (nmId: number) => {
      setRestoringNmId(nmId);
      try {
        const { restoreHiddenProduct } = await import('@/app/(dashboard)/economics/actions');
        if (tenantId) await restoreHiddenProduct(tenantId, nmId);
        setLocallyHiddenNmIds((prev) => prev.filter((id) => id !== nmId));
        router.refresh();
      } catch (err) {
        console.error('[EconomicsTable] restore error', err);
      } finally {
        setRestoringNmId(null);
      }
    },
    [tenantId, router],
  );

  const restoreRows = useCallback(
    async (nmIds: number[]) => {
      const ids = Array.from(
        new Set(nmIds.map((nmId) => Number(nmId)).filter((nmId) => Number.isInteger(nmId) && nmId > 0)),
      );
      if (!tenantId || ids.length === 0) return;

      try {
        const { toggleProductsVisibility } = await import('@/app/(dashboard)/settings/actions');
        await toggleProductsVisibility(tenantId, ids, false);
        const restoredSet = new Set(ids);
        setLocallyHiddenNmIds((prev) => prev.filter((id) => !restoredSet.has(id)));
        router.refresh();
      } catch (err) {
        console.error('[EconomicsTable] bulk restore error', err);
        window.alert('Не удалось вернуть выбранные SKU. Повторите попытку.');
        throw err;
      }
    },
    [tenantId, router],
  );

  const hideRow = useCallback(
    async (nmId: number) => {
      if (!tenantId || nmId <= 0 || hidingNmId === nmId) return;
      const confirmed = window.confirm(
        `Скрыть SKU ${nmId} из таблицы и исключить из расчётов?`,
      );
      if (!confirmed) return;

      setHidingNmId(nmId);
      try {
        const { toggleProductVisibility } = await import('@/app/(dashboard)/settings/actions');
        await toggleProductVisibility(tenantId, nmId, true);
        setLocallyHiddenNmIds((prev) => (prev.includes(nmId) ? prev : [...prev, nmId]));
        setSelectedNmIds((prev) => prev.filter((id) => id !== nmId));
        if (activeNmId === nmId) {
          setDetailMode(null);
        }
      } catch (err) {
        console.error('[EconomicsTable] hide sku error', err);
        window.alert('Не удалось скрыть SKU. Повторите попытку.');
      } finally {
        setHidingNmId((current) => (current === nmId ? null : current));
      }
    },
    [tenantId, hidingNmId, activeNmId],
  );

  const hideSelectedRows = useCallback(async () => {
    if (!tenantId || selectedNmIds.length === 0 || isBulkHiding) return;

    const visibleNmIds = new Set(rows.map((item) => toNumber(item?.nmId)).filter((nmId) => nmId > 0));
    const ids = selectedNmIds.filter((nmId) => visibleNmIds.has(nmId));
    if (ids.length === 0) {
      setSelectedNmIds([]);
      return;
    }

    const confirmed = window.confirm(
      `Скрыть ${ids.length} SKU из таблицы и исключить из расчётов?`,
    );
    if (!confirmed) return;

    setIsBulkHiding(true);
    try {
      const { toggleProductsVisibility } = await import('@/app/(dashboard)/settings/actions');
      await toggleProductsVisibility(tenantId, ids, true);
      const hiddenSet = new Set(ids);
      setLocallyHiddenNmIds((prev) => Array.from(new Set([...prev, ...ids])));
      setSelectedNmIds((prev) => prev.filter((nmId) => !hiddenSet.has(nmId)));
      if (hiddenSet.has(activeNmId)) {
        setDetailMode(null);
      }
      router.refresh();
    } catch (err) {
      console.error('[EconomicsTable] bulk hide sku error', err);
      window.alert('Не удалось скрыть выбранные SKU. Повторите попытку.');
    } finally {
      setIsBulkHiding(false);
    }
  }, [tenantId, selectedNmIds, isBulkHiding, rows, activeNmId, router]);

  /* ── apply current settings to model variants ─────────────────────── */
  const applyToVariants = useCallback(
    async (targetNmIds: number[]) => {
      if (!tenantId || isApplyingVariants || activeNmId <= 0 || targetNmIds.length === 0) return;
      const sourceFields = manualFieldsCache[activeNmId];
      if (!sourceFields) return;

      const valid = targetNmIds.filter((id) => id > 0 && id !== activeNmId);
      if (valid.length === 0) return;

      setIsApplyingVariants(true);
      try {
        const { saveUnitEconomicsManualFields, updateCostPrice } =
          await import('@/app/(dashboard)/economics/actions');

        // Optimistic: write copies into local cache + localStorage immediately
        const optimisticCopies = new Map<number, ManualFields>();
        for (const targetId of valid) {
          const copied = cloneManualFields(sourceFields);
          optimisticCopies.set(targetId, copied);
          saveManualFields(tenantId, targetId, copied);
        }
        setManualFieldsCache((prev) => {
          const next = { ...prev };
          for (const [id, copied] of optimisticCopies.entries()) {
            next[id] = copied;
          }
          return next;
        });

        const sourceCost = toNumber(sourceFields.costPrice);
        const results = await Promise.allSettled(
          valid.map(async (targetId) => {
            const copied = optimisticCopies.get(targetId);
            if (!copied) return;
            await saveUnitEconomicsManualFields(tenantId, targetId, copied);
            if (sourceCost > 0) {
              await updateCostPrice(tenantId, targetId, sourceCost);
            }
          }),
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed > 0) {
          window.alert(
            `Часть SKU не удалось сохранить: ${failed} из ${valid.length}. Повторите применение для них.`,
          );
        }
      } finally {
        setIsApplyingVariants(false);
        setVariantPickerOpen(false);
      }
    },
    [tenantId, isApplyingVariants, activeNmId, manualFieldsCache],
  );

  /* ── Excel export ─────────────────────────────────────────────────── */

  const summaryDepsForExportRef = useRef<{
    normalizedTariffMap: Map<string, AcceptanceTariffCandidate>;
    normalizedReturnTariffMap: Map<string, ReturnTariffCandidate>;
    globalWbDiscount: string;
    defaultTaxPercent: number | null;
  } | null>(null);

  const exportToExcel = useCallback(async () => {
    if (isExportingExcel || filteredRows.length === 0) return;
    setIsExportingExcel(true);
    try {
      const deps = summaryDepsForExportRef.current;
      if (!deps) return;
      const inputs = filteredRows.map((row) => {
        const fields = manualFieldsCache[toNumber(row.nmId)] ?? EMPTY_MANUAL_FIELDS;
        return { row, manualFields: fields, summary: buildRowSummary(row, fields, deps) };
      });
      await exportEconomicsExcel(inputs);
    } catch (err) {
      console.error('[EconomicsTable] excel export error', err);
      window.alert('Не удалось сформировать Excel. Повторите попытку.');
    } finally {
      setIsExportingExcel(false);
    }
  }, [isExportingExcel, filteredRows, manualFieldsCache]);

  /* ── Excel import ─────────────────────────────────────────────────── */

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (e.target) e.target.value = '';
      if (!file) return;

      setImportError(null);
      setImportSuccess(null);
      setIsImportingExcel(true);
      try {
        const parsed = await parseEconomicsExcel(file);
        const nmIds = Object.keys(parsed).map(Number).filter((id) => id > 0);
        if (nmIds.length === 0) {
          setImportError('В файле не найдено ни одного товара. Проверьте лист «Данные для ввода».');
          return;
        }

        let updated = 0;
        for (const nmId of nmIds) {
          const patch = parsed[nmId];
          if (!patch) continue;
          const current = manualFieldsCache[nmId];
          if (!current) continue;

          const merged = { ...current };
          const simpleKeys = [
            'irpPercent', 'purchaseQtyTotal', 'taxPercent', 'turnoverDays',
            'drrPercent', 'marketingInternal', 'marketingExternal', 'contentCost', 'otherCosts',
          ] as const;
          for (const key of simpleKeys) {
            const v = patch[key];
            if (typeof v === 'string' && v !== '') merged[key] = v;
          }
          if (patch.tradeScheme) merged.tradeScheme = patch.tradeScheme;
          if (patch.priceScenarios) {
            const ids = ['excellent', 'good', 'average', 'poor'] as const;
            const newScenarios = { ...merged.priceScenarios };
            for (const scenId of ids) {
              const patchScen = patch.priceScenarios[scenId];
              if (!patchScen) continue;
              newScenarios[scenId] = {
                ...newScenarios[scenId],
                ...(patchScen.sellerPriceBeforeDiscount ? { sellerPriceBeforeDiscount: patchScen.sellerPriceBeforeDiscount } : {}),
                ...(patchScen.sellerDiscount ? { sellerDiscount: patchScen.sellerDiscount } : {}),
                ...(patchScen.wbDiscount ? { wbDiscount: patchScen.wbDiscount } : {}),
                ...(patchScen.buyoutPercent ? { buyoutPercent: patchScen.buyoutPercent } : {}),
              };
            }
            merged.priceScenarios = newScenarios;
          }

          persistManualFieldsForNm(nmId, merged);
          updated++;
        }

        setImportSuccess(`Импорт завершён: обновлено ${updated} из ${nmIds.length} товаров.`);
        setTimeout(() => setImportSuccess(null), 6000);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Неизвестная ошибка при импорте.';
        setImportError(msg);
        setTimeout(() => setImportError(null), 10000);
      } finally {
        setIsImportingExcel(false);
      }
    },
    [manualFieldsCache, persistManualFieldsForNm],
  );

  /* ── summary builder ──────────────────────────────────────────────── */

  const summaryDeps = useMemo(
    () => ({ normalizedTariffMap, normalizedReturnTariffMap, globalWbDiscount, defaultTaxPercent }),
    [normalizedTariffMap, normalizedReturnTariffMap, globalWbDiscount, defaultTaxPercent],
  );

  useEffect(() => {
    summaryDepsForExportRef.current = summaryDeps;
  }, [summaryDeps]);

  // Pre-compute every row's summary once per (rows × manualFields × deps) change.
  // Without this, buildRowSummary was running for every row on every render —
  // 200 SKUs × ~50 columns made keystrokes and hover events noticeably laggy.
  const summariesByNm = useMemo(() => {
    const map = new Map<number, RowSummary>();
    for (const item of filteredRows) {
      const itemNmId = toNumber(item.nmId);
      const itemManualFields = manualFieldsCache[itemNmId] ?? EMPTY_MANUAL_FIELDS;
      map.set(itemNmId, buildRowSummary(item, itemManualFields, summaryDeps));
    }
    return map;
  }, [filteredRows, manualFieldsCache, summaryDeps]);

  const selectedOrderSummary = useMemo(() => {
    const visibleSelectedIds = selectedNmIds.filter((nmId) => rowsByNm.has(nmId));
    let purchaseQtyTotal = 0;
    let batchCostTotal = 0;
    let batchRevenue = 0;
    let batchGrossProfit = 0;
    let marketingInternal = 0;

    for (const nmId of visibleSelectedIds) {
      const row = rowsByNm.get(nmId);
      if (!row) continue;
      const manualFields = manualFieldsCache[nmId] ?? EMPTY_MANUAL_FIELDS;
      const summary = summariesByNm.get(nmId) ?? buildRowSummary(row, manualFields, summaryDeps);
      purchaseQtyTotal += summary.purchaseQtyTotal;
      batchCostTotal += summary.batchCostTotal;
      batchRevenue += summary.batchRevenue;
      batchGrossProfit += summary.batchGrossProfit;
      marketingInternal += summary.marketingInternal;
    }

    return {
      skuCount: visibleSelectedIds.length,
      purchaseQtyTotal,
      batchCostTotal,
      batchRevenue,
      batchGrossProfit,
      marketingInternal,
      profitabilityPercent: batchCostTotal > 0 ? (batchGrossProfit / batchCostTotal) * 100 : 0,
    };
  }, [selectedNmIds, rowsByNm, manualFieldsCache, summariesByNm, summaryDeps]);

  /* ── current source row for variant picker ────────────────────────── */
  const activeRow = useMemo(
    () => filteredRows.find((item) => toNumber(item.nmId) === activeNmId) ?? null,
    [filteredRows, activeNmId],
  );
  const variantsCount = useMemo(() => {
    if (!activeRow) return 0;
    const familyKey = buildVariantFamilyKey(activeRow);
    if (!familyKey) return 0;
    return rows.filter(
      (item) =>
        toNumber(item.nmId) > 0 &&
        toNumber(item.nmId) !== activeNmId &&
        buildVariantFamilyKey(item) === familyKey,
    ).length;
  }, [rows, activeRow, activeNmId]);

  /* ── detail panel toggle ──────────────────────────────────────────── */

  const toggleDetailForRow = useCallback(
    (mode: 'warehouses' | 'finance', targetNmId: number) => {
      if (targetNmId <= 0) return;
      if (targetNmId !== activeNmId) {
        setActiveNmId(targetNmId);
        setDetailMode(mode);
        return;
      }
      if (detailMode === mode) {
        setDetailMode(null);
        return;
      }
      setDetailMode(mode);
    },
    [activeNmId, detailMode],
  );

  /* ── render ───────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-3">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[300px] flex-1 text-muted-foreground">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск: артикул WB, артикул продавца, категория"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base font-semibold text-foreground placeholder:text-muted-foreground/60 outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </label>
        <select
          value={rowFilterMode}
          onChange={(e) => setRowFilterMode(e.target.value as RowFilterMode)}
          className="h-10 rounded-xl border border-border bg-card px-3 text-base font-semibold text-foreground outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
        >
          <option value="all">Фильтр: все SKU</option>
          <option value="withSales">Только с продажами</option>
          <option value="withCost">Только с себестоимостью</option>
          <option value="withoutCost">Только без себестоимости</option>
          <option value="toOrder">К закупке</option>
          <option value="selected">Выбранные</option>
        </select>
        <button
          type="button"
          onClick={() => { setSearchQuery(''); setRowFilterMode('all'); }}
          className="h-10 rounded-xl border border-border bg-card px-3 text-base font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
        >
          Сбросить
        </button>
        <button
          type="button"
          onClick={() => setShowHiddenPanel((v) => !v)}
          className={`h-10 rounded-xl border px-3 text-base font-semibold transition-colors ${
            showHiddenPanel
              ? 'border-amber-500/40 bg-amber-50 text-amber-700'
              : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
          }`}
        >
          <EyeOff className="mr-1 inline h-4 w-4" />
          Скрытые
        </button>

        <button
          type="button"
          onClick={toggleFilteredSelection}
          disabled={filteredNmIds.length === 0 || isBulkHiding}
          className="h-10 rounded-xl border border-border bg-card px-3 text-base font-semibold text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {allFilteredSelected ? 'Снять найденные' : 'Выбрать найденные'}
        </button>

        <button
          type="button"
          onClick={selectOrderCandidates}
          disabled={orderCandidateNmIds.length === 0 || isBulkHiding}
          className="h-10 rounded-xl border border-emerald-500/30 bg-emerald-50 px-3 text-base font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted/40 disabled:text-muted-foreground/60"
        >
          К закупке ({orderCandidateNmIds.length})
        </button>

        <label
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-base font-semibold text-muted-foreground"
          title="Скидка WB для массового заполнения сценариев по всем SKU."
        >
          <span className="text-sm font-semibold text-muted-foreground">Скидка WB</span>
          <input
            value={globalWbDiscount}
            onChange={(e) => setGlobalWbDiscount(normalizeDecimalInput(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void applyGlobalWbDiscountToAllRows();
              }
            }}
            placeholder="0"
            className="h-7 w-16 rounded-md border border-border bg-card px-2 text-right text-sm font-semibold text-foreground outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
          <span className="text-sm font-semibold text-muted-foreground/60">%</span>
        </label>
        <button
          type="button"
          onClick={() => void applyGlobalWbDiscountToAllRows()}
          disabled={!tenantId || rows.length === 0 || isApplyingGlobalWbDiscount}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-50 px-3 text-base font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted/40 disabled:text-muted-foreground/60"
          title="Записать указанную скидку WB во все ценовые сценарии всех SKU в таблице"
        >
          {isApplyingGlobalWbDiscount ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isApplyingGlobalWbDiscount ? 'Проставляю...' : 'Проставить всем'}
        </button>

        <button
          type="button"
          onClick={() => setVariantPickerOpen(true)}
          disabled={!activeRow || variantsCount === 0 || isApplyingVariants}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-50 px-3 text-base font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted/40 disabled:text-muted-foreground/60"
          title="Скопировать ручные поля и себестоимость в варианты той же модели"
        >
          <Palette className="h-4 w-4" />
          В цвета модели ({variantsCount})
        </button>

        <button
          type="button"
          onClick={() => void exportToExcel()}
          disabled={isExportingExcel || filteredRows.length === 0}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-base font-semibold text-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
          title="Экспортировать таблицу в .xlsx (3 листа: Данные, Данные для ввода, Справочник формул)"
        >
          {isExportingExcel
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <FileSpreadsheet className="h-4 w-4" />}
          {isExportingExcel ? 'Экспорт...' : 'Скачать Excel'}
        </button>

        <button
          type="button"
          onClick={() => importFileInputRef.current?.click()}
          disabled={isImportingExcel}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-sky-500/40 bg-sky-50 px-3 text-base font-semibold text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
          title="Загрузить .xlsx с листа «Данные для ввода» — обновит цены и ручные поля"
        >
          {isImportingExcel
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <FileUp className="h-4 w-4" />}
          {isImportingExcel ? 'Импортируем...' : 'Загрузить Excel'}
        </button>
        <input
          ref={importFileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => void handleImportFile(e)}
        />

        <div className="ml-auto text-base font-semibold text-muted-foreground">
          Показано: {filteredRows.length} из {rows.length}
          {selectedNmIds.length > 0 ? ` · выбрано ${selectedNmIds.length}` : ''}
        </div>
      </div>

      {/* import result banners */}
      {importError ? (
        <div className="flex items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">
          <span>⚠️ {importError}</span>
          <button type="button" onClick={() => setImportError(null)} className="ml-auto text-rose-400 hover:text-rose-600">✕</button>
        </div>
      ) : null}
      {importSuccess ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">
          <span>✓ {importSuccess}</span>
          <button type="button" onClick={() => setImportSuccess(null)} className="ml-auto text-emerald-400 hover:text-emerald-600">✕</button>
        </div>
      ) : null}

      {selectedNmIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          <span className="mr-1 font-black">Партия: {selectedOrderSummary.skuCount} SKU</span>
          {[
            ['К закупу', `${formatPlainNumber(selectedOrderSummary.purchaseQtyTotal)} шт`],
            ['Полная стоимость', formatRub(selectedOrderSummary.batchCostTotal)],
            ['Выручка выкупов', formatRub(selectedOrderSummary.batchRevenue)],
            ['Валовая прибыль', formatRub(selectedOrderSummary.batchGrossProfit)],
            ['Рентабельность', `${formatPlainNumber(selectedOrderSummary.profitabilityPercent, 1)}%`],
            ['Внутр. маркетинг', formatRub(selectedOrderSummary.marketingInternal)],
          ].map(([label, value]) => (
            <span
              key={label}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-500/20 bg-card px-2.5 text-xs font-bold text-foreground"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular-nums">{value}</span>
            </span>
          ))}
          <button
            type="button"
            onClick={() => void hideSelectedRows()}
            disabled={isBulkHiding}
            className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg bg-rose-600 px-3 text-sm font-bold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBulkHiding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Скрыть выбранные
          </button>
          <button
            type="button"
            onClick={() => setSelectedNmIds([])}
            disabled={isBulkHiding}
            className="h-9 rounded-lg border border-rose-300 bg-card px-3 text-sm font-bold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Снять выбор
          </button>
        </div>
      ) : null}

      {/* hidden products panel */}
      {showHiddenPanel && tenantId ? (
        <HiddenProductsPanel
          tenantId={tenantId}
          restoringNmId={restoringNmId}
          onRestore={restoreRow}
          onRestoreMany={restoreRows}
          onClose={() => setShowHiddenPanel(false)}
        />
      ) : null}

      {/* table */}
      <div className="max-h-[calc(100vh-220px)] overflow-auto rounded-xl border border-border shadow-sm">
        <table className="w-full min-w-max border-separate border-spacing-0 text-left text-[14px] text-foreground">
          <TableHeader columns={COLUMNS} />
          <tbody className="text-[14px]">
            {filteredRows.map((item, index) => {
              const itemNmId = toNumber(item.nmId);
              const isActive = itemNmId === activeNmId;
              const itemManualFields = getManualFieldsForRow(itemNmId);
              const itemSummary = summariesByNm.get(itemNmId)
                ?? buildRowSummary(item, itemManualFields, summaryDeps);
              const isExpanded = isActive && detailMode !== null;
              // Volume highlight: compare card volume (declared by seller) with WB
              // measured volume. Don't use summary.volumeLiters — it priorityzes
              // wbVolumeLiters and would always equal wbVolume (no highlight ever).
              const cardVolume = parseFirstNumber(item.volume) || toNumber(item.volumeLiters);
              const wbVolume = toNumber(item.wbVolumeLiters);
              const wbVolumeOver = wbVolume > 0 && cardVolume > 0 && wbVolume > cardVolume;
              const wbVolumeUnder = wbVolume > 0 && cardVolume > 0 && wbVolume < cardVolume;
              const isAutoBuyoutUnavailable = itemSummary.buyoutSource !== 'auto';
              const buyoutFactsBaseText = `выкупы ${Math.round(itemSummary.buyoutBuyoutCount)}, отмены ${Math.round(itemSummary.buyoutCancelCount)}, заказы ${Math.round(itemSummary.buyoutOrderCount)}`;
              const buyoutAutoCellTitle = itemSummary.buyoutSource === 'auto'
                ? `Авто-выкуп WB: ${itemSummary.buyoutAutoPercent.toFixed(1)}%. База: ${buyoutFactsBaseText}.`
                : itemSummary.buyoutAutoWarning
                  ? `${itemSummary.buyoutAutoWarning} База: ${buyoutFactsBaseText}.`
                  : `Авто-выкуп недоступен. База: ${buyoutFactsBaseText}.`;

              return (
                <Fragment key={itemNmId > 0 ? itemNmId : `row-${index}`}>
                  <tr
                    className={
                      isActive
                        ? 'bg-emerald-500/15'
                        : 'cursor-pointer bg-card transition-colors hover:bg-muted/60'
                    }
                    onClick={() => setActiveNmId(itemNmId)}
                  >
                    {COLUMNS.map((column) => {
                      const cellValue = resolveCellText(column.id, item, itemSummary, itemManualFields);
                      const stickyIdentityClass = resolveStickyIdentityColumnClass(column.id);

                      return (
                        <td
                          key={`${itemNmId}-${column.id}`}
                          title={column.id === 'buyout_auto' ? buyoutAutoCellTitle : undefined}
                          className={[
                            'px-2 py-2 align-middle',
                            column.id === 'seller_article' ? 'whitespace-normal' : 'whitespace-nowrap',
                            column.align === 'right' ? 'text-right font-medium tabular-nums' : '',
                            column.align === 'center' ? 'text-center' : '',
                            'border-b border-r first:border-l',
                            GRID_BORDER,
                            resolveStrictWidthClasses(column.minWidthClass),
                            STRONG_GROUP_SEPARATOR_COLUMNS.has(column.id) ? 'border-r-2 border-sky-400' : '',
                            column.id === 'separator' ? SEPARATOR_FILL : '',
                            stickyIdentityClass
                              ? `${stickyIdentityClass} z-[5] ${isActive ? 'bg-emerald-500/20' : 'bg-card'}`
                              : '',
                            column.id === 'photo' && isActive ? 'border-l-4 border-l-emerald-500' : '',
                            column.id === 'wb_volume' && wbVolumeOver
                              ? 'text-rose-600 dark:text-rose-400 bg-rose-500/10'
                              : '',
                            column.id === 'wb_volume' && wbVolumeUnder
                              ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                              : '',
                            column.id === 'buyout_auto' && isAutoBuyoutUnavailable
                              ? 'text-amber-700 dark:text-amber-400 bg-amber-500/10'
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {cellValue === INTERACTIVE_COLUMN ? (
                            column.id === 'photo' ? (
                              <div className="mx-auto flex items-center justify-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={selectedNmIdSet.has(itemNmId)}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() => toggleRowSelected(itemNmId)}
                                  disabled={itemNmId <= 0 || isBulkHiding}
                                  className="h-4 w-4 rounded border-slate-400 text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                                  aria-label={`Выбрать SKU ${itemNmId}`}
                                />
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); void hideRow(itemNmId); }}
                                  disabled={itemNmId <= 0 || hidingNmId === itemNmId}
                                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                                    itemNmId > 0 && hidingNmId !== itemNmId
                                      ? 'border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20'
                                      : 'cursor-not-allowed border-border bg-muted text-muted-foreground/60'
                                  }`}
                                  title={hidingNmId === itemNmId ? 'Скрываем SKU…' : 'Скрыть SKU из расчётов'}
                                >
                                  {hidingNmId === itemNmId
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <EyeOff className="h-3.5 w-3.5" />}
                                </button>
                                {item.photoUrl ? (
                                  <div className="h-10 w-10 overflow-hidden rounded-lg border border-border bg-muted">
                                    <Image
                                      src={item.photoUrl}
                                      alt=""
                                      width={40}
                                      height={40}
                                      className="h-full w-full object-cover"
                                      referrerPolicy="no-referrer"
                                    />
                                  </div>
                                ) : (
                                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted">
                                    <span className="text-[10px] font-semibold text-muted-foreground/60">IMG</span>
                                  </div>
                                )}
                              </div>
                            ) : column.id === 'article' ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleDetailForRow('warehouses', itemNmId); }}
                                className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted"
                              >
                                {isActive && detailMode === 'warehouses'
                                  ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                                <span>{itemNmId || '—'}</span>
                              </button>
                            ) : column.id === 'price' ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleDetailForRow('finance', itemNmId); }}
                                className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-medium tabular-nums text-foreground transition-colors hover:bg-muted"
                              >
                                {isActive && detailMode === 'finance'
                                  ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                                  : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                                <span>
                                  {itemSummary.sellerPriceBeforeDiscount > 0
                                    ? `${itemSummary.sellerPriceBeforeDiscount.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
                                    : '—'}
                                </span>
                              </button>
                            ) : null
                          ) : isActive ? (
                            renderEditableCell(
                              column.id,
                              itemNmId,
                              itemManualFields,
                              cellValue,
                              {
                                soldQuantity: toNumber(item.soldQuantity),
                                summary: itemSummary,
                                onUpdate: (next) => persistManualFieldsForNm(itemNmId, next),
                              },
                            )
                          ) : (
                            cellValue
                          )}
                        </td>
                      );
                    })}
                  </tr>

                  {isExpanded && detailMode === 'warehouses' ? (() => {
                    const itemVolumeLiters = resolveVolumeLiters(item);
                    const itemRates = computeWarehouseRates(
                      itemVolumeLiters,
                      itemManualFields,
                      normalizedTariffMap,
                      normalizedReturnTariffMap,
                    );
                    const itemBuyoutManual = itemSummary.buyoutSource === 'manual';
                    const itemBuyoutPercent = itemSummary.buyoutPercent;
                    // ИЛ (Индекс Локализации) — auto from WB localizationPercent ladder,
                    // manual override via localityIndexPercent. Multiplier on forward.
                    const itemAutoLocalityIndex = itemSummary.localizationPercent != null
                      ? resolveLocalityIndexMultiplierFromLocalization(itemSummary.localizationPercent)
                      : 1;
                    const itemAutoIrp = itemSummary.localizationPercent != null
                      ? resolveIrpFromLocalization(itemSummary.localizationPercent)
                      : 0;
                    return (
                      <tr className="bg-emerald-500/8">
                        <td colSpan={COLUMNS.length} className="border-b border-border p-0">
                          <div className="sticky left-0 max-w-[min(1280px,calc(100vw-120px))] space-y-3 px-3 py-3">
                            <SkuMetaBlock
                              row={item}
                              tradeScheme={itemManualFields.tradeScheme}
                              onTradeSchemeChange={(next) =>
                                persistManualFieldsForNm(itemNmId, { ...itemManualFields, tradeScheme: next })
                              }
                            />
                            <WarehousesPanel
                              manualFields={itemManualFields}
                              onUpdate={(next) => persistManualFieldsForNm(itemNmId, next)}
                              costInputsReadOnly
                              warehouseRates={itemRates}
                              volumeLiters={itemVolumeLiters}
                              buyoutPercent={itemBuyoutPercent}
                              isBuyoutManual={itemBuyoutManual}
                              buyoutSource={itemSummary.buyoutSource}
                              buyoutOrderCount={itemSummary.buyoutOrderCount}
                              buyoutBuyoutCount={itemSummary.buyoutBuyoutCount}
                              buyoutCancelCount={itemSummary.buyoutCancelCount}
                              buyoutClosedCount={itemSummary.buyoutClosedCount}
                              buyoutOpenCount={itemSummary.buyoutOpenCount}
                              buyoutOpenShare={itemSummary.buyoutOpenShare}
                              buyoutAutoWarning={itemSummary.buyoutAutoWarning}
                              tradeScheme={itemManualFields.tradeScheme}
                              irpPercent={itemSummary.irpPercent}
                              irpSource={itemSummary.irpSource}
                              autoIrpPercent={itemAutoIrp}
                              irpSurcharge={itemSummary.irpSurcharge}
                              localizationPercent={itemSummary.localizationPercent}
                              localityIndexSource={itemSummary.localityIndexSource}
                              autoLocalityIndex={itemAutoLocalityIndex}
                              acceptanceTariffsDate={null}
                              returnTariffsDate={null}
                              wbWarehouseNames={wbWarehouseNames ?? []}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })() : null}

                  {isExpanded && detailMode === 'finance'
                    ? PRICE_SCENARIOS.map((scenario) => {
                        const scenarioSummary = buildRowSummary(
                          item,
                          itemManualFields,
                          summaryDeps,
                          scenario.id,
                        );
                        return (
                          <ScenarioRow
                            key={`scenario-${itemNmId}-${scenario.id}`}
                            scenarioId={scenario.id}
                            scenarioLabel={scenario.label}
                            row={item}
                            manualFields={itemManualFields}
                            scenarioSummary={scenarioSummary}
                            isActive={itemManualFields.activePriceScenarioId === scenario.id}
                            onSetActive={() =>
                              persistManualFieldsForNm(itemNmId, {
                                ...itemManualFields,
                                activePriceScenarioId: scenario.id,
                              })
                            }
                            onUpdate={(next) => persistManualFieldsForNm(itemNmId, next)}
                          />
                        );
                      })
                    : null}
                </Fragment>
              );
            })}

            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="py-12 text-center text-base font-semibold text-muted-foreground/60"
                >
                  {rows.length === 0 ? 'Нет данных' : 'Нет SKU по заданному фильтру'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {variantPickerOpen && activeRow ? (
        <VariantPickerModal
          sourceRow={activeRow}
          rows={rows}
          isApplying={isApplyingVariants}
          onClose={() => setVariantPickerOpen(false)}
          onApply={applyToVariants}
        />
      ) : null}
    </div>
  );
}
