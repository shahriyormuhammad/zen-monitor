'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Loader2, Save, Sparkles, Trash2 } from 'lucide-react';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

type DaypartingTemplate = 'workday' | 'evening_weekend' | 'always_on' | 'custom';

interface DaypartingRule {
  id: string;
  campaignId: number;
  schedule: boolean[];
  templateName: string | null;
  enabled: boolean;
}

interface DaypartingResponse {
  rules: DaypartingRule[];
}

type HeatmapRecommendation = {
  status: 'ready' | 'insufficient_data';
  schedule: boolean[];
  activeHours: number;
  disabledHours: number;
  dataSlots: number;
  source: 'advertising_hourly_stats' | 'advertising_overview_daily';
  scope?: {
    advertId: number | null;
    nmId: number | null;
    attributionScope: 'tenant' | 'campaign' | 'sku' | 'group';
    groupName: string | null;
    groupNmCount: number;
  };
};

type HeatmapRecommendationResponse = {
  recommendation: HeatmapRecommendation;
};

function buildTemplateSchedule(template: Exclude<DaypartingTemplate, 'custom'>): boolean[] {
  return Array.from({ length: 168 }, (_, i) => {
    const day = Math.floor(i / 24);
    const hour = i % 24;
    if (template === 'workday') return day < 5 && hour >= 9 && hour < 21;
    if (template === 'evening_weekend') return day >= 5 || (hour >= 18 && hour < 24);
    return true; // always_on
  });
}

function slotIndex(day: number, hour: number) {
  return day * 24 + hour;
}

function normalizeTemplateName(templateName: string | null | undefined): DaypartingTemplate {
  if (templateName === 'workday' || templateName === 'evening_weekend' || templateName === 'always_on') {
    return templateName;
  }
  return 'custom';
}

interface Props {
  campaignId: number;
  campaignName?: string;
  nmId?: number | null;
  fromParam?: string;
  toParam?: string;
}

export function DaypartingSchedule(props: Props) {
  const { campaignId } = props;
  const { data, isLoading } = useQuery<DaypartingResponse>({
    queryKey: ['advertising', 'dayparting'],
    queryFn: () =>
      fetch('/api/views/advertising/dayparting').then((r) => r.json()),
  });

  const existingRule = data?.rules.find((r) => r.campaignId === campaignId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[--color-text-secondary] py-4">
        <Loader2 size={16} className="animate-spin" />
        <span>Загрузка расписания...</span>
      </div>
    );
  }

  return (
    <DaypartingScheduleEditor
      key={`${campaignId}:${existingRule?.id ?? 'new'}:${existingRule?.templateName ?? 'none'}`}
      {...props}
      existingRule={existingRule}
    />
  );
}

