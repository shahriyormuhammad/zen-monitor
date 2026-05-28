'use client';

/**
 * Шаг 2: «Накладная» — порт Постал processInvoice.
 *
 * Bulk-ввод пар «артикул × коробок». Поддерживается:
 *   • Свободный ввод vendorCode — fuzzy-match по substring в обе стороны
 *     (`«519-5»` найдёт `«А519-5 ТН-10»`).
 *   • Сокращение `«-N»`: строка `«-5»` после `«А519-2»` читается как
 *     `«А519-5»` (база = префикс до последнего "-").
 *   • Кнопка Enter в поле «коробок» добавляет новую строку.
 *
 * После «Обработать» — каждая строка превращается в supplyItem с default
 * профилем ростовки (или с выбранным в селекте).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, Loader2, Plus, Trash2, X } from 'lucide-react';

import {
  listSupplyArticlesAction,
  processInvoiceAction,
  type InvoiceRowInput,
} from '@/app/(dashboard)/supply/actions';

type Article = Awaited<ReturnType<typeof listSupplyArticlesAction>>[number];

type Row = {
  id: string;
  article: string;
  boxes: string;
};

function makeId(): string {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Expand "-N" shorthand using the last non-shorthand article. */
function expandShorthand(rawRows: Row[]): { article: string; boxes: number; inputText: string; rowId: string }[] {
  let lastBase: string | null = null;
  const out: { article: string; boxes: number; inputText: string; rowId: string }[] = [];
  for (const r of rawRows) {
    const raw = r.article.trim();
    const boxes = Math.max(0, Number(r.boxes) || 0);
    if (!raw || boxes <= 0) continue;
    let article = raw;
    const cont = raw.match(/^-(\d+)$/);
    if (cont && lastBase) {
      article = `${lastBase}-${cont[1]}`;
    } else {
      // Base = letter(s) + 2-6 digits up to the first "-".
      const baseMatch = raw.match(/^([A-Za-zА-Яа-я]*\d{2,6})(?:-\d+)?/);
      if (baseMatch) lastBase = baseMatch[1]!;
    }
    out.push({ article, boxes, inputText: raw, rowId: r.id });
  }
  return out;
}

