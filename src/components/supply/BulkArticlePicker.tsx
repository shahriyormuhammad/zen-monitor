'use client';

/**
 * Массовое добавление артикулов в поставку галочками (п.2). Отмечаешь нужные
 * артикулы, задаёшь кол-во коробок по умолчанию — добавляются пачкой с
 * ростовкой по умолчанию (через processInvoiceAction). Кол-во потом правится
 * в списке поставки. Используется в Шаг 1 (Создать) и Шаг 2 (Накладная).
 */

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckSquare, Loader2, Plus, Square } from 'lucide-react';

import { processInvoiceAction } from '@/app/(dashboard)/supply/actions';

type Article = { nmId: number; vendorCode: string; brand: string | null; category: string | null; photoUrl: string | null };

const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]/gi, '');

export function BulkArticlePicker({
  tenantId, articles, onAdded,
}: {
  tenantId: string;
  articles: Article[];
  onAdded: () => void;
}) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [defaultBoxes, setDefaultBoxes] = useState('1');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const filtered = useMemo(() => {
    const q = norm(search);
    const list = q
      ? articles.filter((a) => norm(a.vendorCode).includes(q) || (a.brand ? norm(a.brand).includes(q) : false))
      : articles;
    return list.slice(0, 300);
  }, [articles, search]);

  const toggle = (nmId: number) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(nmId)) next.delete(nmId); else next.add(nmId);
    return next;
  });
  const allOn = filtered.length > 0 && filtered.every((a) => selected.has(a.nmId));
  const toggleAll = () => setSelected((prev) => {
    const next = new Set(prev);
    if (allOn) filtered.forEach((a) => next.delete(a.nmId));
    else filtered.forEach((a) => next.add(a.nmId));
    return next;
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const boxes = Math.max(1, Number(defaultBoxes) || 1);
      const rows = articles
        .filter((a) => selected.has(a.nmId))
        .map((a) => ({ inputText: a.vendorCode, article: a.vendorCode, boxes }));
      if (rows.length === 0) throw new Error('Не выбран ни один артикул');
      return processInvoiceAction(tenantId, rows);
    },
    onSuccess: (res) => {
      const failNote = res.failed.length > 0
        ? ` · не добавлено: ${res.failed.length} (${res.failed.slice(0, 3).map((f) => `${f.article} — ${f.reason}`).join('; ')})`
        : '';
      setMsg({ tone: res.failed.length > 0 ? 'err' : 'ok', text: `Добавлено: ${res.added.length}${failNote}` });
      setSelected(new Set());
      onAdded();
    },
    onError: (e) => setMsg({ tone: 'err', text: e instanceof Error ? e.message : String(e) }),
  });

  return (
    <div className="dashboard-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-[13px] font-extrabold">Массовое добавление — галочками</h4>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            коробок:
            <input
              type="number" min={1} value={defaultBoxes}
              onChange={(e) => setDefaultBoxes(e.target.value)}
              className="h-8 w-16 rounded-md border border-border bg-card px-2 text-right font-mono text-[12px] outline-none focus:border-rose-400"
            />
          </label>
          <button
            type="button"
            onClick={() => addMutation.mutate()}
            disabled={addMutation.isPending || selected.size === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-[12px] font-bold text-card hover:bg-foreground/90 disabled:opacity-40"
          >
            {addMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-4 w-4" />}
            Добавить выбранные ({selected.size})
          </button>
        </div>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Отметь артикулы галочками — добавятся с ростовкой по умолчанию и этим кол-вом коробок. Кол-во потом можно поправить прямо в списке.
      </p>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Поиск по артикулу / бренду…"
        className="mt-3 h-9 w-full rounded-lg border border-border bg-card px-3 text-[12px] outline-none focus:border-rose-400"
      />

      <div className="mt-2 flex items-center justify-between">
        <button type="button" onClick={toggleAll} className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-700">
          {allOn ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          {allOn ? 'снять все' : 'выбрать все'} ({filtered.length})
        </button>
        {msg ? <span className={`text-[11px] ${msg.tone === 'ok' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600'}`}>{msg.text}</span> : null}
      </div>

      <div className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {filtered.map((a) => {
          const on = selected.has(a.nmId);
          return (
            <button
              key={a.nmId}
              type="button"
              onClick={() => toggle(a.nmId)}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11.5px] ${on ? 'bg-rose-50 dark:bg-rose-950/30' : ''}`}
            >
              {on ? <CheckSquare className="h-4 w-4 shrink-0 text-rose-600" /> : <Square className="h-4 w-4 shrink-0 text-muted-foreground" />}
              {a.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.photoUrl} alt="" className="h-7 w-5 shrink-0 rounded object-cover" />
              ) : (
                <div className="h-7 w-5 shrink-0 rounded bg-subtle" />
              )}
              <span className="min-w-0 flex-1 truncate font-bold text-foreground">{a.vendorCode}</span>
              <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">{a.brand ?? ''}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{a.nmId}</span>
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">Ничего не найдено</div>
        ) : null}
      </div>
    </div>
  );
}
