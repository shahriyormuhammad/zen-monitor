'use client';

/**
 * Шаг 3: «ШК коробов» — порт Постал generateShk + downloadShk.
 *
 *   1. Читаем accumulated supplyList → суммарное число коробов.
 *   2. Пользователь вводит первый ШК короба формата `WB_<digits>`.
 *   3. Сервер генерирует последовательные ШК через BigInt, привязывает
 *      содержимое каждой коробки (по баркодам ростовки).
 *   4. XLSX-экспорт: [Баркод товара, Кол-во товаров, ШК короба, Срок годности].
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, Loader2, QrCode } from 'lucide-react';

import {
  buildShkXlsxAction, listSupplyItemsAction,
} from '@/app/(dashboard)/supply/actions';

function fmtNum(n: number): string { return Math.round(n).toLocaleString('ru-RU'); }

export function BarcodesTab({ tenantId }: { tenantId: string }) {
  const itemsQuery = useQuery({
    queryKey: ['supply-items', tenantId],
    queryFn: () => listSupplyItemsAction(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 5_000,
  });
  const items = itemsQuery.data ?? [];

  const totalBoxes = useMemo(() => items.reduce((s, i) => s + i.boxes, 0), [items]);
  const hasMissingBc = useMemo(() => items.some((i) => i.missingBc > 0), [items]);

  const [firstShk, setFirstShk] = useState('');
  const [boxCount, setBoxCount] = useState<string>('');

  // Auto-fill box count when items load.
  useMemo(() => {
    if (!boxCount && totalBoxes > 0) setBoxCount(String(totalBoxes));
  }, [totalBoxes]); // eslint-disable-line react-hooks/exhaustive-deps

  const generateMutation = useMutation({
    mutationFn: () => buildShkXlsxAction(tenantId, {
      firstShk: firstShk.trim(),
      boxCount: Number(boxCount) || 0,
    }),
    onSuccess: (result) => {
      const bin = atob(result.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });

  if (itemsQuery.isLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-rose-500" /></div>;
  }

  if (items.length === 0) {
    return (
      <div className="dashboard-card p-8">
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
          <QrCode className="h-12 w-12 text-rose-500/70" />
          <h3 className="text-[15px] font-extrabold">Сначала собери поставку</h3>
          <p className="text-[12px] text-muted-foreground">
            Список поставки пуст. Добавь товары через <strong>Шаг 1: Создать</strong> или <strong>Шаг 2: Накладная</strong>, а потом возвращайся сюда сгенерировать ШК коробов.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="dashboard-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-extrabold">ШК коробов</h3>
            <p className="mt-0.5 max-w-xl text-[12px] text-muted-foreground">
              Скопируй первый ШК короба из кабинета WB (раздел «Поставки → твоя поставка → список коробов»). Система сгенерирует последовательные ШК и привяжет содержимое каждой коробки.
            </p>
          </div>
        </div>

        {hasMissingBc ? (
          <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-3 text-[12px] text-rose-700 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-300">
            ⚠ В списке поставки есть строки без штрихкодов. Сначала синхронизируй размеры с WB в Настройках → Ростовки, потом пересоздай профили.
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Первый ШК короба</span>
            <input
              value={firstShk}
              onChange={(e) => setFirstShk(e.target.value)}
              placeholder="WB_1572120887"
              className="h-9 w-full rounded-lg border border-border bg-card px-3 font-mono text-[12px] outline-none focus:border-rose-400"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Кол-во коробов</span>
            <input
              type="number"
              min={1}
              value={boxCount}
              onChange={(e) => setBoxCount(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-right font-mono text-[12px] outline-none focus:border-rose-400"
            />
          </label>
          <button
            type="button"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !firstShk.trim() || hasMissingBc}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[12px] font-bold text-card hover:bg-foreground/90 disabled:opacity-40"
          >
            {generateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Сгенерировать и скачать XLSX
          </button>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Metric label="Артикулов" value={fmtNum(items.length)} />
          <Metric label="Коробок (всего)" value={fmtNum(totalBoxes)} />
          <Metric label="Штук (всего)" value={fmtNum(items.reduce((s, i) => s + i.totalPieces, 0))} />
        </div>
      </div>

      {generateMutation.error ? (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-[12px] text-rose-700 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-300">
          {generateMutation.error instanceof Error ? generateMutation.error.message : String(generateMutation.error)}
        </div>
      ) : null}

      {generateMutation.data ? (
        <div className="dashboard-card overflow-hidden">
          <header className="flex items-center gap-2 border-b border-border bg-emerald-50 px-5 py-3 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-[12px] font-bold">
              Готово: {generateMutation.data.preview.length} коробов сгенерировано, файл скачан
            </span>
          </header>
          <div className="max-h-96 overflow-auto px-2 py-2">
            <table className="w-full text-[11px]">
              <thead className="bg-subtle/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">ШК короба</th>
                  <th className="px-2 py-1.5">Артикул</th>
                  <th className="px-2 py-1.5">Профиль</th>
                  <th className="px-2 py-1.5">Содержимое</th>
                  <th className="px-2 py-1.5 text-right">Пар</th>
                </tr>
              </thead>
              <tbody>
                {generateMutation.data.preview.slice(0, 200).map((box) => (
                  <tr key={box.shkCode} className="border-t border-border">
                    <td className="px-2 py-1.5 font-mono text-foreground">{box.shkCode}</td>
                    <td className="px-2 py-1.5">{box.articleVc}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">{box.profileName ?? '—'}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-1 font-mono">
                        {box.contentDetail.map((d) => (
                          <span key={d.size} className="rounded bg-subtle px-1.5 py-0.5">
                            {d.size}×{d.qty}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{box.sumPerBox}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {generateMutation.data.preview.length > 200 ? (
              <div className="pt-2 text-center text-[11px] text-muted-foreground">
                Показано 200 из {generateMutation.data.preview.length}. Полный список — в скачанном XLSX.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-subtle/40 p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-[18px] font-extrabold text-foreground">{value}</div>
    </div>
  );
}
