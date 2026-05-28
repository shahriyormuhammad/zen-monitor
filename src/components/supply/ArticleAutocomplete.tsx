'use client';

/**
 * Article autocomplete dropdown shared by every Поставка form.
 *
 *   • White (or dark-mode-aware) popover anchored to the input.
 *   • Each row: photo thumbnail + bold vendorCode + brand·category +
 *     nmId aligned right.
 *   • Filter mirrors the server matcher: case-insensitive substring on
 *     a normalised (alphanumeric-only) form, so "519-5" finds
 *     "А519-5 ТН-10". Prefix matches are sorted first.
 *   • Keyboard: ↑↓ navigate, Enter selects, Esc closes, click outside
 *     closes. mousedown picks before blur so the value sticks.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export type AutocompleteArticle = {
  nmId: number;
  vendorCode: string;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-zа-я0-9]/gi, '');
}

export function ArticleAutocomplete({
  value, onChange, articles, placeholder, className,
}: {
  value: string;
  onChange: (v: string) => void;
  articles: AutocompleteArticle[];
  placeholder?: string;
  /** Tailwind classes for the input element. Default uses h-7 compact size. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(() => {
    const q = normalise(value);
    if (!q) return articles.slice(0, 30);
    const scored: { a: AutocompleteArticle; idx: number }[] = [];
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

  const pick = (a: AutocompleteArticle) => {
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
        className={className ?? 'h-7 w-full rounded-md border border-border bg-card px-2 text-[12px] outline-none focus:border-rose-400'}
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
