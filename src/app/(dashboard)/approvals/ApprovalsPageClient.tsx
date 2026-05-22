'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  FileJson,
  Link2,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';

type CostValues = {
  purchasePrice: number | null;
  deliveryToFF: number | null;
  deliveryToWB: number | null;
  packaging: number | null;
  fulfillment: number | null;
  totalCost: number | null;
};

type ApprovalItem = {
  nmId: number | null;
  draftSkuId: string | null;
  isNewProduct: boolean;
  externalSkuKey: string | null;
  supplierArticle: string | null;
  sourceArticle: string | null;
  variant: string | null;
  color: string | null;
  comment: string | null;
  linkedNmId: number | null;
  name: string | null;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  current: CostValues;
  proposed: CostValues;
  deltaTotal: number | null;
  indices: {
    current: {
      localityIndexPercent: number | null;
      irpPercent: number | null;
    };
    proposed: {
      localityIndexPercent: number | null;
      irpPercent: number | null;
    };
  } | null;
  fulfillment: {
    ownStock: {
      currentQty: number;
      proposedQty: number;
      deltaQty: number;
      receivedAt: string | null;
      notes: string | null;
    } | null;
    production: Array<{
      orderTitle: string;
      status: string;
      quantity: number;
      receivedQuantity: number;
      inTransitOrProductionQty: number;
      costPerUnit: number | null;
      totalCost: number | null;
      orderedAt: string | null;
      productionStartedAt: string | null;
      shippedAt: string | null;
      estimatedDeliveryAt: string | null;
      notes: string | null;
    }>;
    totals: {
      currentOwnStockQty: number;
      proposedOwnStockQty: number | null;
      currentProductionQty: number;
      proposedProductionQty: number;
      productionQuantity: number;
      receivedQuantity: number;
      purchaseAmount: number | null;
    };
  } | null;
};

type Approval = {
  id: string;
  tenantId: string;
  workerId: string;
  clientId: string;
  cabinetOid: string;
  actionType: string;
  title: string;
  description: string | null;
  source: string;
  sourceUpdatedAt: string;
  periodFrom: string;
  periodTo: string;
  confidence: string;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
  payload: Record<string, unknown>;
  artifact: {
    id: string;
    title: string;
    body: string | null;
    payload: Record<string, unknown>;
    createdAt: string;
  } | null;
  itemCount: number;
  items: ApprovalItem[];
  parseError: string | null;
  canExecute: boolean;
};

type ApprovalsResponse = {
  tenantId: string;
  role: string;
  canDecide: boolean;
  approvals: Approval[];
};

type ApprovalStatusFilter = 'all' | 'requested' | 'executed' | 'rejected';

const statusOptions: Array<{ value: ApprovalStatusFilter; label: string }> = [
  { value: 'all', label: 'Все' },
  { value: 'requested', label: 'Новые' },
  { value: 'executed', label: 'Применены' },
  { value: 'rejected', label: 'Отклонены' },
];

const costRows: Array<{ key: keyof CostValues; label: string }> = [
  { key: 'purchasePrice', label: 'Закупка' },
  { key: 'deliveryToFF', label: 'Доставка до ФФ' },
  { key: 'packaging', label: 'Упаковка' },
  { key: 'fulfillment', label: 'Фулфилмент' },
  { key: 'deliveryToWB', label: 'Доставка до ВБ' },
  { key: 'totalCost', label: 'Итого' },
];

function formatMoney(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  }).format(value);
}

function formatNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function formatPercentValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  }).format(value)}%`;
}

function formatIndexValue(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
    minimumFractionDigits: value % 1 === 0 ? 0 : 1,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function getStatusView(status: string) {
  if (status === 'requested') {
    return {
      label: 'На согласовании',
      tone: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-200',
    };
  }
  if (status === 'executed') {
    return {
      label: 'Применено',
      tone: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-200',
    };
  }
  if (status === 'rejected') {
    return {
      label: 'Отклонено',
      tone: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-200',
    };
  }
  return {
    label: status,
    tone: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
  };
}

function getDeltaTone(delta: number | null) {
  if (delta === null || delta === 0) return 'text-muted-foreground';
  return delta > 0 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-600 dark:text-emerald-300';
}

async function fetchApprovals(status: ApprovalStatusFilter): Promise<ApprovalsResponse> {
  const params = new URLSearchParams({ limit: '100' });
  if (status !== 'all') params.set('status', status);
  const response = await fetch(`/api/views/approvals?${params.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? 'Не удалось загрузить согласования');
  }
  return response.json();
}

