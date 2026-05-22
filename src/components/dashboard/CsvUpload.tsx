'use client';

import { useState } from 'react';
import { Upload, X, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
import Papa from 'papaparse';
import { bulkUpsertCosts } from '@/app/(dashboard)/settings/bulk-actions';
import { useStore } from '@/store/useStore';

type CsvRow = Record<string, string | undefined>;

type CostImportItem = {
  nmId: number;
  costPrice: number;
  effectiveFrom?: string;
};

export function CsvUpload() {
  const { tenantId } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'uploading' | 'success' | 'error'>('idle');
  const [errorCount, setErrorCount] = useState(0);
  const [successCount, setSuccessCount] = useState(0);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId) return;

    setStatus('parsing');

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const validItems: CostImportItem[] = [];
        let errors = 0;

        results.data.forEach((row) => {
          const nmIdRaw = row.nmId || row['Артикул WB'] || row.nm_id || '';
          const priceRaw = row.costPrice || row['Себестоимость'] || row.cost_price || '';
          const nmId = parseInt(nmIdRaw, 10);
          const price = parseFloat(priceRaw);

          if (!isNaN(nmId) && !isNaN(price)) {
            validItems.push({
              nmId,
              costPrice: price,
              effectiveFrom: row.effectiveFrom || row['Дата'] || undefined
            });
          } else {
            errors++;
          }
        });

        if (validItems.length > 0) {
          setStatus('uploading');
          const res = await bulkUpsertCosts(tenantId, validItems);
          if (res.success) {
            setSuccessCount(validItems.length);
            setErrorCount(errors);
            setStatus('success');
            setTimeout(() => {
              setIsOpen(false);
                setStatus('idle');
            }, 3000);
          } else {
            setStatus('error');
          }
        } else {
          setStatus('error');
        }
      },
      error: () => setStatus('error')
    });
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-all active:scale-95"
      >
        <Upload className="w-4 h-4" />
        Импорт CSV
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-800 w-full max-w-md rounded-[2.5rem] shadow-2xl border border-slate-200/60 dark:border-slate-700 p-8 space-y-6 relative overflow-hidden">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>

            <div className="flex items-center gap-4">
              <div className="p-3 bg-blue-50 rounded-2xl text-blue-600 border border-blue-100/50 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800/40">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xl tracking-tight">Массовый Импорт</h3>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider leading-relaxed">Обновление себестоимости</p>
              </div>
            </div>

            <div className="p-6 border-2 border-dashed border-slate-100 rounded-3xl bg-slate-50/50 flex flex-col items-center justify-center gap-4 text-center dark:border-slate-700 dark:bg-slate-800/30">
              {status === 'idle' && (
                <>
                  <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-2xl shadow-sm flex items-center justify-center text-slate-400 dark:text-slate-500 border border-slate-100 dark:border-slate-700">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-700">Выберите CSV файл</p>
                    <p className="text-[10px] text-slate-400 font-medium px-4">Формат: nmId, costPrice, effectiveFrom (опц.)</p>
                  </div>
                  <label className="cursor-pointer px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs shadow-lg shadow-blue-600/20 transition-all">
                    Выбрать файл
                    <input type="file" accept=".csv" onChange={handleFileUpload} className="hidden" />
                  </label>
                </>
              )}

              {status === 'parsing' && <p className="text-sm font-bold text-blue-600 animate-pulse">Парсинг файла...</p>}
              {status === 'uploading' && <p className="text-sm font-bold text-blue-600 animate-pulse">Сохранение в базу...</p>}

              {status === 'success' && (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="w-12 h-12 text-emerald-500" />
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Готово!</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                    {successCount} SKU обновлено / {errorCount} ошибок
                  </p>
                </div>
              )}

              {status === 'error' && (
                <div className="flex flex-col items-center gap-2 text-rose-500">
                  <AlertCircle className="w-12 h-12" />
                  <p className="text-sm font-bold">Ошибка импорта</p>
                  <p className="text-[10px] uppercase font-bold tracking-widest">Проверьте формат файла</p>
                  <button onClick={() => setStatus('idle')} className="mt-2 text-xs font-bold underline">Попробовать снова</button>
                </div>
              )}
            </div>

            <div className="bg-amber-50/50 border border-amber-100 p-4 rounded-2xl space-y-2 dark:bg-amber-900/10 dark:border-amber-800/40">
               <h4 className="text-[10px] font-bold text-amber-700 uppercase flex items-center gap-2">
                  <AlertCircle className="w-3 h-3" />
                  Важно
               </h4>
               <p className="text-[10px] text-amber-600 leading-relaxed font-medium italic">
                  Система автоматически определит колонки &quot;nmId&quot; и &quot;costPrice&quot;. Вы можете использовать русские заголовки &quot;Артикул WB&quot; и &quot;Себестоимость&quot;.
               </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
