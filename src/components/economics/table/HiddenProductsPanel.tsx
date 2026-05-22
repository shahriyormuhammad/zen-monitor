'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Loader2, RotateCcw, Search, X } from 'lucide-react';
import { getHiddenProducts } from '@/app/(dashboard)/economics/actions';

type HiddenProduct = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
};

const EMPTY_HIDDEN_PRODUCTS: HiddenProduct[] = [];

export function HiddenProductsPanel({
  tenantId,
  restoringNmId,
  onRestore,
  onRestoreMany,
  onClose,
}: {
  tenantId: string;
  restoringNmId: number | null;
  onRestore: (nmId: number) => Promise<void> | void;
  onRestoreMany?: (nmIds: number[]) => Promise<void> | void;
  onClose: () => void;
}) {
  const [hiddenState, setHiddenState] = useState<{
    tenantId: string | null;
    products: HiddenProduct[];
  }>({ tenantId: null, products: [] });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNmIds, setSelectedNmIds] = useState<number[]>([]);
  const [restoringMany, setRestoringMany] = useState(false);

  const loading = hiddenState.tenantId !== tenantId;
  const hiddenProducts = useMemo(
    () => (loading ? EMPTY_HIDDEN_PRODUCTS : hiddenState.products),
    [loading, hiddenState.products],
  );
  const selectedSet = useMemo(() => new Set(selectedNmIds), [selectedNmIds]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return hiddenProducts;
    return hiddenProducts.filter((product) => (
      String(product.nmId).includes(q) ||
      String(product.vendorCode ?? '').toLowerCase().includes(q) ||
      String(product.brand ?? '').toLowerCase().includes(q)
    ));
  }, [hiddenProducts, searchQuery]);

  const filteredNmIds = useMemo(
    () => filteredProducts.map((product) => product.nmId),
    [filteredProducts],
  );

  const selectedFilteredCount = useMemo(
    () => filteredNmIds.filter((nmId) => selectedSet.has(nmId)).length,
    [filteredNmIds, selectedSet],
  );

  useEffect(() => {
    let cancelled = false;
    getHiddenProducts(tenantId)
      .then((products) => {
        if (!cancelled) {
          setHiddenState({ tenantId, products });
        }
      })
      .catch(() => {
        if (!cancelled) setHiddenState({ tenantId, products: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    const availableNmIds = new Set(hiddenProducts.map((product) => product.nmId));
    setSelectedNmIds((prev) => {
      const next = prev.filter((nmId) => availableNmIds.has(nmId));
      return next.length === prev.length ? prev : next;
    });
  }, [hiddenProducts]);

  const handleRestore = async (nmId: number) => {
    await onRestore(nmId);
    setHiddenState((prev) => (
      prev.tenantId === tenantId
        ? { ...prev, products: prev.products.filter((p) => p.nmId !== nmId) }
        : prev
    ));
    setSelectedNmIds((prev) => prev.filter((id) => id !== nmId));
  };

  const toggleSelected = (nmId: number) => {
    setSelectedNmIds((prev) => (
      prev.includes(nmId)
        ? prev.filter((id) => id !== nmId)
        : [...prev, nmId]
    ));
  };

  const selectFiltered = () => {
    setSelectedNmIds((prev) => Array.from(new Set([...prev, ...filteredNmIds])));
  };

  const handleRestoreSelected = async () => {
    const availableNmIds = new Set(hiddenProducts.map((product) => product.nmId));
    const ids = selectedNmIds.filter((nmId) => availableNmIds.has(nmId));
    if (ids.length === 0 || restoringMany) return;

    setRestoringMany(true);
    try {
      if (onRestoreMany) {
        await onRestoreMany(ids);
      } else {
        for (const nmId of ids) {
          await onRestore(nmId);
        }
      }
      const restoredSet = new Set(ids);
      setHiddenState((prev) => (
        prev.tenantId === tenantId
          ? { ...prev, products: prev.products.filter((p) => !restoredSet.has(p.nmId)) }
          : prev
      ));
      setSelectedNmIds((prev) => prev.filter((nmId) => !restoredSet.has(nmId)));
    } finally {
      setRestoringMany(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-50 p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-amber-800">
          Скрытые артикулы ({loading ? '...' : hiddenProducts.length})
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
        >
          <X className="inline h-4 w-4" /> Закрыть
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-amber-700">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаю...
        </div>
      ) : hiddenProducts.length === 0 ? (
        <p className="text-sm text-amber-700">Нет скрытых артикулов</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[260px] flex-1 text-muted-foreground">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Поиск по артикулу, бренду, названию"
                className="h-10 w-full rounded-xl border border-amber-500/30 bg-card pl-9 pr-3 text-sm font-semibold text-foreground outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
              />
            </label>
            <button
              type="button"
              onClick={selectFiltered}
              disabled={filteredProducts.length === 0}
              className="h-10 rounded-xl border border-amber-500/30 bg-card px-3 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Выбрать найденные
            </button>
            <button
              type="button"
              onClick={() => setSelectedNmIds([])}
              disabled={selectedNmIds.length === 0}
              className="h-10 rounded-xl border border-amber-500/30 bg-card px-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Снять
            </button>
            <button
              type="button"
              onClick={() => void handleRestoreSelected()}
              disabled={selectedNmIds.length === 0 || restoringMany}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-100 px-3 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {restoringMany ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Вернуть выбранные ({selectedNmIds.length})
            </button>
            <span className="text-xs font-semibold text-amber-800/70">
              Найдено: {filteredProducts.length}, выбрано: {selectedFilteredCount}
            </span>
          </div>

          {filteredProducts.length === 0 ? (
            <div className="rounded-xl border border-amber-500/20 bg-card px-4 py-8 text-center text-sm font-semibold text-muted-foreground">
              Ничего не найдено
            </div>
          ) : (
            <div className="max-h-80 overflow-auto rounded-xl border border-amber-500/20 bg-card">
              {filteredProducts.map((product) => {
                const isSelected = selectedSet.has(product.nmId);
                const isRestoring = restoringNmId === product.nmId || restoringMany;
                return (
                  <div
                    key={product.nmId}
                    className="grid grid-cols-[32px_48px_minmax(100px,130px)_minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(product.nmId)}
                      className="h-4 w-4 rounded border-amber-500/40 text-emerald-600"
                      aria-label={`Выбрать SKU ${product.nmId}`}
                    />
                    <div className="h-10 w-10 overflow-hidden rounded-lg border border-border bg-muted">
                      {product.photoUrl ? (
                        <Image
                          src={product.photoUrl}
                          alt=""
                          width={40}
                          height={40}
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-muted-foreground/60">
                          IMG
                        </div>
                      )}
                    </div>
                    <div className="text-sm font-bold tabular-nums text-foreground">
                      {product.nmId}
                    </div>
                    <div className="min-w-0 truncate text-sm font-medium text-muted-foreground">
                      {product.vendorCode || '—'}
                      {product.brand ? (
                        <span className="ml-2 text-muted-foreground/60">{product.brand}</span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={isRestoring}
                      onClick={() => void handleRestore(product.nmId)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-100 px-2.5 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isRestoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      Вернуть
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
