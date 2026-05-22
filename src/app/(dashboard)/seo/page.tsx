'use client';

import Image from 'next/image';
import { useMemo, useState, type ElementType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  FileText,
  ImageIcon,
  ListChecks,
  Loader2,
  PackageSearch,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Undo2,
} from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';
import { toLocalDateParam } from '@/lib/date-range';
import { useStore } from '@/store/useStore';
import type {
  SeoAuditField,
  SeoAuditIssue,
  SeoAuditPriority,
  SeoAuditResponse,
  SeoAuditRow,
  SeoAuditSeverity,
} from '@/server/seo/card-audit';

type PriorityFilter = 'all' | SeoAuditPriority;
type SeoTextPatch = { title: string; description: string };
type ApplySeoResponse = {
  ok: true;
  nmId: number;
  title: string;
  description: string;
  updatedAt: string;
  wbSyncNotice: string;
};

const PRIORITY_FILTERS: Array<{ key: PriorityFilter; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'P0', label: 'P0' },
  { key: 'P1', label: 'P1' },
  { key: 'P2', label: 'P2' },
  { key: 'P3', label: 'P3' },
  { key: 'OK', label: 'OK' },
];

const FIELD_LABELS: Record<SeoAuditField, string> = {
  title: 'Название',
  description: 'Описание',
  characteristics: 'Характеристики',
  media: 'Медиа',
  funnel: 'Воронка',
  stock: 'Остаток',
  data: 'Данные',
};

const PRIORITY_STYLES: Record<SeoAuditPriority, string> = {
  P0: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  P1: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  P2: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  P3: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  OK: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

const SEVERITY_STYLES: Record<SeoAuditSeverity, string> = {
  danger: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-200',
  warning: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200',
  info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-200',
};

function formatNumber(value: number) {
  return value.toLocaleString('ru-RU');
}

function formatPercent(value: number | null) {
  return value === null ? '—' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}

function formatDateTime(value: string | null) {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Moscow',
  });
}

function matchesQuery(row: SeoAuditRow, query: string) {
  if (!query.trim()) {
    return true;
  }
  const normalized = query.trim().toLowerCase();
  return [
    row.nmId,
    row.vendorCode,
    row.brand,
    row.category,
    row.title,
  ].some((value) => String(value ?? '').toLowerCase().includes(normalized));
}

function issueSourceLabel(issue: SeoAuditIssue) {
  if (issue.source === 'wb_rules') {
    return 'WB';
  }
  if (issue.source === 'jarvis_sop') {
    return 'Jarvis';
  }
  if (issue.source === 'metric') {
    return 'Метрика';
  }
  return 'Качество данных';
}

function getRowCurrentText(row: SeoAuditRow): SeoTextPatch {
  return {
    title: row.title ?? '',
    description: row.description ?? '',
  };
}

