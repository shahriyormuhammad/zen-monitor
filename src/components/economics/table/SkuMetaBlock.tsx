'use client';

import { formatText, toNumber } from '../helpers';
import { getTradeSchemeLabel } from '../constants';
import type { TradeScheme, UnitTemplateRow } from '../types';

type SkuMetaBlockProps = {
  row: UnitTemplateRow;
  tradeScheme: TradeScheme;
  onTradeSchemeChange: (next: TradeScheme) => void;
};

/**
 * Compact SKU metadata strip shown atop the warehouses detail panel.
 * Mirrors the legacy `renderSkuMetaBlock` (UnitEconomicsTemplateTable
 * lines ~2594-2647).
 */
export function SkuMetaBlock({ row, tradeScheme, onTradeSchemeChange }: SkuMetaBlockProps) {
  const wbArticle = toNumber(row.nmId) > 0 ? String(toNumber(row.nmId)) : '—';
  const brandValue = formatText(row.brand);
  const barcodeValue = formatText(row.barcode);
  const sellerArticleValue = formatText(row.vendorCode);

  const cardBaseClass = 'h-9 rounded-lg border px-2 border-border bg-muted/40';
  const labelClass = 'shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground';
  const valueClass = 'truncate text-[15px] font-semibold leading-none text-foreground';
  const monoValueClass = 'truncate font-mono text-[15px] font-semibold leading-none text-foreground';

  return (
    <div className="grid w-full max-w-[980px] gap-1 sm:grid-cols-2 xl:grid-cols-5">
      <div className={cardBaseClass}>
        <div className="flex h-full items-center gap-1.5">
          <span className={labelClass}>Бренд</span>
          <span className={valueClass}>{brandValue}</span>
        </div>
      </div>
      <div className={cardBaseClass}>
        <div className="flex h-full items-center gap-1.5">
          <span className={labelClass}>Артикул WB</span>
          <span className={monoValueClass}>{wbArticle}</span>
        </div>
      </div>
      <div className={cardBaseClass}>
        <div className="flex h-full items-center gap-1.5">
          <span className={labelClass}>ШК</span>
          <span className={monoValueClass}>{barcodeValue}</span>
        </div>
      </div>
      <div className={cardBaseClass}>
        <div className="flex h-full items-center gap-1.5">
          <span className={labelClass}>Арт. продавца</span>
          <span className={valueClass}>{sellerArticleValue}</span>
        </div>
      </div>
      <div className={cardBaseClass}>
        <div className="flex h-full items-center gap-2">
          <span className={labelClass}>Склад торговли</span>
          <select
            value={tradeScheme}
            onChange={(event) => onTradeSchemeChange(event.target.value as TradeScheme)}
            className="h-7 min-w-[164px] rounded-md border px-2 text-[12px] font-semibold outline-none border-border bg-card text-foreground focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
            title="Комиссия МП берётся из WB тарифов по выбранной схеме"
          >
            <option value="fbw">{getTradeSchemeLabel('fbw')}</option>
            <option value="fbs">{getTradeSchemeLabel('fbs')}</option>
          </select>
        </div>
      </div>
    </div>
  );
}