export function InvoiceTab({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();

  const articlesQuery = useQuery({
    queryKey: ['supply-articles', tenantId],
    queryFn: () => listSupplyArticlesAction(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });
  const articles = articlesQuery.data ?? [];

  const [rows, setRows] = useState<Row[]>([{ id: makeId(), article: '', boxes: '' }]);
  const lastRef = useRef<HTMLInputElement | null>(null);

  const expanded = useMemo(() => expandShorthand(rows), [rows]);

  const addRow = () => setRows((prev) => prev.concat({ id: makeId(), article: '', boxes: '' }));
  const updateRow = (id: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
  const removeRow = (id: string) =>
    setRows((prev) => prev.length > 1 ? prev.filter((r) => r.id !== id) : prev);
  const clearAll = () => setRows([{ id: makeId(), article: '', boxes: '' }]);

  useEffect(() => {
    if (lastRef.current) lastRef.current.focus();
  }, [rows.length]);

  const processMutation = useMutation({
    mutationFn: async () => {
      const inputs: InvoiceRowInput[] = expanded.map((r) => ({
        inputText: r.inputText,
        article: r.article,
        boxes: r.boxes,
      }));
      if (inputs.length === 0) throw new Error('Нет заполненных строк');
      return processInvoiceAction(tenantId, inputs);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supply-items', tenantId] });
    },
  });

  const handleBoxesKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addRow();
    }
  };

  return (
    <div className="space-y-4">
      <div className="dashboard-card p-4">
        <h3 className="text-[14px] font-extrabold">Накладная</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Вбей пары «артикул → коробок». Подсказки появляются по мере ввода. Часть кода тоже сработает: <code className="rounded bg-subtle px-1 font-mono">519-5</code> → <code className="rounded bg-subtle px-1 font-mono">A519-5 ТН-10</code>. Сокращение <code className="rounded bg-subtle px-1 font-mono">-5</code> после <code className="rounded bg-subtle px-1 font-mono">A519-2</code> = <code className="rounded bg-subtle px-1 font-mono">A519-5</code>. Enter в поле «Кор.» добавляет строку.
        </p>

        <div className="mt-3 flex max-w-[600px] flex-col gap-1">
          {rows.map((row, idx) => (
            <div key={row.id} className="grid items-center gap-1.5 grid-cols-[28px_minmax(0,1fr)_70px_28px]">
              <span className="text-[10px] font-bold text-muted-foreground">#{idx + 1}</span>
              <ArticleAutocomplete
                value={row.article}
                onChange={(v) => updateRow(row.id, { article: v })}
                articles={articles}
                placeholder="Артикул (или -N)"
              />
              <input
                ref={idx === rows.length - 1 ? lastRef : undefined}
                value={row.boxes}
                onChange={(e) => updateRow(row.id, { boxes: e.target.value.replace(/\D/g, '') })}
                onKeyDown={handleBoxesKey}
                placeholder="Кор."
                inputMode="numeric"
                className="h-7 w-full rounded-md border border-border bg-card px-2 text-right font-mono text-[12px] outline-none focus:border-rose-400"
              />
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                className="grid h-7 w-7 place-items-center rounded-md border border-border text-rose-500 hover:bg-rose-50 disabled:opacity-30 dark:hover:bg-rose-950/40"
                disabled={rows.length <= 1}
                title="Удалить строку"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={addRow}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-dashed border-border bg-subtle/40 px-2 text-[11px] font-bold text-muted-foreground hover:border-rose-400 hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> Строку
          </button>
          <button
            type="button"
            onClick={() => processMutation.mutate()}
            disabled={processMutation.isPending || expanded.length === 0}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-foreground px-3 text-[11px] font-bold text-card hover:bg-foreground/90 disabled:opacity-40"
          >
            {processMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
            Обработать
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-bold text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" /> Очистить
          </button>
          {expanded.length > 0 ? (
            <span className="ml-1 text-[10.5px] text-muted-foreground">
              К обработке: <strong>{expanded.length}</strong>
            </span>
          ) : null}
        </div>
      </div>

      {/* Results */}
      {processMutation.data ? (
        <div className="dashboard-card overflow-hidden">
          <header className="border-b border-border bg-subtle/30 px-5 py-3">
            <h3 className="text-[14px] font-extrabold">Результат обработки</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Добавлено в список поставки: <strong className="text-emerald-700 dark:text-emerald-300">{processMutation.data.added.length}</strong>{' · '}
              не найдено: <strong className="text-rose-600">{processMutation.data.failed.length}</strong>
            </p>
          </header>

          {processMutation.data.added.length > 0 ? (
            <div className="border-b border-border">
              <div className="px-5 py-2 text-[10.5px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                ✓ Успешно
              </div>
              <ul className="divide-y divide-border">
                {processMutation.data.added.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-baseline gap-2 px-5 py-2 text-[12px]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <strong>{item.vendorCode}</strong>
                    <span className="text-muted-foreground">{item.nmId ?? '—'}</span>
                    {item.profileName ? <span className="text-[11px] text-muted-foreground">· {item.profileName}</span> : null}
                    <span className="text-[11px] text-muted-foreground">· {item.boxes} кор · {item.totalPieces} шт</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {processMutation.data.failed.length > 0 ? (
            <div>
              <div className="px-5 py-2 text-[10.5px] font-black uppercase tracking-wider text-rose-600">
                ✗ Не найдено
              </div>
              <ul className="divide-y divide-border">
                {processMutation.data.failed.map((f, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-2 px-5 py-2 text-[12px]">
                    <X className="h-3.5 w-3.5 text-rose-500" />
                    <strong>{f.inputText}</strong>
                    <span className="text-muted-foreground">· {f.boxes} кор</span>
                    <span className="ml-auto text-[11px] text-rose-600">{f.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {processMutation.error ? (
        <div className="rounded-2xl border border-rose-300 bg-rose-50 p-4 text-[12px] text-rose-700 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-300">
          {processMutation.error instanceof Error ? processMutation.error.message : String(processMutation.error)}
        </div>
      ) : null}
    </div>
  );
}

/* ── ArticleAutocomplete ───────────────────────────────────
 * White-background dropdown with photo thumbnails. Filters
 * articles by substring match (case-insensitive, ignores
 * non-alphanumeric chars so "519-5" matches "А519-5 ТН-10").
 * Keyboard: ↑↓ navigate, Enter select, Esc close.
 */

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
}

function ArticleAutocomplete({
  value, onChange, articles, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  articles: Article[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(() => {
    const q = normalise(value);
    if (!q) return articles.slice(0, 30);
    const scored: { a: Article; idx: number }[] = [];
    for (const a of articles) {
      const norm = normalise(a.vendorCode);
      const idx = norm.indexOf(q);
      if (idx >= 0) {
        scored.push({ a, idx });
      } else if (q.includes(norm) && norm.length >= 3) {
        scored.push({ a, idx: 1000 });
      }
    }
    scored.sort((x, y) => x.idx - y.idx);
    return scored.slice(0, 30).map((x) => x.a);
  }, [articles, value]);

  useEffect(() => { setHover(0); }, [value]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const pick = (a: Article) => {
    onChange(a.vendorCode);
    setOpen(false);
    setTimeout(() => inputRef.current?.blur(), 0);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHover((h) => Math.min(h + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHover((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      if (matches[hover]) { e.preventDefault(); pick(matches[hover]); }
    }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder={placeholder}
        autoComplete="off"
        className="h-7 w-full rounded-md border border-border bg-card px-2 text-[12px] outline-none focus:border-rose-400"
      />
      {open && matches.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-border bg-white shadow-xl dark:bg-slate-900">
          {matches.map((a, i) => (
            <button
              key={a.nmId}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); pick(a); }}
              onMouseEnter={() => setHover(i)}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11.5px] ${
                i === hover ? 'bg-rose-50 dark:bg-rose-950/40' : 'bg-transparent'
              }`}
            >
              {a.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.photoUrl} alt={a.vendorCode}
                  className="h-8 w-6 shrink-0 rounded object-cover" />
              ) : (
                <div className="grid h-8 w-6 shrink-0 place-items-center rounded bg-subtle text-[9px] text-muted-foreground">—</div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold text-foreground">{a.vendorCode}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {a.brand ?? '—'}{a.category ? ` · ${a.category}` : ''}
                </div>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{a.nmId}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
