'use client';

/**
 * Tab: «План поставки» (Postal panel-delivery-plan port).
 *
 *   1. Form: pick article (vendorCode or nmId) + box count + per-box pairs.
 *   2. Strategy switch: Скорость / Стоимость.
 *   3. Added-articles list with status pill + per-okrug distribution table.
 *   4. Sticky bottom bar with «Сбросить» / «Собрать поставку».
 *
 * Deficit-by-cluster table (Postal G.3) is deferred — too large to ship at
 * once. Will land in the next deploy together with the right-side widgets.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { listSupplyArticlesAction, computeArticleDistributionAction } from
  '@/app/(dashboard)/supply/actions';
import type { DistributionResult, SupplyStrategy } from '@/server/supply/distribution';

/* ── Types ─────────────────────────────────────── */

type Article = Awaited<ReturnType<typeof listSupplyArticlesAction>>[number];

type PlannedItem = {
  id: string;
  nmId: number;
  vendorCode: string;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
  boxes: number;
  pairsPerBox: number;
  totalQty: number;
  status: 'loading' | 'ok' | 'no-history' | 'no-article' | 'error';
  distribution: DistributionResult['rows'];
  errorMessage?: string;
  expanded: boolean;
  selected: boolean;
};

/* ── Helpers ───────────────────────────────────── */

