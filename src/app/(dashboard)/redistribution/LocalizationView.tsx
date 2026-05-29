'use client';

/**
 * Вкладка «Индекс локализации» (по образцу Metrics Pulse):
 *   • 4 KPI: ИЛ сейчас, После рекомендаций, Артикулов, Заказов за 13 недель
 *   • Градиентная шкала ИЛ с маркером
 *   • Пояснение «что такое индекс локализации»
 *   • Таблица товаров с бейджами «логистика дороже на N%»
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MapPin, Package, ShoppingCart, TrendingDown } from 'lucide-react';

import { loadLocalizationBreakdownAction } from './actions';

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}
function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function LocalizationView({
  tenantId,
  projectedLocalSharePct,
  projectedKtr,
}: {
  tenantId: string;
  /** «После рекомендаций» — из плана перераспределения (если есть). */
  projectedLocalSharePct?: number | null;
  projectedKtr?: number | null;
}) {
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['localization-breakdown', tenantId],
    queryFn: () => loadLocalizationBreakdownAction(tenantId, 91),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  const data = query.data;
  const rows = useMemo(() => {
    const list = data?.rows ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter((r) =>
        (r.vendorCode ?? '').toLowerCase().includes(q)
        || (r.brand ?? '').toLowerCase().includes(q)
        || String(r.nmId).includes(q))
      : list;
    return filtered.slice(0, 300);
  }, [data, search]);

  if (query.isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
      </div>
    );
  }
  if (!data || data.overall.orders === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Нет заказов за последние 13 недель для расчёта индекса локализации.
      </div>
    );
  }

  const o = data.overall;
  const weeks = Math.round(data.windowDays / 7);
  const markerPct = Math.min(100, Math.max(0, o.localSharePct));

  return (
    <div className="space-y-4">
      {/* 4 KPI */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <KpiCard
          icon={MapPin}
          iconClass="text-amber-500"
          label="Индекс локализации WB"
          primary={(o.localSharePct / 100).toFixed(2)}
          lines={[
            `${fmtPct(o.localSharePct)} локальных заказов`,
            `КТР ${o.ktr.toFixed(2)} · ${ktrLabel(o.ktr)}`,
            `как WB видит магазин за ${weeks} полных недель`,
          ]}
          tone={o.localSharePct >= 60 ? 'ok' : 'warning'}
        />
        <KpiCard
          icon={TrendingDown}
          iconClass="text-emerald-500"
          label="После наших рекомендаций"
          primary={projectedLocalSharePct != null ? (projectedLocalSharePct / 100).toFixed(2) : '—'}
          lines={projectedLocalSharePct != null
            ? [
              `${fmtPct(projectedLocalSharePct)} локальных заказов`,
              projectedKtr != null ? `КТР ${projectedKtr.toFixed(2)} · ${ktrLabel(projectedKtr)}` : '',
            ].filter(Boolean)
            : ['нет плана перемещений']}
          tone="ok"
        />
        <KpiCard
          icon={Package}
          iconClass="text-sky-500"
          label="Артикулов"
          primary={fmtNum(o.articlesCount)}
          lines={['влияют на индекс']}
        />
        <KpiCard
          icon={ShoppingCart}
          iconClass="text-violet-500"
          label="Заказов"
          primary={fmtNum(o.orders)}
          lines={[`всего за ${weeks} полных недель`]}
        />
      </div>

      {/* Gradient scale */}
      <div className="rounded-2xl border border-border bg-card px-5 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Шкала индекса локализации
        </div>
        <div className="relative mt-3 h-3 rounded-full"
          style={{ background: 'linear-gradient(90deg,#ef4444 0%,#f59e0b 50%,#10b981 100%)' }}>
          <div className="absolute -top-1 h-5 w-1 -translate-x-1/2 rounded-full bg-foreground shadow"
            style={{ left: `${markerPct}%` }} />
          <div className="absolute -bottom-5 -translate-x-1/2 text-[11px] font-bold tabular-nums text-foreground"
            style={{ left: `${markerPct}%` }}>
            {(markerPct / 100).toFixed(2)}
          </div>
        </div>
        <div className="mt-6 flex justify-between text-[10.5px] text-muted-foreground">
          <span>0.00 (нет локальных)</span>
          <span>0.50</span>
          <span>1.00 (все локальные)</span>
        </div>
      </div>

      {/* Explanation */}
      <div className="rounded-2xl border border-border bg-muted/30 px-5 py-4 text-[12px] leading-relaxed text-muted-foreground">
        <div className="mb-1 text-[13px] font-semibold text-foreground">Что такое индекс локализации?</div>
        Индекс локализации в кабинете WB — это доля заказов, где товар находится рядом с покупателем.
        Значение 0.60 означает примерно 60% локальных заказов. Чем выше индекс — тем дешевле логистика:
        коэффициент КТР падает (при ≥60% доплаты нет, КТР = 1.00). Если у товара мало локальных заказов,
        КТР растёт и WB делает логистику дороже. Поднять индекс можно, перевезя ходовые размеры на склады
        тех округов, где есть спрос (раздел «Рекомендации по распределению»).
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-foreground">
            Товары, которые сильнее всего влияют на индекс
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по артикулу, бренду…"
            className="h-8 w-full max-w-xs rounded-md border border-border bg-card px-3 text-[12px] outline-none focus:border-emerald-400"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-[12px]">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Товар</th>
                <th className="px-3 py-2 text-right">Заказов</th>
                <th className="px-3 py-2 text-right">Локальных</th>
                <th className="px-3 py-2 text-right">Доля локальных</th>
                <th className="px-3 py-2 text-right">Как влияет на логистику</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.nmId} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {r.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.photoUrl} alt={r.vendorCode ?? ''} className="h-9 w-7 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="grid h-9 w-7 shrink-0 place-items-center rounded bg-muted text-[9px] text-muted-foreground">—</div>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-medium text-foreground">{r.vendorCode || `Артикул ${r.nmId}`}</div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          WB {r.nmId}{r.brand ? ` · ${r.brand}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtNum(r.orders)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtNum(r.localOrders)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtPct(r.localSharePct)}</td>
                  <td className="px-3 py-2 text-right">
                    <LogisticsBadge impactPct={r.logisticsImpactPct} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(data.rows.length > rows.length) ? (
          <div className="border-t border-border px-4 py-2 text-center text-[11px] text-muted-foreground">
            Показано {rows.length} из {fmtNum(data.rows.length)}. Сузь поиск, чтобы увидеть остальные.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ktrLabel(ktr: number): string {
  if (ktr > 1) return `надбавка ${Math.round((ktr - 1) * 100)}% по логистике`;
  if (ktr < 1) return `скидка ${Math.round((1 - ktr) * 100)}% на логистику`;
  return 'логистика в норме';
}

function LogisticsBadge({ impactPct }: { impactPct: number }) {
  if (impactPct <= 0) {
    const txt = impactPct < 0 ? `логистика дешевле на ${-impactPct}%` : 'логистика в норме';
    return (
      <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
        {txt}
      </span>
    );
  }
  const tone = impactPct >= 40
    ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
    : impactPct >= 20
      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${tone}`}>
      логистика дороже на {impactPct}%
    </span>
  );
}

function KpiCard({
  icon: Icon, iconClass, label, primary, lines, tone = 'default',
}: {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  primary: React.ReactNode;
  lines: string[];
  tone?: 'ok' | 'warning' | 'default';
}) {
  const border = tone === 'ok'
    ? 'border-emerald-500/40 bg-emerald-500/5'
    : tone === 'warning'
      ? 'border-amber-500/40 bg-amber-500/5'
      : 'border-border bg-card';
  return (
    <div className={`rounded-2xl border ${border} px-5 py-4 shadow-sm`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-4 w-4 ${iconClass}`} />
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-foreground">{primary}</div>
      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
        {lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}
