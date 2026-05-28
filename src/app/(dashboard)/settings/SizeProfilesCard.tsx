'use client';

/**
 * Settings card: «Ростовки» — direct port of Postal's panel-setup Ростовки.
 *
 * Behaviour:
 *   - On mount, the server materialises default + template-split profiles
 *     for every synced article that has order history. The user doesn't
 *     have to click anything for them to appear.
 *   - Each article row shows its profiles (default first, isDefault pill)
 *     plus a "+ Профиль" button for manual extras.
 *   - The modal offers the 4 built-in templates (41-46, 41-45, 37-41,
 *     36-41) as quick-fill chips.
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, ChevronDown, ChevronUp, Loader2, Pencil,
  Plus, Search, Sparkles, Star, Trash2, X,
} from 'lucide-react';

import { useStore } from '@/store/useStore';
import {
  deleteSizeProfileAction,
  detectArticleSizesAction,
  loadSizeProfilesSnapshot,
  setSizeProfileDefaultAction,
  upsertSizeProfileAction,
  type SizeProfilesSnapshot,
} from './size-profiles-actions';
import type { SizeProfile } from '@/server/size-profiles/service';
import type { SizeProfileSize } from '@/lib/db/schema';
import {
  SIZE_TEMPLATES,
  buildSizesFromTemplate,
  describeRange,
  isWideSizeRange,
  shortRange,
  type SizeTemplate,
} from '@/server/size-profiles/templates';

type ArticleEntry = SizeProfilesSnapshot['articles'][number];

export function SizeProfilesCard() {
  const { tenantId } = useStore();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [editorState, setEditorState] = useState<{
    mode: 'create' | 'edit';
    article: ArticleEntry;
    profile?: SizeProfile;
  } | null>(null);

  const snapshotQuery = useQuery({
    queryKey: ['size-profiles-snapshot', tenantId],
    queryFn: () => loadSizeProfilesSnapshot(tenantId!),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  const articles = snapshotQuery.data?.articles ?? [];
  const profiles = snapshotQuery.data?.profiles ?? [];
  const ensured = snapshotQuery.data?.ensured;

  const profilesByNmId = useMemo(() => {
    const map = new Map<number, SizeProfile[]>();
    for (const p of profiles) {
      const arr = map.get(p.nmId) ?? [];
      arr.push(p);
      map.set(p.nmId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
    }
    return map;
  }, [profiles]);

  const filteredArticles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return articles;
    return articles.filter((a) =>
      a.vendorCode.toLowerCase().includes(q)
      || String(a.nmId).includes(q)
      || (a.brand && a.brand.toLowerCase().includes(q))
      || (a.category && a.category.toLowerCase().includes(q))
    );
  }, [articles, search]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error('Не выбран кабинет');
      await deleteSizeProfileAction(tenantId, id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['size-profiles-snapshot', tenantId] }),
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!tenantId) throw new Error('Не выбран кабинет');
      await setSizeProfileDefaultAction(tenantId, id);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['size-profiles-snapshot', tenantId] }),
  });

  if (!tenantId) return null;

  const summarySuffix = ensured && ensured.profilesCreated > 0
    ? ` · авто-создано ${ensured.profilesCreated} ${plural(ensured.profilesCreated, 'профиль', 'профиля', 'профилей')}`
    : '';

  return (
    <section className="rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-xs)]">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-extrabold">Ростовки</h3>
          <p className="mt-0.5 max-w-xl text-[12px] text-muted-foreground">
            Профили «размер × штук в коробке» для каждого артикула. Широкие ряды (например 37-45) автоматически
            разбиваются на отдельные ростовки «37-41» и «41-45» — как в Постал{summarySuffix}.
          </p>
        </div>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по vendorCode, nmId, бренду…"
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-[12px] outline-none focus:border-rose-400"
          />
        </div>
      </header>

      {snapshotQuery.isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-rose-500" />
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-subtle/40 p-8 text-center text-[12px] text-muted-foreground">
          Пока нет товаров. Подключи кабинет WB в блоке выше и дождись синхронизации — каждая карточка получит свой профиль ростовки.
        </div>
      ) : filteredArticles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-6 text-center text-[12px] text-muted-foreground">
          По запросу «{search}» ничего не найдено.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredArticles.slice(0, 200).map((article) => (
            <ArticleRow
              key={article.nmId}
              article={article}
              profiles={profilesByNmId.get(article.nmId) ?? []}
              onCreate={() => setEditorState({ mode: 'create', article })}
              onEdit={(profile) => setEditorState({ mode: 'edit', article, profile })}
              onDelete={(id) => {
                if (window.confirm('Удалить этот профиль?')) deleteMutation.mutate(id);
              }}
              onSetDefault={(id) => setDefaultMutation.mutate(id)}
            />
          ))}
          {filteredArticles.length > 200 ? (
            <div className="pt-2 text-center text-[11px] text-muted-foreground">
              Показано 200 из {filteredArticles.length}. Используй поиск, чтобы сузить список.
            </div>
          ) : null}
        </div>
      )}

      {editorState ? (
        <ProfileEditorModal
          mode={editorState.mode}
          article={editorState.article}
          profile={editorState.profile}
          onClose={() => setEditorState(null)}
          onSaved={() => {
            setEditorState(null);
            queryClient.invalidateQueries({ queryKey: ['size-profiles-snapshot', tenantId] });
          }}
        />
      ) : null}
    </section>
  );
}

/* ── Article row ───────────────────────────────── */