function nextItemId(): string {
  return `dp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toLocaleString('ru-RU');
}

/* ── Main component ─────────────────────────────── */

export function DeliveryPlanTab({ tenantId }: { tenantId: string }) {
  const articlesQuery = useQuery({
    queryKey: ['supply-articles', tenantId],
    queryFn: () => listSupplyArticlesAction(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });
  const articles = articlesQuery.data ?? [];

  // Form state
  const [vc, setVc] = useState('');
  const [nm, setNm] = useState('');
  const [boxes, setBoxes] = useState('1');
  const [pairs, setPairs] = useState('8');
  const [strategy, setStrategy] = useState<SupplyStrategy>('cost');
  const [items, setItems] = useState<PlannedItem[]>([]);

  /* Auto-link vendor code → nmId via the articles cache. */
  useEffect(() => {
    if (!vc.trim()) return;
    const match = articles.find((a) => a.vendorCode.toLowerCase() === vc.trim().toLowerCase());
    if (match && String(match.nmId) !== nm) {
      setNm(String(match.nmId));
    }
  }, [vc, articles, nm]);
  useEffect(() => {
    if (!nm) return;
    const match = articles.find((a) => String(a.nmId) === nm.trim());
    if (match && match.vendorCode !== vc) {
      setVc(match.vendorCode);
    }
  }, [nm, articles, vc]);

  const recomputeDistribution = useCallback(
    async (item: PlannedItem, nextStrategy: SupplyStrategy) => {
      try {
        const res = await computeArticleDistributionAction(
          tenantId, item.nmId, item.totalQty, nextStrategy,
        );
        setItems((prev) =>
          prev.map((p) => p.id === item.id
            ? { ...p, status: res.status, distribution: res.rows, errorMessage: undefined }
            : p),
        );
      } catch (e) {
        setItems((prev) =>
          prev.map((p) => p.id === item.id
            ? { ...p, status: 'error', errorMessage: e instanceof Error ? e.message : String(e) }
            : p),
        );
      }
    },
    [tenantId],
  );

  const addItem = useCallback(async () => {
    const boxesNum = Math.max(1, Number(boxes) || 0);
    const pairsNum = Math.max(1, Number(pairs) || 0);
    const article = articles.find((a) => String(a.nmId) === nm.trim() || a.vendorCode.toLowerCase() === vc.trim().toLowerCase());
    if (!article) {
      // still allow add for "no-article" status
      const id = nextItemId();
      setItems((prev) => prev.concat({
        id,
        nmId: Number(nm.trim() || 0),
        vendorCode: vc.trim() || '?',
        brand: null,
        category: null,
        photoUrl: null,
        boxes: boxesNum,
        pairsPerBox: pairsNum,
        totalQty: boxesNum * pairsNum,
        status: 'no-article',
        distribution: [],
        expanded: false,
        selected: true,
      }));
      return;
    }
    const totalQty = boxesNum * pairsNum;
    const id = nextItemId();
    setItems((prev) => prev.concat({
      id,
      nmId: article.nmId,
      vendorCode: article.vendorCode,
      brand: article.brand,
      category: article.category,
      photoUrl: article.photoUrl,
      boxes: boxesNum,
      pairsPerBox: pairsNum,
      totalQty,
      status: 'loading',
      distribution: [],
      expanded: true,
      selected: true,
    }));
    // Reset form
    setVc('');
    setNm('');
    setBoxes('1');
    try {
      const res = await computeArticleDistributionAction(tenantId, article.nmId, totalQty, strategy);
      setItems((prev) =>
        prev.map((p) => p.id === id
          ? { ...p, status: res.status, distribution: res.rows }
          : p),
      );
    } catch (e) {
      setItems((prev) =>
        prev.map((p) => p.id === id
          ? { ...p, status: 'error', errorMessage: e instanceof Error ? e.message : String(e) }
          : p),
      );
    }
  }, [vc, nm, boxes, pairs, articles, strategy, tenantId]);

  const onStrategyChange = useCallback((next: SupplyStrategy) => {
    setStrategy(next);
    // recompute all existing items
    items.forEach((item) => {
      if (item.status === 'ok' || item.status === 'loading') {
        recomputeDistribution(item, next);
      }
    });
  }, [items, recomputeDistribution]);

  const removeItem = (id: string) => setItems((prev) => prev.filter((p) => p.id !== id));
  const toggleExpanded = (id: string) =>
    setItems((prev) => prev.map((p) => p.id === id ? { ...p, expanded: !p.expanded } : p));
  const toggleSelected = (id: string) =>
    setItems((prev) => prev.map((p) => p.id === id ? { ...p, selected: !p.selected } : p));
  const clearAll = () => setItems([]);

  const selectedCount = items.filter((i) => i.selected).length;
  const selectedBoxes = items.filter((i) => i.selected).reduce((s, i) => s + i.boxes, 0);
  const selectedTotal = items.filter((i) => i.selected).reduce((s, i) => s + i.totalQty, 0);

  if (articlesQuery.isLoading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-rose-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ─ Add form ─ */}
      <div className="dashboard-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-[15px] font-extrabold">Добавить артикул</h3>
          <StrategySwitch value={strategy} onChange={onStrategyChange} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1.4fr_1fr_0.6fr_0.6fr]">
          <Field label="Артикул продавца">
            <input
              value={vc}
              onChange={(e) => setVc(e.target.value)}
              placeholder="напр. A519-2 ТН-10"
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-[12px] text-foreground outline-none focus:border-rose-400"
              list="dp-vc-list"
            />
            <datalist id="dp-vc-list">
              {articles.map((a) => (
                <option key={a.nmId} value={a.vendorCode}>{a.brand ?? ''}{a.category ? ` · ${a.category}` : ''}</option>
              ))}
            </datalist>
          </Field>
          <Field label="Артикул WB (nmId)">
            <input
              value={nm}
              onChange={(e) => setNm(e.target.value.replace(/\D/g, ''))}
              placeholder="123456789"
              inputMode="numeric"
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-[12px] text-foreground outline-none focus:border-rose-400"
            />
          </Field>
          <Field label="Коробок">
            <input
              type="number"
              min={1}
              value={boxes}
              onChange={(e) => setBoxes(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-right font-mono text-[12px] text-foreground outline-none focus:border-rose-400"
            />
          </Field>
          <Field label="Пар/кор">
            <input
              type="number"
              min={1}
              value={pairs}
              onChange={(e) => setPairs(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-right font-mono text-[12px] text-foreground outline-none focus:border-rose-400"
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addItem}
            disabled={!vc.trim() && !nm.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-[12px] font-bold text-card hover:bg-foreground/90 disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Добавить
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={items.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] font-bold text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" /> Очистить список
          </button>
          {boxes && pairs ? (
            <span className="text-[11px] text-muted-foreground">
              Итого: <strong>{fmtNum(Number(boxes) * Number(pairs))}</strong> шт
            </span>
          ) : null}
        </div>
      </div>

      {/* ─ Added items ─ */}
      {items.length > 0 ? (
        <div className="dashboard-card overflow-hidden">
          <div className="border-b border-border bg-subtle px-5 py-3">
            <h3 className="text-[14px] font-extrabold">
              Запланированные артикулы <span className="ml-2 text-[12px] font-medium text-muted-foreground">{items.length}</span>
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Распределение считается только по нелокальным заказам (округа, где товара сейчас нет на складах).
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[12px]">
              <thead className="bg-subtle/60 text-left">
                <tr>
                  <th className="px-2 py-2"><input type="checkbox" checked={items.every((i) => i.selected)} onChange={() => {
                    const next = !items.every((i) => i.selected);
                    setItems((prev) => prev.map((p) => ({ ...p, selected: next })));
                  }} /></th>
                  <th className="px-2 py-2">#</th>
                  <th className="px-2 py-2">Артикул</th>
                  <th className="px-2 py-2 text-right">Коробок</th>
                  <th className="px-2 py-2 text-right">Итого, шт</th>
                  <th className="px-2 py-2">Статус</th>
                  <th className="px-2 py-2">Распределение</th>
                  <th className="px-2 py-2 text-right">Действия</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <PlannedRow
                    key={item.id}
                    item={item}
                    idx={idx + 1}
                    onToggleExpand={() => toggleExpanded(item.id)}
                    onToggleSelected={() => toggleSelected(item.id)}
                    onRemove={() => removeItem(item.id)}
                    onRetry={() => recomputeDistribution(item, strategy)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="dashboard-card p-8 text-center text-[12px] text-muted-foreground">
          Список пуст. Добавь артикул, и система предложит распределение по округам.
        </div>
      )}

      {/* ─ Sticky bottom bar ─ */}
      {selectedCount > 0 ? (
        <div className="sticky bottom-3 mx-auto flex w-full max-w-3xl items-center justify-between gap-4 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-lg">
          <div className="text-[12px] text-foreground">
            Выбрано: <strong>{selectedCount}</strong> арт · <strong>{selectedBoxes}</strong> кор · <strong>{fmtNum(selectedTotal)}</strong> шт
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setItems((p) => p.map((i) => ({ ...i, selected: false })))}
              className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-bold text-muted-foreground hover:text-foreground"
            >
              Сбросить
            </button>
            <button
              type="button"
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-rose-600 disabled:opacity-40"
              disabled
              title="Будет в следующем деплое"
            >
              Собрать поставку
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Sub-components ─────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function StrategySwitch({ value, onChange }: { value: SupplyStrategy; onChange: (v: SupplyStrategy) => void }) {
  return (
    <div className="inline-flex rounded-full border border-border bg-subtle p-1 text-[11px] font-bold">
      <button
        type="button"
        onClick={() => onChange('speed')}
        className={`rounded-full px-3 py-1.5 transition-colors ${value === 'speed' ? 'bg-foreground text-card' : 'text-muted-foreground hover:text-foreground'}`}
        title="Главный хаб каждого округа — быстрая доставка"
      >
        Скорость
      </button>
      <button
        type="button"
        onClick={() => onChange('cost')}
        className={`rounded-full px-3 py-1.5 transition-colors ${value === 'cost' ? 'bg-foreground text-card' : 'text-muted-foreground hover:text-foreground'}`}
        title="Самый дешёвый склад внутри округа"
      >
        Стоимость
      </button>
    </div>
  );
}

function PlannedRow({
  item, idx, onToggleExpand, onToggleSelected, onRemove, onRetry,
}: {
  item: PlannedItem;
  idx: number;
  onToggleExpand: () => void;
  onToggleSelected: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const status = item.status;
  const statusPill = (
    status === 'loading' ? <span className="inline-flex items-center gap-1 rounded-full bg-subtle px-2 py-0.5 text-[10px] font-bold text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> расчёт</span>
    : status === 'ok' ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">Есть история</span>
    : status === 'no-history' ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">Нет истории</span>
    : status === 'no-article' ? <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">Не найден</span>
    : <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">Ошибка</span>
  );

  return (
    <>
      <tr className={`border-t border-border ${item.selected ? '' : 'opacity-60'}`}>
        <td className="px-2 py-2"><input type="checkbox" checked={item.selected} onChange={onToggleSelected} /></td>
        <td className="px-2 py-2 font-mono text-muted-foreground">{idx}</td>
        <td className="px-2 py-2">
          <div className="flex items-center gap-2">
            {item.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.photoUrl} alt={item.vendorCode} className="h-10 w-8 rounded object-cover" />
            ) : (
              <div className="grid h-10 w-8 place-items-center rounded bg-subtle text-[10px] text-muted-foreground">—</div>
            )}
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-foreground">{item.vendorCode}</span>
              <span className="text-[10px] text-muted-foreground">{item.nmId}{item.brand ? ` · ${item.brand}` : ''}</span>
            </div>
          </div>
        </td>
        <td className="px-2 py-2 text-right font-mono font-bold">{item.boxes}</td>
        <td className="px-2 py-2 text-right font-mono font-bold text-foreground">{fmtNum(item.totalQty)}</td>
        <td className="px-2 py-2">{statusPill}</td>
        <td className="px-2 py-2">
          <button
            type="button"
            onClick={onToggleExpand}
            disabled={status !== 'ok' || item.distribution.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold text-foreground hover:bg-subtle disabled:opacity-40"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${item.expanded ? 'rotate-180' : ''}`} />
            {item.distribution.length > 0 ? `${item.distribution.length} округ${item.distribution.length === 1 ? '' : item.distribution.length < 5 ? 'а' : 'ов'}` : 'Нет'}
          </button>
        </td>
        <td className="px-2 py-2">
          <div className="flex justify-end gap-1">
            {status === 'error' ? (
              <button type="button" onClick={onRetry} className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground" title="Повторить">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button type="button" onClick={onRemove} className="rounded-md border border-border p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40" title="Удалить">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>

      {item.expanded && item.distribution.length > 0 ? (
        <tr className="border-t border-border bg-subtle/40">
          <td colSpan={8} className="px-3 py-3">
            <table className="w-full text-[11px]">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">Округ</th>
                  <th className="px-2 py-1 text-right">Заказов</th>
                  <th className="px-2 py-1 text-right">%</th>
                  <th className="px-2 py-1 text-right">Распределено, шт</th>
                  <th className="px-2 py-1">Склад</th>
                  <th className="px-2 py-1 text-right">Тариф×</th>
                </tr>
              </thead>
              <tbody>
                {item.distribution.map((row) => (
                  <tr key={row.okrug} className="border-t border-border/50">
                    <td className="px-2 py-1 font-bold text-foreground">{row.okrug}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmtNum(row.orders)}</td>
                    <td className="px-2 py-1 text-right font-mono">{(row.pct * 100).toFixed(1)}%</td>
                    <td className="px-2 py-1 text-right font-mono font-bold">{fmtNum(row.qty)}</td>
                    <td className="px-2 py-1">{row.warehouse}</td>
                    <td className="px-2 py-1 text-right font-mono text-muted-foreground">{row.tariffCoef.toFixed(2)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border bg-card/50 font-bold">
                  <td className="px-2 py-1">ИТОГО</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtNum(item.distribution.reduce((s, r) => s + r.orders, 0))}</td>
                  <td className="px-2 py-1 text-right font-mono">100%</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtNum(item.distribution.reduce((s, r) => s + r.qty, 0))}</td>
                  <td className="px-2 py-1" colSpan={2}>—</td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      ) : null}

      {item.errorMessage ? (
        <tr><td colSpan={8} className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-[11px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{item.errorMessage}</td></tr>
      ) : null}
    </>
  );
}
