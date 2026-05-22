'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Loader2,
  MessageCircleQuestion,
  MessageSquareText,
  Power,
  PowerOff,
  RefreshCw,
  Send,
  Sparkles,
  Star,
} from 'lucide-react';

import { toLocalDateParam } from '@/lib/date-range';
import { OperatorState } from '@/components/dashboard/OperatorState';
import { useStore } from '@/store/useStore';

type CollectionKind = 'reviews' | 'questions';
type ItemType = 'review' | 'question';
type Tone = 'friendly' | 'neutral' | 'formal';
type SummaryScope = '24h' | '7d' | 'filter';

type ReviewsQaItem = {
  id: string;
  itemType: ItemType;
  text: string;
  answerText: string | null;
  isAnswered: boolean;
  rating: number | null;
  createdAt: string | null;
  nmId: number | null;
  productName: string | null;
  brandName: string | null;
  userName: string | null;
};

type ReviewsQaResponse = {
  kind: CollectionKind;
  isAnswered: boolean;
  take: number;
  skip: number;
  count: number;
  items: ReviewsQaItem[];
  externalError?: string | null;
  externalStatus?: number | null;
};

type ReviewsQaAutoStateResponse = {
  enabled: boolean;
};

type ReviewsQaDailyRatingDistribution = {
  five: number;
  four: number;
  three: number;
  two: number;
  one: number;
};

type ReviewsQaDashboardResponse = {
  daily: {
    periodHours: number;
    processedReviews: number;
    sentToWb: number;
    approved: number;
    rejected: number;
    ratingDistribution: ReviewsQaDailyRatingDistribution;
    exact: boolean;
  };
  generatedAt: string;
  externalError?: string | null;
  externalStatus?: number | null;
};

const TONE_OPTIONS: Array<{ value: Tone; label: string }> = [
  { value: 'friendly', label: 'Дружелюбный' },
  { value: 'neutral', label: 'Нейтральный' },
  { value: 'formal', label: 'Деловой' },
];

const SUMMARY_SCOPE_OPTIONS: Array<{ value: SummaryScope; label: string }> = [
  { value: '24h', label: '24ч' },
  { value: '7d', label: '7д' },
  { value: 'filter', label: 'Интервал фильтра' },
];

function formatCreatedAt(value: string | null) {
  if (!value) {
    return 'Дата не указана';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Moscow',
  });
}

function getItemStateKey(item: Pick<ReviewsQaItem, 'itemType' | 'id'>): string {
  return `${item.itemType}:${item.id}`;
}

function formatCount(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '0';
  }

  return new Intl.NumberFormat('ru-RU').format(Math.max(0, Math.trunc(value)));
}

function formatDateOnly(value: Date): string {
  return value.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  });
}

async function parseApiError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload?.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    // noop
  }

  return `Ошибка запроса (${response.status})`;
}

