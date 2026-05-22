'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  Boxes,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  Loader2,
  PackageMinus,
  PackagePlus,
  Search,
  Truck,
  Upload,
  X,
} from 'lucide-react';
import {
  formatCurrency,
  formatNumber,
  toNumber,
} from '@/components/economics/helpers';
import { readManualFields } from '@/components/economics/manual-fields-io';
import {
  adjustBatchInventory,
  backfillOwnStockCostsFromEconomics,
  consumeOwnStock,
  createManualReceipts,
  listOwnStock,
  listOwnStockMovements,
  listSkusForBatchForm,
  type OwnStockCostBackfillInput,
  shipOwnStockToWb,
  type ManualReceiptLineInput,
  type OwnStockShipmentLineInput,
  type StockLocation,
  undoOwnStockReceipt,
} from '../actions';
import {
  exportManualReceiptTemplateXlsx,
  exportSelectedWbShipmentXlsx,
  parseManualReceiptXlsx,
  type ParsedManualReceiptLine,
  type WbShipmentExportRow,
} from './ownStockExcel';

type OwnStockItem = Awaited<ReturnType<typeof listOwnStock>>[number];
type Movement = Awaited<ReturnType<typeof listOwnStockMovements>>[number];
type SkuOption = Awaited<ReturnType<typeof listSkusForBatchForm>>[number];
type ReceiptDraftLine = {
  tempId: string;
  nmId: number;
  quantity: string;
  purchaseCostPerUnit: string;
  fulfillmentDeliveryPerUnit: string;
  notes: string;
};
type ShipmentDraftLine = {
  tempId: string;
  nmId: number;
  quantity: string;
  unitsPerBox: string;
  notes: string;
};

const WAREHOUSE_COPY: Record<StockLocation, {
  title: string;
  locationLabel: string;
  receiptTitle: string;
  shipmentTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  hint: ReactNode;
  pickerEmpty: string;
}> = {
  own: {
    title: 'Свой склад',
    locationLabel: 'своего склада',
    receiptTitle: 'Ручной приход на свой склад',
    shipmentTitle: 'Отгрузка на WB со своего склада',
    emptyTitle: 'Свой склад пуст',
    emptyDescription: 'Когда придёт партия из Китая или сделаешь ручной приход — она появится здесь.',
    hint: (
      <>
        Партии прибывают сюда автоматически когда ты отмечаешь батч в{' '}
        <Link href="/stocks-v2/batches" prefetch={false} className="font-semibold text-emerald-600 hover:underline dark:text-emerald-400">
          /stocks-v2/batches
        </Link>{' '}
        как «Принято». Списания идут <b>FIFO</b> — сначала уходят самые старые партии.
      </>
    ),
    pickerEmpty: 'На своем складе нет доступных SKU',
  },
  china: {
    title: 'Склад Китай',
    locationLabel: 'склада Китай',
    receiptTitle: 'Ручной приход на склад Китай',
    shipmentTitle: 'Отгрузка на WB со склада Китай',
    emptyTitle: 'Склад Китай пуст',
    emptyDescription: 'Добавь готовый товар в Китае вручную — он попадёт в общий запас и прогноз закупки.',
    hint: (
      <>
        Здесь учитывается готовый товар в Китае до передачи в доставку или на WB. Списания идут <b>FIFO</b>,
        как на своём складе.
      </>
    ),
    pickerEmpty: 'На складе Китай нет доступных SKU',
  },
};

const BOX_PRESETS = [
  { id: '60x40x40', label: '60x40x40 см', length: 60, width: 40, height: 40 },
] as const;

type BoxPresetId = typeof BOX_PRESETS[number]['id'];
type BoxMode = BoxPresetId | 'custom';

const REASON_LABEL: Record<string, { label: string; tone: 'in' | 'out' | 'adjust' }> = {
  receipt: { label: 'Поступление', tone: 'in' },
  shipped_to_wb: { label: 'На WB', tone: 'out' },
  fbs_sale: { label: 'FBS продажа', tone: 'out' },
  write_off: { label: 'Списание', tone: 'out' },
};

function parsePositiveInt(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const rounded = Math.round(parsed);
  return rounded > 0 && Math.abs(parsed - rounded) < 0.000001 ? rounded : null;
}

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 10) / 10 : null;
}