function DaypartingScheduleEditor({
  campaignId,
  campaignName,
  nmId,
  fromParam,
  toParam,
  existingRule,
}: Props & { existingRule?: DaypartingRule }) {
  const queryClient = useQueryClient();

  const recommendationQuery = useQuery<HeatmapRecommendationResponse | null>({
    queryKey: ['advertising', 'heatmap-dayparting', campaignId, nmId, fromParam, toParam],
    queryFn: () => {
      const params = new URLSearchParams({
        campaignId: String(campaignId),
        from: fromParam ?? '',
        to: toParam ?? '',
      });
      if (nmId) {
        params.set('nmId', String(nmId));
      }
      return fetch(`/api/views/advertising/heatmap/dayparting?${params.toString()}`).then((r) => r.json());
    },
    enabled: Boolean(fromParam && toParam),
  });

  const [schedule, setSchedule] = useState<boolean[]>(
    () => existingRule?.schedule ?? buildTemplateSchedule('always_on'),
  );
  const [activeTemplate, setActiveTemplate] = useState<DaypartingTemplate>(
    () => existingRule ? normalizeTemplateName(existingRule.templateName) : 'always_on',
  );
  const [isDragging, setIsDragging] = useState<boolean | null>(null);

  const applyTemplate = useCallback(
    (tpl: Exclude<DaypartingTemplate, 'custom'>) => {
      setSchedule(buildTemplateSchedule(tpl));
      setActiveTemplate(tpl);
    },
    [],
  );

  const toggleCell = useCallback(
    (day: number, hour: number) => {
      const idx = slotIndex(day, hour);
      setSchedule((prev) => {
        const next = [...prev];
        next[idx] = !next[idx];
        return next;
      });
      setActiveTemplate('custom');
    },
    [],
  );

  const handleMouseEnter = useCallback(
    (day: number, hour: number) => {
      if (isDragging === null) return;
      const idx = slotIndex(day, hour);
      setSchedule((prev) => {
        const next = [...prev];
        next[idx] = isDragging;
        return next;
      });
      setActiveTemplate('custom');
    },
    [isDragging],
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/views/advertising/dayparting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          schedule,
          template: activeTemplate === 'custom' ? 'custom' : activeTemplate,
        }),
      });
      if (!res.ok) throw new Error('Ошибка сохранения');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advertising', 'dayparting'] });
    },
  });

  const applyHeatmapMutation = useMutation({
    mutationFn: async () => {
      if (!fromParam || !toParam) {
        throw new Error('Нет диапазона дат');
      }
      const res = await fetch('/api/views/advertising/heatmap/dayparting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          ...(nmId ? { nmId } : {}),
          from: fromParam,
          to: toParam,
          dryRun: false,
        }),
      });
      const payload = await res.json() as HeatmapRecommendationResponse & { error?: string; rule?: DaypartingRule };
      if (!res.ok) throw new Error(payload.error ?? 'Ошибка сохранения heatmap');
      return payload;
    },
    onSuccess: (payload) => {
      if (payload.recommendation?.schedule?.length === 168) {
        setSchedule(payload.recommendation.schedule);
        setActiveTemplate('custom');
      }
      queryClient.invalidateQueries({ queryKey: ['advertising', 'dayparting'] });
      queryClient.invalidateQueries({ queryKey: ['advertising', 'audit'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/views/advertising/dayparting?campaignId=${campaignId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Ошибка удаления');
      return res.json();
    },
    onSuccess: () => {
      setSchedule(buildTemplateSchedule('always_on'));
      setActiveTemplate('always_on');
      queryClient.invalidateQueries({ queryKey: ['advertising', 'dayparting'] });
    },
  });

  const activeHours = schedule.filter(Boolean).length;
  const recommendation = recommendationQuery.data?.recommendation ?? null;
  const canUseHeatmap = recommendation?.status === 'ready' && recommendation.schedule.length === 168;
  const scopeLabel = recommendation?.scope?.attributionScope === 'group'
    ? `Кампания ${recommendation.scope.advertId} · склейка ${recommendation.scope.groupName ?? ''}`.trim()
    : recommendation?.scope?.attributionScope === 'sku'
      ? `Кампания ${recommendation.scope.advertId ?? campaignId} · nmID ${recommendation.scope.nmId}`
      : recommendation?.scope?.attributionScope === 'campaign'
        ? `Кампания ${recommendation.scope.advertId ?? campaignId}`
        : 'Весь кабинет';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-[--color-text-secondary]" />
          <h3 className="text-sm font-medium text-[--color-text-primary]">
            Расписание показов
            {campaignName && (
              <span className="ml-1 text-[--color-text-secondary] font-normal">
                — {campaignName}
              </span>
            )}
          </h3>
        </div>
        <span className="text-xs text-[--color-text-secondary]">
          {activeHours} / 168 слотов активны
        </span>
      </div>

      {/* Template buttons */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            { key: 'always_on', label: 'Круглосуточно' },
            { key: 'workday', label: 'Рабочее время (пн–пт, 9–21)' },
            { key: 'evening_weekend', label: 'Вечер + выходные' },
          ] as { key: Exclude<DaypartingTemplate, 'custom'>; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => applyTemplate(key)}
            className={[
              'text-xs px-3 py-1.5 rounded-md border transition-colors',
              activeTemplate === key
                ? 'bg-[--color-accent] text-white border-[--color-accent]'
                : 'border-[--color-border] text-[--color-text-secondary] hover:bg-[--color-surface-hover]',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
        {activeTemplate === 'custom' && (
          <span className="text-xs px-3 py-1.5 text-[--color-text-secondary]">
            Пользовательское
          </span>
        )}
      </div>

      {recommendation ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-black">Heatmap</p>
              <p className="mt-1 font-semibold">
                {canUseHeatmap
                  ? `Активно ${recommendation.activeHours}/168 · выключить ${recommendation.disabledHours} · данных ${recommendation.dataSlots} слотов`
                  : 'Недостаточно почасовой истории'}
              </p>
              <p className="mt-1 text-[11px] font-semibold opacity-80">{scopeLabel}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!canUseHeatmap) return;
                  setSchedule(recommendation.schedule);
                  setActiveTemplate('custom');
                }}
                disabled={!canUseHeatmap}
                className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-black text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-default disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 dark:border-emerald-800 dark:bg-slate-900 dark:text-emerald-200"
              >
                <Sparkles size={14} />
                Подставить
              </button>
              <button
                type="button"
                onClick={() => applyHeatmapMutation.mutate()}
                disabled={!canUseHeatmap || applyHeatmapMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-black text-white transition hover:bg-emerald-800 disabled:cursor-default disabled:bg-slate-300"
              >
                {applyHeatmapMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Сохранить heatmap
              </button>
            </div>
          </div>
          {applyHeatmapMutation.isError ? (
            <p className="mt-2 font-semibold text-red-600">{applyHeatmapMutation.error.message}</p>
          ) : null}
          {applyHeatmapMutation.isSuccess ? (
            <p className="mt-2 font-semibold text-emerald-700 dark:text-emerald-300">Heatmap-расписание сохранено</p>
          ) : null}
        </div>
      ) : null}

      {/* 7d × 24h grid */}
      <div
        className="overflow-x-auto select-none"
        onMouseLeave={() => setIsDragging(null)}
        onMouseUp={() => setIsDragging(null)}
      >
        <table className="border-collapse text-[10px]">
          <thead>
            <tr>
              <th scope="col" className="w-8" />
              {HOURS.map((h) => (
                <th
                  key={h}
                  className="w-5 text-center font-normal text-[--color-text-tertiary] pb-1"
                >
                  {h % 3 === 0 ? h : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((dayLabel, dayIdx) => (
              <tr key={dayIdx}>
                <td className="pr-2 text-right text-[--color-text-secondary] font-medium w-8">
                  {dayLabel}
                </td>
                {HOURS.map((hour) => {
                  const idx = slotIndex(dayIdx, hour);
                  const active = schedule[idx] ?? true;
                  return (
                    <td
                      key={hour}
                      className={[
                        'w-5 h-5 rounded-sm cursor-pointer transition-colors border border-[--color-border]',
                        active
                          ? 'bg-[--color-accent] border-[--color-accent]/50'
                          : 'bg-[--color-surface-secondary] hover:bg-[--color-surface-hover]',
                      ].join(' ')}
                      onMouseDown={() => {
                        setIsDragging(!active);
                        toggleCell(dayIdx, hour);
                      }}
                      onMouseEnter={() => handleMouseEnter(dayIdx, hour)}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[--color-text-tertiary]">
        Зелёный — кампания работает; серый — пауза. Клик или перетаскивание переключает слоты.
        Время Московское (UTC+3).
      </p>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-[--color-accent] text-white rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {saveMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Save size={14} />
          )}
          Сохранить расписание
        </button>

        {existingRule && (
          <button
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-red-300 text-red-500 rounded-md hover:bg-red-50 dark:hover:bg-red-950/20 disabled:opacity-50 transition-colors"
          >
            {deleteMutation.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            Удалить расписание
          </button>
        )}

        {saveMutation.isError && (
          <p className="text-sm text-red-500">Ошибка сохранения</p>
        )}
        {saveMutation.isSuccess && (
          <p className="text-sm text-green-600">Сохранено</p>
        )}
      </div>
    </div>
  );
}
