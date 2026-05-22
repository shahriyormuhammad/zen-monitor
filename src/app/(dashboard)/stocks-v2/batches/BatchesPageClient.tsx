'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Package,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  formatCurrency,
  formatNumber,
} from '@/components/economics/helpers';
import {
  type CreateBatchInitialStatus,
  type BatchStatus,
  createBatch,
  deleteBatch,
  listBatches,
  listSkusForBatchForm,
  revertDeliveredBatch,
  updateBatchStatus,
} from '../actions';
import {
  exportBatchTemplateXlsx,
  parseBatchTemplateXlsx,
  type ParsedBatchTemplateLine,
} from './batchExcel';

type BatchListItem = Awaited<ReturnType<typeof listBatches>>[number];
type SkuOption = Awaited<ReturnType<typeof listSkusForBatchForm>>[number];
type BatchDraftLine = {
  tempId: string;
  nmId: number;
  quantity: string;
  costPerUnit: string;
  notes: string;
};

const STATUS_LABEL: Record<BatchStatus, string> = {
  ordered: 'Заказано',
  in_production: 'Производство',
  shipped: 'В пути',
  customs: 'Таможня',
  delivered: 'Принято',
};

const STATUS_ORDER: BatchStatus[] = ['ordered', 'in_production', 'shipped', 'customs', 'delivered'];
const BATCH_INITIAL_STATUS_ORDER: CreateBatchInitialStatus[] = ['ordered', 'in_production', 'shipped', 'customs'];