export default function ReviewsQaPage() {
  const queryClient = useQueryClient();
  const { tenantId, dateFrom, dateTo } = useStore();

  const [kind, setKind] = useState<CollectionKind>('reviews');
  const [showAnswered, setShowAnswered] = useState(false);
  const [tone, setTone] = useState<Tone>('friendly');
  const [draftReplies, setDraftReplies] = useState<Record<string, string>>({});
  const [generatedIds, setGeneratedIds] = useState<Record<string, true>>({});
  const [cachedIds, setCachedIds] = useState<Record<string, true>>({});
  const [publishedIds, setPublishedIds] = useState<Record<string, true>>({});
  const [activeGenerateKey, setActiveGenerateKey] = useState<string | null>(null);
  const [activePublishKey, setActivePublishKey] = useState<string | null>(null);
  const [activeAutoSwitch, setActiveAutoSwitch] = useState<boolean | null>(null);
  const [summaryScope, setSummaryScope] = useState<SummaryScope>('24h');

  const { data, isLoading, isFetching, error, refetch } = useQuery<ReviewsQaResponse | null, Error>({
    queryKey: ['reviews-qa', tenantId, kind, showAnswered],
    queryFn: async () => {
      if (!tenantId) {
        return null;
      }

      const query = new URLSearchParams();
      query.set('tenantId', tenantId);
      query.set('kind', kind);
      query.set('isAnswered', String(showAnswered));
      query.set('take', '40');
      query.set('skip', '0');

      const response = await fetch(`/api/views/reviews-qa?${query.toString()}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      return response.json();
    },
    enabled: Boolean(tenantId),
  });

  const {
    data: autoState,
    isLoading: isAutoStateLoading,
    error: autoStateError,
    refetch: refetchAutoState,
  } = useQuery<ReviewsQaAutoStateResponse | null, Error>({
    queryKey: ['reviews-qa-auto-state', tenantId],
    queryFn: async () => {
      if (!tenantId) {
        return null;
      }

      const query = new URLSearchParams();
      query.set('tenantId', tenantId);

      const response = await fetch(`/api/views/reviews-qa/auto?${query.toString()}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      return response.json();
    },
    enabled: Boolean(tenantId),
  });

  const {
    data: dashboard,
    isFetching: isDashboardFetching,
    error: dashboardError,
    refetch: refetchDashboard,
  } = useQuery<ReviewsQaDashboardResponse | null, Error>({
    queryKey: ['reviews-qa-dashboard', tenantId, summaryScope, dateFrom, dateTo],
    queryFn: async () => {
      if (!tenantId) {
        return null;
      }

      const query = new URLSearchParams();
      query.set('tenantId', tenantId);
      query.set('scope', summaryScope);
      if (summaryScope === 'filter') {
        query.set('from', toLocalDateParam(dateFrom));
        query.set('to', toLocalDateParam(dateTo));
      }

      const response = await fetch(`/api/views/reviews-qa/dashboard?${query.toString()}`, {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      return response.json();
    },
    enabled: Boolean(tenantId),
  });

  const generateMutation = useMutation<{ itemKey: string; reply: string; cacheHit: boolean }, Error, ReviewsQaItem>({
    mutationFn: async (item) => {
      if (!tenantId) {
        throw new Error('Сначала выберите активный кабинет.');
      }

      const response = await fetch('/api/views/reviews-qa/reply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId,
          itemType: item.itemType,
          sourceText: item.text,
          productName: item.productName,
          brandName: item.brandName,
          customerName: item.userName,
          rating: item.rating,
          tone,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const payload = await response.json() as { reply: string; cacheHit?: boolean };
      const itemKey = getItemStateKey(item);
      return {
        itemKey,
        reply: payload.reply,
        cacheHit: Boolean(payload.cacheHit),
      };
    },
    onSuccess: ({ itemKey, reply, cacheHit }) => {
      setDraftReplies((prev) => ({
        ...prev,
        [itemKey]: reply,
      }));
      setGeneratedIds((prev) => ({
        ...prev,
        [itemKey]: true,
      }));
      setCachedIds((prev) => {
        if (!cacheHit) {
          const next = { ...prev };
          delete next[itemKey];
          return next;
        }
        return {
          ...prev,
          [itemKey]: true,
        };
      });
    },
  });

  const publishMutation = useMutation<{ itemKey: string }, Error, { item: ReviewsQaItem; text: string }>({
    mutationFn: async ({ item, text }) => {
      if (!tenantId) {
        throw new Error('Сначала выберите активный кабинет.');
      }

      const response = await fetch('/api/views/reviews-qa/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId,
          itemType: item.itemType,
          itemId: item.id,
          replyText: text,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const itemKey = getItemStateKey(item);
      return {
        itemKey,
      };
    },
    onSuccess: ({ itemKey }) => {
      setPublishedIds((prev) => ({
        ...prev,
        [itemKey]: true,
      }));
      void queryClient.invalidateQueries({
        queryKey: ['reviews-qa', tenantId, kind, showAnswered],
      });
      void queryClient.invalidateQueries({
        queryKey: ['reviews-qa-dashboard', tenantId],
      });
    },
  });

  const autoSwitchMutation = useMutation<{ enabled: boolean }, Error, boolean>({
    mutationFn: async (enabled) => {
      if (!tenantId) {
        throw new Error('Сначала выберите активный кабинет.');
      }

      const response = await fetch('/api/views/reviews-qa/auto', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId,
          enabled,
        }),
      });

      if (!response.ok) {
        throw new Error(await parseApiError(response));
      }

      const payload = await response.json() as { enabled?: boolean };
      return { enabled: payload.enabled === true };
    },
    onSuccess: ({ enabled }) => {
      queryClient.setQueryData<ReviewsQaAutoStateResponse | null>(
        ['reviews-qa-auto-state', tenantId],
        enabled === true ? { enabled: true } : { enabled: false },
      );
    },
  });

  const actionError = generateMutation.error?.message
    || publishMutation.error?.message
    || autoStateError?.message
    || autoSwitchMutation.error?.message
    || null;

  const items = useMemo(() => data?.items ?? [], [data?.items]);
  const autoEnabled = Boolean(autoState?.enabled);
  const isRefreshing = isFetching || isDashboardFetching;
  const effectiveDashboardError = dashboardError?.message ?? null;
  const externalSourceError = data?.externalError ?? dashboard?.externalError ?? null;
  const summaryRangeLabel = summaryScope === '24h'
    ? 'за последние 24 часа'
    : summaryScope === '7d'
      ? 'за последние 7 дней'
      : `за период фильтра ${formatDateOnly(dateFrom)} — ${formatDateOnly(dateTo)}`;

  const handleGenerate = (item: ReviewsQaItem) => {
    const itemKey = getItemStateKey(item);
    setActiveGenerateKey(itemKey);
    generateMutation.mutate(item, {
      onSettled: () => {
        setActiveGenerateKey((current) => (current === itemKey ? null : current));
      },
    });
  };

  const handlePublish = (item: ReviewsQaItem) => {
    const itemKey = getItemStateKey(item);
    const text = (draftReplies[itemKey] ?? item.answerText ?? '').trim();
    if (!text) {
      return;
    }

    setActivePublishKey(itemKey);
    publishMutation.mutate(
      {
        item,
        text,
      },
      {
        onSettled: () => {
          setActivePublishKey((current) => (current === itemKey ? null : current));
        },
      },
    );
  };

  const handleAutoSwitch = (enabled: boolean) => {
    setActiveAutoSwitch(enabled);
    autoSwitchMutation.mutate(enabled, {
      onSettled: () => {
        setActiveAutoSwitch(null);
      },
    });
  };

  const handleRefresh = () => {
    void Promise.all([
      refetch(),
      refetchDashboard(),
      refetchAutoState(),
    ]);
  };

  if (!tenantId) {
    return (
      <OperatorState
        icon={MessageSquareText}
        title="Сначала выберите кабинет"
        description="Вкладка отзывов и вопросов работает только для активного tenant с настроенным WB API токеном."
        actionLabel="Открыть настройки"
        actionHref="/settings"
      />
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse font-medium text-slate-500">Загружаем отзывы и вопросы...</p>
      </div>
    );
  }

  if (error) {
    return (
      <OperatorState
        icon={AlertCircle}
        tone="danger"
        title="Не удалось загрузить блок отзывов и вопросов"
        description={error.message}
        actionLabel="Повторить"
        action={refetch}
      />
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-end gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleAutoSwitch(true)}
            disabled={isAutoStateLoading || autoSwitchMutation.isPending || autoEnabled}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              autoEnabled
                ? 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30'
            }`}
          >
            {autoSwitchMutation.isPending && activeAutoSwitch === true
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Power className="h-4 w-4" />}
            Авто ВКЛ
          </button>

          <button
            type="button"
            onClick={() => handleAutoSwitch(false)}
            disabled={isAutoStateLoading || autoSwitchMutation.isPending || !autoEnabled}
            className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              !autoEnabled
                ? 'border-slate-300 dark:border-slate-600 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            {autoSwitchMutation.isPending && activeAutoSwitch === false
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <PowerOff className="h-4 w-4" />}
            Авто ВЫКЛ
          </button>

          <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest ${
            autoEnabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400'
          }`}>
            {autoEnabled ? 'Автоответы по отзывам: включены' : 'Автоответы по отзывам: выключены'}
          </span>

          <button
            type="button"
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Обновить
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Сводка по отзывам ({summaryRangeLabel})
            </p>
          </div>
          <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
            {dashboard ? (dashboard.daily.exact ? 'Точно' : 'Оценка') : '...'}
          </span>
        </div>

        <div className="inline-flex w-full max-w-[420px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 p-1">
          {SUMMARY_SCOPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSummaryScope(option.value)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition ${
                summaryScope === option.value
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p className="font-semibold text-slate-700 dark:text-slate-300">Обработано отзывов: <span className="text-slate-900 dark:text-slate-100">{formatCount(dashboard?.daily.processedReviews ?? 0)}</span></p>
          <p className="font-semibold text-slate-700 dark:text-slate-300">Отправлено на WB: <span className="text-slate-900 dark:text-slate-100">{formatCount(dashboard?.daily.sentToWb ?? 0)}</span></p>
          <p className="font-semibold text-emerald-700 dark:text-emerald-300">Одобрено: <span className="text-emerald-800 dark:text-emerald-200">{formatCount(dashboard?.daily.approved ?? 0)}</span></p>
          <p className="font-semibold text-rose-700 dark:text-rose-300">Отклонено: <span className="text-rose-800 dark:text-rose-200">{formatCount(dashboard?.daily.rejected ?? 0)}</span></p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Распределение по оценкам</p>
          <div className="mt-2 grid gap-1 text-sm text-slate-700 dark:text-slate-300 sm:grid-cols-2">
            <p>⭐⭐⭐⭐⭐ {formatCount(dashboard?.daily.ratingDistribution.five ?? 0)} отзывов</p>
            <p>⭐⭐⭐⭐ {formatCount(dashboard?.daily.ratingDistribution.four ?? 0)} отзывов</p>
            <p>⭐⭐⭐ {formatCount(dashboard?.daily.ratingDistribution.three ?? 0)} отзывов</p>
            <p>⭐⭐ {formatCount(dashboard?.daily.ratingDistribution.two ?? 0)} отзывов</p>
            <p>⭐ {formatCount(dashboard?.daily.ratingDistribution.one ?? 0)} отзывов</p>
          </div>
        </div>

        {effectiveDashboardError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300">
            Не удалось загрузить ежедневную сводку: {effectiveDashboardError}
          </div>
        ) : null}

        {dashboard ? (
          <p className="px-1 text-xs font-medium text-slate-500">
            Сводка обновлена {formatCreatedAt(dashboard.generatedAt)}{dashboard.daily.exact ? '' : ' · часть данных может быть неполной из-за лимита сканирования страниц WB'}.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/50 p-1">
          <button
            type="button"
            onClick={() => setKind('reviews')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition ${
              kind === 'reviews' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <MessageSquareText className="h-4 w-4" />
            Отзывы
          </button>
          <button
            type="button"
            onClick={() => setKind('questions')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition ${
              kind === 'questions' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <MessageCircleQuestion className="h-4 w-4" />
            Вопросы
          </button>
        </div>

        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={showAnswered}
            onChange={(event) => setShowAnswered(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 dark:checked:bg-emerald-600 focus:ring-emerald-500"
          />
          Показать отвеченные
        </label>

        <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          <Bot className="h-4 w-4 text-emerald-600" />
          Тон Yandex GPT
          <select
            value={tone}
            onChange={(event) => setTone(event.target.value as Tone)}
            className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1 text-sm dark:text-slate-200"
          >
            {TONE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Авто-режим работает только для отзывов
        </span>

        <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Показано {formatCount(items.length)}
        </span>
      </div>

      {actionError ? (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-900/20 px-4 py-3 text-sm font-medium text-rose-700 dark:text-rose-300">
          {actionError}
        </div>
      ) : null}

      {externalSourceError ? (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-sm font-medium text-amber-800 dark:text-amber-200">
          {externalSourceError}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-10 text-center text-sm font-medium text-slate-500 dark:text-slate-400">
          {externalSourceError
            ? 'Данные WB временно недоступны. Проверьте токен в настройках и повторите запрос.'
            : 'По текущим фильтрам данных нет. Проверьте WB токен в настройках или переключите тип/статус.'}
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const itemKey = getItemStateKey(item);
            const draftText = draftReplies[itemKey] ?? item.answerText ?? '';
            const isGenerated = Boolean(generatedIds[itemKey]);
            const isCached = Boolean(cachedIds[itemKey]);
            const isPublished = Boolean(publishedIds[itemKey]);
            const isGenerating = activeGenerateKey === itemKey && generateMutation.isPending;
            const isPublishing = activePublishKey === itemKey && publishMutation.isPending;

            return (
              <article key={`${item.itemType}-${item.id}`} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                      {item.itemType === 'review' ? 'Отзыв' : 'Вопрос'}
                    </span>
                    <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ${
                      item.isAnswered ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    }`}>
                      {item.isAnswered ? 'Отвечен' : 'Не отвечен'}
                    </span>
                    {typeof item.rating === 'number' ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                        <Star className="h-3.5 w-3.5" />
                        {item.rating}/5
                      </span>
                    ) : null}
                    {item.nmId ? (
                      <span className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">
                        NM {item.nmId}
                      </span>
                    ) : null}
                  </div>

                  <div className="text-right text-xs text-slate-500 dark:text-slate-400">
                    <div>{formatCreatedAt(item.createdAt)}</div>
                    {item.productName ? (
                      <div className="font-semibold text-slate-700 dark:text-slate-300">{item.productName}</div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
                  {item.text}
                </div>

                <div className="mt-4 space-y-2">
                  <label htmlFor={`reply-${item.itemType}-${item.id}`} className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Черновик ответа
                  </label>
                  <textarea
                    id={`reply-${item.itemType}-${item.id}`}
                    rows={4}
                    value={draftText}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDraftReplies((prev) => ({
                        ...prev,
                        [itemKey]: value,
                      }));
                    }}
                    placeholder="Сгенерируйте ответ через Yandex GPT или напишите вручную"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800/50 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none transition focus:border-emerald-400 dark:focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 dark:focus:ring-emerald-900"
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleGenerate(item)}
                    disabled={isGenerating || isPublishing}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
                  >
                    {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {isGenerating ? 'Генерация...' : 'Сгенерировать'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePublish(item)}
                    disabled={isPublishing || isGenerating || draftText.trim().length === 0}
                    className="inline-flex items-center gap-2 rounded-xl border border-sky-200 dark:border-sky-800/40 bg-sky-50 dark:bg-sky-900/20 px-4 py-2 text-sm font-semibold text-sky-700 dark:text-sky-300 transition hover:bg-sky-100 dark:hover:bg-sky-900/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPublishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {isPublishing ? 'Отправка...' : 'Отправить в WB'}
                  </button>

                  {isGenerated ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Ответ сгенерирован
                    </span>
                  ) : null}

                  {isCached ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/30 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Из кэша
                    </span>
                  ) : null}

                  {isPublished ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 dark:bg-sky-900/30 px-3 py-1 text-xs font-semibold text-sky-700 dark:text-sky-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Отправлено в WB
                    </span>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