function getRowSuggestedText(row: SeoAuditRow): SeoTextPatch {
  return {
    title: row.draft.title,
    description: row.draft.description,
  };
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function hasTextPatchChanges(row: SeoAuditRow, patch: SeoTextPatch) {
  const current = getRowCurrentText(row);
  return normalizeComparableText(current.title) !== normalizeComparableText(patch.title)
    || normalizeComparableText(current.description) !== normalizeComparableText(patch.description);
}

function createIdempotencyKey(nmId: number) {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
  return `seo-apply:${nmId}:${random}`;
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: ElementType;
  label: string;
  value: string | number;
  hint: string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-4 w-4 ${tone}`} />
        {label}
      </div>
      <div className="mt-1.5 text-3xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="mt-1 text-xs font-medium text-muted-foreground">{hint}</div>
    </div>
  );
}

function ScoreBar({ value }: { value: number }) {
  const tone = value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

function ProductImage({ row }: { row: SeoAuditRow }) {
  return (
    <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
      {row.photoUrl ? (
        <Image
          src={row.photoUrl}
          alt=""
          width={56}
          height={56}
          unoptimized
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageIcon className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}

function ProductRow({
  row,
  selected,
  onSelect,
}: {
  row: SeoAuditRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const topIssue = row.issues[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full border-b border-border px-4 py-3 text-left transition hover:bg-muted/50 last:border-b-0 ${
        selected ? 'bg-muted/70' : 'bg-card'
      }`}
    >
      <div className="flex gap-3">
        <ProductImage row={row} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${PRIORITY_STYLES[row.priority]}`}>
              {row.priority}
            </span>
            <span className="text-xs font-semibold tabular-nums text-muted-foreground">nm {row.nmId}</span>
            <span className="text-xs font-semibold text-muted-foreground">{row.brand ?? 'бренд не указан'}</span>
          </div>
          <div className="mt-1 truncate text-sm font-bold text-foreground">
            {row.title ?? row.vendorCode ?? `Карточка ${row.nmId}`}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {topIssue ? `${FIELD_LABELS[topIssue.field]}: ${topIssue.title}` : 'Критичных замечаний нет'}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="w-24">
              <ScoreBar value={row.score} />
            </div>
            <span className="text-xs font-bold tabular-nums text-foreground">{row.score}/100</span>
            <span className="text-xs text-muted-foreground">{row.issues.length} замеч.</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function MetricGrid({ row }: { row: SeoAuditRow }) {
  const items = [
    ['Название', `${row.metrics.titleLength} симв.`],
    ['Описание', `${row.metrics.descriptionLength} симв.`],
    ['Фото', formatNumber(row.metrics.photosCount)],
    ['Видео', row.metrics.hasVideo ? 'есть' : 'нет'],
    ['Характеристики', formatNumber(row.metrics.characteristicsCount)],
    ['Переходы', formatNumber(row.metrics.openCardCount)],
    ['В корзину', formatPercent(row.metrics.addToCartPercent)],
    ['Корзина-заказ', formatPercent(row.metrics.cartToOrderPercent)],
    ['Выкуп', formatPercent(row.metrics.orderToBuyoutPercent)],
    ['Остаток WB', row.metrics.stockQty === null ? '—' : formatNumber(row.metrics.stockQty)],
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-border bg-muted/30 px-3 py-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 text-sm font-bold tabular-nums text-foreground">{value}</div>
        </div>
      ))}
    </div>
  );
}

function IssueCard({ issue }: { issue: SeoAuditIssue }) {
  return (
    <div className={`rounded-2xl border p-4 ${SEVERITY_STYLES[issue.severity]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${PRIORITY_STYLES[issue.priority]}`}>
          {issue.priority}
        </span>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
          {FIELD_LABELS[issue.field]}
        </span>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
          {issueSourceLabel(issue)}
        </span>
      </div>
      <div className="mt-3 text-sm font-black">{issue.title}</div>
      <p className="mt-1 text-sm leading-relaxed text-inherit/80">{issue.details}</p>
      <div className="mt-3 rounded-xl bg-white/70 p-3 text-sm font-semibold leading-relaxed text-slate-800 dark:bg-slate-900/50 dark:text-slate-200">
        {issue.recommendation}
      </div>
    </div>
  );
}

export default function SeoPage() {
  const queryClient = useQueryClient();
  const { tenantId, dateFrom, dateTo } = useStore();
  const [query, setQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [selectedNmId, setSelectedNmId] = useState<number | null>(null);
  const [draftByNmId, setDraftByNmId] = useState<Record<number, SeoTextPatch>>({});
  const [applyMessage, setApplyMessage] = useState<{ nmId: number; message: string } | null>(null);

  const fromParam = toLocalDateParam(dateFrom);
  const toParam = toLocalDateParam(dateTo);

  const auditQuery = useQuery<SeoAuditResponse, Error>({
    queryKey: ['seo-audit', tenantId, fromParam, toParam],
    queryFn: async () => {
      const response = await fetch(`/api/views/seo?from=${fromParam}&to=${toParam}`, { cache: 'no-store' });
      const payload = await response.json() as SeoAuditResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Не удалось загрузить SEO-аудит');
      }
      return payload;
    },
    enabled: Boolean(tenantId),
  });

  const applyMutation = useMutation<ApplySeoResponse, Error, { nmId: number; title: string; description: string }>({
    mutationFn: async (payload) => {
      const response = await fetch('/api/views/seo/apply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': createIdempotencyKey(payload.nmId),
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as ApplySeoResponse & { error?: string };
      if (!response.ok) {
        throw new Error(result.error || 'Не удалось применить SEO-правку');
      }
      return result;
    },
    onSuccess: (result) => {
      setApplyMessage({ nmId: result.nmId, message: result.wbSyncNotice });
      setDraftByNmId((current) => ({
        ...current,
        [result.nmId]: {
          title: result.title,
          description: result.description,
        },
      }));
      void queryClient.invalidateQueries({ queryKey: ['seo-audit', tenantId, fromParam, toParam] });
    },
  });

  const rows = auditQuery.data?.rows;
  const filteredRows = useMemo(() => {
    return (rows ?? []).filter((row) => {
      if (onlyProblems && row.priority === 'OK') {
        return false;
      }
      if (priorityFilter !== 'all' && row.priority !== priorityFilter) {
        return false;
      }
      return matchesQuery(row, query);
    });
  }, [onlyProblems, priorityFilter, query, rows]);

  const allRows = rows ?? [];
  const activeRow = filteredRows.find((row) => row.nmId === selectedNmId) ?? filteredRows[0] ?? allRows[0] ?? null;
  const activeDraft = activeRow ? (draftByNmId[activeRow.nmId] ?? getRowSuggestedText(activeRow)) : null;
  const activeTitleLength = activeDraft?.title.trim().length ?? 0;
  const activeDescriptionLength = activeDraft?.description.trim().length ?? 0;
  const activeHasChanges = Boolean(activeRow && activeDraft && hasTextPatchChanges(activeRow, activeDraft));
  const activeTitleInvalid = activeTitleLength === 0 || activeTitleLength > 60;
  const activeDescriptionInvalid = activeDescriptionLength > 5000;
  const canApplyActiveDraft = Boolean(
    activeRow
      && activeDraft
      && activeHasChanges
      && !activeTitleInvalid
      && !activeDescriptionInvalid
      && !applyMutation.isPending,
  );

  function updateActiveDraft(field: keyof SeoTextPatch, value: string) {
    if (!activeRow) {
      return;
    }
    const current = activeDraft ?? getRowSuggestedText(activeRow);
    setDraftByNmId((drafts) => ({
      ...drafts,
      [activeRow.nmId]: {
        ...current,
        [field]: value,
      },
    }));
  }

  function resetActiveDraft(mode: 'current' | 'suggested') {
    if (!activeRow) {
      return;
    }
    setApplyMessage(null);
    setDraftByNmId((drafts) => ({
      ...drafts,
      [activeRow.nmId]: mode === 'current' ? getRowCurrentText(activeRow) : getRowSuggestedText(activeRow),
    }));
  }

  function applyActiveDraft() {
    if (!activeRow || !activeDraft || !canApplyActiveDraft) {
      return;
    }

    const confirmed = window.confirm(`Применить SEO-текст в WB для nm ${activeRow.nmId}?`);
    if (!confirmed) {
      return;
    }

    setApplyMessage(null);
    applyMutation.mutate({
      nmId: activeRow.nmId,
      title: activeDraft.title,
      description: activeDraft.description,
    });
  }

  if (!tenantId) {
    return (
      <OperatorState
        icon={DatabaseZap}
        title="Сначала подключите кабинет"
        description="SEO-аудит доступен после выбора активного кабинета и синхронизации карточек."
        actionLabel="Открыть настройки"
        actionHref="/settings"
        secondaryText="Без tenant данные не загружаются"
      />
    );
  }

  if (auditQuery.isLoading) {
    return (
      <div className="flex h-[55vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-sky-600" />
        <div className="text-sm font-semibold">Сканируем карточки</div>
      </div>
    );
  }

  if (auditQuery.error) {
    return (
      <OperatorState
        icon={AlertTriangle}
        tone="danger"
        title="SEO-аудит не загрузился"
        description={auditQuery.error.message}
        actionLabel="Повторить"
        action={() => void auditQuery.refetch()}
      />
    );
  }

  const summary = auditQuery.data?.summary;

  return (
    <div className="animate-in fade-in zoom-in-95 space-y-6 pb-10 duration-500">
      <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-sky-700 dark:text-sky-300">
              <PackageSearch className="h-4 w-4" />
              SEO карточек
            </div>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-foreground">Аудит контента WB</h1>
            <p className="mt-2 max-w-3xl text-sm font-medium leading-relaxed text-muted-foreground">
              Сканируем названия, описания, медиа, характеристики, остатки и воронку. Текст уходит в WB только по кнопке на выбранной карточке.
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-800 dark:text-emerald-200">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Ручное применение
            </div>
            <div className="mt-1 text-xs font-semibold text-emerald-800/75 dark:text-emerald-200/75">
              {fromParam} - {toParam}
            </div>
          </div>
        </div>
      </section>

      {summary ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <SummaryTile icon={ListChecks} label="Карточек" value={formatNumber(summary.totalCards)} hint="в скане" tone="text-sky-500" />
          <SummaryTile icon={AlertTriangle} label="P0" value={summary.p0Count} hint="сначала исправить" tone="text-rose-500" />
          <SummaryTile icon={SlidersHorizontal} label="P1" value={summary.p1Count} hint="высокий приоритет" tone="text-orange-500" />
          <SummaryTile icon={Sparkles} label="Оценка" value={`${summary.avgScore}/100`} hint="средний score" tone="text-amber-500" />
          <SummaryTile icon={CheckCircle2} label="OK/P3" value={summary.okCount} hint="без срочных правок" tone="text-emerald-500" />
        </section>
      ) : null}

      <section className="rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="nmId, артикул, бренд, название"
              className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm font-semibold text-foreground outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PRIORITY_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setPriorityFilter(filter.key)}
                className={`h-10 rounded-xl px-3 text-sm font-black transition ${
                  priorityFilter === filter.key
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {filter.label}
              </button>
            ))}
            <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground">
              <input
                type="checkbox"
                checked={onlyProblems}
                onChange={(event) => setOnlyProblems(event.target.checked)}
                className="h-4 w-4 accent-sky-600"
              />
              С проблемами
            </label>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.2fr)]">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-sm font-black text-foreground">Карточки</div>
              <div className="text-xs font-medium text-muted-foreground">
                Показано {formatNumber(filteredRows.length)} из {formatNumber(allRows.length)}
              </div>
            </div>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="max-h-[760px] overflow-auto">
            {filteredRows.length > 0 ? (
              filteredRows.map((row) => (
                <ProductRow
                  key={row.nmId}
                  row={row}
                  selected={activeRow?.nmId === row.nmId}
                  onSelect={() => setSelectedNmId(row.nmId)}
                />
              ))
            ) : (
              <div className="px-4 py-10 text-center text-sm font-semibold text-muted-foreground">
                По текущим фильтрам карточек нет
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          {activeRow ? (
            <div className="space-y-4">
              <div className="flex gap-3">
                <ProductImage row={activeRow} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${PRIORITY_STYLES[activeRow.priority]}`}>
                      {activeRow.priority}
                    </span>
                    <span className="text-xs font-bold tabular-nums text-muted-foreground">nm {activeRow.nmId}</span>
                    <span className="text-xs font-bold text-muted-foreground">{activeRow.vendorCode ?? 'артикул не указан'}</span>
                  </div>
                  <h2 className="mt-1 text-lg font-black leading-tight text-foreground">
                    {activeRow.title ?? `Карточка ${activeRow.nmId}`}
                  </h2>
                  <div className="mt-1 text-xs font-medium text-muted-foreground">
                    {activeRow.category ?? 'категория не указана'} · обновлено {formatDateTime(activeRow.updatedAt)}
                  </div>
                </div>
              </div>

              <MetricGrid row={activeRow} />

              {activeDraft ? (
                <div className="rounded-2xl border border-border bg-muted/30 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-black text-foreground">Текст для WB</div>
                      <div className="text-xs font-medium text-muted-foreground">
                        title {activeTitleLength}/60 · description {activeDescriptionLength}/5000
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => resetActiveDraft('suggested')}
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground transition hover:bg-muted"
                      >
                        <Sparkles className="h-4 w-4 text-sky-500" />
                        Очистить
                      </button>
                      <button
                        type="button"
                        onClick={() => resetActiveDraft('current')}
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-black text-foreground transition hover:bg-muted"
                      >
                        <Undo2 className="h-4 w-4 text-muted-foreground" />
                        Текущий
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 space-y-3">
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Название</span>
                      <input
                        value={activeDraft.title}
                        onChange={(event) => updateActiveDraft('title', event.target.value)}
                        className={`mt-1 h-11 w-full rounded-xl border bg-background px-3 text-sm font-semibold text-foreground outline-none transition focus:ring-2 ${
                          activeTitleInvalid
                            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20'
                            : 'border-border focus:border-sky-500 focus:ring-sky-500/20'
                        }`}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Описание</span>
                      <textarea
                        value={activeDraft.description}
                        onChange={(event) => updateActiveDraft('description', event.target.value)}
                        rows={6}
                        className={`mt-1 w-full resize-y rounded-xl border bg-background px-3 py-2 text-sm font-medium leading-relaxed text-foreground outline-none transition focus:ring-2 ${
                          activeDescriptionInvalid
                            ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-500/20'
                            : 'border-border focus:border-sky-500 focus:ring-sky-500/20'
                        }`}
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-h-5 text-xs font-semibold">
                      {activeTitleLength === 0 ? (
                        <span className="text-rose-600 dark:text-rose-400">Название обязательно.</span>
                      ) : activeTitleLength > 60 ? (
                        <span className="text-rose-600 dark:text-rose-400">Название длиннее лимита WB.</span>
                      ) : activeDescriptionInvalid ? (
                        <span className="text-rose-600 dark:text-rose-400">Описание длиннее лимита WB.</span>
                      ) : activeHasChanges ? (
                        <span className="text-amber-700 dark:text-amber-300">Есть неподтверждённые изменения.</span>
                      ) : (
                        <span className="text-muted-foreground">Изменений в тексте нет.</span>
                      )}
                      {applyMessage && applyMessage.nmId === activeRow.nmId ? (
                        <span className="ml-2 text-emerald-700 dark:text-emerald-300">{applyMessage.message}</span>
                      ) : null}
                      {applyMutation.error ? (
                        <span className="ml-2 text-rose-600 dark:text-rose-400">{applyMutation.error.message}</span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={applyActiveDraft}
                      disabled={!canApplyActiveDraft}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-black text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                    >
                      {applyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Применить в WB
                    </button>
                  </div>
                </div>
              ) : null}

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-foreground">Что править</div>
                    <div className="text-xs font-medium text-muted-foreground">
                      {activeRow.issues.length > 0 ? `${activeRow.issues.length} рекомендаций` : 'замечаний нет'}
                    </div>
                  </div>
                  <div className="w-28">
                    <ScoreBar value={activeRow.score} />
                  </div>
                </div>
                <div className="space-y-3">
                  {activeRow.issues.length > 0 ? (
                    activeRow.issues.map((issue) => <IssueCard key={`${activeRow.nmId}-${issue.code}`} issue={issue} />)
                  ) : (
                    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-800 dark:text-emerald-200">
                      Срочных SEO-правок по текущим правилам нет.
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="px-4 py-10 text-center text-sm font-semibold text-muted-foreground">
              Выберите карточку для деталей
            </div>
          )}
        </div>
      </section>

      {auditQuery.data?.rules.length ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="text-sm font-black text-foreground">Правила проверки</div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {auditQuery.data.rules.map((rule) => (
              <div key={rule.title} className="rounded-xl border border-border bg-muted/30 p-3">
                <div className="text-sm font-semibold leading-relaxed text-foreground">{rule.title}</div>
                <div className="mt-1 text-xs font-medium text-muted-foreground">{rule.source}</div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
