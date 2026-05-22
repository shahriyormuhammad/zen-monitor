'use client';

import { Suspense } from 'react';
import { useStore } from '@/store/useStore';
import { useQuery } from '@tanstack/react-query';
import { PnLChart } from '@/components/dashboard/PnLChart';
import { SignalQueueOwnerSummaryStrip } from '@/components/dashboard/SignalQueueOwnerSummaryStrip';
import { SignalSlaSummaryStrip } from '@/components/dashboard/SignalSlaSummaryStrip';
import { SignalsFeed } from '@/components/dashboard/SignalsFeed';
import { OperatorState } from '@/components/dashboard/OperatorState';
import type { SignalFeedResponse } from '@/lib/operator-signal-timeline';
import { buildSignalAssigneeRoleMap, buildSignalQueueOwnerSummaries, buildSignalSlaDashboardSummary } from '@/lib/signal-queue-utils';
import { toLocalDateParam } from '@/lib/date-range';
import { DatabaseZap, Loader2 } from 'lucide-react';

type DashboardResponse = {
  chart: Array<Record<string, unknown>>;
};

function SignalsFeedFallback() {
  return <div className="mb-8 h-32 animate-pulse rounded-3xl bg-slate-100" />;
}

export default function OverviewTestPage() {
  const { tenantId, dateFrom, dateTo } = useStore();

  const { data, isLoading, error, refetch } = useQuery<DashboardResponse | null, Error>({
    queryKey: ['dashboard-test', tenantId, dateFrom, dateTo],
    queryFn: async () => {
      if (!tenantId) {
        return null;
      }

      const res = await fetch(
        `/api/views/dashboard?from=${toLocalDateParam(dateFrom)}&to=${toLocalDateParam(dateTo)}`,
        { cache: 'no-store' },
      );

      if (!res.ok) {
        throw new Error('Ошибка при загрузке тестового обзора');
      }

      return res.json();
    },
    enabled: Boolean(tenantId),
  });

  const { data: signalFeed } = useQuery<SignalFeedResponse | null, Error>({
    queryKey: ['signals-test', tenantId],
    queryFn: async () => {
      if (!tenantId) {
        return { signals: [], availableAssignees: [], savedViews: [], automationRuns: [], automationSuppressions: [] };
      }

      const res = await fetch(`/api/views/dashboard/signals`, { cache: 'no-store' });
      if (!res.ok) {
        return { signals: [], availableAssignees: [], savedViews: [], automationRuns: [], automationSuppressions: [] };
      }

      return res.json();
    },
    enabled: Boolean(tenantId),
  });

  const signalSlaSummary = buildSignalSlaDashboardSummary(
    signalFeed?.signals ?? [],
    buildSignalAssigneeRoleMap(signalFeed?.availableAssignees ?? []),
  );
  const queueOwnerSummary = buildSignalQueueOwnerSummaries({
    signals: signalFeed?.signals ?? [],
    savedViews: signalFeed?.savedViews ?? [],
    automationRuns: signalFeed?.automationRuns ?? [],
    assignees: signalFeed?.availableAssignees ?? [],
  });

  if (!tenantId) {
    return (
      <OperatorState
        icon={DatabaseZap}
        title="Сначала подключите кабинет"
        description="Тестовая вкладка доступна после выбора активного кабинета."
        actionLabel="Открыть настройки"
        actionHref="/settings"
      />
    );
  }

  let content: React.ReactNode;

  if (isLoading) {
    content = (
      <div className="flex h-[45vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse font-medium text-slate-500">Готовим тестовую витрину сигналов и графиков...</p>
      </div>
    );
  } else if (error) {
    content = (
      <OperatorState
        icon={DatabaseZap}
        tone="danger"
        title="Не удалось загрузить тестовую вкладку"
        description={error.message}
        actionLabel="Повторить запрос"
        action={refetch}
      />
    );
  } else if (!data) {
    content = (
      <OperatorState
        icon={DatabaseZap}
        tone="warning"
        title="Нет данных для тестовой вкладки"
        description="Запустите синхронизацию и повторите проверку."
        actionLabel="Перейти в настройки"
        actionHref="/settings"
      />
    );
  } else {
    content = (
      <>
        <SignalQueueOwnerSummaryStrip summary={queueOwnerSummary} />
        <SignalSlaSummaryStrip summary={signalSlaSummary} />
        <Suspense fallback={<SignalsFeedFallback />}>
          <SignalsFeed key={`signals-test-${tenantId}`} />
        </Suspense>
        <PnLChart data={data.chart} metric="revenue" />
      </>
    );
  }

  return (
    <div className="animate-in fade-in zoom-in-95 space-y-8 pb-10 duration-500">
      {content}
    </div>
  );
}
