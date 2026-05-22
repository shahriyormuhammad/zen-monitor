'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Loader2 } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { toLocalDateParam } from '@/lib/date-range';
import { OperatorState } from '@/components/dashboard/OperatorState';
import { EconomicsTable } from '@/components/economics/table';

type EconomicsTemplateResponse = {
  data: Array<Record<string, unknown>>;
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
