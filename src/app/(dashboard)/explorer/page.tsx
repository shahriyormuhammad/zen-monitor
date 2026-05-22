'use client';

import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useStore } from '@/store/useStore';
import { Database, ShoppingCart, BarChart3, Target, Megaphone, Loader2, AlertCircle, RefreshCw, FilterX } from 'lucide-react';
import { OperatorState } from '@/components/dashboard/OperatorState';

const TABS = [
  { id: 'orders', name: 'Заказы', icon: ShoppingCart },
  { id: 'realizations', name: 'Отчёты реализации', icon: BarChart3 },
  { id: 'prices', name: 'Цены и Скидки', icon: Database },
  { id: 'ads', name: 'Реклама (АРМ)', icon: Megaphone },
  { id: 'funnel', name: 'Воронка продаж', icon: Target },
];

type ExplorerRow = Record<string, unknown>;

function getFocusLabel(signalType: string | null) {
  switch (signalType) {
    case 'negative_margin':
      return 'Фокус по отрицательной марже';
    case 'ads_leak':
      return 'Фокус по рекламной утечке';
    case 'stock_out':
      return 'Фокус по риску остатка';
    case 'logistics_spike':
      return 'Фокус по логистической аномалии';
    case 'content_risk':
      return 'Фокус по контентному риску';
    case 'seo_risk':
      return 'Фокус по SEO-риску';
    case 'conversion_drop':
      return 'Фокус по просадке конверсии';
    default:
      return 'Фокус по сигналу';
  }
}

