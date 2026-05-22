'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, PackageOpen, EyeOff, BarChart3, Target, AlertTriangle, AlertCircle, Search } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { updateCostPrice } from '@/app/(dashboard)/economics/actions';
import { toggleProductVisibility } from '@/app/(dashboard)/settings/actions';

type ActiveSignal = {
  severity: 'critical' | 'high' | 'medium' | string;
};

type EconomicsRow = {
  nmId?: number | string;
  photoUrl?: string | null;
  brand?: string | null;
  vendorCode?: string;
  soldQuantity?: number | string;
  grossRevenue?: number | string;
  costPrice?: number | string;
  commission?: number | string;
  logistics?: number | string;
  totalCost?: number | string;
  adSpend?: number | string;
  views?: number | string;
  netProfit?: number | string;
  activeSignals?: ActiveSignal[];
};

type EconomicsTableRow = EconomicsRow & Record<string, unknown>;

export function EconomicsTable({
  data,
  onRefresh,
  focusNmId,
}: {
  data: EconomicsTableRow[];
  onRefresh?: () => void;
  focusNmId?: number | null;
}) {
  const { tenantId } = useStore();
  const [loadingCodes, setLoadingCodes] = useState<Record<number, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [draftCosts, setDraftCosts] = useState<Record<number, string>>({});
  const saveTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const calculateMargin = (r: EconomicsRow) => {
    const rev = Number(r.grossRevenue);
    if (!rev) return 0;
    return (Number(r.netProfit) / rev * 100);
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredData = useMemo(() => {
    if (!normalizedQuery) {
      return data;
    }

    return data.filter((row) => {
      const nmId = String(row.nmId ?? '').toLowerCase();
      const vendorCode = String(row.vendorCode ?? '').toLowerCase();
      const brand = String(row.brand ?? '').toLowerCase();

      return (
        nmId.includes(normalizedQuery)
        || vendorCode.includes(normalizedQuery)
        || brand.includes(normalizedQuery)
      );
    });
  }, [data, normalizedQuery]);

  const handleCostPriceSave = async (nmId: number, newValue: string) => {
    const cost = parseFloat(newValue);
    if (isNaN(cost) || !tenantId) return;

    setLoadingCodes((prev) => ({ ...prev, [nmId]: true }));
    try {
      await updateCostPrice(tenantId, nmId, cost);
      setDraftCosts((prev) => ({ ...prev, [nmId]: String(Math.round(cost)) }));
      onRefresh?.();
    } catch (err: unknown) {
      console.error(err);
      alert('Ошибка при сохранении себестоимости');
    } finally {
      setLoadingCodes((prev) => ({ ...prev, [nmId]: false }));
    }
  };

  const scheduleCostPriceSave = (nmId: number, value: string) => {
    setDraftCosts((prev) => ({ ...prev, [nmId]: value }));

    if (saveTimersRef.current[nmId]) {
      clearTimeout(saveTimersRef.current[nmId]);
    }

    saveTimersRef.current[nmId] = setTimeout(() => {
      void handleCostPriceSave(nmId, value);
      delete saveTimersRef.current[nmId];
    }, 450);
  };

  const flushCostPriceSave = (nmId: number, value: string) => {
    if (saveTimersRef.current[nmId]) {
      clearTimeout(saveTimersRef.current[nmId]);
      delete saveTimersRef.current[nmId];
    }
    void handleCostPriceSave(nmId, value);
  };

  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach((timerId) => clearTimeout(timerId));
      saveTimersRef.current = {};
    };
  }, []);

  const handleHideProduct = async (nmId: number) => {
    if (!tenantId) return;
    if (!confirm('Вы уверены, что хотите скрыть этот товар из аналитики?')) return;

    try {
      await toggleProductVisibility(tenantId, nmId, true);
      if (onRefresh) onRefresh();
    } catch {
      alert('Ошибка при скрытии товара');
    }
  };

  if (!data || data.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm rounded-2xl p-16 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400">
        <PackageOpen className="w-16 h-16 mb-4 text-emerald-200/60" />
        <p className="font-medium text-lg text-slate-600">Нет товаров для отображения</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-3xl border border-slate-200/60 dark:border-slate-700 shadow-[0_4px_25px_rgba(0,0,0,0.03)] overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/60 flex flex-col gap-3 md:flex-row md:items-center md:justify-between dark:bg-slate-800/30 dark:border-slate-700">
        <div className="relative w-full md:max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Поиск по артикулу, коду или бренду"
            className="w-full pl-9 pr-3 py-2.5 border border-slate-200 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 focus:outline-emerald-500 focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all dark:text-slate-300"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <div className="text-xs font-semibold text-slate-500 whitespace-nowrap">
            Показано: {filteredData.length} из {data.length}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left align-middle text-slate-800 dark:text-slate-300 whitespace-nowrap">
          <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-semibold uppercase text-xs dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-400">
            <tr>
              <th scope="col" className="py-5 px-6 font-semibold tracking-wider">Товар (SKU)</th>
              <th scope="col" className="py-5 px-6 font-semibold text-right">Продано</th>
              <th scope="col" className="py-5 px-6 font-semibold text-right">Выручка</th>
              <th scope="col" className="py-5 px-6 font-semibold text-right text-rose-500">Расходы WB</th>
              <th scope="col" className="py-5 px-6 font-semibold text-right text-rose-600">Реклама (Ads)</th>
              <th scope="col" className="py-5 px-6 font-semibold text-center">Воронка (CR%)</th>
              <th scope="col" className="py-5 px-6 font-semibold text-right">Себестоимость</th>
              <th scope="col" className="py-5 px-6 font-semibold text-center">ROI / Маржа</th>
              <th scope="col" className="py-5 px-6 text-right font-bold text-emerald-700 font-mono tracking-wider">Прибыль ₽</th>
              <th scope="col" className="py-5 px-6 font-semibold text-center">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/80">
            {filteredData.map((row) => {
               const margin = calculateMargin(row);
               const isGoodMargin = margin >= 15;
               const soldQuantity = Number(row.soldQuantity || 0);
               const nmId = Number(row.nmId || 0);
               const unitCost = Number(row.totalCost) / (soldQuantity || 1);
               const configuredCost = Number(row.costPrice);
               const inputCost = Number.isFinite(configuredCost) && configuredCost > 0 ? configuredCost : unitCost;
               const crPercent = Number(row.views) > 0 ? (soldQuantity / Number(row.views) * 100) : 0;

               return (
                 <tr
                   key={`${nmId}-${row.vendorCode ?? 'sku'}`}
                   className={`transition-colors group ${
                     focusNmId === nmId
                       ? 'bg-emerald-50/60 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-50/80 dark:bg-emerald-900/10 dark:ring-emerald-800/40 dark:hover:bg-emerald-900/20'
                       : 'hover:bg-slate-50/50 dark:hover:bg-slate-800/30'
                   }`}
                 >
                   <td className="py-4 px-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl overflow-hidden border border-slate-200/60 bg-slate-50 flex-shrink-0 relative shadow-sm flex items-center justify-center">
                           {row.photoUrl ? (
                              <Image
                                 src={row.photoUrl}
                                 alt=""
                                 fill
                                 sizes="48px"
                                 className="object-cover"
                                 referrerPolicy="no-referrer"
                              />
                           ) : <div className="text-slate-300 font-semibold text-[10px]">IMG</div>}
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 dark:text-slate-100 tracking-tight mb-0.5">{row.brand || 'Без бренда'}</div>
                          <div className="text-[11px] text-slate-400 font-mono font-medium tracking-wide flex items-center gap-2">
                            Арт: <span className="text-slate-500">{nmId}</span> • {row.vendorCode || 'Без кода'}
                            {row.activeSignals?.some((s) => s.severity === 'critical') && (
                               <span className="flex items-center gap-1 bg-rose-50 text-rose-600 px-2 py-0.5 rounded-full text-[9px] font-bold animate-pulse dark:bg-rose-900/20 dark:text-rose-400">
                                  <AlertCircle className="w-2.5 h-2.5" /> Крит. риск
                               </span>
                            )}
                            {row.activeSignals?.some((s) => s.severity === 'high') && (
                               <span className="flex items-center gap-1 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full text-[9px] font-bold dark:bg-amber-900/20 dark:text-amber-400">
                                  <AlertTriangle className="w-2.5 h-2.5" /> Высокий
                               </span>
                            )}
                          </div>
                        </div>
                      </div>
                   </td>
                   <td className="py-4 px-6 text-right font-bold text-slate-700">
                     {soldQuantity} <span className="text-[10px] uppercase font-normal text-slate-400">шт</span>
                   </td>
                   <td className="py-4 px-6 text-right text-emerald-600 font-bold">
                     {Number(row.grossRevenue).toLocaleString('ru-RU')} ₽
                   </td>
                   <td className="py-4 px-6 text-right text-rose-500/80 font-medium text-xs">
                     <span className="block">-{Number(row.commission).toLocaleString('ru-RU')} ₽ Ком.</span>
                     <span className="block mt-0.5">-{Number(row.logistics).toLocaleString('ru-RU')} ₽ Лог.</span>
                   </td>
                   <td className="py-4 px-6 text-right">
                      <div className="text-rose-600 font-bold flex items-center justify-end gap-1">
                        -{Number(row.adSpend).toLocaleString('ru-RU')}
                        <span className="text-[10px] text-slate-300">₽</span>
                      </div>
                      <div className="text-[10px] text-slate-400">АРМ Продвижение</div>
                   </td>
                   <td className="py-4 px-6 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex items-center gap-1 text-slate-500 text-[11px] font-medium">
                          <BarChart3 className="w-3 h-3" />
                          {Number(row.views).toLocaleString()}
                        </div>
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${crPercent > 3 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                          <Target className="w-2.5 h-2.5" />
                          {crPercent.toFixed(1)}% CR
                        </div>
                      </div>
                   </td>
                   <td className="py-4 px-6 text-right relative min-w-[130px]">
                      <div className="relative inline-flex items-center group-hover:shadow-sm transition-shadow rounded-lg">
                        <span className="absolute left-3 text-slate-400 font-bold text-xs select-none">₽</span>
                        <input
                           value={draftCosts[nmId] ?? (inputCost > 0 ? inputCost.toFixed(0) : '')}
                           placeholder="0"
                           className="w-24 pl-7 pr-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-700 focus:outline-emerald-500 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all font-mono font-medium hover:border-emerald-400 text-right dark:text-slate-300"
                           onChange={(e) => scheduleCostPriceSave(nmId, e.target.value)}
                           onBlur={(e) => flushCostPriceSave(nmId, e.target.value)}
                           onKeyDown={(e) => {
                             if (e.key === 'Enter') {
                               flushCostPriceSave(nmId, (e.target as HTMLInputElement).value);
                               (e.target as HTMLInputElement).blur();
                             }
                           }}
                        />
                        {loadingCodes[nmId] && (
                           <Loader2 className="w-4 h-4 absolute -right-6 text-emerald-500 animate-spin" />
                        )}
                      </div>
                   </td>
                   <td className="py-4 px-6 text-center">
                      <span className={`px-2.5 py-1 rounded-lg font-bold text-[11px] tracking-wide ${isGoodMargin ? 'bg-emerald-100/60 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-rose-100/60 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>
                        {margin.toFixed(1)}%
                      </span>
                   </td>
                   <td className={`py-4 px-6 font-bold text-right text-[15px] font-mono tracking-tight ${Number(row.netProfit) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                     {Number(row.netProfit).toLocaleString('ru-RU')} ₽
                   </td>
                   <td className="py-4 px-6 text-center">
                     <button
                        onClick={() => handleHideProduct(nmId)}
                        className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all dark:hover:bg-rose-900/20"
                        title="Скрыть товар"
                     >
                       <EyeOff className="w-4 h-4" />
                     </button>
                   </td>
                 </tr>
               );
            })}
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-10 text-center text-slate-500">
                  По запросу ничего не найдено. Попробуйте часть артикула или кода SKU.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
