'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CalendarDays, CheckCircle2, ClipboardList, Loader2, Plus, TrendingUp } from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';
import { useStore } from '@/store/useStore';
import { CylinderGauge } from '@/components/sales-plan/CylinderGauge';
import { MiniTrafficLights, lightTone, type TrafficLightItem } from '@/components/sales-plan/MiniTrafficLights';
import {
  archiveSalesPlanAction,
  createSalesPlanAction,
  loadSalesPlanWorkspaceAction,
} from './actions';
import type { SalesPlanSummary, SalesPlanWorkspace } from '@/server/sales-plan/service';

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthStart() {
  const now = new Date();
  return dateOnly(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}

function monthEnd() {
  const now = new Date();
  return dateOnly(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
}

function formatNumber(value: number) {
  return Math.round(value).toLocaleString('ru-RU');
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('ru-RU')} ₽`;
}

function paceLabel(status: SalesPlanSummary['paceStatus']) {
  if (status === 'ahead') return 'с опережением';
  if (status === 'behind') return 'отстаём';
  if (status === 'on_track') return 'по графику';
  return 'ещё не стартовал';
}

function paceClass(status: SalesPlanSummary['paceStatus']) {
  if (status === 'ahead') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200';
  if (status === 'behind') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200';
  if (status === 'on_track') return 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-200';
  return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

export default function SalesPlanPage() {
  const { tenantId } = useStore();
  const queryClient = useQueryClient();
  const [groupId, setGroupId] = useState('');
  const [plannedOrders, setPlannedOrders] = useState('300');
  const [averagePrice, setAveragePrice] = useState('1000');
  const [periodStart, setPeriodStart] = useState(monthStart());
  const [periodEnd, setPeriodEnd] = useState(monthEnd());
  const [seasonName, setSeasonName] = useState('');
  const [targetStockDays, setTargetStockDays] = useState('30');
  const [formError, setFormError] = useState<string | null>(null);

  const workspaceQuery = useQuery<SalesPlanWorkspace, Error>({
    queryKey: ['sales-plan-workspace', tenantId],
    queryFn: () => loadSalesPlanWorkspaceAction(tenantId!),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  const groups = workspaceQuery.data?.groups ?? [];
  const plans = workspaceQuery.data?.plans ?? [];
  const activePlans = plans.filter((plan) => plan.status === 'active');

  const createMutation = useMutation({
    mutationFn: () => {
      if (!tenantId) throw new Error('Сначала выберите кабинет');
      if (!groupId) throw new Error('Выберите склейку');
      return createSalesPlanAction(tenantId, {
        groupId,
        periodStart,
        periodEnd,
        plannedOrders: Number(plannedOrders),
        averagePrice: Number(averagePrice),
        seasonName,
        targetStockDays: Number(targetStockDays),
      });
    },
    onSuccess: () => {
      setFormError(null);
      void queryClient.invalidateQueries({ queryKey: ['sales-plan-workspace'] });
    },
    onError: (error: Error) => {
      setFormError(error.message);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (planId: string) => {
      if (!tenantId) throw new Error('Сначала выберите кабинет');
      return archiveSalesPlanAction(tenantId, planId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sales-plan-workspace'] });
    },
  });

  const selectedGroup = groups.find((group) => group.id === groupId) ?? null;

  if (!tenantId) {
    return (
      <OperatorState
        icon={ClipboardList}
        title="План продаж недоступен без кабинета"
        description="Выберите активный магазин, чтобы создать план по склейкам."
        actionLabel="Открыть настройки"
        actionHref="/settings"
      />
    );
  }

  if (workspaceQuery.error) {
    return (
      <OperatorState
        icon={ClipboardList}
        tone="danger"
        title="Не удалось загрузить план продаж"
        description={workspaceQuery.error.message}
        actionLabel="Повторить"
        action={workspaceQuery.refetch}
      />
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <section className="flex justify-end">
        <div className="inline-flex max-w-full items-center gap-2 rounded-xl border border-border bg-subtle/70 px-3 py-2 text-xs font-bold text-muted-foreground">
          <CalendarDays className="h-4 w-4 text-cyan-500" />
          Активных планов: {activePlans.length}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="dashboard-card p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/12 text-cyan-600 dark:text-cyan-300">
              <Plus className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-black tracking-tight text-foreground">Новый план</h2>
              <p className="text-xs font-semibold text-muted-foreground">Склейка, период, штуки, цена</p>
            </div>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">1. Что продаём</span>
              <select
                className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:border-cyan-400"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                disabled={workspaceQuery.isLoading || groups.length === 0}
              >
                <option value="">Выберите склейку</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} · {group.memberCount} SKU
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">2. Сколько штук</span>
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:border-cyan-400"
                  inputMode="numeric"
                  value={plannedOrders}
                  onChange={(event) => setPlannedOrders(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">Средняя цена</span>
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:border-cyan-400"
                  inputMode="numeric"
                  value={averagePrice}
                  onChange={(event) => setAveragePrice(event.target.value)}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">3. С даты</span>
                <input
                  type="date"
                  className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:border-cyan-400"
                  value={periodStart}
                  onChange={(event) => setPeriodStart(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">По дату</span>
                <input
                  type="date"
                  className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:border-cyan-400"
                  value={periodEnd}
                  onChange={(event) => setPeriodEnd(event.target.value)}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">Сезон</span>
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:border-cyan-400"
                  placeholder="Например: лето, школа, Новый год"
                  value={seasonName}
                  onChange={(event) => setSeasonName(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-xs font-black uppercase tracking-[0.18em] text-muted-foreground">Запас, дн.</span>
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:border-cyan-400"
                  inputMode="numeric"
                  value={targetStockDays}
                  onChange={(event) => setTargetStockDays(event.target.value)}
                />
              </label>
            </div>

            {formError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200">
                {formError}
              </div>
            ) : null}

            {selectedGroup && selectedGroup.memberCount === 0 ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100">
                В этой склейке пока нет SKU. План сохранится, но факт будет 0.
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || workspaceQuery.isLoading || groups.length === 0}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 text-sm font-black text-white shadow-[0_18px_40px_-24px_rgba(8,145,178,0.9)] transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Сохранить план
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {workspaceQuery.isLoading ? (
            <div className="dashboard-card flex min-h-[260px] items-center justify-center gap-3 text-sm font-bold text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-500" />
              Загружаю планы...
            </div>
          ) : plans.length === 0 ? (
            <div className="dashboard-card flex min-h-[260px] flex-col items-center justify-center gap-3 p-6 text-center">
              <ClipboardList className="h-9 w-9 text-cyan-500" />
              <h2 className="text-xl font-black tracking-tight text-foreground">Планов пока нет</h2>
              <p className="max-w-md text-sm font-semibold text-muted-foreground">
                Создайте первый план по склейке. После сохранения он появится в дашборде и остатках.
              </p>
            </div>
          ) : (
            plans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                archiving={archiveMutation.isPending}
                onArchive={() => archiveMutation.mutate(plan.id)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function PlanCard({
  plan,
  archiving,
  onArchive,
}: {
  plan: SalesPlanSummary;
  archiving: boolean;
  onArchive: () => void;
}) {
  return (
    <article className="dashboard-card p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-black tracking-tight text-foreground">{plan.groupName ?? plan.name}</h2>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-black ${paceClass(plan.paceStatus)}`}>
              {paceLabel(plan.paceStatus)}
            </span>
            {plan.status !== 'active' ? (
              <span className="rounded-full border border-border bg-subtle px-2.5 py-1 text-xs font-black text-muted-foreground">
                архив
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm font-semibold text-muted-foreground">
            {plan.periodStart} - {plan.periodEnd}
            {plan.seasonName ? ` · ${plan.seasonName}` : ''}
            {plan.targetStockDays ? ` · запас ${plan.targetStockDays} дн.` : ''}
          </p>
        </div>

        {plan.status === 'active' ? (
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
          >
            {archiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            В архив
          </button>
        ) : null}
      </div>

      {/*
        Cylinder + KPI grid layout: левый блок — вертикальный цилиндр
        выполнения плана; правый — компактная сетка ключевых метрик и
        мини-светофор. Так глаз сразу попадает в "сколько процентов" и
        потом считывает детали.
      */}
      <div className="mt-5 grid gap-5 sm:grid-cols-[130px_minmax(0,1fr)]">
        <CylinderGauge pct={plan.progressPct} label="Выполнение" />

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MiniMetric label="План" value={`${formatNumber(plan.plannedOrders)} шт`} />
            <MiniMetric label="Факт" value={`${formatNumber(plan.actualOrders)} шт`} />
            <MiniMetric label="Прогноз" value={`${formatNumber(plan.projectedOrders)} шт`} />
            <MiniMetric label="Осталось" value={`${formatNumber(plan.remainingOrders)} шт`} />
          </div>

          <MiniTrafficLights items={buildTrafficLights(plan)} />

          <div className="flex flex-wrap gap-2 text-xs font-bold text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-xl border border-border bg-subtle px-2.5 py-1">
              <TrendingUp className="h-3.5 w-3.5 text-cyan-500" />
              Выручка план: {formatMoney(plan.plannedRevenue)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-xl border border-border bg-subtle px-2.5 py-1">
              Факт: {formatMoney(plan.actualRevenue)}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Compose 5-pill traffic-light row from the plan summary. Values map:
 *   - План:        progressPct (higher better, ≥95% = ok, ≥80% = warn)
 *   - Выручка:     actual / planned revenue (higher better)
 *   - Скорость:    paceStatus enum
 *   - Прогноз:     projected vs planned (higher better)
 *   - Остаток дн.: targetStockDays (informational, neutral)
 */
function buildTrafficLights(plan: SalesPlanSummary): TrafficLightItem[] {
  const revenuePct = plan.plannedRevenue > 0
    ? (plan.actualRevenue / plan.plannedRevenue) * 100
    : 0;
  const projectionPct = plan.plannedOrders > 0
    ? (plan.projectedOrders / plan.plannedOrders) * 100
    : 0;

  const paceTone: TrafficLightItem['tone'] =
    plan.paceStatus === 'ahead' ? 'ok'
    : plan.paceStatus === 'on_track' ? 'ok'
    : plan.paceStatus === 'behind' ? 'bad'
    : 'idle';

  return [
    { label: 'План',     value: `${plan.progressPct.toFixed(0)}%`, tone: lightTone(plan.progressPct, 95, 80) },
    { label: 'Выручка',  value: `${revenuePct.toFixed(0)}%`,        tone: lightTone(revenuePct, 95, 80) },
    { label: 'Темп',     value: paceLabel(plan.paceStatus),         tone: paceTone },
    { label: 'Прогноз',  value: `${projectionPct.toFixed(0)}%`,     tone: lightTone(projectionPct, 100, 80) },
  ];
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-subtle/60 px-3 py-3">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-black text-foreground">{value}</p>
    </div>
  );
}