function formatBoxDimension(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getBoxLabel(boxMode: BoxMode, customBox: { length: string; width: string; height: string }): string | null {
  const preset = BOX_PRESETS.find((box) => box.id === boxMode);
  if (preset) return preset.label;

  const length = parsePositiveNumber(customBox.length);
  const width = parsePositiveNumber(customBox.width);
  const height = parsePositiveNumber(customBox.height);
  if (length === null || width === null || height === null) return null;
  return `${formatBoxDimension(length)}x${formatBoxDimension(width)}x${formatBoxDimension(height)} см`;
}

function ConsumeForm({
  tenantId,
  item,
  stockLocation,
  onClose,
}: {
  tenantId: string;
  item: OwnStockItem;
  stockLocation: StockLocation;
  onClose: (refresh: boolean) => void;
}) {
  const [reason, setReason] = useState<'shipped_to_wb' | 'fbs_sale' | 'write_off'>('shipped_to_wb');
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = () => {
    setError(null);
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Укажите количество > 0');
      return;
    }
    if (qty > item.totalRemaining) {
      setError(`На складе только ${item.totalRemaining} шт`);
      return;
    }
    startTransition(async () => {
      try {
        await consumeOwnStock(tenantId, {
          nmId: item.nmId,
          quantity: qty,
          reason,
          stockLocation,
          notes: notes || null,
        });
        onClose(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось списать');
      }
    });
  };

  return (
    <div className="mt-2 rounded-xl border-2 border-rose-500/40 bg-rose-500/5 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-foreground">
          Списать с {item.sku?.vendorCode ?? `nm ${item.nmId}`}
        </span>
        <button
          type="button"
          onClick={() => onClose(false)}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Куда / зачем
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as 'shipped_to_wb' | 'fbs_sale' | 'write_off')}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
          >
            <option value="shipped_to_wb">📤 Отгрузить на WB</option>
            <option value="fbs_sale">🛍 Продажа FBS</option>
            <option value="write_off">💸 Списать (брак / подарок)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Количество (max {item.totalRemaining})
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0"
            className="rounded-md border border-border bg-card px-2 py-1.5 text-right text-sm tabular-nums focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Заметки (необязательно)
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </label>
      </div>
      {error ? <div className="mt-2 text-xs text-rose-700 dark:text-rose-300">{error}</div> : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onClose(false)}
          disabled={isPending}
          className="rounded-md border border-border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md bg-rose-500 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageMinus className="h-3.5 w-3.5" />}
          Списать
        </button>
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">
        FIFO: сначала уходят самые старые партии. Распределение по партиям записывается в журнал.
      </div>
    </div>
  );
}

