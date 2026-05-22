'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, DatabaseZap, Loader2, ShieldCheck, UserCheck } from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';
import { DecisionCenter } from '@/components/advertising/decision/DecisionCenter';
import { AdvertisingHeatmap } from '@/components/advertising/heatmap/AdvertisingHeatmap';
import { toLocalDateParam } from '@/lib/date-range';
import { useStore } from '@/store/useStore';
import type { AdvertisingTabKey, SelectedCluster } from '@/components/advertising/_shared/types';
import type { AdvertisingWorkspaceTab } from '@/components/advertising/workspace/AdvertisingBidWorkspace';

const TabSpinner = () => (
  <div className="flex h-[45vh] flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
    <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
  </div>
);

const AdvertisingOverview = dynamic(
  () => import('@/components/advertising/overview/AdvertisingOverview').then((m) => m.AdvertisingOverview),
  { loading: TabSpinner },
);
const AdvertisingTerminal = dynamic(
  () => import('@/components/advertising/terminal/AdvertisingTerminal').then((m) => m.AdvertisingTerminal),
  { loading: TabSpinner },
);
const ProductsTab = dynamic(
  () => import('@/components/advertising/products/ProductsTab').then((m) => m.ProductsTab),
  { loading: TabSpinner },
);
const AdvertisingClusters = dynamic(
  () => import('@/components/advertising/clusters/AdvertisingClusters').then((m) => m.AdvertisingClusters),
  { loading: TabSpinner },
);
const AdvertisingControl = dynamic(
  () => import('@/components/advertising/control/AdvertisingControl').then((m) => m.AdvertisingControl),
  { loading: TabSpinner },
);
const AdvertisingBidWorkspace = dynamic(
  () => import('@/components/advertising/workspace/AdvertisingBidWorkspace').then((m) => m.AdvertisingBidWorkspace),
  { loading: TabSpinner },
);
const BalancePage = dynamic(
  () => import('@/components/advertising/balance/BalancePage').then((m) => m.BalancePage),
  { loading: TabSpinner },
);
const DaypartingSchedule = dynamic(
  () => import('@/components/advertising/dayparting/DaypartingSchedule').then((m) => m.DaypartingSchedule),
  { loading: TabSpinner },
);
const AuditLog = dynamic(
  () => import('@/components/advertising/audit/AuditLog').then((m) => m.AuditLog),
  { loading: TabSpinner },
);

const TAB_DEFS: Array<{ key: AdvertisingTabKey; label: string; description: string }> = [
  { key: 'summary',  label: 'Сводка',    description: 'Расходы, ДРР, рекомендации' },
  { key: 'terminal', label: 'Терминал',  description: 'Плотная таблица и детализация' },
  { key: 'products', label: 'Товары',    description: 'Карточки SKU со светофором' },
  { key: 'bids',     label: 'Ставки',    description: 'Кластеры и управление ставками' },
  { key: 'balance',  label: 'Баланс',    description: 'Рекламный баланс и пополнение' },
  { key: 'history',  label: 'История',   description: 'Аудит-лог действий автопилота' },
  { key: 'settings', label: 'Настройки', description: 'Расписание, guardrails, kill switch' },
];

type BidsSubView = 'clusters' | 'control' | 'workspace';
type AdvertisingAutopilotMode = 'advisor' | 'semi_auto' | 'auto';
type AdvertisingSettingsResponse = {
  mode: AdvertisingAutopilotMode;
  autopilotEnabled: boolean;
};

const MODE_DEFS: Array<{
  key: AdvertisingAutopilotMode;
  label: string;
  status: string;
  Icon: typeof UserCheck;
}> = [
  { key: 'advisor', label: 'Советник', status: 'Подтверждаем руками', Icon: UserCheck },
  { key: 'semi_auto', label: 'Полуавтомат', status: 'Безопасные действия отдельно', Icon: ShieldCheck },
  { key: 'auto', label: 'Автопилот', status: 'Боевой автозапуск закрыт guardrails', Icon: Bot },
];

function modeStorageKey(tenantId: string) {
  return `advertising-autopilot-mode:${tenantId}`;
}

function readStoredMode(tenantId: string | null): AdvertisingAutopilotMode {
  if (!tenantId || typeof window === 'undefined') {
    return 'advisor';
  }
  const stored = window.localStorage.getItem(modeStorageKey(tenantId));
  return stored === 'advisor' || stored === 'semi_auto' || stored === 'auto' ? stored : 'advisor';
}

