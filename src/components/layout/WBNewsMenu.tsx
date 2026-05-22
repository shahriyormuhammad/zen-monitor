'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Newspaper } from 'lucide-react';
import { useStore } from '@/store/useStore';

type WBNewsItem = {
  id: string;
  title: string;
  content: string;
  date: string | null;
  types: string[];
};

type WBNewsResponse = {
  items: WBNewsItem[];
  fetchedAt: string;
  stale: boolean;
  source: string;
};

function formatNewsDate(value: string | null) {
  if (!value) {
    return 'Без даты';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Без даты';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function trimNewsContent(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

export function WBNewsMenu() {
  const { tenantId } = useStore();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { data, error, isFetching, isLoading } = useQuery<WBNewsResponse, Error>({
    queryKey: ['wb-news', tenantId],
    queryFn: async () => {
      const response = await fetch('/api/views/wb-news');
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Не удалось загрузить новости WB');
      }
      return response.json();
    },
    enabled: open && Boolean(tenantId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  if (!tenantId) {
    return null;
  }

  const items = data?.items ?? [];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="hidden h-8 shrink-0 items-center gap-2 rounded-xl border border-border bg-card px-2.5 text-xs font-black text-foreground shadow-xs transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800 dark:hover:border-sky-800 dark:hover:bg-sky-950/30 dark:hover:text-sky-200 lg:inline-flex"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {isFetching && open ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />
        ) : (
          <Newspaper className="h-3.5 w-3.5 text-sky-600" />
        )}
        Новости WB
      </button>

      {open ? (
        <div className="absolute right-0 top-10 z-40 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-[0_18px_60px_rgba(15,23,42,0.18)] dark:shadow-[0_18px_60px_rgba(0,0,0,0.36)]">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-black text-foreground">Новости портала WB</p>
                <p className="mt-0.5 text-[11px] font-semibold text-muted-foreground">
                  {data?.stale ? 'Показан кеш после лимита WB' : 'Официальный API WB'}
                </p>
              </div>
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-sky-700 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-200">
                WB
              </span>
            </div>
          </div>

          <div className="max-h-[28rem] overflow-y-auto p-3">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загружаю новости
              </div>
            ) : error ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error.message}</span>
                </div>
              </div>
            ) : items.length ? (
              <div className="space-y-2">
                {items.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-xl border border-border bg-card px-3 py-2.5 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="min-w-0 text-sm font-black leading-snug text-foreground">{item.title}</h3>
                      <span className="shrink-0 text-[10px] font-bold text-muted-foreground">{formatNewsDate(item.date)}</span>
                    </div>
                    {item.types.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.types.map((type) => (
                          <span
                            key={`${item.id}-${type}`}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {type}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {item.content ? (
                      <p className="mt-2 text-xs font-medium leading-relaxed text-muted-foreground">
                        {trimNewsContent(item.content)}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-sm font-bold text-muted-foreground">
                Новостей WB за период нет
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