function ManualReceiptForm({
  tenantId,
  stockLocation,
  title,
  onCreated,
  onCancel,
}: {
  tenantId: string;
  stockLocation: StockLocation;
  title: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [isLoadingSkus, setIsLoadingSkus] = useState(true);
  const [skuQuery, setSkuQuery] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [draftSelectedNmIds, setDraftSelectedNmIds] = useState<Set<number>>(new Set());
  const [lines, setLines] = useState<ReceiptDraftLine[]>([]);
  const [isExportingTemplate, setIsExportingTemplate] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showValidationErrors, setShowValidationErrors] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    listSkusForBatchForm(tenantId)
      .then((res) => {
        setSkus(res);
        setIsLoadingSkus(false);
      })
      .catch((err) => {
        setError(`Не удалось загрузить SKU: ${err.message}`);
        setIsLoadingSkus(false);
      });
  }, [tenantId]);

  const skuByNm = useMemo(() => new Map(skus.map((s) => [Number(s.nmId), s])), [skus]);
  const selectedNmIds = useMemo(() => new Set(lines.map((line) => line.nmId)), [lines]);
  const filteredSkus = useMemo(() => {
    const query = skuQuery.trim().toLowerCase();
    const source = query
      ? skus.filter((s) => `${s.vendorCode ?? ''} ${s.brand ?? ''} ${s.nmId}`.toLowerCase().includes(query))
      : skus;
    return source.slice(0, 80);
  }, [skuQuery, skus]);

  const totalQty = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const totalCost = lines.reduce((sum, line) => {
    const qty = Number(line.quantity) || 0;
    const purchase = Number(line.purchaseCostPerUnit) || 0;
    const delivery = Number(line.fulfillmentDeliveryPerUnit) || 0;
    return sum + qty * (purchase + delivery);
  }, 0);

  const toOptionalMoney = (value: string): number | null => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const updateLine = (tempId: string, patch: Partial<ReceiptDraftLine>) => {
    setLines((prev) => prev.map((line) => (line.tempId === tempId ? { ...line, ...patch } : line)));
  };

  const removeLine = (tempId: string) => {
    setLines((prev) => prev.filter((line) => line.tempId !== tempId));
  };

  const openPicker = () => {
    setDraftSelectedNmIds(new Set(selectedNmIds));
    setIsPickerOpen(true);
  };

  const toggleDraftSku = (nmId: number) => {
    setDraftSelectedNmIds((prev) => {
      const next = new Set(prev);
      if (next.has(nmId)) next.delete(nmId);
      else next.add(nmId);
      return next;
    });
  };

  const applySkuSelection = () => {
    const previousByNm = new Map(lines.map((line) => [line.nmId, line]));
    const orderedNmIds = skus
      .map((sku) => Number(sku.nmId))
      .filter((nmId) => draftSelectedNmIds.has(nmId));

    setLines(orderedNmIds.map((nmId) => {
      const existing = previousByNm.get(nmId);
      if (existing) return existing;

      const sku = skuByNm.get(nmId);
      const localFields = readManualFields(tenantId, nmId);
      const localPurchase = toNumber(localFields.costPrice);
      const localDelivery = toNumber(localFields.deliveryToFf);

      return {
        tempId: crypto.randomUUID(),
        nmId,
        quantity: '',
        purchaseCostPerUnit: sku?.purchaseCostPerUnit != null
          ? String(sku.purchaseCostPerUnit)
          : localPurchase > 0
            ? String(localPurchase)
            : '',
        fulfillmentDeliveryPerUnit: sku?.fulfillmentDeliveryPerUnit != null
          ? String(sku.fulfillmentDeliveryPerUnit)
          : localDelivery > 0
            ? String(localDelivery)
            : '',
        notes: '',
      };
    }));
    setSkuQuery('');
    setIsPickerOpen(false);
  };

  const mergeImportedLines = (parsed: ParsedManualReceiptLine[]) => {
    setLines((prev) => {
      const previousByNm = new Map(prev.map((line) => [line.nmId, line]));
      for (const line of parsed) {
        previousByNm.set(line.nmId, {
          tempId: previousByNm.get(line.nmId)?.tempId ?? crypto.randomUUID(),
          nmId: line.nmId,
          quantity: String(line.quantity),
          purchaseCostPerUnit: line.purchaseCostPerUnit != null ? String(line.purchaseCostPerUnit) : '',
          fulfillmentDeliveryPerUnit: line.fulfillmentDeliveryPerUnit != null ? String(line.fulfillmentDeliveryPerUnit) : '',
          notes: line.notes ?? '',
        });
      }
      const ordered = skus
        .map((sku) => Number(sku.nmId))
        .filter((nmId) => previousByNm.has(nmId));
      return ordered.map((nmId) => previousByNm.get(nmId)!);
    });
  };

  const onDownloadTemplate = async () => {
    setError(null);
    setIsExportingTemplate(true);
    try {
      await exportManualReceiptTemplateXlsx(skus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось скачать шаблон');
    } finally {
      setIsExportingTemplate(false);
    }
  };

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setIsImporting(true);
    try {
      const parsed = await parseManualReceiptXlsx(file, skus);
      if (parsed.length === 0) {
        setError('В файле нет строк с количеством > 0.');
        return;
      }
      mergeImportedLines(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось прочитать Excel');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onSubmit = () => {
    setError(null);
    setShowValidationErrors(false);
    if (lines.length === 0) {
      setError('Выберите один или несколько SKU');
      return;
    }
    const invalidLine = lines.find((line) => !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0);
    if (invalidLine) {
      const sku = skuByNm.get(invalidLine.nmId);
      setError(`Укажите количество > 0 для ${sku?.vendorCode ?? `nm ${invalidLine.nmId}`}`);
      return;
    }
    const withoutPurchase = lines.find((line) => {
      const purchase = toOptionalMoney(line.purchaseCostPerUnit);
      return purchase === null || purchase <= 0;
    });
    if (withoutPurchase) {
      const sku = skuByNm.get(withoutPurchase.nmId);
      setShowValidationErrors(true);
      setError(`Укажите закупку для ${sku?.vendorCode ?? `nm ${withoutPurchase.nmId}`}`);
      return;
    }

    const payloadLines: ManualReceiptLineInput[] = lines.map((line) => ({
      nmId: line.nmId,
      quantity: Number(line.quantity),
      purchaseCostPerUnit: toOptionalMoney(line.purchaseCostPerUnit),
      fulfillmentDeliveryPerUnit: toOptionalMoney(line.fulfillmentDeliveryPerUnit),
      notes: line.notes || null,
    }));

    startTransition(async () => {
      try {
        await createManualReceipts(tenantId, { lines: payloadLines, stockLocation });
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось добавить приход');
      }
    });
  };

  return (
    <div className="space-y-3 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-foreground">{title}</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDownloadTemplate}
            disabled={isLoadingSkus || isExportingTemplate}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExportingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Шаблон Excel
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoadingSkus || isImporting}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Загрузить Excel
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(event) => void onImportFile(event.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={openPicker}
          disabled={isLoadingSkus}
          className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-sm text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>
            {isLoadingSkus
              ? 'Загружаем SKU…'
              : lines.length > 0
                ? `Выбрано SKU: ${lines.length}`
                : 'Найти и выбрать SKU'}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>

        {isPickerOpen ? (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-border bg-card shadow-xl">
            <div className="border-b border-border p-2">
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={skuQuery}
                  autoFocus
                  onChange={(e) => setSkuQuery(e.target.value)}
                  placeholder="SKU, артикул продавца или бренд"
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
              {filteredSkus.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">SKU не найдены</div>
              ) : (
                filteredSkus.map((sku) => {
                  const nmId = Number(sku.nmId);
                  const checked = draftSelectedNmIds.has(nmId);
                  return (
                    <label
                      key={sku.nmId}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDraftSku(nmId)}
                        className="h-4 w-4 rounded border-border text-emerald-600 focus:ring-emerald-500"
                      />
                      <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded border border-border bg-muted">
                        {sku.photoUrl ? (
                          <Image
                            src={sku.photoUrl}
                            alt=""
                            width={36}
                            height={36}
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {sku.vendorCode ?? `nm ${sku.nmId}`}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {sku.brand ?? '—'} · nm {sku.nmId}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Выбрано: {draftSelectedNmIds.size}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPickerOpen(false)}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={applySkuSelection}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
                >
                  <Check className="h-3.5 w-3.5" />
                  ОК
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {lines.length > 0 ? (
        <div className="space-y-2">
          <div className="hidden grid-cols-[minmax(220px,1fr)_90px_130px_160px_minmax(160px,1fr)_32px] gap-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
            <div>SKU</div>
            <div className="text-right">Кол-во</div>
            <div className="text-right">Закупка</div>
            <div className="text-right">Доставка до ФФ</div>
            <div>Заметки</div>
            <div />
          </div>
          {lines.map((line) => {
            const sku = skuByNm.get(line.nmId);
            const purchase = toOptionalMoney(line.purchaseCostPerUnit);
            const hasPurchaseError = showValidationErrors && (purchase === null || purchase <= 0);
            return (
              <div
                key={line.tempId}
                className="grid gap-2 rounded-lg border border-border bg-card p-2 lg:grid-cols-[minmax(220px,1fr)_90px_130px_160px_minmax(160px,1fr)_32px] lg:items-center"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded border border-border bg-muted">
                    {sku?.photoUrl ? (
                      <Image
                        src={sku.photoUrl}
                        alt=""
                        width={40}
                        height={40}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {sku?.vendorCode ?? `nm ${line.nmId}`}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {sku?.brand ?? '—'} · nm {line.nmId}
                    </div>
                  </div>
                </div>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.tempId, { quantity: e.target.value })}
                  placeholder="шт"
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-right text-sm tabular-nums focus:border-emerald-500 focus:outline-none"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.purchaseCostPerUnit}
                  onChange={(e) => updateLine(line.tempId, { purchaseCostPerUnit: e.target.value })}
                  placeholder="₽/шт"
                  className={`rounded-md border px-2 py-1.5 text-right text-sm tabular-nums focus:outline-none ${
                    hasPurchaseError
                      ? 'border-rose-500 bg-rose-50 text-rose-900 focus:border-rose-500 dark:bg-rose-950/30 dark:text-rose-100'
                      : 'border-border bg-card focus:border-emerald-500'
                  }`}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.fulfillmentDeliveryPerUnit}
                  onChange={(e) => updateLine(line.tempId, { fulfillmentDeliveryPerUnit: e.target.value })}
                  placeholder="₽/шт"
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-right text-sm tabular-nums focus:border-emerald-500 focus:outline-none"
                />
                <input
                  type="text"
                  value={line.notes}
                  onChange={(e) => updateLine(line.tempId, { notes: e.target.value })}
                  placeholder="Заметки"
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeLine(line.tempId)}
                  className="justify-self-end rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-rose-500"
                  title="Убрать SKU"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
            Итого: <span className="font-bold tabular-nums">{formatNumber(totalQty, 0)} шт</span>
            {' · '}
            <span className="font-bold tabular-nums">{formatCurrency(totalCost, 0)}</span>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Выберите SKU вручную или загрузите заполненный Excel.
        </div>
      )}

      {error ? <div className="text-xs text-rose-700 dark:text-rose-300">{error}</div> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
          Добавить
        </button>
      </div>
    </div>
  );
}

function ShipmentToWbForm({
  tenantId,
  items,
  stockLocation,
  title,
  pickerEmpty,
  onCreated,
  onCancel,
}: {
  tenantId: string;
  items: OwnStockItem[];
  stockLocation: StockLocation;
  title: string;
  pickerEmpty: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [skuQuery, setSkuQuery] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [boxMode, setBoxMode] = useState<BoxMode>('60x40x40');
  const [customBox, setCustomBox] = useState({ length: '', width: '', height: '' });
  const [draftSelectedNmIds, setDraftSelectedNmIds] = useState<Set<number>>(new Set());
  const [lines, setLines] = useState<ShipmentDraftLine[]>([]);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showPackingErrors, setShowPackingErrors] = useState(false);

  const availableItems = useMemo(
    () => items.filter((item) => item.totalRemaining > 0),
    [items],
  );
  const itemByNm = useMemo(
    () => new Map(availableItems.map((item) => [item.nmId, item])),
    [availableItems],
  );
  const selectedNmIds = useMemo(() => new Set(lines.map((line) => line.nmId)), [lines]);
  const filteredItems = useMemo(() => {
    const query = skuQuery.trim().toLowerCase();
    const source = query
      ? availableItems.filter((item) => {
          const haystack = `${item.sku?.vendorCode ?? ''} ${item.sku?.brand ?? ''} ${item.nmId}`.toLowerCase();
          return haystack.includes(query);
        })
      : availableItems;
    return source.slice(0, 80);
  }, [availableItems, skuQuery]);

  const totalQty = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const totalBoxes = lines.reduce((sum, line) => {
    const quantity = parsePositiveInt(line.quantity);
    const unitsPerBox = parsePositiveInt(line.unitsPerBox);
    return quantity !== null && unitsPerBox !== null ? sum + Math.ceil(quantity / unitsPerBox) : sum;
  }, 0);
  const incompleteBoxLines = lines.some((line) => {
    const quantity = parsePositiveInt(line.quantity);
    const unitsPerBox = parsePositiveInt(line.unitsPerBox);
    return quantity !== null && unitsPerBox === null;
  });
  const selectedBoxLabel = getBoxLabel(boxMode, customBox);

  const updateLine = (tempId: string, patch: Partial<ShipmentDraftLine>) => {
    setLines((prev) => prev.map((line) => (line.tempId === tempId ? { ...line, ...patch } : line)));
  };

  const removeLine = (tempId: string) => {
    setLines((prev) => prev.filter((line) => line.tempId !== tempId));
  };

  const openPicker = () => {
    setDraftSelectedNmIds(new Set(selectedNmIds));
    setIsPickerOpen(true);
  };

  const toggleDraftSku = (nmId: number) => {
    setDraftSelectedNmIds((prev) => {
      const next = new Set(prev);
      if (next.has(nmId)) next.delete(nmId);
      else next.add(nmId);
      return next;
    });
  };

  const applySkuSelection = () => {
    const previousByNm = new Map(lines.map((line) => [line.nmId, line]));
    const orderedNmIds = availableItems
      .map((item) => item.nmId)
      .filter((nmId) => draftSelectedNmIds.has(nmId));

    setLines(orderedNmIds.map((nmId) => previousByNm.get(nmId) ?? {
      tempId: crypto.randomUUID(),
      nmId,
      quantity: '',
      unitsPerBox: '',
      notes: '',
    }));
    setSkuQuery('');
    setIsPickerOpen(false);
  };

  const buildExportRows = (): WbShipmentExportRow[] => lines.map((line) => {
    const item = itemByNm.get(line.nmId);
    const quantity = Number(line.quantity);
    const unitsPerBox = parsePositiveInt(line.unitsPerBox);
    const boxCount = Number.isFinite(quantity) && quantity > 0 && unitsPerBox !== null
      ? Math.ceil(quantity / unitsPerBox)
      : null;
    return {
      nmId: line.nmId,
      vendorCode: item?.sku?.vendorCode ?? null,
      brand: item?.sku?.brand ?? null,
      photoUrl: item?.sku?.photoUrl ?? null,
      availableQty: item?.totalRemaining ?? 0,
      shipQty: quantity,
      boxLabel: selectedBoxLabel,
      unitsPerBox,
      boxCount,
      notes: line.notes || null,
    };
  });

  const onSubmit = () => {
    setError(null);
    setShowPackingErrors(false);
    if (lines.length === 0) {
      setError('Выберите один или несколько SKU');
      return;
    }
    if (!selectedBoxLabel) {
      setError('Укажите размер своего короба');
      return;
    }

    for (const line of lines) {
      const item = itemByNm.get(line.nmId);
      const qty = Number(line.quantity);
      const unitsPerBox = parsePositiveInt(line.unitsPerBox);
      if (!item) {
        setError(`SKU nm ${line.nmId} уже не найден на складе`);
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        setError(`Укажите количество > 0 для ${item.sku?.vendorCode ?? `nm ${line.nmId}`}`);
        return;
      }
      if (qty > item.totalRemaining) {
        setError(`По ${item.sku?.vendorCode ?? `nm ${line.nmId}`} доступно только ${item.totalRemaining} шт`);
        return;
      }
      if (unitsPerBox === null) {
        setShowPackingErrors(true);
        setError(`Укажите шт/короб для ${item.sku?.vendorCode ?? `nm ${line.nmId}`}`);
        return;
      }
    }

    const payloadLines: OwnStockShipmentLineInput[] = lines.map((line) => {
      const quantity = Number(line.quantity);
      const unitsPerBox = parsePositiveInt(line.unitsPerBox)!;
      const boxCount = Math.ceil(quantity / unitsPerBox);
      const packingNote = `Короб ${selectedBoxLabel} · ${unitsPerBox} шт/короб · ${boxCount} кор.`;
      return {
        nmId: line.nmId,
        quantity,
        notes: [line.notes.trim(), packingNote].filter(Boolean).join(' · ') || null,
      };
    });
    const exportRows = buildExportRows();

    startTransition(async () => {
      try {
        await exportSelectedWbShipmentXlsx(exportRows);
        await shipOwnStockToWb(tenantId, { lines: payloadLines, stockLocation });
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось оформить отгрузку на WB');
      }
    });
  };

  return (
    <div className="space-y-3 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-foreground">{title}</h3>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-2 rounded-xl border border-emerald-500/20 bg-card/80 p-3 lg:grid-cols-[minmax(220px,1fr)_minmax(260px,1.5fr)_120px] lg:items-end">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Короб
          <select
            value={boxMode}
            onChange={(e) => setBoxMode(e.target.value as BoxMode)}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
          >
            {BOX_PRESETS.map((box) => (
              <option key={box.id} value={box.id}>{box.label}</option>
            ))}
            <option value="custom">Свой размер</option>
          </select>
        </label>
        {boxMode === 'custom' ? (
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Длина
              <input
                type="number"
                min="1"
                step="0.1"
                value={customBox.length}
                onChange={(e) => setCustomBox((prev) => ({ ...prev, length: e.target.value }))}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-right text-sm tabular-nums focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Ширина
              <input
                type="number"
                min="1"
                step="0.1"
                value={customBox.width}
                onChange={(e) => setCustomBox((prev) => ({ ...prev, width: e.target.value }))}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-right text-sm tabular-nums focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Высота
              <input
                type="number"
                min="1"
                step="0.1"
                value={customBox.height}
                onChange={(e) => setCustomBox((prev) => ({ ...prev, height: e.target.value }))}
                className="rounded-md border border-border bg-card px-2 py-1.5 text-right text-sm tabular-nums focus:border-emerald-500 focus:outline-none"
              />
            </label>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            <Boxes className="h-4 w-4" />
            {selectedBoxLabel}
          </div>
        )}
        <div className="rounded-md bg-muted/50 px-3 py-2 text-right text-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Коробов</div>
          <div className="font-bold tabular-nums text-foreground">
            {totalBoxes > 0 ? formatNumber(totalBoxes, 0) : '—'}
          </div>
        </div>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={openPicker}
          disabled={availableItems.length === 0}
          className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-sm text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>
            {availableItems.length === 0
              ? pickerEmpty
              : lines.length > 0
                ? `Выбрано SKU: ${lines.length}`
                : 'Найти и выбрать SKU для отгрузки'}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>

        {isPickerOpen ? (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-xl border border-border bg-card shadow-xl">
            <div className="border-b border-border p-2">
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={skuQuery}
                  autoFocus
                  onChange={(e) => setSkuQuery(e.target.value)}
                  placeholder="SKU, артикул продавца или бренд"
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
                />
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto p-1">
              {filteredItems.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">SKU не найдены</div>
              ) : (
                filteredItems.map((item) => {
                  const checked = draftSelectedNmIds.has(item.nmId);
                  return (
                    <label
                      key={item.nmId}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDraftSku(item.nmId)}
                        className="h-4 w-4 rounded border-border text-emerald-600 focus:ring-emerald-500"
                      />
                      <div className="h-9 w-9 flex-shrink-0 overflow-hidden rounded border border-border bg-muted">
                        {item.sku?.photoUrl ? (
                          <Image
                            src={item.sku.photoUrl}
                            alt=""
                            width={36}
                            height={36}
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-foreground">
                          {item.sku?.vendorCode ?? `nm ${item.nmId}`}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {item.sku?.brand ?? '—'} · доступно {formatNumber(item.totalRemaining, 0)} шт
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">Выбрано: {draftSelectedNmIds.size}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsPickerOpen(false)}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={applySkuSelection}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
                >
                  <Check className="h-3.5 w-3.5" />
                  ОК
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {lines.length > 0 ? (
        <div className="space-y-2">
          <div className="hidden grid-cols-[minmax(220px,1fr)_90px_100px_100px_86px_minmax(150px,1fr)_32px] gap-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
            <div>SKU</div>
            <div className="text-right">Доступно</div>
            <div className="text-right">Отгрузить</div>
            <div className="text-right">Шт/короб</div>
            <div className="text-right">Коробов</div>
            <div>Комментарий</div>
            <div />
          </div>
          {lines.map((line) => {
            const item = itemByNm.get(line.nmId);
            const quantity = parsePositiveInt(line.quantity);
            const unitsPerBox = parsePositiveInt(line.unitsPerBox);
            const boxCount = quantity !== null && unitsPerBox !== null ? Math.ceil(quantity / unitsPerBox) : null;
            const hasPackingError = showPackingErrors && quantity !== null && unitsPerBox === null;
            return (
              <div
                key={line.tempId}
                className="grid gap-2 rounded-lg border border-border bg-card p-2 lg:grid-cols-[minmax(220px,1fr)_90px_100px_100px_86px_minmax(150px,1fr)_32px] lg:items-center"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded border border-border bg-muted">
                    {item?.sku?.photoUrl ? (
                      <Image
                        src={item.sku.photoUrl}
                        alt=""
                        width={40}
                        height={40}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {item?.sku?.vendorCode ?? `nm ${line.nmId}`}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {item?.sku?.brand ?? '—'} · nm {line.nmId}
                    </div>
                  </div>
                </div>
                <div className="rounded-md bg-muted/50 px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-foreground">
                  {formatNumber(item?.totalRemaining ?? 0, 0)} шт
                </div>
                <input
                  type="number"
                  min="1"
                  max={item?.totalRemaining ?? undefined}
                  step="1"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.tempId, { quantity: e.target.value })}
                  placeholder="шт"
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-right text-sm tabular-nums focus:border-emerald-500 focus:outline-none"
                />
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={line.unitsPerBox}
                  onChange={(e) => updateLine(line.tempId, { unitsPerBox: e.target.value })}
                  placeholder="шт"
                  className={`rounded-md border px-2 py-1.5 text-right text-sm tabular-nums focus:outline-none ${
                    hasPackingError
                      ? 'border-rose-500 bg-rose-50 text-rose-900 focus:border-rose-500 dark:bg-rose-950/30 dark:text-rose-100'
                      : 'border-border bg-card focus:border-emerald-500'
                  }`}
                />
                <div className="rounded-md bg-muted/50 px-2 py-1.5 text-right text-sm font-semibold tabular-nums text-foreground">
                  {boxCount !== null ? formatNumber(boxCount, 0) : '—'}
                </div>
                <input
                  type="text"
                  value={line.notes}
                  onChange={(e) => updateLine(line.tempId, { notes: e.target.value })}
                  placeholder="Комментарий для фулфилмента"
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeLine(line.tempId)}
                  className="justify-self-end rounded-md border border-border bg-card p-1.5 text-muted-foreground hover:text-rose-500"
                  title="Убрать SKU"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
            Итого к отгрузке: <span className="font-bold tabular-nums">{formatNumber(totalQty, 0)} шт</span>
            {' · '}
            коробов: <span className="font-bold tabular-nums">{totalBoxes > 0 ? formatNumber(totalBoxes, 0) : '—'}</span>
            {incompleteBoxLines ? <span className="ml-2 text-xs text-rose-600 dark:text-rose-300">заполните шт/короб</span> : null}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          Выберите SKU, которые нужно передать на фулфилмент.
        </div>
      )}

      {error ? <div className="text-xs text-rose-700 dark:text-rose-300">{error}</div> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending || lines.length === 0}
          className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
          Отгрузить на WB
        </button>
      </div>
    </div>
  );
}

function StockItemCard({
  tenantId,
  item,
  stockLocation,
  onMutated,
}: {
  tenantId: string;
  item: OwnStockItem;
  stockLocation: StockLocation;
  onMutated: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isConsuming, setIsConsuming] = useState(false);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustValue, setAdjustValue] = useState('');
  const [isPending, startTransition] = useTransition();

  const onAdjust = (batchId: string, currentRemaining: number) => {
    setAdjustingId(batchId);
    setAdjustValue(String(currentRemaining));
  };

  const submitAdjust = (batchId: string) => {
    const newQty = Number(adjustValue);
    if (!Number.isFinite(newQty) || newQty < 0) {
      alert('Некорректное количество');
      return;
    }
    startTransition(async () => {
      try {
        await adjustBatchInventory(tenantId, { batchId, newQuantity: newQty, notes: null });
        setAdjustingId(null);
        setAdjustValue('');
        onMutated();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Ошибка корректировки');
      }
    });
  };

  const submitUndoReceipt = (batchId: string) => {
    if (!window.confirm('Отменить этот приход? Партия исчезнет со склада, если из неё ещё не было списаний.')) {
      return;
    }
    startTransition(async () => {
      try {
        await undoOwnStockReceipt(tenantId, batchId);
        onMutated();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Ошибка отмены прихода');
      }
    });
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
          {item.sku?.photoUrl ? (
            <Image
              src={item.sku.photoUrl}
              alt=""
              width={48}
              height={48}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {item.sku?.vendorCode ?? `nm ${item.nmId}`}
          </div>
          <div className="text-xs text-muted-foreground">
            {item.sku?.brand ?? '—'} · nm {item.nmId}
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-bold tabular-nums text-foreground">
            {formatNumber(item.totalRemaining, 0)} шт
          </div>
          <div className="text-xs font-medium text-muted-foreground">
            {item.totalCost > 0 ? formatCurrency(item.totalCost, 0) : '—'}
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIsConsuming((v) => !v)}
          disabled={isConsuming}
          className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-500/20 disabled:opacity-50 dark:text-rose-300"
        >
          <PackageMinus className="h-3.5 w-3.5" /> Списать
        </button>
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          {item.batches.length} партии
        </button>
      </div>

      {isConsuming ? (
        <ConsumeForm
          tenantId={tenantId}
          item={item}
          stockLocation={stockLocation}
          onClose={(refresh) => {
            setIsConsuming(false);
            if (refresh) onMutated();
          }}
        />
      ) : null}

      {isExpanded ? (
        <div className="mt-2 space-y-1.5 rounded-xl border border-border/60 bg-muted/30 p-2 text-xs">
          {item.batches.map((b) => {
            const receivedAt = new Date(b.receivedAt).toLocaleDateString('ru-RU', {
              day: 'numeric', month: 'short', year: '2-digit',
            });
            const isAdjusting = adjustingId === b.id;
            return (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">
                    {b.sourceType === 'production_order' ? 'Партия' : 'Ручной приход'} от {receivedAt}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Поступило {b.receivedQuantity} шт
                    {b.costPerUnit ? <> · по {formatCurrency(Number(b.costPerUnit), 2)}/шт</> : null}
                  </div>
                </div>
                {isAdjusting ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max={b.receivedQuantity}
                      value={adjustValue}
                      onChange={(e) => setAdjustValue(e.target.value)}
                      className="w-20 rounded-md border border-border bg-card px-2 py-1 text-right text-xs tabular-nums focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => submitAdjust(b.id)}
                      disabled={isPending}
                      className="rounded-md bg-emerald-500 p-1 text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustingId(null);
                        setAdjustValue('');
                      }}
                      className="rounded-md border border-border bg-card p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="text-right">
                      <div className="font-bold tabular-nums text-foreground">{b.remainingQuantity} шт</div>
                      <div className="text-[10px] text-muted-foreground">осталось</div>
                    </div>
                    <button
                      type="button"
                      title="Корректировка после инвентаризации"
                      onClick={() => onAdjust(b.id, b.remainingQuantity)}
                      className="rounded-md border border-border bg-card p-1 text-muted-foreground hover:text-foreground"
                    >
                      <ClipboardCheck className="h-3.5 w-3.5" />
                    </button>
                    {b.remainingQuantity === b.receivedQuantity ? (
                      <button
                        type="button"
                        title="Отменить приход"
                        onClick={() => submitUndoReceipt(b.id)}
                        disabled={isPending}
                        className="rounded-md border border-amber-500/30 bg-amber-500/10 p-1 text-amber-700 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-300"
                      >
                        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeft className="h-3.5 w-3.5" />}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MovementsLog({ movements }: { movements: Movement[] }) {
  if (movements.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        Движений пока нет.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="divide-y divide-border">
        {movements.map((m) => {
          const meta = REASON_LABEL[m.reason] ?? { label: m.reason, tone: 'adjust' as const };
          const sign = m.deltaQuantity >= 0 ? '+' : '';
          const deltaClass =
            m.deltaQuantity > 0
              ? 'text-emerald-600 dark:text-emerald-400'
              : m.deltaQuantity < 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-muted-foreground';
          const reasonClass =
            meta.tone === 'in'
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : meta.tone === 'out'
                ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
          const date = new Date(m.createdAt).toLocaleString('ru-RU', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          });
          return (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <div className="w-32 text-muted-foreground">{date}</div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${reasonClass}`}>
                {meta.label}
              </span>
              <div className="min-w-0 flex-1 truncate text-foreground">
                {m.sku?.vendorCode ?? `nm ${m.nmId}`}
                {m.notes ? <span className="text-muted-foreground"> — {m.notes}</span> : null}
              </div>
              <div className={`text-right font-bold tabular-nums ${deltaClass}`}>
                {sign}{m.deltaQuantity} шт
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function OwnStockPageClient({
  tenantId,
  stockLocation = 'own',
}: {
  tenantId: string;
  stockLocation?: StockLocation;
}) {
  const [items, setItems] = useState<OwnStockItem[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReceiptForm, setShowReceiptForm] = useState(false);
  const [showShipmentForm, setShowShipmentForm] = useState(false);
  const costBackfillKeyRef = useRef<string | null>(null);
  const copy = WAREHOUSE_COPY[stockLocation];

  const refresh = () => {
    setIsLoading(true);
    Promise.all([
      listOwnStock(tenantId, stockLocation),
      listOwnStockMovements(tenantId, 80, stockLocation),
    ])
      .then(([stock, movs]) => {
        setItems(stock);
        setMovements(movs);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, stockLocation]);

  useEffect(() => {
    if (isLoading || items.length === 0) return;

    const costsByNm = new Map<number, OwnStockCostBackfillInput>();
    for (const item of items) {
      const hasBatchWithoutCost = item.batches.some((batch) => {
        const cost = Number(batch.costPerUnit);
        return !Number.isFinite(cost) || cost <= 0;
      });
      if (!hasBatchWithoutCost) continue;

      const manualFields = readManualFields(tenantId, item.nmId);
      const purchaseCostPerUnit = toNumber(manualFields.costPrice);
      if (purchaseCostPerUnit <= 0) continue;

      costsByNm.set(item.nmId, {
        nmId: item.nmId,
        purchaseCostPerUnit,
        fulfillmentDeliveryPerUnit: toNumber(manualFields.deliveryToFf),
      });
    }

    const costs = Array.from(costsByNm.values());
    const backfillKey = costs
      .map((cost) => `${cost.nmId}:${cost.purchaseCostPerUnit}:${cost.fulfillmentDeliveryPerUnit ?? 0}`)
      .sort()
      .join('|');
    if (!backfillKey || costBackfillKeyRef.current === backfillKey) return;

    costBackfillKeyRef.current = backfillKey;
    backfillOwnStockCostsFromEconomics(tenantId, costs)
      .then((result) => {
        if (result.updatedRows > 0) refresh();
      })
      .catch((err) => {
        console.error('[OwnStockPageClient] cost backfill failed', err);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, items, isLoading]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4 pb-10 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/stocks-v2"
            prefetch={false}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Дашборд
          </Link>
          <h1 className="text-lg font-bold text-foreground">{copy.title}</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setShowShipmentForm(true);
              setShowReceiptForm(false);
            }}
            disabled={items.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            title="Оформить отгрузку на WB и скачать Excel для фулфилмента"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Отгрузка на WB
          </button>
          {!showReceiptForm ? (
            <button
              type="button"
              onClick={() => {
                setShowReceiptForm(true);
                setShowShipmentForm(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
            >
              <PackagePlus className="h-4 w-4" /> Ручной приход
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        💡 {copy.hint}
      </div>

      {showReceiptForm ? (
        <ManualReceiptForm
          tenantId={tenantId}
          stockLocation={stockLocation}
          title={copy.receiptTitle}
          onCreated={() => {
            setShowReceiptForm(false);
            refresh();
          }}
          onCancel={() => setShowReceiptForm(false)}
        />
      ) : null}

      {showShipmentForm ? (
        <ShipmentToWbForm
          tenantId={tenantId}
          items={items}
          stockLocation={stockLocation}
          title={copy.shipmentTitle}
          pickerEmpty={copy.pickerEmpty}
          onCreated={() => {
            setShowShipmentForm(false);
            refresh();
          }}
          onCancel={() => setShowShipmentForm(false)}
        />
      ) : null}

      {isLoading && items.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
          <Boxes className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <div className="text-base font-semibold text-foreground">{copy.emptyTitle}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {copy.emptyDescription}
          </div>
        </div>
      ) : (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            SKU на складе ({items.length})
          </h2>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {items.map((item) => (
              <StockItemCard
                key={item.nmId}
                tenantId={tenantId}
                item={item}
                stockLocation={stockLocation}
                onMutated={refresh}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            История движений
          </h2>
          <span className="text-xs text-muted-foreground">
            <Truck className="mr-1 inline h-3.5 w-3.5" />
            Последние {movements.length}
          </span>
        </div>
        <MovementsLog movements={movements} />
      </section>
    </div>
  );
}