async function submitDecision(approvalId: string, action: 'approve' | 'reject') {
  const response = await fetch(`/api/views/approvals/${approvalId}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: action === 'reject'
      ? JSON.stringify({ reason: 'rejected_from_ui' })
      : JSON.stringify({}),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? 'Не удалось выполнить действие');
  }

  return response.json();
}

async function submitDraftSkuLink(draftSkuId: string, nmId: number) {
  const response = await fetch(`/api/views/draft-skus/${draftSkuId}/link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nmId }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? 'Не удалось привязать draft SKU');
  }

  return response.json();
}

function approvalItemKey(item: ApprovalItem) {
  if (item.nmId !== null) return `nm:${item.nmId}`;
  if (item.draftSkuId) return `draft:${item.draftSkuId}`;
  if (item.externalSkuKey) return `external:${item.externalSkuKey}`;
  return `source:${item.supplierArticle ?? item.sourceArticle ?? item.name ?? 'new'}`;
}

export function ApprovalsPageClient({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<ApprovalStatusFilter>('requested');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery<ApprovalsResponse, Error>({
    queryKey: ['procifry-approvals', tenantId, status],
    queryFn: () => fetchApprovals(status),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
  const { data: countsData } = useQuery<ApprovalsResponse, Error>({
    queryKey: ['procifry-approvals-counts', tenantId],
    queryFn: () => fetchApprovals('all'),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });

  const approvals = useMemo(() => data?.approvals ?? [], [data?.approvals]);
  const selectedApproval = useMemo(
    () => approvals.find((approval) => approval.id === selectedId) ?? approvals[0] ?? null,
    [approvals, selectedId],
  );

  const decisionMutation = useMutation({
    mutationFn: ({ approvalId, action }: { approvalId: string; action: 'approve' | 'reject' }) =>
      submitDecision(approvalId, action),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['procifry-approvals'] });
      await queryClient.invalidateQueries({ queryKey: ['economics-template-v2'] });
    },
  });
  const linkMutation = useMutation({
    mutationFn: ({ draftSkuId, nmId }: { draftSkuId: string; nmId: number }) =>
      submitDraftSkuLink(draftSkuId, nmId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['procifry-approvals'] });
      await queryClient.invalidateQueries({ queryKey: ['stocks-v2'] });
    },
  });

  const counts = useMemo(() => {
    const result = { requested: 0, executed: 0, rejected: 0 };
    for (const approval of countsData?.approvals ?? approvals) {
      if (approval.status === 'requested') result.requested += 1;
      if (approval.status === 'executed') result.executed += 1;
      if (approval.status === 'rejected') result.rejected += 1;
    }
    return result;
  }, [approvals, countsData?.approvals]);

  return (
    <div className="space-y-5 pb-10">
      <div className="flex justify-end">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-card p-1">
            {statusOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatus(option.value)}
                className={`h-9 rounded-md px-3 text-xs font-bold transition-colors ${
                  status === option.value
                    ? 'bg-emerald-500 text-white shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-bold text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <SummaryMetric label="Новые" value={counts.requested} tone="text-amber-600 dark:text-amber-300" />
        <SummaryMetric label="Применены" value={counts.executed} tone="text-emerald-600 dark:text-emerald-300" />
        <SummaryMetric label="Отклонены" value={counts.rejected} tone="text-rose-600 dark:text-rose-300" />
      </div>

      {error ? (
        <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          {error.message}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex h-[42vh] items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
          <Loader2 className="mr-3 h-6 w-6 animate-spin text-emerald-500" />
          Загружаем заявки
        </div>
      ) : approvals.length === 0 ? (
        <div className="flex h-[42vh] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card text-center">
          <ClipboardCheck className="h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-bold text-foreground">Заявок нет</p>
          <p className="mt-1 text-xs text-muted-foreground">Фильтр: {statusOptions.find((option) => option.value === status)?.label}</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(420px,0.8fr)_minmax(0,1.2fr)]">
          <section className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-sm)]">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-black text-foreground">Очередь</p>
            </div>
            <div className="max-h-[68vh] overflow-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-border bg-subtle text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Заявка</th>
                    <th className="px-3 py-3">Статус</th>
                    <th className="px-3 py-3 text-right">SKU</th>
                    <th className="px-4 py-3 text-right">Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {approvals.map((approval) => {
                    const statusView = getStatusView(approval.status);
                    const active = selectedApproval?.id === approval.id;

                    return (
                      <tr
                        key={approval.id}
                        onClick={() => setSelectedId(approval.id)}
                        className={`cursor-pointer border-b border-border/70 transition-colors last:border-0 ${
                          active ? 'bg-emerald-500/8' : 'hover:bg-accent/70'
                        }`}
                      >
                        <td className="min-w-0 px-4 py-3">
                          <p className="max-w-[260px] truncate font-bold text-foreground">{approval.title}</p>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {approval.workerId} · {approval.actionType}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-bold ${statusView.tone}`}>
                            {statusView.label}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right font-bold text-foreground">{approval.itemCount}</td>
                        <td className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">
                          {formatDate(approval.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {selectedApproval ? (
            <ApprovalDetails
              approval={selectedApproval}
              canDecide={Boolean(data?.canDecide)}
              isBusy={decisionMutation.isPending}
              actionError={decisionMutation.error instanceof Error ? decisionMutation.error.message : null}
              linkBusyDraftSkuId={linkMutation.isPending ? linkMutation.variables?.draftSkuId ?? null : null}
              linkError={linkMutation.error instanceof Error ? linkMutation.error.message : null}
              onApprove={() => decisionMutation.mutate({ approvalId: selectedApproval.id, action: 'approve' })}
              onReject={() => decisionMutation.mutate({ approvalId: selectedApproval.id, action: 'reject' })}
              onLinkDraftSku={(draftSkuId, nmId) => linkMutation.mutate({ draftSkuId, nmId })}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function SummaryMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-[var(--shadow-xs)]">
      <p className="text-xs font-bold uppercase text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-black ${tone}`}>{value}</p>
    </div>
  );
}

function ApprovalDetails({
  approval,
  canDecide,
  isBusy,
  actionError,
  linkBusyDraftSkuId,
  linkError,
  onApprove,
  onReject,
  onLinkDraftSku,
}: {
  approval: Approval;
  canDecide: boolean;
  isBusy: boolean;
  actionError: string | null;
  linkBusyDraftSkuId: string | null;
  linkError: string | null;
  onApprove: () => void;
  onReject: () => void;
  onLinkDraftSku: (draftSkuId: string, nmId: number) => void;
}) {
  const statusView = getStatusView(approval.status);
  const isIndicesAction = approval.actionType === 'unit_economics_indices_update';
  const isFulfillmentAction = approval.actionType === 'fulfillment_stock_update';
  const [draftLinkValues, setDraftLinkValues] = useState<Record<string, string>>({});

  const updateDraftLinkValue = (draftSkuId: string, value: string) => {
    setDraftLinkValues((prev) => ({ ...prev, [draftSkuId]: value }));
  };

  const submitDraftLink = (draftSkuId: string) => {
    const nmId = Number(draftLinkValues[draftSkuId]);
    if (!Number.isInteger(nmId) || nmId <= 0) return;
    onLinkDraftSku(draftSkuId, nmId);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-[var(--shadow-sm)]">
      <div className="border-b border-border px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-bold ${statusView.tone}`}>
                {statusView.label}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">{approval.cabinetOid}</span>
            </div>
            <h3 className="mt-3 text-lg font-black text-foreground">{approval.title}</h3>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">
              {approval.workerId} · {approval.clientId} · {formatDate(approval.createdAt)}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={onReject}
              disabled={!canDecide || approval.status !== 'requested' || isBusy}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-300 bg-card px-3 text-xs font-black text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800/60 dark:text-rose-300 dark:hover:bg-rose-950/30"
            >
              <XCircle className="h-4 w-4" />
              Отклонить
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={!canDecide || !approval.canExecute || isBusy}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-3 text-xs font-black text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Одобрить и применить
            </button>
          </div>
        </div>

        {approval.parseError ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-200">
            Ошибка payload: {approval.parseError}
          </div>
        ) : null}

        {actionError ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-200">
            {actionError}
          </div>
        ) : null}

        {linkError ? (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-200">
            {linkError}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 border-b border-border px-4 py-3 text-xs md:grid-cols-4">
        <MetaItem label="Источник" value={approval.source} />
        <MetaItem label="Freshness" value={formatDate(approval.sourceUpdatedAt)} />
        <MetaItem label="Период" value={`${formatDate(approval.periodFrom)} - ${formatDate(approval.periodTo)}`} />
        <MetaItem label="Confidence" value={approval.confidence} />
      </div>

      <div className="max-h-[58vh] overflow-auto">
        {isIndicesAction ? (
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-subtle text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-3 py-3 text-right">ИЛ</th>
                <th className="px-4 py-3 text-right">ИРП %</th>
              </tr>
            </thead>
            <tbody>
              {approval.items.map((item) => (
                <tr key={approvalItemKey(item)} className="border-b border-border/70 last:border-0">
                  <td className="min-w-0 px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.photoUrl}
                          alt=""
                          className="h-10 w-10 rounded-md border border-border object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-subtle text-[10px] font-black text-muted-foreground">
                          WB
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-bold text-foreground">{item.name ?? item.vendorCode ?? item.nmId ?? 'Новый товар'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{item.nmId ? `nmId ${item.nmId}` : 'Новый товар, WB nmId ещё нет'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="font-bold text-foreground">{formatIndexValue(item.indices?.proposed.localityIndexPercent ?? null)}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">было {formatIndexValue(item.indices?.current.localityIndexPercent ?? null)}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="font-bold text-foreground">{formatPercentValue(item.indices?.proposed.irpPercent ?? null)}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">было {formatPercentValue(item.indices?.current.irpPercent ?? null)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : isFulfillmentAction ? (
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-subtle text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-3 py-3 text-right">Свой склад</th>
                <th className="px-3 py-3 text-right">В производстве / Китай</th>
                <th className="px-3 py-3 text-right">Партия</th>
                <th className="px-3 py-3 text-right">Принято</th>
                <th className="px-3 py-3 text-right">Закупка</th>
                <th className="px-3 py-3">Даты</th>
                <th className="px-4 py-3 text-right">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {approval.items.map((item) => {
                const fulfillment = item.fulfillment;
                const firstProduction = fulfillment?.production[0] ?? null;

                return (
                  <tr key={approvalItemKey(item)} className="border-b border-border/70 last:border-0">
                    <td className="min-w-0 px-4 py-3">
                      <div className="flex items-center gap-3">
                        {item.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.photoUrl}
                            alt=""
                            className="h-10 w-10 rounded-md border border-border object-cover"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-subtle text-[10px] font-black text-muted-foreground">
                            WB
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-bold text-foreground">{item.name ?? item.vendorCode ?? item.externalSkuKey ?? item.nmId ?? 'Новый товар'}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {item.nmId ? `nmId ${item.nmId}` : 'Новый товар, WB nmId ещё нет'}
                          </p>
                          {!item.nmId ? (
                            <div className="mt-1 flex max-w-[260px] flex-wrap gap-1 text-[11px] font-semibold text-muted-foreground">
                              {item.supplierArticle ? <span>арт. {item.supplierArticle}</span> : null}
                              {item.externalSkuKey ? <span>{item.externalSkuKey}</span> : null}
                              {item.color ? <span>{item.color}</span> : null}
                              {item.variant ? <span>{item.variant}</span> : null}
                            </div>
                          ) : null}
                          {item.draftSkuId && !item.linkedNmId ? (
                            <div className="mt-2 flex items-center gap-1">
                              <input
                                value={draftLinkValues[item.draftSkuId] ?? ''}
                                onChange={(event) => updateDraftLinkValue(item.draftSkuId!, event.target.value)}
                                inputMode="numeric"
                                placeholder="WB nmId"
                                className="h-8 w-28 rounded-md border border-border bg-background px-2 text-xs font-semibold outline-none focus:border-emerald-500"
                              />
                              <button
                                type="button"
                                onClick={() => submitDraftLink(item.draftSkuId!)}
                                disabled={!canDecide || linkBusyDraftSkuId === item.draftSkuId}
                                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-black text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {linkBusyDraftSkuId === item.draftSkuId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                                Привязать
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="font-bold text-foreground">
                        {fulfillment?.ownStock
                          ? `${formatNumber(fulfillment.ownStock.currentQty)} → ${formatNumber(fulfillment.ownStock.proposedQty)}`
                          : formatNumber(fulfillment?.totals.currentOwnStockQty ?? null)}
                      </div>
                      {fulfillment?.ownStock ? (
                        <div className={`mt-0.5 text-[11px] font-semibold ${fulfillment.ownStock.deltaQty >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                          {fulfillment.ownStock.deltaQty >= 0 ? '+' : ''}{formatNumber(fulfillment.ownStock.deltaQty)}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[11px] text-muted-foreground">без изменения</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="font-bold text-foreground">
                        {formatNumber(fulfillment?.totals.currentProductionQty ?? null)} → {formatNumber(fulfillment?.totals.proposedProductionQty ?? null)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        партия +{formatNumber(fulfillment
                          ? fulfillment.production.reduce((sum, line) => sum + line.inTransitOrProductionQty, 0)
                          : null)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="font-bold text-foreground">{formatNumber(fulfillment?.totals.productionQuantity ?? null)}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {firstProduction?.status ?? '—'} · {fulfillment?.production.length ?? 0} стр.
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="font-bold text-foreground">{formatNumber(fulfillment?.totals.receivedQuantity ?? null)}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">receivedQuantity</div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="font-bold text-foreground">{formatMoney(firstProduction?.costPerUnit ?? null)}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">₽/шт</div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <div className="font-semibold text-foreground">{firstProduction?.orderTitle ?? '—'}</div>
                      <div className="mt-1 text-muted-foreground">
                        заказ {formatDate(firstProduction?.orderedAt ?? null)} · отгрузка {formatDate(firstProduction?.shippedAt ?? null)} · ETA {formatDate(firstProduction?.estimatedDeliveryAt ?? null)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-black text-foreground">
                      {formatMoney(fulfillment?.totals.purchaseAmount ?? null)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-subtle text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">SKU</th>
                {costRows.map((row) => (
                  <th key={row.key} className="px-3 py-3 text-right">{row.label}</th>
                ))}
                <th className="px-4 py-3 text-right">Изм.</th>
              </tr>
            </thead>
            <tbody>
              {approval.items.map((item) => (
                <tr key={approvalItemKey(item)} className="border-b border-border/70 last:border-0">
                  <td className="min-w-0 px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.photoUrl}
                          alt=""
                          className="h-10 w-10 rounded-md border border-border object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-subtle text-[10px] font-black text-muted-foreground">
                          WB
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-bold text-foreground">{item.name ?? item.vendorCode ?? item.nmId ?? 'Новый товар'}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{item.nmId ? `nmId ${item.nmId}` : 'Новый товар, WB nmId ещё нет'}</p>
                      </div>
                    </div>
                  </td>
                  {costRows.map((row) => (
                    <td key={row.key} className="px-3 py-3 text-right">
                      <div className="font-bold text-foreground">{formatMoney(item.proposed[row.key])}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">было {formatMoney(item.current[row.key])}</div>
                    </td>
                  ))}
                  <td className={`px-4 py-3 text-right font-black ${getDeltaTone(item.deltaTotal)}`}>
                    {item.deltaTotal === null || item.deltaTotal === 0
                      ? '—'
                      : `${item.deltaTotal > 0 ? '+' : ''}${formatMoney(item.deltaTotal)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <details className="border-t border-border px-4 py-3">
        <summary className="inline-flex cursor-pointer items-center gap-2 text-xs font-black text-muted-foreground hover:text-foreground">
          <FileJson className="h-4 w-4" />
          Сырой payload
        </summary>
        <pre className="mt-3 max-h-[360px] overflow-auto rounded-lg border border-border bg-subtle p-3 text-xs leading-relaxed text-foreground">
          {JSON.stringify({
            approvalPayload: approval.payload,
            artifactPayload: approval.artifact?.payload ?? null,
          }, null, 2)}
        </pre>
      </details>
    </section>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-bold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-semibold text-foreground">{value}</p>
    </div>
  );
}
