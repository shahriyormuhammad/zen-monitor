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
import { ChevronDown, Loader2, PackageCheck, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  listSupplyArticlesAction, computeArticleDistributionAction,
  assembleSupplyFromPlanAction, loadSupplyPlanAction, loadLocalizationAction,
} from '@/app/(dashboard)/supply/actions';
import type { DistributionResult, SupplyStrategy } from '@/server/supply/distribution';
import { warehousesInOkrug, type Okrug } from '@/server/supply/geography';
import { ArticleAutocomplete } from './ArticleAutocomplete';
import { DeficitClusters } from './DeficitClusters';
import { DeficitWidgets } from './DeficitWidgets';

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
  basis: 'deficit' | 'demand' | null;
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

/* ── Answer-first сводка (период + сколько отгрузить + по округам) ─────── */

const SUMMARY_OKRUGS: { code: string; label: string }[] = [
  { code: 'ЦФО', label: 'Центр' }, { code: 'СЗФО', label: 'Северо-Запад' },
  { code: 'ПФО', label: 'Поволжье' }, { code: 'УФО', label: 'Урал' },
  { code: 'СФО', label: 'Сибирь+ДВ' }, { code: 'ЮФО', label: 'Юг' },
];
const SUMMARY_PERIODS: [string, number][] = [['Месяц', 30], ['2 месяца', 60], ['3 месяца', 90]];