function StatusTimeline({ batch }: { batch: BatchListItem }) {
  const currentIdx = STATUS_ORDER.indexOf(batch.status as BatchStatus);
  return (
    <div className="flex items-center gap-2 text-[11px]">
      {STATUS_ORDER.map((s, idx) => {
        const reached = idx <= currentIdx;
        const isCurrent = idx === currentIdx;
        return (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full border ${
                reached
                  ? isCurrent
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'border-border bg-muted text-muted-foreground/60'
              }`}
              title={STATUS_LABEL[s]}
            >
              {reached ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </div>
            <div className={`whitespace-nowrap font-medium ${reached ? 'text-foreground' : 'text-muted-foreground'}`}>
              {STATUS_LABEL[s]}
            </div>
            {idx < STATUS_ORDER.length - 1 ? (
              <div className={`h-px w-6 ${reached ? 'bg-emerald-500/40' : 'bg-border'}`} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function BatchCard({
  batch,
  onAdvance,
  onDelete,
  onRevert,
  isPending,
}: {
  batch: BatchListItem;
  onAdvance: (id: string, next: BatchStatus) => void;
  onDelete: (id: string) => void;
  onRevert: (id: string) => void;
  isPending: boolean;
}) {
  const currentIdx = STATUS_ORDER.indexOf(batch.status as BatchStatus);
  const nextStatus = currentIdx >= 0 && currentIdx < STATUS_ORDER.length - 1
    ? STATUS_ORDER[currentIdx + 1]
    : null;
  const isDelivered = batch.status === 'delivered';
  const eta = batch.estimatedDeliveryAt
    ? new Date(batch.estimatedDeliveryAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    : null;
  const ordered = new Date(batch.orderedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' });

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-bold text-foreground">
            {batch.title || `Партия #${batch.id.slice(0, 8)}`}
          </div>
          <div className="text-xs text-muted-foreground">
            {batch.supplierName ?? 'Поставщик не указан'} · заказано {ordered}
            {eta && !isDelivered ? <> · ETA {eta}</> : null}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold tabular-nums text-foreground">
            {formatNumber(batch.totalQty, 0)} шт
          </div>
          <div className="text-xs font-medium text-muted-foreground">
            {batch.totalCost > 0 ? formatCurrency(batch.totalCost, 0) : 'без стоимости'}
            {Number(batch.shippingCost ?? 0) + Number(batch.customsCost ?? 0) > 0
              ? ` + доставка/таможня ${formatCurrency(Number(batch.shippingCost ?? 0) + Number(batch.customsCost ?? 0), 0)}`
              : ''}
          </div>
        </div>
      </div>

      <StatusTimeline batch={batch} />

      <div className="mt-3 space-y-1.5 rounded-xl border border-border/60 bg-muted/30 p-2">
        {batch.lines.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">SKU не добавлены</div>
        ) : (
          batch.lines.map((line) => (
            <div key={line.id} className="flex items-center gap-2 text-xs">
              <div className="h-7 w-7 flex-shrink-0 overflow-hidden rounded border border-border bg-card">
                {line.sku?.photoUrl ? (
                  <Image
                    src={line.sku.photoUrl}
                    alt=""
                    width={28}
                    height={28}
                    className="h-full w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 truncate font-medium text-foreground">
                {line.sku?.vendorCode ?? `nm ${line.nmId}`}
              </div>
              <div className="tabular-nums text-muted-foreground">
                {line.quantity} шт
                {line.costPerUnit ? <> × {formatCurrency(Number(line.costPerUnit), 0)}</> : null}
                {line.totalCost ? <> = {formatCurrency(Number(line.totalCost), 0)}</> : null}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="text-[11px] text-muted-foreground">
          {batch.trackingNumber ? <>Tracking: <code>{batch.trackingNumber}</code></> : null}
        </div>
        <div className="flex items-center gap-2">
          {!isDelivered && nextStatus ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => onAdvance(batch.id, nextStatus)}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {STATUS_LABEL[nextStatus]}
            </button>
          ) : null}
          {isDelivered ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (window.confirm('Вернуть партию из «Принято» назад? Это удалит созданный приход, если из него ещё не было списаний.')) onRevert(batch.id);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-300"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowLeft className="h-3.5 w-3.5" />}
              Назад
            </button>
          ) : null}
          {!isDelivered ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (window.confirm('Удалить партию? Все её SKU будут отменены.')) onDelete(batch.id);
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300"
              title="Удалить партию"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CreateBatchForm({
  tenantId,
  onCreated,
  onCancel,
}: {
  tenantId: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [initialStatus, setInitialStatus] = useState<CreateBatchInitialStatus>('ordered');
  const [currency, setCurrency] = useState('RUB');
  const [shippingCost, setShippingCost] = useState('');
  const [customsCost, setCustomsCost] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [estimatedDeliveryAt, setEstimatedDeliveryAt] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<BatchDraftLine[]>([]);
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [skuQuery, setSkuQuery] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [draftSelectedNmIds, setDraftSelectedNmIds] = useState<Set<number>>(new Set());
  const [isExportingTemplate, setIsExportingTemplate] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isLoadingSkus, setIsLoadingSkus] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
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

  const totalQty = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  const totalCost = lines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.costPerUnit) || 0),
    0,
  );

  const updateLine = (tempId: string, patch: Partial<BatchDraftLine>) =>
    setLines((prev) => prev.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)));
  const removeLine = (tempId: string) =>
    setLines((prev) => prev.filter((l) => l.tempId !== tempId));

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
      return {
        tempId: crypto.randomUUID(),
        nmId,
        quantity: '',
        costPerUnit: sku?.purchaseCostPerUnit != null ? String(sku.purchaseCostPerUnit) : '',
        notes: '',
      };
    }));
    setSkuQuery('');
    setIsPickerOpen(false);
  };

  const mergeImportedLines = (parsed: ParsedBatchTemplateLine[]) => {
    setLines((prev) => {
      const previousByNm = new Map(prev.map((line) => [line.nmId, line]));
      for (const line of parsed) {
        const previous = previousByNm.get(line.nmId);
        const sku = skuByNm.get(line.nmId);
        previousByNm.set(line.nmId, {
          tempId: previous?.tempId ?? crypto.randomUUID(),
          nmId: line.nmId,
          quantity: String(line.quantity),
          costPerUnit: line.costPerUnit != null
            ? String(line.costPerUnit)
            : previous?.costPerUnit ?? (sku?.purchaseCostPerUnit != null ? String(sku.purchaseCostPerUnit) : ''),
          notes: line.notes ?? previous?.notes ?? '',
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
      await exportBatchTemplateXlsx(skus);
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
      const parsed = await parseBatchTemplateXlsx(file, skus);
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

    const validLines = lines.map((line) => ({
      nmId: line.nmId,
      quantity: Number(line.quantity),
      costPerUnit: line.costPerUnit.trim() ? Number(line.costPerUnit) : null,
      notes: line.notes || null,
    }));

    startTransition(async () => {
      try {
        await createBatch(tenantId, {
          initialStatus,
          title: title || null,
          supplierName: supplierName || null,
          currency,
          shippingCost: shippingCost ? Number(shippingCost) : null,
          customsCost: customsCost ? Number(customsCost) : null,
          trackingNumber: trackingNumber || null,
          estimatedDeliveryAt: estimatedDeliveryAt || null,
          notes: notes || null,
          lines: validLines,
        });
        onCreated();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось создать партию');
      }
    });
  };

  return (
    <div className="space-y-4 rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-bold text-foreground">Новая партия</h3>
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
            className="rounded-lg border border-border bg-card p-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Название партии (необязательно)
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Контейнер #2025-01-08 Yiwu"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Поставщик
          <input
            type="text"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            placeholder="Yiwu Factory"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Где сейчас партия
          <select
            value={initialStatus}
            onChange={(e) => setInitialStatus(e.target.value as CreateBatchInitialStatus)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
          >
            {BATCH_INITIAL_STATUS_ORDER.map((status) => (
              <option key={status} value={status}>{STATUS_LABEL[status]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Валюта
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
          >
            <option value="RUB">RUB</option>
            <option value="CNY">CNY</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          ETA (дата прихода)
          <input
            type="date"
            value={estimatedDeliveryAt}
            onChange={(e) => setEstimatedDeliveryAt(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Стоимость доставки, {currency}
          <input
            type="number"
            min="0"
            step="0.01"
            value={shippingCost}
            onChange={(e) => setShippingCost(e.target.value)}
            placeholder="0"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          Стоимость таможни, {currency}
          <input
            type="number"
            min="0"
            step="0.01"
            value={customsCost}
            onChange={(e) => setCustomsCost(e.target.value)}
            placeholder="0"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground lg:col-span-2">
          Tracking номер (необязательно)
          <input
            type="text"
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder="ABC123XYZ"
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
          />
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-foreground">Содержимое партии</h4>
          <span className="text-xs text-muted-foreground">Выбрано: {lines.length}</span>
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
            <div className="hidden grid-cols-[minmax(220px,1fr)_90px_130px_minmax(160px,1fr)_32px] gap-2 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
              <div>SKU</div>
              <div className="text-right">Кол-во</div>
              <div className="text-right">Закупка</div>
              <div>Заметки</div>
              <div />
            </div>
            {lines.map((line) => {
              const sku = skuByNm.get(line.nmId);
              return (
                <div
                  key={line.tempId}
                  className="grid gap-2 rounded-lg border border-border bg-card p-2 lg:grid-cols-[minmax(220px,1fr)_90px_130px_minmax(160px,1fr)_32px] lg:items-center"
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
                    value={line.costPerUnit}
                    onChange={(e) =>
                      updateLine(line.tempId, {
                        costPerUnit: e.target.value,
                      })
                    }
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
              {Number(shippingCost || 0) + Number(customsCost || 0) > 0 ? (
                <>
                  {' + '}доставка/таможня{' '}
                  <span className="font-bold tabular-nums">
                    {formatCurrency(Number(shippingCost || 0) + Number(customsCost || 0), 0)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
            Выберите SKU вручную или загрузите заполненный Excel.
          </div>
        )}
      </div>

      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Заметки (необязательно)
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="resize-none rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-emerald-500 focus:outline-none"
        />
      </label>

      {error ? (
        <div className="rounded-md bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          Отмена
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Создать партию
        </button>
      </div>
    </div>
  );
}

export function BatchesPageClient({ tenantId }: { tenantId: string }) {
  const [batches, setBatches] = useState<BatchListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const refresh = () => {
    setIsLoading(true);
    listBatches(tenantId)
      .then((res) => {
        setBatches(res);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Не удалось загрузить партии'))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  const onAdvance = (id: string, next: BatchStatus) => {
    startTransition(async () => {
      try {
        await updateBatchStatus(tenantId, id, next);
        refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Ошибка обновления статуса');
      }
    });
  };

  const onDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteBatch(tenantId, id);
        refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Ошибка удаления');
      }
    });
  };

  const onRevert = (id: string) => {
    startTransition(async () => {
      try {
        await revertDeliveredBatch(tenantId, id);
        refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Ошибка отката партии');
      }
    });
  };

  const active = batches.filter((b) => b.status !== 'delivered');
  const delivered = batches.filter((b) => b.status === 'delivered');

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4 pb-10 duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/stocks-v2"
            prefetch={false}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Дашборд
          </Link>
        </div>
        {!showCreateForm ? (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
          >
            <Plus className="h-4 w-4" /> Создать партию
          </button>
        ) : null}
      </div>

      {showCreateForm ? (
        <CreateBatchForm
          tenantId={tenantId}
          onCreated={() => {
            setShowCreateForm(false);
            refresh();
          }}
          onCancel={() => setShowCreateForm(false)}
        />
      ) : null}

      {isLoading && batches.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      ) : batches.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-6 py-12 text-center">
          <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
          <div className="text-base font-semibold text-foreground">Партий пока нет</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Нажми «Создать партию» чтобы зафиксировать заказ у поставщика и отслеживать его до прихода на свой склад.
          </div>
        </div>
      ) : (
        <>
          {active.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Активные ({active.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {active.map((b) => (
                  <BatchCard key={b.id} batch={b} onAdvance={onAdvance} onDelete={onDelete} onRevert={onRevert} isPending={isPending} />
                ))}
              </div>
            </section>
          ) : null}
          {delivered.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Доставлено ({delivered.length})
              </h2>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {delivered.map((b) => (
                  <BatchCard key={b.id} batch={b} onAdvance={onAdvance} onDelete={onDelete} onRevert={onRevert} isPending={isPending} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
