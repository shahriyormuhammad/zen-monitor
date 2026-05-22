'use client';

import { useMemo, useState } from 'react';
import { Columns3, ExternalLink, Search } from 'lucide-react';

type ProductSalesHighlightItem = {
  nmId: number;
  photoUrl: string | null;
  brand: string | null;
  vendorCode: string | null;
  soldQuantity: number;
  grossRevenue: number;
  netProfit: number;
  adSpend: number;
};

function formatRub(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function formatPercent(value: number) {
  return `${value.toFixed(2)} %`;
}

function productName(item: ProductSalesHighlightItem) {
  return item.brand || item.vendorCode || `NM ${item.nmId}`;
}

function marginPct(item: ProductSalesHighlightItem) {
  return item.grossRevenue > 0 ? (item.netProfit / item.grossRevenue) * 100 : 0;
}

function drrPct(item: ProductSalesHighlightItem) {
  return item.grossRevenue > 0 ? (item.adSpend / item.grossRevenue) * 100 : 0;
}

function ProductRow({ item }: { item: ProductSalesHighlightItem }) {
  const imageSrc = item.photoUrl?.trim() || null;
  const name = productName(item);
  const margin = marginPct(item);
  const drr = drrPct(item);
  const profitTone = item.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300';
  const marginTone = margin >= 15 ? 'text-emerald-600 dark:text-emerald-300' : margin >= 0 ? 'text-amber-600 dark:text-amber-300' : 'text-rose-600 dark:text-rose-300';

  return (
    <div className="grid min-w-[980px] grid-cols-[minmax(310px,1.7fr)_130px_100px_130px_110px_110px] items-center gap-4 border-b border-border px-4 py-3 text-sm last:border-b-0 hover:bg-subtle/65">
      <div className="flex min-w-0 items-center gap-3">
        <div className="h-14 w-11 shrink-0 overflow-hidden rounded-xl border border-border bg-subtle">
          {imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageSrc} alt={name} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[9px] font-black text-muted-foreground">
              IMG
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate font-black text-foreground">{name}</p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-muted-foreground">
            <span>Артикул: {item.nmId}</span>
            {item.vendorCode ? <span className="truncate">· {item.vendorCode}</span> : null}
            <a
              href={`https://www.wildberries.ru/catalog/${item.nmId}/detail.aspx`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-cyan-600 hover:text-cyan-500 dark:text-cyan-300"
              aria-label={`Открыть ${item.nmId} на Wildberries`}
            >
              WB
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      <div className="font-black text-foreground">{formatRub(item.grossRevenue)}</div>
      <div className="font-black text-foreground">{item.soldQuantity.toLocaleString('ru-RU')}</div>
      <div className={`font-black ${profitTone}`}>{formatRub(item.netProfit)}</div>
      <div className={`font-black ${marginTone}`}>{formatPercent(margin)}</div>
      <div className="font-black text-muted-foreground">{item.adSpend > 0 ? formatPercent(drr) : '—'}</div>
    </div>
  );
}

export function ProductSalesHighlights({
  topSelling,
  leastSelling,
}: {
  topSelling: ProductSalesHighlightItem[];
  leastSelling: ProductSalesHighlightItem[];
}) {
  const [query, setQuery] = useState('');

  const products = useMemo(() => {
    const byNmId = new Map<number, ProductSalesHighlightItem>();
    for (const item of [...topSelling, ...leastSelling]) {
      const current = byNmId.get(item.nmId);
      if (!current || item.grossRevenue > current.grossRevenue) {
        byNmId.set(item.nmId, item);
      }
    }

    return [...byNmId.values()].sort((a, b) => b.grossRevenue - a.grossRevenue || b.soldQuantity - a.soldQuantity);
  }, [topSelling, leastSelling]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return products;
    }

    return products.filter((item) => {
      const haystack = [
        item.nmId,
        item.brand,
        item.vendorCode,
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [products, query]);

  const totals = filteredProducts.reduce(
    (acc, item) => {
      acc.grossRevenue += item.grossRevenue;
      acc.soldQuantity += item.soldQuantity;
      acc.netProfit += item.netProfit;
      acc.adSpend += item.adSpend;
      return acc;
    },
    { grossRevenue: 0, soldQuantity: 0, netProfit: 0, adSpend: 0 },
  );
  const totalMargin = totals.grossRevenue > 0 ? (totals.netProfit / totals.grossRevenue) * 100 : 0;
  const totalDrr = totals.grossRevenue > 0 ? (totals.adSpend / totals.grossRevenue) * 100 : 0;

  return (
    <section className="dashboard-card overflow-hidden p-0">
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-muted-foreground">По товарам</h2>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-black text-amber-700 dark:text-amber-300">
              Сегодня: данные обновляются
            </span>
          </div>
          <p className="mt-2 text-xs font-semibold text-muted-foreground">
            Товаров: {filteredProducts.length.toLocaleString('ru-RU')}
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block min-w-0 sm:w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по артикулу, nmId, бренду..."
              className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm font-semibold text-foreground shadow-[var(--shadow-xs)] outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-cyan-500"
            />
          </label>
          <button
            type="button"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-black text-foreground shadow-[var(--shadow-xs)] transition-colors hover:border-border-strong hover:bg-accent"
            title="Колонки таблицы"
          >
            <Columns3 className="h-4 w-4" />
            Колонки 6
          </button>
        </div>
      </div>

      {products.length ? (
        <div className="overflow-x-auto">
          <div className="grid min-w-[980px] grid-cols-[minmax(310px,1.7fr)_130px_100px_130px_110px_110px] gap-4 border-b border-border bg-subtle/65 px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
            <div>Товар</div>
            <button type="button" className="text-left">Сумма заказов ↓</button>
            <button type="button" className="text-left">Заказы, шт</button>
            <button type="button" className="text-left">Прибыль</button>
            <button type="button" className="text-left">Марж.%</button>
            <button type="button" className="text-left">ДРР</button>
          </div>

          <div className="grid min-w-[980px] grid-cols-[minmax(310px,1.7fr)_130px_100px_130px_110px_110px] gap-4 border-b border-border bg-card px-4 py-3 text-sm">
            <div className="font-black text-muted-foreground">
              Сумма по выборке ({filteredProducts.length.toLocaleString('ru-RU')})
            </div>
            <div className="font-black text-foreground">{formatRub(totals.grossRevenue)}</div>
            <div className="font-black text-foreground">{totals.soldQuantity.toLocaleString('ru-RU')}</div>
            <div className="font-black text-foreground">{formatRub(totals.netProfit)}</div>
            <div className="font-black text-foreground">{formatPercent(totalMargin)}</div>
            <div className="font-black text-foreground">{totals.adSpend > 0 ? formatPercent(totalDrr) : '—'}</div>
          </div>

          {filteredProducts.length ? (
            <div className="max-h-[68vh] overflow-y-auto">
              {filteredProducts.map((item) => (
                <ProductRow key={item.nmId} item={item} />
              ))}
            </div>
          ) : (
            <div className="min-w-[980px] px-5 py-8 text-sm font-semibold text-muted-foreground">
              По такому запросу товары не найдены.
            </div>
          )}
        </div>
      ) : (
        <div className="px-5 py-5 text-sm font-medium text-muted-foreground">
          Нет данных по товарам в выбранном периоде.
        </div>
      )}
    </section>
  );
}