function ArticleRow({
  article, profiles, onCreate, onEdit, onDelete, onSetDefault,
}: {
  article: ArticleEntry;
  profiles: SizeProfile[];
  onCreate: () => void;
  onEdit: (p: SizeProfile) => void;
  onDelete: (id: string) => void;
  onSetDefault: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(profiles.length > 1);
  const widest = profiles[0]?.sizes ?? [];
  const wide = isWideSizeRange(widest);

  const rangeChips = useMemo(() => {
    const seen = new Set<string>();
    for (const p of profiles) {
      for (const s of p.sizes) seen.add(s.size);
    }
    return Array.from(seen).sort((a, b) => parseFloat(a) - parseFloat(b));
  }, [profiles]);

  return (
    <div className="rounded-2xl border border-border bg-subtle/30 p-3">
      <div className="flex items-center gap-3">
        {article.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={article.photoUrl} alt={article.vendorCode}
            className="h-12 w-10 rounded-md object-cover" />
        ) : (
          <div className="grid h-12 w-10 place-items-center rounded-md bg-subtle text-[10px] text-muted-foreground">—</div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <strong className="truncate text-[13px] text-foreground">{article.vendorCode}</strong>
            <span className="text-[11px] text-muted-foreground">{article.nmId}</span>
            {article.brand ? <span className="text-[10px] text-muted-foreground">· {article.brand}</span> : null}
            {article.category ? <span className="text-[10px] text-muted-foreground">· {article.category}</span> : null}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {profiles.length === 0
              ? 'Нет профилей (нет истории заказов)'
              : `${profiles.length} ${plural(profiles.length, 'профиль', 'профиля', 'профилей')} · полный ряд: ${describeRange(rangeChips)}`}
            {wide ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">⚠ широкий ряд — авто-сплит</span> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-bold text-foreground hover:border-rose-400"
        >
          <Plus className="h-3.5 w-3.5" /> Профиль
        </button>
        {profiles.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground"
            title={expanded ? 'Свернуть' : 'Развернуть'}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        ) : null}
      </div>

      {expanded && profiles.length > 0 ? (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-2">
          {profiles.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-card px-3 py-2 text-[11px]">
              <span className="font-bold text-foreground">{p.name}</span>
              {p.sourceTemplate ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300">
                  <Sparkles className="h-3 w-3" /> шаблон {p.sourceTemplate}
                </span>
              ) : null}
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{shortRange(p.sizes.map((s) => s.size))} · {p.sizes.length} разм · <strong>{p.totalPerBox}</strong> пар/кор</span>
              <span className="text-[10px] text-muted-foreground">
                {p.sizes.map((s) => `${s.size}×${s.perBox}`).join(' · ')}
              </span>
              {p.isDefault ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[9.5px] font-extrabold uppercase text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  <Star className="h-3 w-3" /> по умолчанию
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSetDefault(p.id)}
                  className="text-[10px] text-muted-foreground underline-offset-2 hover:text-emerald-700 hover:underline"
                  title="Сделать профилем по умолчанию"
                >
                  сделать по умолч.
                </button>
              )}
              <div className="ml-auto flex gap-1">
                <button type="button" onClick={() => onEdit(p)} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground" title="Редактировать">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(p.id)}
                  disabled={p.isDefault}
                  className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50 disabled:opacity-30 dark:hover:bg-rose-950/40"
                  title={p.isDefault ? 'Профиль по умолчанию нельзя удалить' : 'Удалить'}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ── Modal ─────────────────────────────────────── */

function ProfileEditorModal({
  mode, article, profile, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  article: ArticleEntry;
  profile?: SizeProfile;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { tenantId } = useStore();
  const [name, setName] = useState(profile?.name ?? '');
  const [rows, setRows] = useState<SizeProfileSize[]>(profile?.sizes ?? []);
  const [error, setError] = useState<string | null>(null);

  const detectedQuery = useQuery({
    queryKey: ['detected-sizes', tenantId, article.nmId],
    queryFn: () => detectArticleSizesAction(tenantId!, article.nmId),
    enabled: Boolean(tenantId) && mode === 'create',
    staleTime: 5 * 60_000,
  });
  const detectedSizes = detectedQuery.data ?? [];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totalPerBox = rows.reduce((s, r) => s + (Number(r.perBox) || 0), 0);

  const applyTemplate = (tpl: SizeTemplate) => {
    setName(`Стандарт ${tpl.name}`);
    setRows(buildSizesFromTemplate(tpl));
  };

  const updateRow = (index: number, patch: Partial<SizeProfileSize>) => {
    setRows((prev) => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
  };
  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));
  const addRow = () => setRows((prev) => prev.concat({ size: '', perBox: 1 }));

  const upsertMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error('Не выбран кабинет');
      await upsertSizeProfileAction(tenantId, {
        id: profile?.id,
        nmId: article.nmId,
        vendorCode: article.vendorCode,
        name: name.trim(),
        sizes: rows,
        isDefault: profile?.isDefault ?? false,
      });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-subtle/30 px-5 py-3">
          <div>
            <h3 className="text-[15px] font-extrabold">
              {mode === 'create' ? 'Новый профиль ростовки' : 'Редактировать профиль'}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {article.vendorCode} · {article.nmId}{article.brand ? ` · ${article.brand}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:text-foreground" aria-label="Закрыть">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {/* Detected sizes hint (read-only) */}
          {mode === 'create' && detectedSizes.length > 0 ? (
            <div className="mb-4 rounded-2xl border border-emerald-300/60 bg-emerald-50 p-3 dark:border-emerald-700/40 dark:bg-emerald-950/30">
              <div className="text-[10.5px] font-black uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">
                Размеры артикула в истории заказов
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {detectedSizes.map((s) => (
                  <span key={s} className="inline-flex items-center rounded-md bg-card px-1.5 py-0.5 font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    {s}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[10.5px] text-muted-foreground">
                Этот артикул уже автоматически получил подходящие профили. Здесь — для создания дополнительного.
              </p>
            </div>
          ) : null}

          {/* 4 built-in templates */}
          {mode === 'create' ? (
            <div className="mb-4">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                Готовые шаблоны Постал
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SIZE_TEMPLATES.map((tpl) => {
                  const total = tpl.sizes.reduce((s, sz) => s + (tpl.map[sz] ?? 1), 0);
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => applyTemplate(tpl)}
                      className="flex flex-col items-start rounded-lg border border-border bg-subtle/40 px-3 py-2 text-left text-[11px] hover:border-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    >
                      <strong className="text-[12px] font-extrabold">{tpl.name}</strong>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {tpl.sizes.map((s) => `${s}×${tpl.map[s]}`).join(' · ')}
                      </span>
                      <span className="mt-0.5 text-[10px] font-bold text-rose-500">{total} пар/кор</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Name */}
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Название профиля</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="напр. Стандарт 41-46 или Подростковая ТН-10"
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-[13px] outline-none focus:border-rose-400"
            />
          </label>

          {/* Sizes table */}
          <div className="mt-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Размеры × штук в коробке</span>
              <span className="text-[11px] text-muted-foreground">
                Итого пар: <strong className="text-rose-600">{totalPerBox}</strong>
              </span>
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-[12px]">
                <thead className="bg-subtle/40 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-bold">Размер</th>
                    <th className="px-3 py-2 text-right font-bold">шт/кор</th>
                    <th className="px-3 py-2 font-bold">Штрихкод</th>
                    <th className="w-10 px-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={idx} className="border-t border-border">
                      <td className="px-3 py-1.5">
                        <input
                          value={row.size}
                          onChange={(e) => updateRow(idx, { size: e.target.value })}
                          placeholder="37"
                          className="h-8 w-20 rounded-md border border-border bg-card px-2 text-[12px] outline-none focus:border-rose-400"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <input
                          type="number"
                          min={0}
                          value={row.perBox}
                          onChange={(e) => updateRow(idx, { perBox: Math.max(0, Number(e.target.value) || 0) })}
                          className="h-8 w-20 rounded-md border border-border bg-card px-2 text-right font-mono text-[12px] outline-none focus:border-rose-400"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          value={row.barcode ?? ''}
                          onChange={(e) => updateRow(idx, { barcode: e.target.value })}
                          placeholder="—"
                          className="h-8 w-full rounded-md border border-border bg-card px-2 font-mono text-[11px] outline-none focus:border-rose-400"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          className="rounded-md p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                          aria-label="Удалить строку"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-[11px] text-muted-foreground">Размеров пока нет — выбери шаблон выше или добавь вручную.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="mt-2">
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1 rounded-md border border-dashed border-border bg-subtle/40 px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground hover:border-rose-400 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> Добавить размер
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-subtle/30 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-[12px] font-bold text-muted-foreground hover:text-foreground"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={upsertMutation.isPending || !name.trim() || rows.length === 0}
            onClick={() => upsertMutation.mutate()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-500 px-3 py-2 text-[12px] font-bold text-white hover:bg-rose-600 disabled:opacity-40"
          >
            {upsertMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {mode === 'create' ? 'Создать профиль' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── helpers ───────────────────────────────────── */

function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}