export default function AdvertisingPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<AdvertisingTabKey>('summary');
  const [selectedCluster, setSelectedCluster] = useState<SelectedCluster>(null);
  const [showDetailedOverview, setShowDetailedOverview] = useState(false);
  const { tenantId, dateFrom, dateTo } = useStore();
  const [autopilotMode, setAutopilotMode] = useState<AdvertisingAutopilotMode>(() => readStoredMode(tenantId));
  const [workspaceTabRequest, setWorkspaceTabRequest] = useState<{
    tab: AdvertisingWorkspaceTab;
    key: number;
  } | null>(null);

  // sub-state для вкладки Ставки: clusters → control drill-down
  const [bidsSubView, setBidsSubView] = useState<BidsSubView>('clusters');

  // sub-state для вкладки Настройки: dayparting campaign id
  const [daypartingCampaignId, setDaypartingCampaignId] = useState<number | null>(null);
  const [daypartingCampaignInput, setDaypartingCampaignInput] = useState('');
  const [daypartingNmId, setDaypartingNmId] = useState<number | null>(null);
  const [daypartingNmInput, setDaypartingNmInput] = useState('');

  const fromParam = toLocalDateParam(dateFrom);
  const toParam = toLocalDateParam(dateTo);

  const settingsQuery = useQuery<AdvertisingSettingsResponse, Error>({
    queryKey: ['advertising-settings', tenantId],
    queryFn: async () => {
      const response = await fetch('/api/views/advertising/settings', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('Не удалось загрузить режим рекламы');
      }
      return response.json();
    },
    enabled: Boolean(tenantId),
  });

  const modeMutation = useMutation<AdvertisingSettingsResponse, Error, AdvertisingAutopilotMode>({
    mutationFn: async (nextMode) => {
      const response = await fetch('/api/views/advertising/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: nextMode }),
      });
      const payload = await response.json() as AdvertisingSettingsResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Не удалось сохранить режим рекламы');
      }
      return payload;
    },
    onSuccess: (payload) => {
      queryClient.setQueryData(['advertising-settings', tenantId], payload);
    },
  });

  const effectiveAutopilotMode = settingsQuery.data?.mode ?? autopilotMode;

  if (!tenantId) {
    return (
      <OperatorState
        icon={DatabaseZap}
        title="Сначала подключите кабинет"
        description="Вкладка рекламы доступна после выбора активного кабинета и первой синхронизации."
        actionLabel="Открыть настройки"
        actionHref="/settings"
        secondaryText="Без активного tenant данные не загружаются"
      />
    );
  }

  function openWorkspace(nmId: number) {
    void nmId;
    openWorkspaceTab('bids');
  }

  function openWorkspaceTab(nextTab: AdvertisingWorkspaceTab) {
    setTab('bids');
    setBidsSubView('workspace');
    setWorkspaceTabRequest({ tab: nextTab, key: Date.now() });
  }

  function openClusterControl(cluster: SelectedCluster) {
    setSelectedCluster(cluster);
    setBidsSubView('control');
  }

  function changeAutopilotMode(nextMode: AdvertisingAutopilotMode) {
    setAutopilotMode(nextMode);
    if (tenantId) {
      window.localStorage.setItem(modeStorageKey(tenantId), nextMode);
    }
    modeMutation.mutate(nextMode);
  }

  return (
    <div className="animate-in fade-in zoom-in-95 space-y-6 pb-10 duration-500">
      <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Режим рекламы
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-700 dark:text-slate-300">
              Сейчас применяется сценарий: {MODE_DEFS.find((mode) => mode.key === effectiveAutopilotMode)?.status}
              {modeMutation.isPending ? ' · сохраняем' : ''}
              {modeMutation.error ? ` · ${modeMutation.error.message}` : ''}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODE_DEFS.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => changeAutopilotMode(key)}
                className={`inline-flex h-10 min-w-[150px] items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition ${
                  effectiveAutopilotMode === key
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700/50 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Навигация — 6 секций */}
      <nav className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-wrap gap-2">
          {TAB_DEFS.map((def) => (
            <button
              key={def.key}
              type="button"
              onClick={() => setTab(def.key)}
              title={def.description}
              className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                tab === def.key
                  ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700/50 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {def.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Сводка ─────────────────────────────────────────────────── */}
      {tab === 'summary' ? (
        <div className="space-y-6">
          <DecisionCenter
            tenantId={tenantId}
            fromParam={fromParam}
            toParam={toParam}
            onOpenBids={() => {
              openWorkspaceTab('bids');
            }}
            onOpenProducts={() => setTab('products')}
            onOpenOperations={() => openWorkspaceTab('operations')}
          />
          <AdvertisingHeatmap tenantId={tenantId} fromParam={fromParam} toParam={toParam} />
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setShowDetailedOverview((value) => !value)}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
            >
              {showDetailedOverview ? 'Скрыть подробности' : 'Подробная аналитика'}
            </button>
          </div>
          {showDetailedOverview ? (
            <AdvertisingOverview tenantId={tenantId} fromParam={fromParam} toParam={toParam} />
          ) : null}
        </div>
      ) : null}

      {/* ── Терминал ──────────────────────────────────────────────── */}
      {tab === 'terminal' ? (
        <AdvertisingTerminal
          tenantId={tenantId}
          fromParam={fromParam}
          toParam={toParam}
          onOpenWorkspace={openWorkspace}
        />
      ) : null}

      {/* ── Товары ─────────────────────────────────────────────────── */}
      {tab === 'products' ? (
        <ProductsTab
          tenantId={tenantId}
          fromParam={fromParam}
          toParam={toParam}
          onOpenWorkspace={openWorkspace}
        />
      ) : null}

      {/* ── Ставки ─────────────────────────────────────────────────── */}
      {tab === 'bids' ? (
        <div className="space-y-4">
          {/* sub-nav */}
          <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/60">
            {([
              { key: 'clusters',  label: 'Кластеры' },
              { key: 'control',   label: 'Управление кластером' },
              { key: 'workspace', label: 'Рабочее место' },
            ] as const).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setBidsSubView(s.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  bidsSubView === s.key
                    ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-slate-100'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {bidsSubView === 'clusters' ? (
            <AdvertisingClusters
              tenantId={tenantId}
              fromParam={fromParam}
              toParam={toParam}
              selectedCluster={selectedCluster}
              onOpenCluster={(cluster) => openClusterControl(cluster)}
            />
          ) : null}
          {bidsSubView === 'control' ? (
            <AdvertisingControl
              tenantId={tenantId}
              selectedCluster={selectedCluster}
              invalidationKeys={[['advertising-clusters', tenantId, fromParam, toParam]]}
            />
          ) : null}
          {bidsSubView === 'workspace' ? (
            <AdvertisingBidWorkspace
              key={workspaceTabRequest?.key ?? 'workspace'}
              tenantId={tenantId}
              fromParam={fromParam}
              toParam={toParam}
              initialTab={workspaceTabRequest?.tab}
            />
          ) : null}
        </div>
      ) : null}

      {/* ── Баланс ─────────────────────────────────────────────────── */}
      {tab === 'balance' ? <BalancePage /> : null}

      {/* ── История ────────────────────────────────────────────────── */}
      {tab === 'history' ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <AuditLog />
        </div>
      ) : null}

      {/* ── Настройки ──────────────────────────────────────────────── */}
      {tab === 'settings' ? (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div>
            <h2 className="mb-4 text-base font-bold text-slate-900 dark:text-slate-100">Расписание показов</h2>
            <div className="mb-2 flex flex-wrap gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  ID кампании
                </span>
                <input
                  type="number"
                  value={daypartingCampaignInput}
                  onChange={(e) => setDaypartingCampaignInput(e.target.value)}
                  placeholder="1234567"
                  className="w-48 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-emerald-500"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  nmID / склейка
                </span>
                <input
                  type="number"
                  value={daypartingNmInput}
                  onChange={(e) => setDaypartingNmInput(e.target.value)}
                  placeholder="необязательно"
                  className="w-48 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-emerald-500"
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  const id = Number(daypartingCampaignInput);
                  const nmId = Number(daypartingNmInput);
                  if (Number.isFinite(id) && id > 0) {
                    setDaypartingCampaignId(Math.trunc(id));
                    setDaypartingNmId(Number.isFinite(nmId) && nmId > 0 ? Math.trunc(nmId) : null);
                  }
                }}
                className="self-end rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
              >
                Открыть расписание
              </button>
            </div>
          </div>
          {daypartingCampaignId ? (
            <DaypartingSchedule
              campaignId={daypartingCampaignId}
              campaignName={daypartingNmId ? `Кампания ${daypartingCampaignId} · nmID ${daypartingNmId}` : `Кампания ${daypartingCampaignId}`}
              nmId={daypartingNmId}
              fromParam={fromParam}
              toParam={toParam}
            />
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Введите ID кампании выше чтобы настроить расписание показов.
            </p>
          )}
        </div>
      ) : null}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        * Оценочная ДРР в кластерах рассчитывается как расход кластера к выручке SKU за период, а не как прямая атрибуционная ДРР.
      </p>
    </div>
  );
}
