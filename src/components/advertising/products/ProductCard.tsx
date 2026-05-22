'use client';

import Image from 'next/image';

import { calcCampaignStatus } from '@/lib/advertising/math';
import { getTerm } from '@/lib/advertising/terms';

import { formatMoney, formatNumber, formatPercent } from '../_shared/format';
import type { AdvertisingProductReasonCode, AdvertisingSkuRow } from '../_shared/types';

type Props = {
  row: AdvertisingSkuRow;
  /** Коллбек при клике «Настроить автопилот» */
  onOpenWorkspace?: (nmId: number) => void;
};

const STATUS_CONFIG = {
  good: {
    dot: 'bg-emerald-500',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400',
    label: 'Норма',
  },
  warning: {
    dot: 'bg-amber-500',
    badge: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400',
    label: 'Внимание',
  },
  danger: {
    dot: 'bg-red-500',
    badge: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400',
    label: 'Проблема',
  },
} as const;

const PRODUCT_CHECK_CLASS = {
  fix: 'bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200',
  watch: 'bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
  ok: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200',
} as const;

const PRODUCT_CHECK_LABEL = {
  fix: 'Проверить товар',
  watch: 'Проверить при случае',
  ok: 'Карточка без явных рекламных проблем',
} as const;

const REASON_CLASS: Record<AdvertisingProductReasonCode, string> = {
  stock: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200',
  card_content: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
  seo: 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200',
  price: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  competitor: 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-200',
  semantic: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-200',
  bid_economics: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  traffic_quality: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  group_attribution: 'bg-slate-200 text-slate-800 dark:bg-slate-900 dark:text-slate-200',
};

export function ProductCard({ row, onOpenWorkspace }: Props) {
  const status = calcCampaignStatus({
    drrPct: row.acosPct,
    targetDrrPct: null,
    orders: row.clusterOrders,
    spendRub: row.adSpend,
    stockQty: null,
  });

  const cfg = STATUS_CONFIG[status];
  const drrTerm = getTerm('DRR');
  const autopilotTerm = getTerm('AUTOPILOT');
  const isGroupScope = row.attributionScope === 'group';
  const productCheck = row.productCheck;
  const shouldShowProductCheck = productCheck.status !== 'ok' && productCheck.reasons.length > 0;

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-800">
      {/* Шапка: фото + название + светофор */}
      <div className="flex items-center gap-3">
        <div className="relative h-[60px] w-[60px] flex-shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-700">
          {row.photoUrl ? (
            <Image
              src={row.photoUrl}
              alt={row.vendorCode ?? String(row.nmId)}
              fill
              sizes="60px"
              className="object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[9px] font-bold uppercase text-slate-400">ФОТО</div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate font-bold text-slate-900 dark:text-slate-100">
            {row.brand || 'Без бренда'}
          </p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {row.vendorCode ? `${row.vendorCode} · ` : ''}
            <span title={getTerm('NM_ID').tooltip}>nmId {row.nmId}</span>
          </p>
          {isGroupScope ? (
            <p
              className="mt-0.5 truncate text-[11px] font-semibold text-emerald-700 dark:text-emerald-400"
              title="Рекламная эффективность считается по всей склейке: расход по рекламируемым артикулам, продажи по всем артикулам склейки."
            >
              Склейка: {row.groupName ?? 'без названия'} · {row.groupNmCount} SKU
            </p>
          ) : null}
        </div>

        <span
          className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${cfg.badge}`}
          title={drrTerm.tooltip}
        >
          <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>

      {/* Метрики: расходы / заказы / ДРР */}
      <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-700/40">
        <div className="text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Расход</p>
          <p className="mt-0.5 text-sm font-extrabold text-slate-900 dark:text-slate-100">
            {formatMoney(row.adSpend)}
          </p>
          {isGroupScope && row.advertisedNmCount > 1 ? (
            <p className="mt-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              {row.advertisedNmCount} SKU
            </p>
          ) : null}
        </div>
        <div className="text-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Заказы</p>
          <p className="mt-0.5 text-sm font-extrabold text-slate-900 dark:text-slate-100">
            {formatNumber(row.clusterOrders)}
          </p>
        </div>
        <div className="text-center">
          <p
            className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
            title={drrTerm.tooltip}
          >
            {drrTerm.label}
          </p>
          <p className={`mt-0.5 text-sm font-extrabold ${
            status === 'danger' ? 'text-red-600' : status === 'warning' ? 'text-amber-600' : 'text-emerald-600'
          }`}>
            {row.acosPct !== null ? formatPercent(row.acosPct) : '—'}
          </p>
        </div>
      </div>

      {/* CPC / CTR вспомогательно */}
      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <span title={getTerm('CTR').tooltip}>
          {getTerm('CTR').label}: {row.ctrPct !== null ? formatPercent(row.ctrPct, 2) : '—'}
        </span>
        <span title={getTerm('CPC').tooltip}>
          {getTerm('CPC').label}: {row.cpc !== null ? formatMoney(row.cpc) : '—'}
        </span>
      </div>

      <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs dark:bg-slate-700/40">
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold text-slate-500 dark:text-slate-400">ЧП после рекламы</span>
          <span className={`font-black ${row.netProfit < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {formatMoney(row.netProfit)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 text-slate-500 dark:text-slate-400">
          <span>До рекламы {formatMoney(row.netProfitBeforeAds)}</span>
          <span>{row.profitMarginPct === null ? 'Маржа —' : `Маржа ${formatPercent(row.profitMarginPct)}`}</span>
        </div>
      </div>

      {shouldShowProductCheck ? (
        <div className={`rounded-xl px-3 py-2 text-xs ${PRODUCT_CHECK_CLASS[productCheck.status]}`}>
          <p className="font-black">{PRODUCT_CHECK_LABEL[productCheck.status]}</p>
          <p className="mt-1 font-semibold leading-5">{productCheck.reasons[0]}</p>
          {productCheck.checks.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {productCheck.checks.slice(0, 4).map((check) => (
                <span key={`${check.code}-${check.message}`} className={`rounded-full px-2 py-0.5 text-[10px] font-black ${REASON_CLASS[check.code]}`}>
                  {check.label}
                </span>
              ))}
            </div>
          ) : null}
          {productCheck.checklist.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {productCheck.checklist.slice(0, 4).map((item) => (
                <span key={item} className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black dark:bg-slate-900/50">
                  {item}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Кнопка Автопилот */}
      {onOpenWorkspace ? (
        <button
          type="button"
          onClick={() => onOpenWorkspace(row.nmId)}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-1.5 text-xs font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-600 dark:bg-slate-700/40 dark:text-slate-300 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400"
          title={autopilotTerm.tooltip}
        >
          {autopilotTerm.label} →
        </button>
      ) : null}
    </article>
  );
}
