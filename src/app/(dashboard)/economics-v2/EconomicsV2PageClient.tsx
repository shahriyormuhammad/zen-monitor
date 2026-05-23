'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Loader2, Save } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { toLocalDateParam } from '@/lib/date-range';
import { OperatorState } from '@/components/dashboard/OperatorState';
import { EconomicsTable } from '@/components/economics/table';

type EconomicsTemplateResponse = {
  data: Array<Record<string, unknown>>;
  cabinetIndices?: CabinetIndices | null;
  manualInputsByNm?: Record<string, Record<string, unknown>>;
  calculationMode?: 'FACT_WB' | 'PLAN_TEMPLATE';
  acceptanceTariffs?: Array<Record<string, unknown>>;
  acceptanceTariffsDate?: string | null;
  boxTariffs?: Array<Record<string, unknown>>;
  boxTariffsDate?: string | null;
  returnTariffs?: Array<Record<string, unknown>>;
  returnTariffsDate?: string | null;
  wbWarehouseNames?: string[];
  defaultTaxPercent?: number | null;
};

type CabinetIndices = {
  localityIndex: number | string | null;
  irpPercent: number | string | null;
  source: 'wb_tariffs' | 'manual' | 'none' | string | null;
  effectiveWeek: string | null;
  fetchedAt: string | null;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function sourceLabel(source: CabinetIndices['source']): string {
  if (source === 'wb_tariffs') return 'WB';
  if (source === 'manual') return 'Вручную';
  return 'Нет данных';
}

function CabinetIndicesPanel({
  indices,
  onSaved,
}: {
  indices: CabinetIndices | null | undefined;
  onSaved: () => Promise<unknown>;
}) {
  const [localityIndex, setLocalityIndex] = useState('');
  const [irpPercent, setIrpPercent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setLocalityIndex(indices?.localityIndex != null ? String(indices.localityIndex) : '');
    setIrpPercent(indices?.irpPercent != null ? String(indices.irpPercent) : '');
    setMessage(null);
  }, [indices?.localityIndex, indices?.irpPercent]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/views/economics-template/cabinet-indices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ localityIndex, irpPercent }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
        throw new Error(body?.error ?? body?.message ?? 'Не удалось сохранить ИЛ/ИРП');
      }
      await onSaved();
      setMessage('Сохранено вручную. Следующее успешное обновление WB перезапишет эти значения.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить ИЛ/ИРП');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="mb-4 rounded-lg border border-border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">Кабинетные ИЛ/ИРП</h2>
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
              источник: {sourceLabel(indices?.source ?? null)}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Одно значение применяется ко всем артикулам кабинета. WB-обновление имеет приоритет и перезаписывает ручной ввод.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Неделя: {indices?.effectiveWeek ?? '—'} · обновлено: {formatDate(indices?.fetchedAt)}
          </p>
        </div>
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={handleSubmit}>
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            ИЛ
            <input
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold text-foreground outline-none focus:border-emerald-500 sm:w-24"
              inputMode="decimal"
              value={localityIndex}
              onChange={(event) => setLocalityIndex(event.target.value)}
              placeholder="1.00"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
            ИРП, %
            <input
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm font-semibold text-foreground outline-none focus:border-emerald-500 sm:w-24"
              inputMode="decimal"
              value={irpPercent}
              onChange={(event) => setIrpPercent(event.target.value)}
              placeholder="0.00"
            />
          </label>
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Сохранить
          </button>
        </form>
      </div>
      {message ? <p className="mt-2 text-xs font-medium text-muted-foreground">{message}</p> : null}
    </section>
  );
}



export function EconomicsV2PageClient({ tenantId: _tenantId }: { tenantId: string }) {
  const { dateFrom, dateTo } = useStore();
  const searchParams = useSearchParams();
  const focusNmId = useMemo(() => {
    const raw = searchParams.get('focusNmId');
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  const { data, isLoading, error, refetch } = useQuery<EconomicsTemplateResponse | null, Error>({
    queryKey: ['economics-template-v2', _tenantId, dateFrom, dateTo],
    queryFn: async () => {
      const response = await fetch(
        `/api/views/economics-template?from=${toLocalDateParam(dateFrom)}&to=${toLocalDateParam(dateTo)}&scope=costed`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('Ошибка при загрузке шаблона юнит-экономики');
      return response.json();
    },
    // Always pull a fresh snapshot when the user re-enters the page or the
    // tab regains focus. Otherwise TanStack Query shows the previous in-memory
    // copy of `manualInputsByNm`, the bootstrap effect parses those stale
    // values and overwrites localStorage with them — making freshly-saved
    // edits appear to disappear.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });

  const tableRows = useMemo(() => data?.data ?? [], [data?.data]);
  const boxTariffs = useMemo(
    () => (data?.boxTariffs ?? []) as Parameters<typeof EconomicsTable>[0]['boxTariffs'],
    [data?.boxTariffs],
  );
  const acceptanceTariffs = useMemo(
    () => (data?.acceptanceTariffs ?? []) as Parameters<typeof EconomicsTable>[0]['acceptanceTariffs'],
    [data?.acceptanceTariffs],
  );
  const returnTariffs = useMemo(
    () => (data?.returnTariffs ?? []) as Parameters<typeof EconomicsTable>[0]['returnTariffs'],
    [data?.returnTariffs],
  );

  if (isLoading) {
    return (
      <div className="flex h-[55vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse font-medium text-muted-foreground">Загружаем юнит-экономику…</p>
      </div>
    );
  }

  if (error) {
    return (
      <OperatorState
        icon={ClipboardList}
        tone="danger"
        title="Не удалось загрузить данные"
        description={error.message}
        actionLabel="Повторить запрос"
        action={refetch}
      />
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-500 pb-10">
      <CabinetIndicesPanel indices={data?.cabinetIndices} onSaved={refetch} />
      <EconomicsTable
        data={tableRows as Parameters<typeof EconomicsTable>[0]['data']}
        manualInputsByNm={data?.manualInputsByNm ?? {}}
        boxTariffs={boxTariffs}
        acceptanceTariffs={acceptanceTariffs}
        returnTariffs={returnTariffs}
        wbWarehouseNames={data?.wbWarehouseNames ?? []}
        defaultTaxPercent={data?.defaultTaxPercent ?? null}
        focusNmId={focusNmId}
      />
    </div>
  );
}
