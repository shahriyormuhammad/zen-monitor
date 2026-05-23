'use client';

import Image from 'next/image';
import { Fragment, type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Boxes, Check, Download, EyeOff, FileSpreadsheet, Loader2, Palette, Save, Search, Trash2, Upload, Warehouse, X } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { toLocalDateParam } from '@/lib/date-range';
import { OperatorState } from '@/components/dashboard/OperatorState';
import {
  cloneManualFields,
  hasServerManualPayload,
  parseManualFieldsFromUnknown,
  readManualFields,
  saveManualFields,
} from '@/components/economics/manual-fields-io';
import { EMPTY_MANUAL_FIELDS, resolveLocalityIndexMultiplierFromLocalization } from '@/components/economics/constants';
import { formatCurrency, normalizeDecimalInput, toNumber } from '@/components/economics/helpers';
import { resolveVolumeLiters } from '@/components/economics/tariff-helpers';
import { buildRowSummary } from '@/components/economics/row-summary';
import type { ManualFields, UnitTemplateRow, WarehouseBoxTariff, WarehouseReturnTariff, WarehouseTariff } from '@/components/economics/types';
import { HiddenProductsPanel } from '@/components/economics/table/HiddenProductsPanel';
import { VariantPickerModal } from '@/components/economics/table/VariantPickerModal';
import { WarehousesPanel } from '@/components/economics/table/WarehousesPanel';
import { buildVariantFamilyKey } from '@/components/economics/table/utils';
import { computeWarehouseRates } from '@/components/economics/table/warehouse-rates';
import {
  buildAcceptanceTariffMap,
  buildAcceptanceTariffMapFromBox,
  buildReturnTariffMap,
} from '@/components/economics/table/tariff-maps';
import {
  computeCostTotal,
  computeDeliveryToWb,
  copyCostFieldsToManualFields,
  isCostComplete,
  resolvePurchaseCost,
} from './costing-helpers';
import { exportCostingExcel, parseCostingExcel, type CostingExcelMode, type CostingExcelRow } from './costingExcel';

type EconomicsTemplateResponse = {
  data: UnitTemplateRow[];
  manualInputsByNm?: Record<string, Record<string, unknown>>;
  boxTariffs?: WarehouseBoxTariff[];
  boxTariffsDate?: string | null;
  acceptanceTariffs?: WarehouseTariff[];
  acceptanceTariffsDate?: string | null;
  returnTariffs?: WarehouseReturnTariff[];
  returnTariffsDate?: string | null;
  wbWarehouseNames?: string[];
};

type CostFilterMode = 'all' | 'missing' | 'complete';

const COSTING_ROW_ESTIMATE_PX = 58;
const COSTING_OVERSCAN_ROWS = 10;

function worklistStorageKey(tenantId: string) {
  return `costing-worklist:${tenantId}`;
}

function selectedStorageKey(tenantId: string) {
  return `costing-selected:${tenantId}`;
}

function loadWorklist(tenantId: string): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(worklistStorageKey(tenantId)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.map(Number).filter((nmId) => Number.isInteger(nmId) && nmId > 0)
      : [];
  } catch {
    return [];
  }
}

function saveWorklist(tenantId: string, nmIds: number[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(worklistStorageKey(tenantId), JSON.stringify(nmIds));
}

function loadSelectedNmIds(tenantId: string): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(selectedStorageKey(tenantId)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.map(Number).filter((nmId) => Number.isInteger(nmId) && nmId > 0)
      : [];
  } catch {
    return [];
  }
}

function saveSelectedNmIds(tenantId: string, nmIds: number[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(selectedStorageKey(tenantId), JSON.stringify(nmIds));
}

function getCostingSalesRank(row: UnitTemplateRow) {
  const soldQuantity = toNumber(row.soldQuantity);
  const grossRevenue = toNumber(row.grossRevenue);
  const buyoutCount = toNumber(row.buyoutCountFact);
  if (soldQuantity > 0 || grossRevenue > 0 || buyoutCount > 0) return 2;

  const orderCount = toNumber(row.buyoutOrderCountFact ?? row.orderCount);
  const views = toNumber(row.views);
  return orderCount > 0 || views > 0 ? 1 : 0;
}

function getVisibilityErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function hasManualFieldValues(fields: ManualFields) {
  const textFields: Array<keyof Pick<
    ManualFields,
    | 'costPrice'
    | 'deliveryToFf'
    | 'packagingMaterial'
    | 'fulfillment'
    | 'irpPercent'
    | 'localityIndexPercent'
    | 'purchaseQtyTotal'
    | 'taxPercent'
    | 'turnoverDays'
    | 'drrPercent'
    | 'marketingInternal'
    | 'marketingExternal'
    | 'contentCost'
    | 'otherCosts'
    | 'cpoPlan'
    | 'cpsPlan'
  >> = [
    'costPrice',
    'deliveryToFf',
    'packagingMaterial',
    'fulfillment',
    'irpPercent',
    'localityIndexPercent',
    'purchaseQtyTotal',
    'taxPercent',
    'turnoverDays',
    'drrPercent',
    'marketingInternal',
    'marketingExternal',
    'contentCost',
    'otherCosts',
    'cpoPlan',
    'cpsPlan',
  ];

  if (textFields.some((key) => fields[key].trim().length > 0)) return true;
  if (fields.selectedWarehouses.length > 0 || fields.customWarehouses.length > 0) return true;
  if (Object.values(fields.warehouseCosts).some((value) => value.trim().length > 0)) return true;
  if (fields.tradeScheme !== EMPTY_MANUAL_FIELDS.tradeScheme) return true;
  if (fields.activePriceScenarioId !== EMPTY_MANUAL_FIELDS.activePriceScenarioId) return true;
  return Object.values(fields.priceScenarios).some((scenario) =>
    Object.values(scenario).some((value) => value.trim().length > 0)
  );
}

async function postProductsVisibility(nmIds: number[], isHidden: boolean) {
  const response = await fetch('/api/views/costs/visibility', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nmIds, isHidden }),
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? 'Не удалось изменить видимость SKU');
  }

  return payload;
}

