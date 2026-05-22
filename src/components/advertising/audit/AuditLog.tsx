'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronDown,
  History,
  Loader2,
  RotateCcw,
} from 'lucide-react';

interface AuditEntry {
  id: string;
  campaignId: number | null;
  nmId: number | null;
  actionType: string;
  objectType: string;
  valueBefore: unknown;
  valueAfter: unknown;
  reason: string | null;
  rolledBack: boolean;
  rolledBackAt: string | null;
  source: string;
  createdAt: string;
}

interface AuditResponse {
  entries: AuditEntry[];
}

const ACTION_LABELS: Record<string, string> = {
  bid_raise: 'Ставка ↑',
  bid_lower: 'Ставка ↓',
  pause_drr: 'Пауза (ДРР)',
  pause_stock: 'Пауза (остатки)',
  pause_no_orders: 'Пауза (0 заказов)',
  pause_low_cr: 'Пауза (CR)',
  dayparting_pause: 'Пауза (расписание)',
  dayparting_resume: 'Возобновление',
  dayparting_rule: 'Правило расписания',
  cap_reached: 'Лимит дня',
  kill_switch: 'Kill switch',
  manual: 'Вручную',
};

const ACTION_TYPE_OPTIONS = [
  { value: '', label: 'Все типы' },
  { value: 'bid_raise', label: 'Ставка ↑' },
  { value: 'bid_lower', label: 'Ставка ↓' },
  { value: 'pause_drr', label: 'Пауза (ДРР)' },
  { value: 'pause_stock', label: 'Пауза (остатки)' },
  { value: 'dayparting_pause', label: 'Пауза (расписание)' },
  { value: 'dayparting_resume', label: 'Возобновление' },
  { value: 'dayparting_rule', label: 'Правило расписания' },
];

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function BidValue({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return <span className="text-[--color-text-tertiary]">—</span>;
  const v = value as Record<string, unknown>;
  if (v.bid != null) return <span>{String(v.bid)}₽</span>;
  return <span className="text-[--color-text-tertiary] text-xs">см. детали</span>;
}

export function AuditLog() {
  const queryClient = useQueryClient();
  const [actionType, setActionType] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (actionType) params.set('actionType', actionType);
  if (campaignId) params.set('campaignId', campaignId);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);

  const { data, isLoading, isError, refetch } = useQuery<AuditResponse>({
    queryKey: ['advertising', 'audit', actionType, campaignId, dateFrom, dateTo],
    queryFn: () =>
      fetch(`/api/views/advertising/audit?${params.toString()}`).then((r) => r.json()),
  });

  const rollbackMutation = useMutation({
    mutationFn: async (auditEntryId: string) => {
      const res = await fetch('/api/views/advertising/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rollback', auditEntryId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? 'Ошибка отката');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['advertising', 'audit'] });
    },
  });

  const entries = data?.entries ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History size={16} className="text-[--color-text-secondary]" />
        <h3 className="text-sm font-medium text-[--color-text-primary]">История автодействий</h3>
        <button
          onClick={() => refetch()}
          className="ml-auto text-xs text-[--color-text-secondary] hover:text-[--color-text-primary] flex items-center gap-1"
        >
          <RotateCcw size={12} />
          Обновить
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value)}
          className="text-xs border border-[--color-border] rounded-md px-2 py-1.5 bg-[--color-surface] text-[--color-text-primary]"
        >
          {ACTION_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <input
          type="number"
          placeholder="ID кампании"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          className="text-xs border border-[--color-border] rounded-md px-2 py-1.5 w-32 bg-[--color-surface] text-[--color-text-primary]"
        />

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="text-xs border border-[--color-border] rounded-md px-2 py-1.5 bg-[--color-surface] text-[--color-text-primary]"
        />
        <span className="text-xs text-[--color-text-tertiary] self-center">—</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="text-xs border border-[--color-border] rounded-md px-2 py-1.5 bg-[--color-surface] text-[--color-text-primary]"
        />
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-[--color-text-secondary] py-6 justify-center">
          <Loader2 size={16} className="animate-spin" />
          <span>Загрузка…</span>
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 text-red-500 py-4">
          <AlertCircle size={16} />
          <span>Ошибка загрузки данных</span>
        </div>
      )}

      {!isLoading && !isError && entries.length === 0 && (
        <p className="text-sm text-[--color-text-secondary] py-6 text-center">
          Нет записей по заданным фильтрам
        </p>
      )}

      {entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[--color-border] text-[--color-text-secondary] text-xs">
                <th scope="col" className="text-left py-2 pr-3 font-medium">Время</th>
                <th scope="col" className="text-left py-2 pr-3 font-medium">Тип</th>
                <th scope="col" className="text-left py-2 pr-3 font-medium">Кампания</th>
                <th scope="col" className="text-left py-2 pr-3 font-medium">До</th>
                <th scope="col" className="text-left py-2 pr-3 font-medium">После</th>
                <th scope="col" className="text-left py-2 pr-3 font-medium">Причина</th>
                <th scope="col" className="py-2" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <>
                  <tr
                    key={entry.id}
                    className={[
                      'border-b border-[--color-border]/50 hover:bg-[--color-surface-hover] transition-colors',
                      entry.rolledBack ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    <td className="py-2 pr-3 text-[--color-text-secondary] whitespace-nowrap text-xs">
                      {formatDateTime(entry.createdAt)}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={[
                        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                        entry.actionType.startsWith('bid_raise')
                          ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400'
                          : entry.actionType.startsWith('bid_lower')
                          ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400'
                          : entry.actionType.startsWith('pause')
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                          : 'bg-[--color-surface-secondary] text-[--color-text-secondary]',
                      ].join(' ')}>
                        {ACTION_LABELS[entry.actionType] ?? entry.actionType}
                      </span>
                      {entry.rolledBack && (
                        <span className="ml-1 text-[10px] text-[--color-text-tertiary]">
                          (откатано)
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-[--color-text-secondary] text-xs">
                      {entry.campaignId ?? '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <BidValue value={entry.valueBefore} />
                    </td>
                    <td className="py-2 pr-3">
                      <BidValue value={entry.valueAfter} />
                    </td>
                    <td className="py-2 pr-3 text-[--color-text-secondary] text-xs max-w-[200px] truncate">
                      {entry.reason ?? '—'}
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {entry.actionType.startsWith('bid_') && !entry.rolledBack && (
                          <button
                            onClick={() => rollbackMutation.mutate(entry.id)}
                            disabled={rollbackMutation.isPending}
                            title="Откатить ставку"
                            className="flex items-center gap-1 text-xs px-2 py-1 border border-[--color-border] text-[--color-text-secondary] rounded hover:bg-[--color-surface-hover] disabled:opacity-50 transition-colors"
                          >
                            {rollbackMutation.isPending && rollbackMutation.variables === entry.id ? (
                              <Loader2 size={10} className="animate-spin" />
                            ) : (
                              <RotateCcw size={10} />
                            )}
                            Откатить
                          </button>
                        )}
                        {entry.reason && (
                          <button
                            onClick={() =>
                              setExpandedId(expandedId === entry.id ? null : entry.id)
                            }
                            className="text-[--color-text-tertiary] hover:text-[--color-text-secondary] transition-colors"
                          >
                            <ChevronDown
                              size={14}
                              className={`transition-transform ${
                                expandedId === entry.id ? 'rotate-180' : ''
                              }`}
                            />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === entry.id && (
                    <tr
                      key={`${entry.id}-expanded`}
                      className="border-b border-[--color-border]/50 bg-[--color-surface-secondary]"
                    >
                      <td colSpan={7} className="py-2 px-3">
                        <div className="text-xs text-[--color-text-secondary] space-y-1">
                          <p>
                            <span className="font-medium">Причина:</span> {entry.reason}
                          </p>
                          {entry.valueBefore != null && (
                            <p>
                              <span className="font-medium">До:</span>{' '}
                              <code className="bg-[--color-surface] px-1 rounded">
                                {JSON.stringify(entry.valueBefore)}
                              </code>
                            </p>
                          )}
                          {entry.valueAfter != null && (
                            <p>
                              <span className="font-medium">После:</span>{' '}
                              <code className="bg-[--color-surface] px-1 rounded">
                                {JSON.stringify(entry.valueAfter)}
                              </code>
                            </p>
                          )}
                          <p>
                            <span className="font-medium">Источник:</span> {entry.source}
                            {entry.rolledBackAt && (
                              <> · откатано {formatDateTime(entry.rolledBackAt)}</>
                            )}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rollbackMutation.isError && (
        <div className="flex items-center gap-2 text-red-500 text-sm">
          <AlertCircle size={14} />
          <span>{(rollbackMutation.error as Error).message}</span>
        </div>
      )}
    </div>
  );
}
