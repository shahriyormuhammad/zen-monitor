'use client';

import { useMemo, useState } from 'react';
import { Loader2, Palette, Search, X } from 'lucide-react';
import { toNumber } from '../helpers';
import type { UnitTemplateRow } from '../types';
import { buildVariantFamilyKey, normalizeFamilyToken } from './utils';

type VariantPickerModalProps = {
  sourceRow: UnitTemplateRow;
  rows: UnitTemplateRow[];
  isApplying: boolean;
  description?: string;
  onClose: () => void;
  onApply: (selectedNmIds: number[]) => void | Promise<void>;
};

const SELLER_ARTICLE_COLLATOR = new Intl.Collator('ru-RU', { numeric: true, sensitivity: 'base' });

/**
 * Modal that lists all SKUs from the same model family as `sourceRow`
 * (same vendorCode stem with color tokens stripped) and lets the user pick
 * a subset to copy current manualFields + costPrice into.
 *
 * Mirrors the legacy variant picker in UnitEconomicsTemplateTable.tsx
 * (state at lines ~1320-1593 + JSX at ~3669-3740).
 */
export function VariantPickerModal({
  sourceRow,
  rows,
  isApplying,
  description,
  onClose,
  onApply,
}: VariantPickerModalProps) {
  const sourceNmId = toNumber(sourceRow.nmId);
  const familyKey = useMemo(() => buildVariantFamilyKey(sourceRow), [sourceRow]);

  const options = useMemo(() => {
    if (!familyKey) return [];
    return rows
      .filter((item) => {
        const itemNmId = toNumber(item.nmId);
        return (
          itemNmId > 0 &&
          itemNmId !== sourceNmId &&
          buildVariantFamilyKey(item) === familyKey
        );
      })
      .map((item) => ({
        nmId: toNumber(item.nmId),
        vendorCode: typeof item.vendorCode === 'string' ? item.vendorCode.trim() : '',
      }))
      .sort((a, b) => {
        const sa = normalizeFamilyToken(a.vendorCode) || `nm-${a.nmId}`;
        const sb = normalizeFamilyToken(b.vendorCode) || `nm-${b.nmId}`;
        const cmp = SELLER_ARTICLE_COLLATOR.compare(sa, sb);
        return cmp !== 0 ? cmp : a.nmId - b.nmId;
      });
  }, [rows, sourceNmId, familyKey]);

  const [selectedDraft, setSelectedDraft] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const optionIdSet = useMemo(() => new Set(options.map((item) => item.nmId)), [options]);
  const selected = useMemo(
    () => selectedDraft.filter((nmId) => optionIdSet.has(nmId)),
    [selectedDraft, optionIdSet],
  );

  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) => (
      String(option.nmId).includes(q) ||
      option.vendorCode.toLowerCase().includes(q)
    ));
  }, [options, searchQuery]);

  const toggle = (nmId: number) => {
    setSelectedDraft((prev) => (prev.includes(nmId) ? prev.filter((id) => id !== nmId) : [...prev, nmId]));
  };

  const selectShown = () => setSelectedDraft((prev) => Array.from(new Set([...prev, ...filteredOptions.map((item) => item.nmId)])));
  const clearShown = () => {
    const shown = new Set(filteredOptions.map((item) => item.nmId));
    setSelectedDraft((prev) => prev.filter((nmId) => !shown.has(nmId)));
  };
  const clearAll = () => setSelectedDraft([]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/30 px-4 py-8"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isApplying) onClose();
      }}
    >
      <div className="relative w-full max-w-xl rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-foreground">В цвета модели</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto px-5 py-4">
          <p className="text-xs font-medium text-muted-foreground">
            SKU-источник: <span className="font-mono font-bold text-foreground">{sourceNmId}</span>.
            {' '}{description ?? 'Отметьте SKU той же модели, в которые скопировать ручные поля и себестоимость.'}
          </p>

          {options.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs font-semibold text-muted-foreground">
              В текущем списке не нашлось других SKU той же модели.
            </p>
          ) : (
            <>
              <label className="relative block text-muted-foreground">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Поиск по SKU или артикулу продавца"
                  className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm font-semibold text-foreground outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                />
              </label>

              <div className="flex flex-wrap items-center gap-2 border-y border-border py-2">
                <button
                  type="button"
                  onClick={selectShown}
                  disabled={isApplying || filteredOptions.length === 0}
                  className="rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
                >
                  Выбрать найденные ({filteredOptions.length})
                </button>
                <button
                  type="button"
                  onClick={clearShown}
                  disabled={isApplying || selected.length === 0 || filteredOptions.length === 0}
                  className="rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
                >
                  Снять найденные
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  disabled={isApplying || selected.length === 0}
                  className="rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
                >
                  Очистить
                </button>
                <span className="ml-auto text-[11px] font-semibold text-muted-foreground">
                  Выбрано: {selected.length}
                </span>
              </div>

              {filteredOptions.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs font-semibold text-muted-foreground">
                  Ничего не найдено.
                </p>
              ) : (
                <div className="space-y-1">
                  {filteredOptions.map((option) => {
                    const checked = selected.includes(option.nmId);
                    return (
                      <label
                        key={option.nmId}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                          checked ? 'border-emerald-500/40 bg-emerald-50 text-emerald-700' : 'border-border bg-card text-foreground hover:bg-muted/40'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(option.nmId)}
                          disabled={isApplying}
                          className="h-3.5 w-3.5 rounded border-border text-emerald-600 focus:ring-emerald-500/30"
                        />
                        <span className="font-mono">{option.nmId}</span>
                        {option.vendorCode ? (
                          <span className="truncate text-muted-foreground">{option.vendorCode}</span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isApplying}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void onApply(selected)}
            disabled={isApplying || selected.length === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isApplying ? 'Применяем...' : `Применить к ${selected.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}