export function CostingPageClient({ tenantId }: { tenantId: string }) {
  const { dateFrom, dateTo } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<CostFilterMode>('all');
  const [manualFieldsByNm, setManualFieldsByNm] = useState<Record<number, ManualFields>>({});
  const [savedCostCompleteByNm, setSavedCostCompleteByNm] = useState<Record<number, boolean>>({});
  const [dirtyNmIds, setDirtyNmIds] = useState<number[]>([]);
  const [worklistNmIds, setWorklistNmIds] = useState<number[]>([]);
  const [showWorklistOnly, setShowWorklistOnly] = useState(false);
  const [locallyHiddenNmIds, setLocallyHiddenNmIds] = useState<number[]>([]);
  const [selectedNmIds, setSelectedNmIds] = useState<number[]>([]);
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);
  const [restoringNmId, setRestoringNmId] = useState<number | null>(null);
  const [hidingNmId, setHidingNmId] = useState<number | null>(null);
  const [isBulkHiding, setIsBulkHiding] = useState(false);
  const [expandedWarehouseNmId, setExpandedWarehouseNmId] = useState<number | null>(null);
  const [variantSourceRow, setVariantSourceRow] = useState<UnitTemplateRow | null>(null);
  const [isApplyingVariants, setIsApplyingVariants] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isCostingExcelExporting, setIsCostingExcelExporting] = useState(false);
  const [isCostingExcelImporting, setIsCostingExcelImporting] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const selectedStorageLoadedRef = useRef(false);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);
  const costingImportInputRef = useRef<HTMLInputElement | null>(null);

  const { data, isLoading, error, refetch } = useQuery<EconomicsTemplateResponse | null, Error>({
    queryKey: ['costing-source', tenantId, dateFrom, dateTo],
    queryFn: async () => {
      const response = await fetch(
        `/api/views/economics-template?from=${toLocalDateParam(dateFrom)}&to=${toLocalDateParam(dateTo)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Ошибка при загрузке себестоимости');
      return response.json();
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  const normalizedTariffMap = useMemo(() => {
    const fromAcceptance = buildAcceptanceTariffMap(data?.acceptanceTariffs ?? []);
    const fromBox = buildAcceptanceTariffMapFromBox(data?.boxTariffs ?? []);
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
  }, [data?.acceptanceTariffs, data?.boxTariffs]);

  const normalizedReturnTariffMap = useMemo(
    () => buildReturnTariffMap(data?.returnTariffs ?? []),
    [data?.returnTariffs],
  );

  const locallyHiddenSet = useMemo(() => new Set(locallyHiddenNmIds), [locallyHiddenNmIds]);
  const selectedSet = useMemo(() => new Set(selectedNmIds), [selectedNmIds]);

  const rows = useMemo(
    () => (data?.data ?? [])
      .filter((item) => toNumber(item.nmId) > 0)
      .filter((item) => !locallyHiddenSet.has(toNumber(item.nmId)))
      .sort((a, b) => {
        const salesRankDiff = getCostingSalesRank(b) - getCostingSalesRank(a);
        if (salesRankDiff !== 0) return salesRankDiff;

        const soldDiff = toNumber(b.soldQuantity) - toNumber(a.soldQuantity);
        if (soldDiff !== 0) return soldDiff;

        const revenueDiff = toNumber(b.grossRevenue) - toNumber(a.grossRevenue);
        if (revenueDiff !== 0) return revenueDiff;

        return String(a.vendorCode ?? a.nmId ?? '').localeCompare(String(b.vendorCode ?? b.nmId ?? ''), 'ru');
      }),
    [data?.data, locallyHiddenSet],
  );

  const variantCountsByNm = useMemo(() => {
    const familyByNm = new Map<number, string>();
    const familyCounts = new Map<string, number>();

    for (const row of rows) {
      const nmId = toNumber(row.nmId);
      if (nmId <= 0) continue;
      const familyKey = buildVariantFamilyKey(row);
      familyByNm.set(nmId, familyKey);
      familyCounts.set(familyKey, (familyCounts.get(familyKey) ?? 0) + 1);
    }

    const countsByNm = new Map<number, number>();
    for (const [nmId, familyKey] of familyByNm.entries()) {
      countsByNm.set(nmId, Math.max(0, (familyCounts.get(familyKey) ?? 1) - 1));
    }
    return countsByNm;
  }, [rows]);

  const dirtySet = useMemo(() => new Set(dirtyNmIds), [dirtyNmIds]);
  const worklistSet = useMemo(() => new Set(worklistNmIds), [worklistNmIds]);

  useEffect(() => {
    const next: Record<number, ManualFields> = {};
    for (const row of data?.data ?? []) {
      const nmId = toNumber(row.nmId);
      if (nmId <= 0) continue;
      const serverPayload = data?.manualInputsByNm?.[String(nmId)];
      if (hasServerManualPayload(serverPayload)) {
        const parsed = parseManualFieldsFromUnknown(serverPayload);
        next[nmId] = parsed;
        saveManualFields(tenantId, nmId, parsed);
      } else {
        next[nmId] = readManualFields(tenantId, nmId);
      }
    }
    setManualFieldsByNm(next);
    setDirtyNmIds([]);
  }, [data?.data, data?.manualInputsByNm, tenantId]);

  useEffect(() => {
    setSavedCostCompleteByNm({});
  }, [tenantId]);

  useEffect(() => {
    const next: Record<number, boolean> = {};
    for (const row of data?.data ?? []) {
      const nmId = toNumber(row.nmId);
      if (nmId <= 0) continue;
      const serverPayload = data?.manualInputsByNm?.[String(nmId)];
      const savedManualFields = hasServerManualPayload(serverPayload)
        ? parseManualFieldsFromUnknown(serverPayload)
        : EMPTY_MANUAL_FIELDS;
      next[nmId] = isCostComplete(row, savedManualFields);
    }

    setSavedCostCompleteByNm((prev) => {
      if (filterMode !== 'missing' && filterMode !== 'complete') {
        return next;
      }

      const stable = { ...next };
      for (const key of Object.keys(stable)) {
        const nmId = Number(key);
        const previousValue = prev[nmId];
        if (Number.isFinite(nmId) && typeof previousValue === 'boolean') {
          stable[nmId] = previousValue;
        }
      }
      return stable;
    });
  }, [data?.data, data?.manualInputsByNm, filterMode]);

  useEffect(() => {
    setWorklistNmIds(loadWorklist(tenantId));
  }, [tenantId]);

  useEffect(() => {
    selectedStorageLoadedRef.current = false;
    setSelectedNmIds(loadSelectedNmIds(tenantId));
    queueMicrotask(() => {
      selectedStorageLoadedRef.current = true;
    });
  }, [tenantId]);

  useEffect(() => {
    saveWorklist(tenantId, worklistNmIds);
  }, [tenantId, worklistNmIds]);

  useEffect(() => {
    if (!selectedStorageLoadedRef.current) return;
    saveSelectedNmIds(tenantId, selectedNmIds);
  }, [tenantId, selectedNmIds]);

  useEffect(() => {
    const visibleNmIds = new Set(rows.map((row) => toNumber(row.nmId)).filter((nmId) => nmId > 0));
    setSelectedNmIds((prev) => {
      const next = prev.filter((nmId) => visibleNmIds.has(nmId));
      return next.length === prev.length ? prev : next;
    });
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const nmId = toNumber(row.nmId);
      const savedCostComplete = savedCostCompleteByNm[nmId] ?? isCostComplete(row, EMPTY_MANUAL_FIELDS);
      if (showWorklistOnly && !worklistSet.has(nmId)) return false;
      if (filterMode === 'missing' && savedCostComplete) return false;
      if (filterMode === 'complete' && !savedCostComplete) return false;
      if (!q) return true;
      return (
        String(row.nmId ?? '').toLowerCase().includes(q) ||
        String(row.vendorCode ?? '').toLowerCase().includes(q) ||
        String(row.category ?? '').toLowerCase().includes(q) ||
        String(row.brand ?? '').toLowerCase().includes(q)
      );
    });
  }, [filterMode, rows, savedCostCompleteByNm, searchQuery, showWorklistOnly, worklistSet]);

  const completeCount = useMemo(
    () => rows.filter((row) => isCostComplete(row, manualFieldsByNm[toNumber(row.nmId)] ?? EMPTY_MANUAL_FIELDS)).length,
    [manualFieldsByNm, rows],
  );

  const saveableRows = useMemo(() => rows
    .map((row) => {
      const nmId = toNumber(row.nmId);
      if (nmId <= 0) return null;
      const manualFields = manualFieldsByNm[nmId] ?? EMPTY_MANUAL_FIELDS;
      const hasServerPayload = hasServerManualPayload(data?.manualInputsByNm?.[String(nmId)]);
      return hasServerPayload || hasManualFieldValues(manualFields)
        ? { nmId, manualFields }
        : null;
    })
    .filter((item): item is { nmId: number; manualFields: ManualFields } => item !== null),
  [data?.manualInputsByNm, manualFieldsByNm, rows]);

  const costingExcelRows = useMemo<CostingExcelRow[]>(
    () => rows.map((row) => ({
      row,
      manualFields: manualFieldsByNm[toNumber(row.nmId)] ?? EMPTY_MANUAL_FIELDS,
    })),
    [manualFieldsByNm, rows],
  );

  const filteredNmIds = useMemo(
    () => filteredRows.map((row) => toNumber(row.nmId)).filter((nmId) => nmId > 0),
    [filteredRows],
  );

  const selectedFilteredCount = useMemo(
    () => filteredNmIds.filter((nmId) => selectedSet.has(nmId)).length,
    [filteredNmIds, selectedSet],
  );

  const allFilteredSelected = filteredNmIds.length > 0 && selectedFilteredCount === filteredNmIds.length;

  useEffect(() => {
    if (!selectAllCheckboxRef.current) return;
    selectAllCheckboxRef.current.indeterminate = selectedFilteredCount > 0 && !allFilteredSelected;
  }, [allFilteredSelected, selectedFilteredCount]);

  const patchManualFields = (nmId: number, patch: Partial<ManualFields>) => {
    setManualFieldsByNm((prev) => {
      const current = prev[nmId] ?? EMPTY_MANUAL_FIELDS;
      const next = { ...cloneManualFields(current), ...patch };
      saveManualFields(tenantId, nmId, next);
      return { ...prev, [nmId]: next };
    });
    setDirtyNmIds((prev) => (prev.includes(nmId) ? prev : [...prev, nmId]));
  };

  const updateManualFields = (nmId: number, nextManualFields: ManualFields) => {
    setManualFieldsByNm((prev) => {
      saveManualFields(tenantId, nmId, nextManualFields);
      return { ...prev, [nmId]: nextManualFields };
    });
    setDirtyNmIds((prev) => (prev.includes(nmId) ? prev : [...prev, nmId]));
  };

  const toggleSelected = (nmId: number) => {
    setSelectedNmIds((prev) => (
      prev.includes(nmId)
        ? prev.filter((id) => id !== nmId)
        : [...prev, nmId]
    ));
  };

  const selectAllFilteredRows = () => {
    if (filteredNmIds.length === 0) return;
    setSelectedNmIds((prev) => Array.from(new Set([...prev, ...filteredNmIds])));
  };

  const clearFilteredSelection = () => {
    if (filteredNmIds.length === 0) return;
    const filteredSet = new Set(filteredNmIds);
    setSelectedNmIds((prev) => prev.filter((nmId) => !filteredSet.has(nmId)));
  };

  const toggleFilteredSelection = () => {
    if (allFilteredSelected) {
      clearFilteredSelection();
      return;
    }
    selectAllFilteredRows();
  };

  const toggleWorklist = (nmId: number) => {
    setWorklistNmIds((prev) => (
      prev.includes(nmId)
        ? prev.filter((id) => id !== nmId)
        : [...prev, nmId]
    ));
  };

  const addFilteredToWorklist = () => {
    setWorklistNmIds((prev) => Array.from(new Set([
      ...prev,
      ...filteredRows.map((row) => toNumber(row.nmId)).filter((nmId) => nmId > 0),
    ])));
  };

  const downloadCostingExcel = async (mode: CostingExcelMode) => {
    if (isCostingExcelExporting || costingExcelRows.length === 0) return;
    setIsCostingExcelExporting(true);
    setSaveMessage(null);
    try {
      await exportCostingExcel(costingExcelRows, mode);
    } catch (err) {
      console.error('[CostingPageClient] costing excel export error', err);
      window.alert('Не удалось скачать Excel-файл себестоимости. Повторите попытку.');
    } finally {
      setIsCostingExcelExporting(false);
    }
  };

  const importCostingExcel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    if (!file || isCostingExcelImporting) return;

    setIsCostingExcelImporting(true);
    setSaveMessage(null);
    try {
      const parsed = await parseCostingExcel(file);
      const loadedNmIds = new Set(rows.map((row) => toNumber(row.nmId)).filter((nmId) => nmId > 0));
      const nextManualFieldsByNm = { ...manualFieldsByNm };
      const importedNmIds: number[] = [];

      for (const item of parsed.rows) {
        if (!loadedNmIds.has(item.nmId)) continue;
        const current = nextManualFieldsByNm[item.nmId] ?? EMPTY_MANUAL_FIELDS;
        const nextManualFields = { ...cloneManualFields(current), ...item.patch };
        nextManualFieldsByNm[item.nmId] = nextManualFields;
        saveManualFields(tenantId, item.nmId, nextManualFields);
        importedNmIds.push(item.nmId);
      }

      const importedUniqueNmIds = Array.from(new Set(importedNmIds));
      if (importedUniqueNmIds.length === 0) {
        setSaveMessage(`Excel прочитан, но подходящих SKU не найдено. Пропущено строк: ${parsed.skippedRows}`);
        setTimeout(() => setSaveMessage(null), 7000);
        return;
      }

      setManualFieldsByNm(nextManualFieldsByNm);
      setDirtyNmIds((prev) => Array.from(new Set([...prev, ...importedUniqueNmIds])));
      const skippedCount = parsed.skippedRows + parsed.rows.length - importedUniqueNmIds.length;
      setSaveMessage(
        `Импортировано: ${importedUniqueNmIds.length} SKU${skippedCount > 0 ? `, пропущено: ${skippedCount}` : ''}. Нажмите «Сохранить всё».`,
      );
      setTimeout(() => setSaveMessage(null), 7000);
    } catch (err) {
      console.error('[CostingPageClient] costing excel import error', err);
      window.alert(getVisibilityErrorMessage(err, 'Не удалось загрузить Excel-файл себестоимости.'));
    } finally {
      setIsCostingExcelImporting(false);
    }
  };

  const restoreRow = async (nmId: number) => {
    if (!tenantId || nmId <= 0) return;
    setRestoringNmId(nmId);
    try {
      const { restoreHiddenProduct } = await import('@/app/(dashboard)/economics/actions');
      await restoreHiddenProduct(tenantId, nmId);
      setLocallyHiddenNmIds((prev) => prev.filter((id) => id !== nmId));
      await refetch();
    } catch (err) {
      console.error('[CostingPageClient] restore error', err);
      window.alert(getVisibilityErrorMessage(err, 'Не удалось вернуть SKU. Повторите попытку.'));
    } finally {
      setRestoringNmId(null);
    }
  };

  const restoreRows = async (nmIds: number[]) => {
    const ids = Array.from(new Set(nmIds.map(Number).filter((nmId) => Number.isInteger(nmId) && nmId > 0)));
    if (!tenantId || ids.length === 0) return;
    try {
      await postProductsVisibility(ids, false);
      const restoredSet = new Set(ids);
      setLocallyHiddenNmIds((prev) => prev.filter((id) => !restoredSet.has(id)));
      await refetch();
    } catch (err) {
      console.error('[CostingPageClient] bulk restore error', err);
      window.alert(getVisibilityErrorMessage(err, 'Не удалось вернуть выбранные SKU. Повторите попытку.'));
      throw err;
    }
  };

  const hideRow = async (nmId: number) => {
    if (!tenantId || nmId <= 0 || hidingNmId === nmId) return;
    const confirmed = window.confirm(`Скрыть SKU ${nmId} из себестоимости и расчётов?`);
    if (!confirmed) return;

    setHidingNmId(nmId);
    try {
      await postProductsVisibility([nmId], true);
      setLocallyHiddenNmIds((prev) => (prev.includes(nmId) ? prev : [...prev, nmId]));
      setSelectedNmIds((prev) => prev.filter((id) => id !== nmId));
      if (expandedWarehouseNmId === nmId) setExpandedWarehouseNmId(null);
    } catch (err) {
      console.error('[CostingPageClient] hide sku error', err);
      window.alert(getVisibilityErrorMessage(err, 'Не удалось скрыть SKU. Повторите попытку.'));
    } finally {
      setHidingNmId((current) => (current === nmId ? null : current));
    }
  };

  const hideSelectedRows = async () => {
    if (!tenantId || selectedNmIds.length === 0 || isBulkHiding) return;
    const visibleNmIds = new Set(rows.map((row) => toNumber(row.nmId)).filter((nmId) => nmId > 0));
    const ids = selectedNmIds.filter((nmId) => visibleNmIds.has(nmId));
    if (ids.length === 0) {
      setSelectedNmIds([]);
      return;
    }

    const confirmed = window.confirm(`Скрыть ${ids.length} SKU из себестоимости и расчётов?`);
    if (!confirmed) return;

    setIsBulkHiding(true);
    try {
      await postProductsVisibility(ids, true);
      const hiddenSet = new Set(ids);
      setLocallyHiddenNmIds((prev) => Array.from(new Set([...prev, ...ids])));
      setSelectedNmIds((prev) => prev.filter((nmId) => !hiddenSet.has(nmId)));
      if (expandedWarehouseNmId && hiddenSet.has(expandedWarehouseNmId)) {
        setExpandedWarehouseNmId(null);
      }
    } catch (err) {
      console.error('[CostingPageClient] bulk hide sku error', err);
      window.alert(getVisibilityErrorMessage(err, 'Не удалось скрыть выбранные SKU. Повторите попытку.'));
    } finally {
      setIsBulkHiding(false);
    }
  };

  const saveChanges = async () => {
    if (isSaving) return;
    if (saveableRows.length === 0) {
      setSaveMessage('Нет заполненной себестоимости для сохранения');
      setTimeout(() => setSaveMessage(null), 5000);
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);
    try {
      const { saveUnitEconomicsManualFieldsBulk } = await import('@/app/(dashboard)/economics/actions');
      const { bulkUpsertCosts } = await import('@/app/(dashboard)/settings/bulk-actions');

      await saveUnitEconomicsManualFieldsBulk(tenantId, saveableRows);
      const costRows = saveableRows
        .map((item) => ({ nmId: item.nmId, costPrice: toNumber(item.manualFields.costPrice) }))
        .filter((item) => item.costPrice > 0);
      if (costRows.length > 0) {
        await bulkUpsertCosts(tenantId, costRows);
      }

      setDirtyNmIds([]);
      setSaveMessage(`Сохранено: ${saveableRows.length} SKU`);
      setTimeout(() => setSaveMessage(null), 5000);
      void refetch();
    } catch (err) {
      console.error('[CostingPageClient] save error', err);
      window.alert('Не удалось сохранить себестоимость. Повторите попытку.');
    } finally {
      setIsSaving(false);
    }
  };

  const applyCostToVariants = async (targetNmIds: number[]) => {
    const sourceNmId = toNumber(variantSourceRow?.nmId);
    if (!tenantId || isApplyingVariants || sourceNmId <= 0 || targetNmIds.length === 0) return;

    const validTargets = Array.from(new Set(
      targetNmIds
        .map((nmId) => Number(nmId))
        .filter((nmId) => Number.isInteger(nmId) && nmId > 0 && nmId !== sourceNmId),
    ));
    if (validTargets.length === 0) return;

    const sourceFields = manualFieldsByNm[sourceNmId] ?? EMPTY_MANUAL_FIELDS;
    const sourceCost = toNumber(sourceFields.costPrice);
    const rowsToSave = new Map<number, ManualFields>([[sourceNmId, sourceFields]]);

    for (const targetNmId of validTargets) {
      const targetFields = manualFieldsByNm[targetNmId] ?? EMPTY_MANUAL_FIELDS;
      rowsToSave.set(targetNmId, copyCostFieldsToManualFields(sourceFields, targetFields));
    }

    setIsApplyingVariants(true);
    setSaveMessage(null);
    try {
      for (const [nmId, manualFields] of rowsToSave.entries()) {
        saveManualFields(tenantId, nmId, manualFields);
      }

      setManualFieldsByNm((prev) => {
        const next = { ...prev };
        for (const [nmId, manualFields] of rowsToSave.entries()) {
          next[nmId] = manualFields;
        }
        return next;
      });

      const { saveUnitEconomicsManualFieldsBulk } = await import('@/app/(dashboard)/economics/actions');
      const { bulkUpsertCosts } = await import('@/app/(dashboard)/settings/bulk-actions');

      await saveUnitEconomicsManualFieldsBulk(
        tenantId,
        Array.from(rowsToSave.entries()).map(([nmId, manualFields]) => ({ nmId, manualFields })),
      );

      if (sourceCost > 0) {
        await bulkUpsertCosts(
          tenantId,
          Array.from(rowsToSave.keys()).map((nmId) => ({ nmId, costPrice: sourceCost })),
        );
      }

      const savedNmIds = new Set(rowsToSave.keys());
      setDirtyNmIds((prev) => prev.filter((nmId) => !savedNmIds.has(nmId)));
      setSaveMessage(`Себестоимость скопирована: ${validTargets.length} SKU`);
      setTimeout(() => setSaveMessage(null), 5000);
      setVariantSourceRow(null);
      void refetch();
    } catch (err) {
      console.error('[CostingPageClient] apply cost to variants error', err);
      window.alert('Не удалось проставить себестоимость в выбранные SKU. Повторите попытку.');
    } finally {
      setIsApplyingVariants(false);
    }
  };

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => COSTING_ROW_ESTIMATE_PX,
    overscan: COSTING_OVERSCAN_ROWS,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const firstVirtualRow = virtualRows[0] ?? null;
  const lastVirtualRow = virtualRows[virtualRows.length - 1] ?? null;
  const topPadding = firstVirtualRow ? firstVirtualRow.start : 0;
  const bottomPadding = lastVirtualRow
    ? Math.max(0, rowVirtualizer.getTotalSize() - lastVirtualRow.end)
    : 0;

  if (isLoading) {
    return (
      <div className="flex h-[55vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse font-medium text-muted-foreground">Загружаем себестоимость…</p>
      </div>
    );
  }

  if (error) {
    return (
      <OperatorState
        icon={Boxes}
        tone="danger"
        title="Не удалось загрузить себестоимость"
        description={error.message}
        actionLabel="Повторить запрос"
        action={refetch}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-10">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-muted-foreground">
          <span className="rounded-xl border border-border bg-card px-3 py-2">
            Заполнено: {completeCount} из {rows.length}
          </span>
          <span className="rounded-xl border border-border bg-card px-3 py-2">
            Показано: {filteredRows.length}
          </span>
          <span className="rounded-xl border border-border bg-card px-3 py-2">
            Рабочий список: {worklistNmIds.length}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[280px] flex-1 text-muted-foreground">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Поиск: артикул WB, артикул продавца, категория"
            className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-base font-semibold text-foreground placeholder:text-muted-foreground/60 outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </label>
        <select
          value={filterMode}
          onChange={(event) => setFilterMode(event.target.value as CostFilterMode)}
          className="h-10 rounded-xl border border-border bg-card px-3 text-base font-semibold text-foreground outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
        >
          <option value="all">Все SKU</option>
          <option value="missing">Без себестоимости</option>
          <option value="complete">Заполненные</option>
        </select>
        <button
          type="button"
          onClick={addFilteredToWorklist}
          disabled={filteredRows.length === 0}
          title="Добавить текущую выдачу в рабочий список себестоимости"
          className="h-10 rounded-xl border border-border bg-card px-3 text-base font-semibold text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          В рабочий список
        </button>
        <button
          type="button"
          onClick={toggleFilteredSelection}
          disabled={filteredRows.length === 0 || isBulkHiding}
          title="Выбрать все SKU в текущей выдаче для массового скрытия"
          className="h-10 rounded-xl border border-border bg-card px-3 text-base font-semibold text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {allFilteredSelected ? 'Снять выбор' : 'Выбрать все'}
        </button>
        <button
          type="button"
          onClick={() => setShowHiddenPanel((value) => !value)}
          className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-base font-semibold transition-colors ${
            showHiddenPanel
              ? 'border-amber-500/40 bg-amber-50 text-amber-700'
              : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
          }`}
        >
          <EyeOff className="h-4 w-4" />
          Скрытые
        </button>
        <button
          type="button"
          onClick={() => setShowWorklistOnly((value) => !value)}
          disabled={worklistNmIds.length === 0}
          className={`h-10 rounded-xl border px-3 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            showWorklistOnly
              ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700'
              : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
          }`}
        >
          {showWorklistOnly ? 'Показать все' : 'Только рабочий список'}
        </button>
        <button
          type="button"
          onClick={() => setWorklistNmIds([])}
          disabled={worklistNmIds.length === 0}
          title="Очистить только локальный рабочий список. Себестоимость не удаляется."
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-base font-semibold text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-4 w-4" />
          Очистить рабочий список
        </button>
        <input
          ref={costingImportInputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => void importCostingExcel(event)}
        />
        <button
          type="button"
          onClick={() => void downloadCostingExcel('template')}
          disabled={costingExcelRows.length === 0 || isCostingExcelExporting}
          title="Скачать шаблон Excel для заполнения себестоимости"
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-base font-semibold text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCostingExcelExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Шаблон Excel
        </button>
        <button
          type="button"
          onClick={() => void downloadCostingExcel('filled')}
          disabled={costingExcelRows.length === 0 || isCostingExcelExporting}
          title="Скачать текущую заполненную себестоимость в Excel"
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-base font-semibold text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileSpreadsheet className="h-4 w-4" />
          Скачать Excel
        </button>
        <button
          type="button"
          onClick={() => costingImportInputRef.current?.click()}
          disabled={costingExcelRows.length === 0 || isCostingExcelImporting}
          title="Загрузить заполненный Excel-шаблон в таблицу себестоимости"
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-50 px-3 text-base font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isCostingExcelImporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Загрузить Excel
        </button>
        <button
          type="button"
          onClick={() => void saveChanges()}
          disabled={saveableRows.length === 0 || isSaving}
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-600 px-4 text-base font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {isSaving ? 'Сохраняю...' : `Сохранить всё (${saveableRows.length})`}
        </button>
      </div>

      {selectedNmIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">
          <span>Выбрано SKU: {selectedNmIds.length}</span>
          <button
            type="button"
            onClick={selectAllFilteredRows}
            disabled={isBulkHiding || filteredRows.length === 0 || allFilteredSelected}
            title="Добавить к выбору все SKU из текущей выдачи"
            className="h-9 rounded-lg border border-rose-300 bg-card px-3 text-sm font-bold text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Выбрать все
          </button>
          <button
            type="button"
            onClick={() => void hideSelectedRows()}
            disabled={isBulkHiding}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-rose-600 px-3 text-sm font-bold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
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

      {saveMessage ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">
          <Check className="h-4 w-4" />
          {saveMessage}
        </div>
      ) : null}

      {showHiddenPanel ? (
        <HiddenProductsPanel
          tenantId={tenantId}
          restoringNmId={restoringNmId}
          onRestore={restoreRow}
          onRestoreMany={restoreRows}
          onClose={() => setShowHiddenPanel(false)}
        />
      ) : null}

      <div ref={tableScrollRef} className="max-h-[calc(100vh-250px)] overflow-auto rounded-xl border border-border shadow-sm">
        <table className="w-full min-w-[1420px] border-separate border-spacing-0 text-left text-sm text-foreground">
          <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 text-center font-semibold" title="Галочка выбирает SKU для массового скрытия; кнопка с глазом скрывает одну строку.">
                <label className="flex flex-col items-center gap-1">
                  <span>Скрыть</span>
                  <input
                    ref={selectAllCheckboxRef}
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleFilteredSelection}
                    disabled={filteredRows.length === 0 || isBulkHiding}
                    className="h-4 w-4 rounded border-slate-400 text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Выбрать все SKU в текущей выдаче"
                  />
                </label>
              </th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 text-center font-semibold" title="Галочка добавляет SKU в локальный рабочий список себестоимости.">Раб. список</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 text-center font-semibold">Фото</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 font-semibold">Артикул WB</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 font-semibold">Артикул продавца</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 font-semibold">Категория</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 text-right font-semibold">Товар закупка</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 text-right font-semibold">Доставка до ФФ</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 text-right font-semibold">Упаковка</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 text-right font-semibold">Фулфилмент</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 text-center font-semibold">Склады ВБ</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 text-right font-semibold">Доставка до ВБ</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 text-right font-semibold">Себес полный<br />с отгрузкой</th>
              <th className="sticky top-0 z-20 border-b border-r border-slate-300 bg-muted px-2 py-2 text-center font-semibold">Склейка</th>
            </tr>
          </thead>
          <tbody>
            {topPadding > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={14} style={{ height: topPadding, padding: 0, border: 0 }} />
              </tr>
            ) : null}
            {virtualRows.map((virtualRow) => {
              const row = filteredRows[virtualRow.index];
              if (!row) return null;
              const nmId = toNumber(row.nmId);
              const manualFields = manualFieldsByNm[nmId] ?? EMPTY_MANUAL_FIELDS;
              const purchaseCost = resolvePurchaseCost(row, manualFields);
              const total = computeCostTotal(row, manualFields);
              const deliveryToWb = computeDeliveryToWb(manualFields);
              const isDirty = dirtySet.has(nmId);
              const inWorklist = worklistSet.has(nmId);
              const isExpanded = expandedWarehouseNmId === nmId;
              const variantsCount = variantCountsByNm.get(nmId) ?? 0;
              const rowSummary = buildRowSummary(row, manualFields, {
                normalizedTariffMap,
                normalizedReturnTariffMap,
                globalWbDiscount: '',
                defaultTaxPercent: null,
              });
              const autoLocalityIndex = rowSummary.localizationPercent != null
                ? resolveLocalityIndexMultiplierFromLocalization(rowSummary.localizationPercent)
                : 1;
              return (
                <Fragment key={nmId}>
                  <tr
                    ref={rowVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className={isDirty ? 'bg-amber-500/10' : 'bg-card hover:bg-muted/40'}
                  >
                    <td className="border-b border-r border-slate-300 px-2 py-2">
                      <div className="flex items-center justify-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(nmId)}
                          onChange={() => toggleSelected(nmId)}
                          disabled={isBulkHiding}
                          className="h-4 w-4 rounded border-slate-400 text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label={`Выбрать SKU ${nmId}`}
                        />
                        <button
                          type="button"
                          onClick={() => void hideRow(nmId)}
                          disabled={hidingNmId === nmId}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-600 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          title={hidingNmId === nmId ? 'Скрываем SKU...' : 'Скрыть SKU'}
                        >
                          {hidingNmId === nmId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </td>
                    <td className="border-b border-r border-slate-300 px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={inWorklist}
                        onChange={() => toggleWorklist(nmId)}
                        className="h-4 w-4 rounded border-slate-400 text-emerald-600"
                        aria-label={`Добавить SKU ${nmId} в рабочий список`}
                      />
                    </td>
                    <td className="border-b border-r border-slate-300 px-2 py-2 text-center">
                      {row.photoUrl ? (
                        <div className="mx-auto h-10 w-10 overflow-hidden rounded-lg border border-border bg-muted">
                          <Image
                            src={row.photoUrl}
                            alt=""
                            width={40}
                            height={40}
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : (
                        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-[10px] font-bold text-muted-foreground/60">
                          IMG
                        </div>
                      )}
                    </td>
                    <td className="border-b border-r border-slate-300 px-2 py-2 font-bold tabular-nums">{nmId}</td>
                    <td className="max-w-[280px] truncate border-b border-r border-slate-300 px-2 py-2 font-semibold">
                      {row.vendorCode || '—'}
                    </td>
                    <td className="max-w-[180px] truncate border-b border-r border-slate-300 px-2 py-2 text-muted-foreground">
                      {row.category || '—'}
                    </td>
                    <CostInput
                      value={manualFields.costPrice}
                      placeholder={purchaseCost > 0 ? String(purchaseCost) : '0'}
                      onChange={(value) => patchManualFields(nmId, { costPrice: value })}
                    />
                    <CostInput
                      value={manualFields.deliveryToFf}
                      placeholder="0"
                      onChange={(value) => patchManualFields(nmId, { deliveryToFf: value })}
                    />
                    <CostInput
                      value={manualFields.packagingMaterial}
                      placeholder="0"
                      onChange={(value) => patchManualFields(nmId, { packagingMaterial: value })}
                    />
                    <CostInput
                      value={manualFields.fulfillment}
                      placeholder="0"
                      onChange={(value) => patchManualFields(nmId, { fulfillment: value })}
                    />
                    <td className="border-b border-r border-slate-300 px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setExpandedWarehouseNmId((current) => (current === nmId ? null : nmId))}
                        className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition-colors ${
                          isExpanded
                            ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700'
                            : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                        }`}
                      >
                        <Warehouse className="h-4 w-4" />
                        {manualFields.selectedWarehouses.length || 'Склады'}
                      </button>
                    </td>
                    <td className="border-b border-r border-slate-300 px-2 py-2 text-right font-bold tabular-nums">
                      {deliveryToWb > 0 ? formatCurrency(deliveryToWb, 2) : '—'}
                    </td>
                    <td className="border-b border-r border-slate-300 px-2 py-2 text-right font-black tabular-nums">
                      {total > 0 ? formatCurrency(total, 2) : '—'}
                    </td>
                    <td className="border-b border-r border-slate-300 px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setVariantSourceRow(row)}
                        disabled={variantsCount === 0 || isApplyingVariants}
                        title={variantsCount > 0
                          ? 'Скопировать себестоимость в выбранные SKU той же модели'
                          : 'В текущем списке нет других SKU той же модели'}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted/40 disabled:text-muted-foreground/60"
                      >
                        <Palette className="h-4 w-4" />
                        {variantsCount}
                      </button>
                    </td>
                  </tr>

                  {isExpanded ? (
                    <tr className="bg-emerald-500/8">
                      <td colSpan={14} className="border-b border-border p-0">
                        <div className="sticky left-0 max-w-[min(1280px,calc(100vw-120px))] px-3 py-3">
                          <WarehousesPanel
                            manualFields={manualFields}
                            onUpdate={(next) => updateManualFields(nmId, next)}
                            warehouseRates={computeWarehouseRates(
                              resolveVolumeLiters(row),
                              manualFields,
                              normalizedTariffMap,
                              normalizedReturnTariffMap,
                            )}
                            volumeLiters={resolveVolumeLiters(row)}
                            tradeScheme={manualFields.tradeScheme}
                            irpPercent={rowSummary.irpPercent}
                            irpDisplayPercent={rowSummary.irpDisplayPercent}
                            irpSurcharge={rowSummary.irpSurcharge}
                            localizationPercent={rowSummary.localizationPercent}
                            localityIndexSource={rowSummary.localityIndexSource}
                            autoLocalityIndex={autoLocalityIndex}
                            acceptanceTariffsDate={data?.acceptanceTariffsDate ?? data?.boxTariffsDate ?? null}
                            returnTariffsDate={data?.returnTariffsDate ?? null}
                            wbWarehouseNames={data?.wbWarehouseNames ?? []}
                            suggestedStockWarehouses={row.wbStockWarehouses ?? []}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}

            {bottomPadding > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={14} style={{ height: bottomPadding, padding: 0, border: 0 }} />
              </tr>
            ) : null}

            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={14} className="py-12 text-center text-base font-semibold text-muted-foreground/60">
                  Нет SKU по заданному фильтру
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {variantSourceRow ? (
        <VariantPickerModal
          sourceRow={variantSourceRow}
          rows={rows}
          isApplying={isApplyingVariants}
          description="Отметьте SKU той же модели, в которые скопировать поля себестоимости: закупку, доставку до ФФ, упаковку, фулфилмент и доставку до ВБ."
          onClose={() => {
            if (!isApplyingVariants) setVariantSourceRow(null);
          }}
          onApply={applyCostToVariants}
        />
      ) : null}
    </div>
  );
}

function CostInput({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <td className="border-b border-r border-slate-300 px-2 py-2 text-right">
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(normalizeDecimalInput(event.target.value))}
        className="h-9 w-24 rounded-lg border border-amber-500/50 bg-amber-500/15 px-2 text-right font-mono text-xs font-semibold text-foreground outline-none transition-all placeholder:text-amber-700/70 focus:border-amber-500 focus:bg-amber-500/20 focus:ring-4 focus:ring-amber-400/30"
      />
    </td>
  );
}