function SupplyHero({ tenantId }: { tenantId: string }) {
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ['supplyplan', tenantId, days, days],
    queryFn: () => loadSupplyPlanAction(tenantId, days, days),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });
  const plan = q.data;
  const need = plan?.total ?? 0;
  const by = (plan?.byOkrug ?? {}) as Record<string, { ship: number; orders: number; stock: number }>;
  const okMax = Math.max(1, ...SUMMARY_OKRUGS.map((o) => by[o.code]?.ship ?? 0));
  const topWh = (plan?.byWarehouse ?? []).filter((w) => w.ship > 0).slice(0, 8);
  return (
    <div className="dashboard-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">План поставки · {days} дн · по складам</p>
          <h2 className="mt-1 text-[26px] font-black tracking-tight text-slate-950 dark:text-white">
            {q.isLoading ? 'Считаем…' : `Отгрузить ${fmtNum(need)} шт`}
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {plan
              ? `${fmtNum(plan.modelsCount)} артикулов · ${fmtNum(plan.withPlan)} к поставке · по складам (гео-отгрузки) и выкупам`
              : 'Расчёт по складам — формула Поставлено'}
          </p>
        </div>
        <div className="flex rounded-full border border-border p-0.5 text-[12px] font-semibold">
          {SUMMARY_PERIODS.map(([label, d]) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`rounded-full px-3 py-1 transition-colors ${days === d ? 'bg-foreground text-card' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {SUMMARY_OKRUGS.map((o) => {
          const n = by[o.code]?.ship ?? 0;
          return (
            <div key={o.code} className="rounded-xl border border-border bg-background/50 p-3">
              <p className="text-[11px] text-muted-foreground">{o.label}</p>
              <p className="mt-0.5 text-[16px] font-black tabular-nums text-slate-950 dark:text-white">{fmtNum(n)}</p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-subtle">
                <div className={`h-full rounded-full ${n > 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(100, (n / okMax) * 100)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      {topWh.length > 0 ? (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Разнарядка по складам</p>
          <div className="flex flex-wrap gap-1.5">
            {topWh.map((w) => (
              <span key={w.warehouse} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background/50 px-2 py-1 text-[11px]">
                <span className="font-semibold text-foreground">{w.warehouse}</span>
                <span className="font-mono font-bold text-rose-600 dark:text-rose-400">{fmtNum(w.ship)}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ── Локализация (ИЛ/ИРП + «что лечить») — порт «Поставлено» на наши данные ── */

const LOC_PERIODS: [string, number][] = [['Месяц', 30], ['13 недель', 91]];

function ilColor(il: number): string {
  if (il <= 1.0) return 'text-emerald-600 dark:text-emerald-400';
  if (il <= 1.1) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}
function irpColor(irp: number): string {
  if (irp <= 0.001) return 'text-emerald-600 dark:text-emerald-400';
  if (irp < 1) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}
function shareBadge(share: number): string {
  if (share >= 60) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
  if (share >= 45) return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  return 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300';
}

function Kpi({ label, value, cls, hint }: { label: string; value: string; cls: string; hint: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/50 p-3" title={hint}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-[20px] font-black tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

function LocalizationPanel({ tenantId }: { tenantId: string }) {
  const [days, setDays] = useState(91);
  const q = useQuery({
    queryKey: ['localization', tenantId, days],
    queryFn: () => loadLocalizationAction(tenantId, days),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });
  const d = q.data;
  const top = (d?.articles ?? []).slice(0, 20);
  return (
    <div className="dashboard-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-indigo-600 dark:text-indigo-400">Локализация · {days} дн</p>
          <h3 className="mt-1 text-[18px] font-black tracking-tight text-slate-950 dark:text-white">Индексы логистики WB</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Чем ниже ИЛ и ИРП — тем дешевле прямая логистика. Доля локализации ≥ 60% обнуляет ИРП.
          </p>
        </div>
        <div className="flex rounded-full border border-border p-0.5 text-[12px] font-semibold">
          {LOC_PERIODS.map(([label, dd]) => (
            <button
              key={dd}
              type="button"
              onClick={() => setDays(dd)}
              className={`rounded-full px-3 py-1 transition-colors ${days === dd ? 'bg-foreground text-card' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Считаем локализацию…
        </div>
      ) : !d || d.totalOrders === 0 ? (
        <div className="mt-4 text-[12px] text-muted-foreground">Нет заказов с распознанным регионом за период.</div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi label="ИЛ (индекс лок.)" value={d.il.toFixed(3)} cls={ilColor(d.il)} hint="Σ(заказы×КТР)/Σ заказов — цель ≤ 1" />
            <Kpi label="ИРП" value={d.irp.toFixed(3)} cls={irpColor(d.irp)} hint="штраф за нелокальные продажи — цель 0" />
            <Kpi label="Средняя доля лок." value={`${d.avgShare.toFixed(1)}%`} cls="text-foreground" hint="справочно — на индексы не влияет" />
            <Kpi
              label="Ниже 60%"
              value={`${fmtNum(d.belowThreshold)} арт`}
              cls={d.belowThreshold > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}
              hint="артикулы, генерящие ИРП"
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Что лечить — топ по влиянию на ИЛ</p>
            <table className="w-full min-w-[640px] text-[12px]">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">Артикул</th>
                  <th className="px-2 py-1.5 text-right">Заказов</th>
                  <th className="px-2 py-1.5 text-right">Доля лок.</th>
                  <th className="px-2 py-1.5 text-right">КТР</th>
                  <th className="px-2 py-1.5 text-right">КРП</th>
                  <th className="px-2 py-1.5 text-right">% влияния ИЛ</th>
                  <th className="px-2 py-1.5 text-right">% влияния ИРП</th>
                </tr>
              </thead>
              <tbody>
                {top.map((a) => (
                  <tr key={a.nmId} className="border-t border-border/60">
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        {a.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.photoUrl} alt={a.vendorCode} className="h-9 w-7 rounded object-cover" />
                        ) : (
                          <div className="grid h-9 w-7 place-items-center rounded bg-subtle text-[10px] text-muted-foreground">—</div>
                        )}
                        <div className="flex flex-col leading-tight">
                          <span className="font-bold text-foreground">{a.vendorCode}</span>
                          <span className="text-[10px] text-muted-foreground">{a.nmId}{a.brand ? ` · ${a.brand}` : ''}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{fmtNum(a.orders)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${shareBadge(a.share)}`}>{a.share.toFixed(0)}%</span>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{a.ktr.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right font-mono">{a.krp.toFixed(2)}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-bold">{a.ilInfluencePct.toFixed(1)}%</td>
                    <td className="px-2 py-1.5 text-right font-mono">{a.irpInfluencePct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.articles.length > top.length ? (
              <p className="mt-2 text-[11px] text-muted-foreground">Показаны топ-{top.length} из {fmtNum(d.articles.length)} артикулов по влиянию.</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Main component ─────────────────────────────── */

export function DeliveryPlanTab({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const articlesQuery = useQuery({
    queryKey: ['supply-articles', tenantId],
    queryFn: () => listSupplyArticlesAction(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });
  const articles = articlesQuery.data ?? [];
  const [assembleOpen, setAssembleOpen] = useState(false);

  // Form state
  const [vc, setVc] = useState('');
  const [nm, setNm] = useState('');
  const [boxes, setBoxes] = useState('1');
  const [pairs, setPairs] = useState('8');
  const [strategy, setStrategy] = useState<SupplyStrategy>('cost');
  const [items, setItems] = useState<PlannedItem[]>([]);

  /* Связку vendorCode ↔ nmId делаем ТОЛЬКО при выборе из подсказки (onPick),
   * а не реактивными эффектами — иначе ввод «снапается» назад и его нельзя
   * стереть/изменить (баг п.1). */

  const recomputeDistribution = useCallback(
    async (item: PlannedItem, nextStrategy: SupplyStrategy) => {
      try {
        const res = await computeArticleDistributionAction(
          tenantId, item.nmId, item.totalQty, nextStrategy,
        );
        setItems((prev) =>
          prev.map((p) => p.id === item.id
            ? { ...p, status: res.status, basis: res.basis, distribution: res.rows, errorMessage: undefined }
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
        basis: null,
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
      basis: null,
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
          ? { ...p, status: res.status, basis: res.basis, distribution: res.rows }
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
  /* Per-okrug warehouse override: changes which warehouse this okrug ships to. */
  const setRowWarehouse = useCallback((itemId: string, okrug: string, warehouse: string) => {
    setItems((prev) => prev.map((p) => p.id === itemId
      ? { ...p, distribution: p.distribution.map((r) => r.okrug === okrug ? { ...r, warehouse } : r) }
      : p));
  }, []);
  const toggleSelected = (id: string) =>
    setItems((prev) => prev.map((p) => p.id === id ? { ...p, selected: !p.selected } : p));
  const clearAll = () => setItems([]);

  const selectedCount = items.filter((i) => i.selected).length;
  const selectedBoxes = items.filter((i) => i.selected).reduce((s, i) => s + i.boxes, 0);
  const selectedTotal = items.filter((i) => i.selected).reduce((s, i) => s + i.totalQty, 0);

  // Group selected items' distribution by warehouse for the assemble modal.
  const assemblePlan = useMemo(() => {
    const ready = items.filter((i) => i.selected && i.status === 'ok' && i.distribution.length > 0);
    const byWarehouse = new Map<string, { vendorCode: string; nmId: number; qty: number }[]>();
    const articlesPayload = new Map<number, { vendorCode: string; nmId: number; legs: { warehouse: string; qty: number }[] }>();
    for (const item of ready) {
      for (const row of item.distribution) {
        const wh = row.warehouse || `${row.okrug} (склад не задан)`;
        const list = byWarehouse.get(wh) ?? [];
        list.push({ vendorCode: item.vendorCode, nmId: item.nmId, qty: row.qty });
        byWarehouse.set(wh, list);

        const ap = articlesPayload.get(item.nmId) ?? { vendorCode: item.vendorCode, nmId: item.nmId, legs: [] };
        ap.legs.push({ warehouse: row.warehouse || '', qty: row.qty });
        articlesPayload.set(item.nmId, ap);
      }
    }
    const warehouses = Array.from(byWarehouse.entries())
      .map(([warehouse, rows]) => ({
        warehouse,
        rows,
        totalQty: rows.reduce((s, r) => s + r.qty, 0),
      }))
      .sort((a, b) => b.totalQty - a.totalQty);
    return { warehouses, payload: Array.from(articlesPayload.values()), readyCount: ready.length };
  }, [items]);

  const assembleMutation = useMutation({
    mutationFn: () => assembleSupplyFromPlanAction(tenantId, assemblePlan.payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supply-items', tenantId] });
      setAssembleOpen(false);
    },
  });

  if (articlesQuery.isLoading) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-rose-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SupplyHero tenantId={tenantId} />

      <LocalizationPanel tenantId={tenantId} />

      {/* ─ Add form ─ (виджет «Добавить артикул» — не менять) */}
      <div className="dashboard-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="text-[15px] font-extrabold">Добавить артикул</h3>
          <StrategySwitch value={strategy} onChange={onStrategyChange} />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1.4fr_1fr_0.6fr_0.6fr]">
          <Field label="Артикул продавца">
            <ArticleAutocomplete
              value={vc}
              onChange={(v) => { setVc(v); setNm(''); }}
              onPick={(a) => { setVc(a.vendorCode); setNm(String(a.nmId)); }}
              articles={articles}
              placeholder="напр. A519-2 ТН-10"
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-[12px] text-foreground outline-none focus:border-rose-400"
            />
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
              Распределение «по дефициту»: коробки идут пропорционально нехватке (прогноз продаж − остаток) по каждому округу. Где остатка хватает — округ получает мало или ноль.
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
                    onWarehouseChange={(okrug, wh) => setRowWarehouse(item.id, okrug, wh)}
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

      {/* ─ Виджеты сводки ─ */}
      <DeficitWidgets tenantId={tenantId} />

      {/* ─ Дефицит по кластерам ─ */}
      <DeficitClusters tenantId={tenantId} />

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
              onClick={() => setAssembleOpen(true)}
              disabled={assemblePlan.readyCount === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-rose-600 disabled:opacity-40"
              title={assemblePlan.readyCount === 0 ? 'Выбери артикулы с рассчитанным распределением' : 'Сгруппировать по складам и создать поставку'}
            >
              <PackageCheck className="h-4 w-4" /> Собрать поставку
            </button>
          </div>
        </div>
      ) : null}

      {/* ─ Assemble modal ─ */}
      {assembleOpen ? (
        <AssembleModal
          plan={assemblePlan}
          pending={assembleMutation.isPending}
          error={assembleMutation.error instanceof Error ? assembleMutation.error.message : null}
          result={assembleMutation.data ?? null}
          onConfirm={() => assembleMutation.mutate()}
          onClose={() => { setAssembleOpen(false); assembleMutation.reset(); }}
        />
      ) : null}
    </div>
  );
}

/* ── Assemble modal ─────────────────────────────── */

function AssembleModal({
  plan, pending, error, result, onConfirm, onClose,
}: {
  plan: { warehouses: { warehouse: string; rows: { vendorCode: string; qty: number }[]; totalQty: number }[]; payload: unknown[]; readyCount: number };
  pending: boolean;
  error: string | null;
  result: { added: { id: string }[]; failed: { vendorCode: string; reason: string }[] } | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-subtle/30 px-5 py-3">
          <div>
            <h3 className="text-[15px] font-extrabold">Собрать поставку</h3>
            <p className="text-[11px] text-muted-foreground">
              Будет создано <strong>{plan.warehouses.length}</strong> поставок по складам. Каждый артикул раскладывается на ростовку по умолчанию.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground" aria-label="Закрыть">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {result ? (
            <div className="space-y-2 text-[12px]">
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-700/40 dark:bg-emerald-950/30 dark:text-emerald-200">
                ✓ Создано строк поставки: <strong>{result.added.length}</strong>. Открой «Шаг 1: Создать» — там список с разбивкой по складам, оттуда экспорт XLSX (отдельный лист на каждый склад).
              </div>
              {result.failed.length > 0 ? (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-rose-700 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-300">
                  Пропущено {result.failed.length}: {result.failed.map((f) => `${f.vendorCode} (${f.reason})`).join(', ')}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {plan.warehouses.map((wh) => (
                <div key={wh.warehouse} className="rounded-xl border border-border bg-subtle/30 p-3">
                  <div className="flex items-baseline justify-between">
                    <strong className="text-[12.5px] text-foreground">{wh.warehouse}</strong>
                    <span className="text-[11px] text-muted-foreground">{wh.rows.length} арт · <strong>{fmtNum(wh.totalQty)}</strong> шт</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[10.5px]">
                    {wh.rows.map((r, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 font-mono">
                        {r.vendorCode} <span className="text-rose-600">{fmtNum(r.qty)}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {error ? (
            <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">{error}</div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-subtle/30 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-[12px] font-bold text-muted-foreground hover:text-foreground">
            {result ? 'Закрыть' : 'Отмена'}
          </button>
          {!result ? (
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending || plan.warehouses.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-2 text-[12px] font-bold text-white hover:bg-rose-600 disabled:opacity-40"
            >
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}
              Создать поставку
            </button>
          ) : null}
        </div>
      </div>
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
  item, idx, onToggleExpand, onToggleSelected, onRemove, onRetry, onWarehouseChange,
}: {
  item: PlannedItem;
  idx: number;
  onToggleExpand: () => void;
  onToggleSelected: () => void;
  onRemove: () => void;
  onRetry: () => void;
  onWarehouseChange: (okrug: string, warehouse: string) => void;
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
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {item.basis === 'deficit'
                ? '🎯 По дефициту: чем больше нехватка в округе, тем больше коробок'
                : item.basis === 'demand'
                  ? '📊 По спросу: дефицита нет нигде — делим по доле заказов'
                  : ''}
            </div>
            <table className="w-full text-[11px]">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1">Округ</th>
                  <th className="px-2 py-1 text-right">Заказов</th>
                  <th className="px-2 py-1 text-right">Остаток</th>
                  <th className="px-2 py-1 text-right">Дефицит</th>
                  <th className="px-2 py-1 text-right">%</th>
                  <th className="px-2 py-1 text-right">Везём, шт</th>
                  <th className="px-2 py-1">Склад</th>
                </tr>
              </thead>
              <tbody>
                {item.distribution.map((row) => (
                  <tr key={row.okrug} className="border-t border-border/50">
                    <td className="px-2 py-1 font-bold text-foreground">{row.okrug}</td>
                    <td className="px-2 py-1 text-right font-mono">{fmtNum(row.orders)}</td>
                    <td className="px-2 py-1 text-right font-mono text-muted-foreground">{fmtNum(row.stock)}</td>
                    <td className="px-2 py-1 text-right font-mono font-bold text-rose-700">{fmtNum(row.need)}</td>
                    <td className="px-2 py-1 text-right font-mono">{(row.pct * 100).toFixed(1)}%</td>
                    <td className="px-2 py-1 text-right font-mono font-bold">{fmtNum(row.qty)}</td>
                    <td className="px-2 py-1">
                      {(() => {
                        const opts = warehousesInOkrug(row.okrug as Okrug);
                        const hasCurrent = opts.some((w) => w.name === row.warehouse);
                        return (
                          <select
                            value={row.warehouse}
                            onChange={(e) => onWarehouseChange(row.okrug, e.target.value)}
                            className="max-w-[190px] rounded border border-border bg-card px-1 py-0.5 text-[11px] outline-none focus:border-rose-400"
                            title="Склад для этого округа — можно поменять; «Создать в WB» создаст поставку именно на него"
                          >
                            {!hasCurrent && row.warehouse ? <option value={row.warehouse}>{row.warehouse}</option> : null}
                            {opts.map((w) => (
                              <option key={w.name} value={w.name}>{w.name}</option>
                            ))}
                          </select>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border bg-card/50 font-bold">
                  <td className="px-2 py-1">ИТОГО</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtNum(item.distribution.reduce((s, r) => s + r.orders, 0))}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtNum(item.distribution.reduce((s, r) => s + r.stock, 0))}</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtNum(item.distribution.reduce((s, r) => s + r.need, 0))}</td>
                  <td className="px-2 py-1 text-right font-mono">100%</td>
                  <td className="px-2 py-1 text-right font-mono">{fmtNum(item.distribution.reduce((s, r) => s + r.qty, 0))}</td>
                  <td className="px-2 py-1">—</td>
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
