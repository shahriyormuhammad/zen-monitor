'use client';

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { AdvertisingClusterListRow, SelectedCluster } from '../_shared/types';
import {
  formatMoney,
  formatMoneyPrecise,
  formatNumber,
  formatPercent,
} from '../_shared/format';
import { riskChip, riskLabel } from '../_shared/ui';

const COLUMNS = 'minmax(260px,2fr) minmax(160px,1.2fr) 120px 140px 140px 140px 80px 120px';
const ROW_HEIGHT = 96;
const VIRTUALIZATION_THRESHOLD = 50;

type Props = {
  rows: AdvertisingClusterListRow[];
  selected: SelectedCluster;
  onSelect: (row: { nmId: number; cluster: string }) => void;
};

export function ClusterTable({ rows, selected, onSelect }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const useVirtual = rows.length > VIRTUALIZATION_THRESHOLD;

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns functions; React Compiler can't memoize them, but this is safe here
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div
        role="row"
        className="grid items-center gap-0 bg-slate-50 px-3 py-2 text-left text-xs font-bold uppercase tracking-wider text-slate-500"
        style={{ gridTemplateColumns: COLUMNS }}
      >
        <span>Кластер</span>
        <span>SKU</span>
        <span>Расход</span>
        <span>Клики / Заказы</span>
        <span>CTR / CPC</span>
        <span>CVR / ДРР*</span>
        <span>Дней</span>
        <span>Управление</span>
      </div>

      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ height: useVirtual ? '70vh' : 'auto', overflowAnchor: 'none' }}
      >
        <div
          style={{
            height: useVirtual ? `${rowVirtualizer.getTotalSize()}px` : 'auto',
            position: 'relative',
          }}
        >
          {(useVirtual ? virtualItems : rows.map((_, index) => ({ index, start: index * ROW_HEIGHT, key: index }))).map(
            (virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              const isSelected =
                selected?.nmId === row.nmId && selected.cluster === row.cluster;
              return (
                <div
                  key={`${row.nmId}:${row.cluster}`}
                  data-index={virtualRow.index}
                  ref={useVirtual ? rowVirtualizer.measureElement : undefined}
                  role="row"
                  className={`grid items-start gap-0 border-t border-slate-100 px-3 py-2 text-sm ${
                    isSelected ? 'bg-emerald-50/40' : ''
                  }`}
                  style={
                    useVirtual
                      ? {
                          gridTemplateColumns: COLUMNS,
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }
                      : { gridTemplateColumns: COLUMNS }
                  }
                >
                  <div className="pr-2">
                    <div className="max-w-[320px]">
                      <p className="truncate font-semibold text-slate-900">{row.cluster}</p>
                      <p className="mt-1 text-xs text-slate-500">nmId {row.nmId}</p>
                    </div>
                    <div className="mt-1">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${riskChip(row.riskLevel)}`}
                      >
                        {riskLabel(row.riskLevel)}
                      </span>
                    </div>
                    {row.riskReason ? (
                      <p className="mt-1 text-xs text-slate-500">{row.riskReason}</p>
                    ) : null}
                  </div>
                  <div className="pr-2 text-slate-700">
                    <p className="font-semibold">{row.vendorCode || '—'}</p>
                    <p className="text-xs text-slate-500">{row.brand || 'Без бренда'}</p>
                  </div>
                  <div className="pr-2 font-semibold text-slate-900">{formatMoney(row.adSpend)}</div>
                  <div className="pr-2 text-slate-700">
                    {formatNumber(row.clicks)} / {formatNumber(row.orders)}
                  </div>
                  <div className="pr-2 text-slate-700">
                    {formatPercent(row.ctrPct, 2)} / {formatMoneyPrecise(row.cpc, 2)}
                  </div>
                  <div className="pr-2 text-slate-700">
                    {formatPercent(row.orderRatePct, 2)} / {formatPercent(row.acosProxyPct, 1)}
                  </div>
                  <div className="pr-2 text-slate-700">{formatNumber(row.activeDays)}</div>
                  <div>
                    <button
                      type="button"
                      onClick={() => onSelect({ nmId: row.nmId, cluster: row.cluster })}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        isSelected
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      Открыть
                    </button>
                  </div>
                </div>
              );
            },
          )}
        </div>
      </div>
    </section>
  );
}