function ExplorerPageContent() {
  const { tenantId } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusTabParam = searchParams.get('focusTab');
  const focusSignalType = searchParams.get('focusSignalType');
  const focusTitle = searchParams.get('focusTitle');
  const signalId = searchParams.get('signalId');
  const focusNmId = useMemo(() => {
    const raw = searchParams.get('focusNmId');
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  const [localTab, setLocalTab] = useState('orders');
  const hasFocusContext = Boolean(focusNmId || focusSignalType || focusTitle || focusTabParam);
  const activeTab = hasFocusContext ? (focusTabParam || 'orders') : localTab;

  const buildFocusHref = (tabId: string) => {
    const params = new URLSearchParams();
    if (focusNmId) {
      params.set('focusNmId', String(focusNmId));
    }
    if (focusSignalType) {
      params.set('focusSignalType', focusSignalType);
    }
    if (focusTitle) {
      params.set('focusTitle', focusTitle);
    }
    if (signalId) {
      params.set('signalId', signalId);
    }
    params.set('focusTab', tabId);
    return `/explorer?${params.toString()}`;
  };

  const { data, isLoading, error, refetch } = useQuery<ExplorerRow[], Error>({
    queryKey: ['explorer', tenantId, activeTab, focusNmId],
    queryFn: async () => {
      if (!tenantId) return [];

      const url = new URL('/api/views/explorer', window.location.origin);
      url.searchParams.set('type', activeTab);
      if (focusNmId) {
        url.searchParams.set('nmId', String(focusNmId));
      }

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error('Ошибка при загрузке данных');
      return res.json();
    },
    enabled: !!tenantId,
  });

  if (!tenantId) {
    return (
      <OperatorState
        icon={Database}
        title="Проводник данных пока не к чему подключать"
        description="Сначала выберите активный кабинет и загрузите данные WB, после чего здесь появятся сырые таблицы."
        actionLabel="Открыть настройки"
        actionHref="/settings"
      />
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-8">
      <div className="mb-4 flex justify-end">
        <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-xl">
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Tenant ID:</span>
          <code className="text-[10px] font-mono font-bold text-indigo-500 dark:text-indigo-400">{tenantId}</code>
        </div>
      </div>

      {focusNmId ? (
        <div
          data-testid="signal-focus-banner"
          className={`mb-6 rounded-[2rem] border p-5 ${
            data && data.length > 0
              ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-200'
              : 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-800/40 dark:bg-amber-900/20 dark:text-amber-200'
          }`}
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-current/15 bg-white/70 dark:bg-slate-900/40 px-3 py-1 text-[10px] font-bold uppercase tracking-widest">
                  <Target className="h-3.5 w-3.5" />
                  {getFocusLabel(focusSignalType)}
                </span>
                <span className="rounded-full border border-current/15 bg-white/70 dark:bg-slate-900/40 px-3 py-1 text-[10px] font-bold uppercase tracking-widest">
                  NM {focusNmId}
                </span>
                <span className="rounded-full border border-current/15 bg-white/70 dark:bg-slate-900/40 px-3 py-1 text-[10px] font-bold uppercase tracking-widest">
                  Таб: {TABS.find((tab) => tab.id === activeTab)?.name ?? activeTab}
                </span>
              </div>
              <h3 className="text-lg font-bold">{focusTitle || `SKU ${focusNmId}`}</h3>
              <p className="text-sm font-medium leading-relaxed">
                {data && data.length > 0
                  ? 'Raw-срез уже отфильтрован до выбранного SKU. Переключайте табы выше, чтобы пройти от сигнала к нужному источнику без ручного поиска.'
                  : 'Для этого SKU в текущем raw-tab пока нет записей. Можно сменить таб или сбросить фокус и вернуться к общему потоку.'}
              </p>
            </div>

            <Link
              href="/explorer"
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-current/15 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-bold transition-colors hover:bg-white/80 dark:hover:bg-slate-700"
            >
              <FilterX className="h-4 w-4" />
              Сбросить фокус
            </Link>
            {signalId ? (
              <Link
                href={`/overview?signalId=${signalId}&signalReturnFrom=explorer`}
                data-testid="back-to-signal-link"
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-current/15 bg-white dark:bg-slate-800 px-4 py-3 text-sm font-bold transition-colors hover:bg-white/80 dark:hover:bg-slate-700"
              >
                <Target className="h-4 w-4" />
                Вернуться к сигналу
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div className="flex flex-wrap gap-2 bg-slate-100/50 dark:bg-slate-800/20 p-1.5 rounded-2xl border border-slate-200/60 dark:border-slate-700/30">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  if (hasFocusContext) {
                    router.replace(buildFocusHref(tab.id), { scroll: false });
                  } else {
                    setLocalTab(tab.id);
                  }
                }}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  isActive
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm border border-slate-200 dark:border-slate-700'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-white/50 dark:hover:bg-slate-800/30'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`} />
                {tab.name}
              </button>
            );
          })}
        </div>

        {data && (
          <div className="px-4 py-2 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-xl">
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{data.length} записей</span>
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-[0_4px_25px_rgba(0,0,0,0.03)] overflow-hidden">
        {isLoading ? (
          <div className="p-20 flex flex-col items-center justify-center gap-4 text-slate-500 dark:text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            <p className="font-bold text-sm uppercase tracking-widest">Загрузка данных...</p>
          </div>
        ) : error ? (
          <div className="p-8">
            <OperatorState
              icon={AlertCircle}
              tone="danger"
              title="Не удалось загрузить срез raw-данных"
              description={error.message}
              actionLabel="Повторить запрос"
              action={refetch}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left align-middle text-slate-600 dark:text-slate-400 whitespace-nowrap">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700 text-slate-400 dark:text-slate-500 font-bold uppercase tracking-tighter">
                <tr>
                  {data && data.length > 0 ? Object.keys(data[0]!).map((key) => (
                    <th scope="col" key={key} className="py-4 px-6 font-bold">{key}</th>
                  )) : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/30">
                {data && data.length > 0 ? data.map((row, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-colors font-mono">
                    {Object.values(row).map((val, vIdx: number) => (
                      <td key={vIdx} className="py-3.5 px-6 truncate max-w-[200px]" title={String(val)}>
                        {val === null ? <span className="text-slate-300 dark:text-slate-600">null</span> :
                         typeof val === 'object' ? JSON.stringify(val) : String(val)}
                      </td>
                    ))}
                  </tr>
                )) : (
                  <tr>
                    <td className="p-20 text-center font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                      {focusNmId ? `Данные по NM ${focusNmId} отсутствуют` : 'Данные отсутствуют'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-6 px-4 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500 font-medium">
        <div>Показано до 100 последних записей</div>
        <div className="flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5" />
          Актуальность проверяйте по последнему sync в настройках
        </div>
      </div>
    </div>
  );
}

function ExplorerPageFallback() {
  return (
    <div className="p-8 max-w-[1600px] mx-auto">
      <div className="h-24 animate-pulse rounded-[2rem] bg-slate-100/80 dark:bg-slate-800/50" />
      <div className="mt-6 flex h-[40vh] flex-col items-center justify-center gap-4 text-slate-500 dark:text-slate-400">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-500" />
        <p className="font-bold text-sm uppercase tracking-widest">Подготавливаем raw-проводник...</p>
      </div>
    </div>
  );
}

export default function ExplorerPage() {
  return (
    <Suspense fallback={<ExplorerPageFallback />}>
      <ExplorerPageContent />
    </Suspense>
  );
}
