'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  MapPin,
  Package,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';

import { OperatorState } from '@/components/dashboard/OperatorState';
import { formatCurrency, formatNumber, formatPercent } from '@/components/economics/helpers';
import { resolveIrpFromLocalization, resolveLocalityIndexMultiplierFromLocalization as resolveKtrFromLocalization } from '@/components/economics/constants';
import { toLocalDateParam } from '@/lib/date-range';
import { useStore } from '@/store/useStore';
import type {
  RedistributionPlan,
  RedistributionTransferRecommendation,
} from '@/server/analytics/redistribution';

import { exportRedistributionXlsx } from './redistributionExport';
import { getRobotSessionStatus, type RobotSessionStatus } from './actions';

const PAGE_SIZE = 20;

type RedistributionExecutionLog = {
  generatedAt: string;
  tenantId: string;
  windowHours: number;
  itemStatusCounts: Record<string, number>;
  items: Array<{
    id: string;
    status: string;
    nmId: number;
    vendorCode: string | null;
    brand: string | null;
    sizeName: string;
    fromWarehouse: string;
    fromOfficeId: number | null;
    toWarehouse: string;
    toOfficeId: number | null;
    transferUnits: number;
    executionNote: string | null;
    executedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    runId: string;
    runTriggerSource: string | null;
    runCreatedAt: string | null;
  }>;
  attempts: Array<{
    observedAt: string | null;
    fromWarehouse: string;
    toWarehouse: string;
    status: string;
    reason: string | null;
    source: string;
    runId: string | null;
    nmId: number | null;
    itemId: string | null;
    sizeName: string | null;
    fromOfficeId: number | null;
    toOfficeId: number | null;
    srcQuota: number | null;
    dstQuota: number | null;
    canSubmitUnits: number | null;
    submitted: boolean;
    submittedUnits: number;
  }>;
  monitorRuns: Array<{
    startedAt: string | null;
    finishedAt: string | null;
    triggerSource: string;
    mode: string;
    status: string;
    skipped: boolean;
    message: string | null;
    autoSubmit: boolean;
    maxRoutesPerTenant: number | null;
    probedItems: number;
    openedSlots: number;
  }>;
};

function formatDateTimeMsk(value: string | null) {
  if (!value) return 'вЂ”';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'вЂ”';
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

function executionStatusLabel(status: string) {
  if (status === 'rpa_submitted') return 'РЎРѕР·РґР°РЅРѕ РІ WB';
  if (status === 'rpa_failed') return 'РќРµ СЃРѕР·РґР°РЅРѕ';
  if (status === 'rpa_queued') return 'Р’ РѕС‡РµСЂРµРґРё';
  if (status === 'rpa_running') return 'Р’ СЂР°Р±РѕС‚Рµ';
  if (status === 'planned') return 'РћР¶РёРґР°РµС‚ СЃР»РѕС‚Р°';
  if (status === 'rejected') return 'РћС‚РєР»РѕРЅРµРЅРѕ';
  return status;
}

function executionStatusClass(status: string) {
  if (status === 'rpa_submitted') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'rpa_failed') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'rpa_running' || status === 'rpa_queued') return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  return 'border-border bg-muted text-muted-foreground';
}

function attemptStatusLabel(status: string, submitted: boolean) {
  if (submitted) return 'Р—Р°СЏРІРєР° СѓС€Р»Р°';
  if (status === 'available') return 'РЎР»РѕС‚ Р±С‹Р»';
  if (status === 'limit_exhausted') return 'Р›РёРјРёС‚ РЅРѕР»СЊ';
  if (status === 'route_unavailable') return 'РњР°СЂС€СЂСѓС‚ РЅРµРґРѕСЃС‚СѓРїРµРЅ';
  if (status === 'transient_error') return 'РћС€РёР±РєР° WB';
  return status;
}

function attemptStatusClass(status: string, submitted: boolean) {
  if (submitted || status === 'available') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'transient_error') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300';
  return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
}

function explainAttemptReason(reason: string | null) {
  if (!reason) return 'WB РЅРµ РІРµСЂРЅСѓР» РїСЂРёС‡РёРЅСѓ.';
  if (reason.includes('HTTP 429')) return 'WB РѕРіСЂР°РЅРёС‡РёР» С‡Р°СЃС‚РѕС‚Сѓ Р·Р°РїСЂРѕСЃРѕРІ. РњРѕРЅРёС‚РѕСЂ РїСЂРѕРґРѕР»Р¶РёС‚ РїСЂРѕРІРµСЂСЏС‚СЊ СЃ РїР°СѓР·Р°РјРё.';
  if (reason === 'src_quota_zero') return 'РќР° РёСЃС…РѕРґСЏС‰РµРј СЃРєР»Р°РґРµ Р·Р°РєРѕРЅС‡РёР»СЃСЏ СЃСѓС‚РѕС‡РЅС‹Р№ Р»РёРјРёС‚ РѕС‚РїСЂР°РІРєРё.';
  if (reason === 'dst_quota_zero') return 'РќР° СЃРєР»Р°РґРµ РЅР°Р·РЅР°С‡РµРЅРёСЏ Р·Р°РєРѕРЅС‡РёР»СЃСЏ СЃСѓС‚РѕС‡РЅС‹Р№ Р»РёРјРёС‚ РїСЂРёС‘РјР°.';
  if (reason === 'source_warehouse_not_found') return 'WB РЅРµ РѕС‚РґР°Р» СЌС‚РѕС‚ СЃРєР»Р°Рґ РєР°Рє РґРѕСЃС‚СѓРїРЅС‹Р№ РёСЃС…РѕРґСЏС‰РёР№ РґР»СЏ Р°СЂС‚РёРєСѓР»Р°.';
  if (reason === 'destination_warehouse_not_found') return 'WB РЅРµ РѕС‚РґР°Р» СЃРєР»Р°Рґ РЅР°Р·РЅР°С‡РµРЅРёСЏ РґР»СЏ Р°СЂС‚РёРєСѓР»Р°.';
  if (reason === 'size_not_in_source_stock') return 'WB РЅРµ РІРёРґРёС‚ РЅСѓР¶РЅС‹Р№ СЂР°Р·РјРµСЂ РЅР° РёСЃС…РѕРґРЅРѕРј СЃРєР»Р°РґРµ.';
  if (reason === 'source_stock_zero') return 'WB РІРёРґРёС‚ РЅСѓР»РµРІРѕР№ РѕСЃС‚Р°С‚РѕРє РЅР° РёСЃС…РѕРґРЅРѕРј СЃРєР»Р°РґРµ.';
  if (reason === 'http_order_submitted') return 'WB РїСЂРёРЅСЏР» Р·Р°СЏРІРєСѓ РЅР° РїРµСЂРµРјРµС‰РµРЅРёРµ.';
  return reason;
}

function HeroTile({
  icon: Icon,
  iconClass,
  label,
  primary,
  secondary,
  tone = 'default',
}: {
  icon: React.ElementType;
  iconClass: string;
  label: string;
  primary: React.ReactNode;
  secondary: React.ReactNode;
  tone?: 'ok' | 'warning' | 'critical' | 'default';
}) {
  const border =
    tone === 'ok'
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : tone === 'warning'
        ? 'border-amber-500/40 bg-amber-500/5'
        : tone === 'critical'
          ? 'border-rose-500/40 bg-rose-500/5'
          : 'border-border bg-card';
  return (
    <div className={`rounded-2xl border ${border} px-5 py-4 shadow-sm`}>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className={`h-4 w-4 ${iconClass}`} />
        {label}
      </div>
      <div className="mt-2 text-3xl font-bold tabular-nums text-foreground">{primary}</div>
      <div className="mt-1 text-xs text-muted-foreground">{secondary}</div>
    </div>
  );
}

function RobotStatusBlock({ status }: { status: RobotSessionStatus }) {
  let tone: 'ok' | 'warning' | 'critical' = 'critical';
  let title = 'рџ”ґ Р РѕР±РѕС‚ РЅРµ РЅР°СЃС‚СЂРѕРµРЅ';
  let body: React.ReactNode = (
    <>
      РџРµСЂРµР№РґРёС‚Рµ РІ <Link href="/settings" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">РќР°СЃС‚СЂРѕР№РєРё в†’ WB Р›Рљ</Link> Рё РІРѕР№РґРёС‚Рµ С‡РµСЂРµР· СЂРѕР±РѕС‚Р°.
      Р‘РµР· СЌС‚РѕРіРѕ В«Р—Р°РІРµСЃС‚Рё РІ WB Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРёВ» РЅРµ СЃСЂР°Р±РѕС‚Р°РµС‚ вЂ” РїСЂРёРґС‘С‚СЃСЏ СЃРєР°С‡РёРІР°С‚СЊ Excel Рё Р·Р°РІРѕРґРёС‚СЊ Р·Р°СЏРІРєРё СЂСѓРєР°РјРё.
    </>
  );

  if (status.hasSession && status.markedActive) {
    if (status.freshness === 'fresh') {
      tone = 'ok';
      title = 'рџџў Р РѕР±РѕС‚ РіРѕС‚РѕРІ';
      const ageStr = status.ageDays != null && status.ageDays > 0 ? ` (РѕР±РЅРѕРІР»РµРЅРѕ ${status.ageDays} РґРЅ РЅР°Р·Р°Рґ)` : ' (СЃРІРµР¶Р°СЏ СЃРµСЃСЃРёСЏ)';
      body = <>Р РѕР±РѕС‚ РјРѕР¶РµС‚ Р·Р°Р№С‚Рё РІ WB Рё РѕС„РѕСЂРјРёС‚СЊ Р·Р°СЏРІРєРё СЃР°Рј.{ageStr}</>;
    } else if (status.freshness === 'stale') {
      tone = 'warning';
      title = 'рџџЎ РЎРµСЃСЃРёСЏ РґР°РІРЅРѕ РЅРµ РѕР±РЅРѕРІР»СЏР»Р°СЃСЊ';
      body = (
        <>
          РЎРµСЃСЃРёСЏ Р¶РёРІС‘С‚ {status.ageDays} РґРЅРµР№ вЂ” РїРѕРєР° СЂР°Р±РѕС‚Р°РµС‚, РЅРѕ СЂРµРєРѕРјРµРЅРґСѓРµРј
          РїРµСЂРµРІРѕР№С‚Рё РІ <Link href="/settings" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">РќР°СЃС‚СЂРѕР№РєР°С…</Link>, С‡С‚РѕР±С‹ РєСѓРєРё РЅРµ РёСЃС‚РµРєР»Рё.
        </>
      );
    } else {
      tone = 'critical';
      title = 'рџ”ґ РЎРµСЃСЃРёСЏ СѓСЃС‚Р°СЂРµР»Р°';
      body = (
        <>
          РџСЂРѕС€Р»Рѕ {status.ageDays ?? 'вЂ”'} РґРЅРµР№ вЂ” РЅСѓР¶РЅРѕ Р·Р°Р№С‚Рё Р·Р°РЅРѕРІРѕ РІ <Link href="/settings" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">РќР°СЃС‚СЂРѕР№РєР°С… в†’ WB Р›Рљ</Link>.
        </>
      );
    }
  } else if (status.hasSession) {
    tone = 'warning';
    title = 'рџџЎ РЎРµСЃСЃРёСЏ РµСЃС‚СЊ, РЅРѕ РЅРµ РїРѕРґС‚РІРµСЂР¶РґРµРЅР°';
    body = (
      <>
        РџРѕСЃР»РµРґРЅРёР№ РІС…РѕРґ РЅРµ Р±С‹Р» СѓСЃРїРµС€РЅРѕ РїРѕРґС‚РІРµСЂР¶РґС‘РЅ. РџРµСЂРµР№РґРёС‚Рµ РІ <Link href="/settings" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300">РќР°СЃС‚СЂРѕР№РєРё в†’ WB Р›Рљ</Link> Рё РІРѕР№РґРёС‚Рµ СЃРЅРѕРІР°.
        {status.lastError ? <span className="mt-1 block opacity-70">РћС€РёР±РєР°: {status.lastError.slice(0, 200)}</span> : null}
      </>
    );
  }

  const cls =
    tone === 'ok'
      ? 'border-emerald-500/40 bg-emerald-500/5'
      : tone === 'warning'
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'border-rose-500/40 bg-rose-500/5';

  return (
    <div className={`rounded-2xl border ${cls} px-4 py-3 shadow-sm`}>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-xs text-muted-foreground">{body}</div>
    </div>
  );
}

type RecLeg = {
  fromWarehouse: string;
  toWarehouse: string;
  fromRegionName: string;
  toRegionName: string;
  totalUnits: number;
  savingsRub: number;
  sizes: { size: string; units: number }[];
};

type ArticleRecGroup = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  totalUnits: number;
  totalSavingsRub: number;
  maxPriority: number;
  localWeighted: number;
  simLocalWeighted: number;
  krpWeighted: number;
  simKrpWeighted: number;
  legs: Map<string, RecLeg>;
};

type ArticleRecRendered = Omit<ArticleRecGroup, 'legs'> & {
  legsList: RecLeg[];
  currentLocalSharePct: number;
  simulatedLocalSharePct: number;
  currentKrpPct: number;
  simulatedKrpPct: number;
};

/** РћРґРЅР° РєР°СЂС‚РѕС‡РєР°-Р·Р°СЏРІРєР° РЅР° Р°СЂС‚РёРєСѓР»: РІСЃРµ РјР°СЂС€СЂСѓС‚С‹ Рё СЂР°Р·РјРµСЂС‹ РІРЅСѓС‚СЂРё. */
function ArticleRecommendationCard({ group, rank }: { group: ArticleRecRendered; rank: number }) {
  const localDelta = group.simulatedLocalSharePct - group.currentLocalSharePct;
  const krpDelta = group.currentKrpPct - group.simulatedKrpPct;
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:border-emerald-500/40 hover:shadow-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground">#{rank}</span>
          <h3 className="text-base font-semibold text-foreground">{group.vendorCode || `РђСЂС‚РёРєСѓР» ${group.nmId}`}</h3>
          {group.brand && <span className="text-xs text-muted-foreground">В· {group.brand}</span>}
          <span className="text-[11px] text-muted-foreground tabular-nums">{group.nmId}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-sky-500/10 px-2 py-0.5 text-xs font-bold text-sky-700 dark:text-sky-300">
            {group.totalUnits} С€С‚ В· {group.legsList.length}{group.legsList.length === 1 ? ' РјР°СЂС€СЂСѓС‚' : ' РјР°СЂС€СЂ.'}
          </span>
          <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
            {formatCurrency(group.totalSavingsRub, 0)}/РјРµСЃ
          </span>
        </div>
      </div>

      {/* РњР°СЂС€СЂСѓС‚С‹ Р°СЂС‚РёРєСѓР»Р°: РєР°Р¶РґС‹Р№ = РѕС‚РєСѓРґР°в†’РєСѓРґР° + СЂР°Р·РјРµСЂС‹ */}
      <div className="mt-3 flex flex-col gap-2">
        {group.legsList.map((leg, i) => (
          <div key={i} className="rounded-xl border border-border bg-muted/30 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="rounded-md border border-rose-500/30 bg-rose-500/5 px-2 py-0.5 text-[12px] font-medium text-foreground">{leg.fromWarehouse}</span>
              <ArrowRight className="h-4 w-4 text-emerald-500" />
              <span className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-0.5 text-[12px] font-medium text-foreground">{leg.toWarehouse}</span>
              <span className="ml-auto text-[12px] font-bold tabular-nums text-foreground">{leg.totalUnits} С€С‚</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {leg.sizes.map((s) => (
                <span key={s.size} className="inline-flex items-center gap-1 rounded-md bg-card px-1.5 py-0.5 font-mono text-[11px]">
                  {s.size} <span className="font-bold text-emerald-700 dark:text-emerald-300">Г—{s.units}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Р­С„С„РµРєС‚ РїРѕ Р°СЂС‚РёРєСѓР»Сѓ */}
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-2.5 text-xs">
        <div>
          <div className="text-muted-foreground">Р›РѕРєР°Р»РёР·Р°С†РёСЏ</div>
          <div className="font-semibold text-foreground tabular-nums">
            {formatPercent(group.currentLocalSharePct, 1)} в†’ {formatPercent(group.simulatedLocalSharePct, 1)}
            {localDelta > 0 && <span className="ml-1 text-emerald-700 dark:text-emerald-400">(+{formatPercent(localDelta, 1)})</span>}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Р”РѕРїР»Р°С‚Р° WB Р·Р° РґР°Р»СЊРЅРѕСЃС‚СЊ</div>
          <div className="font-semibold text-foreground tabular-nums">
            {formatPercent(group.currentKrpPct, 2)} в†’ {formatPercent(group.simulatedKrpPct, 2)}
            {krpDelta > 0 && <span className="ml-1 text-emerald-700 dark:text-emerald-400">(в€’{formatPercent(krpDelta, 2)})</span>}
          </div>
        </div>
      </div>
    </div>
  );
}


function Pagination({
  currentPage,
  totalPages,
  onChange,
}: {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  // РЎС‡РёС‚Р°РµРј РєР°РєРёРµ СЃС‚СЂР°РЅРёС†С‹ РїРѕРєР°Р·Р°С‚СЊ РІ РЅР°РІРёРіР°С†РёРё (СЃ РјРЅРѕРіРѕС‚РѕС‡РёСЏРјРё РґР»СЏ РґР»РёРЅРЅС‹С… СЃРїРёСЃРєРѕРІ).
  const pages: Array<number | 'вЂ¦'> = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('вЂ¦');
    const from = Math.max(2, currentPage - 1);
    const to = Math.min(totalPages - 1, currentPage + 1);
    for (let i = from; i <= to; i++) pages.push(i);
    if (currentPage < totalPages - 2) pages.push('вЂ¦');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center gap-1 text-xs">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
        className="rounded-md border border-border bg-card px-2 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        в†ђ РќР°Р·Р°Рґ
      </button>
      {pages.map((p, idx) =>
        p === 'вЂ¦' ? (
          <span key={`dots-${idx}`} className="px-1 text-muted-foreground">
            вЂ¦
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`min-w-[28px] rounded-md px-2 py-1 font-medium tabular-nums transition-colors ${
              p === currentPage
                ? 'bg-emerald-500 text-white'
                : 'border border-border bg-card text-foreground hover:bg-muted'
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={() => onChange(Math.min(totalPages, currentPage + 1))}
        disabled={currentPage >= totalPages}
        className="rounded-md border border-border bg-card px-2 py-1 font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        Р’РїРµСЂС‘Рґ в†’
      </button>
    </div>
  );
}

function ExecutionLogBlock({
  log,
  loading,
  refreshing,
  runningSlotMonitor,
  manualSubmitMessage,
  onRefresh,
  onRunSlotMonitor,
}: {
  log: RedistributionExecutionLog | null | undefined;
  loading: boolean;
  refreshing: boolean;
  runningSlotMonitor: boolean;
  manualSubmitMessage: string | null;
  onRefresh: () => void;
  onRunSlotMonitor: () => void;
}) {
  const submitted = log?.itemStatusCounts.rpa_submitted ?? 0;
  const planned = log?.itemStatusCounts.planned ?? 0;
  const queued = (log?.itemStatusCounts.rpa_queued ?? 0) + (log?.itemStatusCounts.rpa_running ?? 0);
  const lastRun = log?.monitorRuns[0] ?? null;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'items' | 'attempts'>('items');
  const visibleItems = log?.items.slice(0, 6) ?? [];
  const visibleAttempts = log?.attempts.slice(0, 6) ?? [];

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-[280px] flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <History className="h-4 w-4 text-emerald-500" />
            РђРІС‚РѕСЃРѕР·РґР°РЅРёРµ
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>РЎРѕР·РґР°РЅРѕ: <b className="text-foreground">{submitted}</b></span>
            <span>Р’ РѕС‡РµСЂРµРґРё: <b className="text-foreground">{queued}</b></span>
            <span>Р–РґС‘С‚ СЃР»РѕС‚Р°: <b className="text-foreground">{planned}</b></span>
          </div>
          {lastRun ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">
              РџРѕСЃР»РµРґРЅСЏСЏ РїСЂРѕРІРµСЂРєР°: {formatDateTimeMsk(lastRun.startedAt)} В· {lastRun.message ?? lastRun.status}
            </div>
          ) : null}
          {manualSubmitMessage ? (
            <div className="mt-1 truncate text-xs text-muted-foreground">
              Р СѓС‡РЅРѕР№ Р·Р°РїСѓСЃРє: <span className="font-semibold text-foreground">{manualSubmitMessage}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            РћР±РЅРѕРІРёС‚СЊ
          </button>
          <button
            type="button"
            onClick={onRunSlotMonitor}
            disabled={runningSlotMonitor}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {runningSlotMonitor ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            РЎРѕР·РґР°С‚СЊ РІ WB СЃРµР№С‡Р°СЃ
          </button>
          <button
            type="button"
            onClick={() => setDetailsOpen((value) => !value)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
          >
            <History className="h-3.5 w-3.5" />
            {detailsOpen ? 'РЎРєСЂС‹С‚СЊ Р¶СѓСЂРЅР°Р»' : 'Р–СѓСЂРЅР°Р»'}
          </button>
        </div>
      </div>

      {loading && detailsOpen ? (
        <div className="px-4 py-5 text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Р—Р°РіСЂСѓР¶Р°СЋ Р¶СѓСЂРЅР°Р»вЂ¦
        </div>
      ) : null}

      {detailsOpen && !loading ? (
        <div className="border-t border-border px-4 py-3">
          <div className="mb-3 inline-flex rounded-lg border border-border bg-muted/30 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('items')}
              className={`rounded-md px-3 py-1.5 font-semibold ${
                activeTab === 'items' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Р—Р°СЏРІРєРё
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('attempts')}
              className={`rounded-md px-3 py-1.5 font-semibold ${
                activeTab === 'attempts' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              РџРѕРїС‹С‚РєРё WB
            </button>
          </div>

          {activeTab === 'items' ? (
            visibleItems.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-border">
                {visibleItems.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-1 gap-1 border-b border-border px-3 py-2 text-xs last:border-b-0 md:grid-cols-[1.2fr_1.4fr_auto]"
                  >
                    <div className="font-semibold text-foreground">
                      {item.vendorCode || item.nmId} В· {item.sizeName}
                    </div>
                    <div className="text-muted-foreground">
                      {item.fromWarehouse} в†’ {item.toWarehouse} В· {item.transferUnits} С€С‚ В· {formatDateTimeMsk(item.executedAt ?? item.updatedAt)}
                    </div>
                    <div className="md:text-right">
                      <span className={`rounded-md border px-2 py-0.5 font-semibold ${executionStatusClass(item.status)}`}>
                        {executionStatusLabel(item.status)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
                Р—Р°СЏРІРѕРє РІ Р¶СѓСЂРЅР°Р»Рµ РїРѕРєР° РЅРµС‚.
              </div>
            )
          ) : visibleAttempts.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border">
              {visibleAttempts.map((attempt, idx) => (
                <div
                  key={`${attempt.observedAt}-${attempt.itemId ?? idx}-${attempt.fromWarehouse}-${attempt.toWarehouse}`}
                  className="grid grid-cols-1 gap-1 border-b border-border px-3 py-2 text-xs last:border-b-0 md:grid-cols-[1.2fr_1.4fr_auto]"
                >
                  <div className="font-semibold text-foreground">
                    {attempt.nmId ?? 'РјР°СЂС€СЂСѓС‚'}{attempt.sizeName ? ` В· ${attempt.sizeName}` : ''}
                  </div>
                  <div className="text-muted-foreground">
                    {attempt.fromWarehouse} в†’ {attempt.toWarehouse} В· src={attempt.srcQuota ?? '-'} В· dst={attempt.dstQuota ?? '-'} В· {formatDateTimeMsk(attempt.observedAt)}
                  </div>
                  <div className="md:text-right">
                    <span className={`rounded-md px-2 py-0.5 font-semibold ${attemptStatusClass(attempt.status, attempt.submitted)}`}>
                      {attemptStatusLabel(attempt.status, attempt.submitted)}
                    </span>
                  </div>
                  <div className="text-muted-foreground md:col-span-3">
                    {explainAttemptReason(attempt.reason)}
                    {attempt.submitted ? ` В· СѓС€Р»Рѕ ${attempt.submittedUnits} С€С‚` : ''}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
              Р—Р° РїРѕСЃР»РµРґРЅРёРµ {log?.windowHours ?? 168} С‡ РїРѕРїС‹С‚РѕРє РЅРµ РЅР°Р№РґРµРЅРѕ.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

type WarehouseOption = {
  name: string;
  officeId: number | null;
};

type ManualRequestFormState = {
  nmId: string;
  vendorCode: string;
  sizeName: string;
  transferUnits: string;
  fromWarehouse: string;
  toWarehouse: string;
};

const emptyManualRequestForm: ManualRequestFormState = {
  nmId: '',
  vendorCode: '',
  sizeName: 'Р‘РµР· СЂР°Р·РјРµСЂР°',
  transferUnits: '',
  fromWarehouse: '',
  toWarehouse: '',
};

function normalizeWarehouseOptionName(value: string) {
  return value
    .toLowerCase()
    .replace(/[В«В»"']/g, '')
    .replace(/\bwb\b/g, '')
    .replace(/[^a-zР°-СЏС‘0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveWarehouseOfficeId(options: WarehouseOption[], warehouseName: string) {
  const key = normalizeWarehouseOptionName(warehouseName);
  const ids = Array.from(new Set(
    options
      .filter((option) => normalizeWarehouseOptionName(option.name) === key)
      .map((option) => option.officeId)
      .filter((officeId): officeId is number => officeId != null),
  ));
  return ids.length === 1 ? ids[0] : null;
}

function ManualRequestBlock({
  warehouseOptions,
  onCreated,
}: {
  warehouseOptions: WarehouseOption[];
  onCreated: (submitNow: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ManualRequestFormState>(emptyManualRequestForm);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingMode, setCreatingMode] = useState<'queue' | 'submit' | null>(null);
  const datalistId = 'redistribution-manual-warehouse-options';

  const updateField = (field: keyof ManualRequestFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const submitManualRequest = async (submitNow: boolean) => {
    setError(null);
    setMessage(null);
    setCreatingMode(submitNow ? 'submit' : 'queue');
    try {
      const payload = {
        nmId: form.nmId,
        vendorCode: form.vendorCode,
        sizeName: form.sizeName,
        transferUnits: form.transferUnits,
        fromWarehouse: form.fromWarehouse,
        fromOfficeId: resolveWarehouseOfficeId(warehouseOptions, form.fromWarehouse),
        toWarehouse: form.toWarehouse,
        toOfficeId: resolveWarehouseOfficeId(warehouseOptions, form.toWarehouse),
      };
      const res = await fetch('/api/views/redistribution/manual-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => null) as { message?: string; error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? `РќРµ СѓРґР°Р»РѕСЃСЊ РґРѕР±Р°РІРёС‚СЊ Р·Р°СЏРІРєСѓ: HTTP ${res.status}`);
        return;
      }
      setMessage(data?.message ?? 'Р СѓС‡РЅР°СЏ Р·Р°СЏРІРєР° РґРѕР±Р°РІР»РµРЅР° РІ РѕС‡РµСЂРµРґСЊ.');
      setForm(emptyManualRequestForm);
      await onCreated(submitNow);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ РґРѕР±Р°РІРёС‚СЊ Р·Р°СЏРІРєСѓ.');
    } finally {
      setCreatingMode(null);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Plus className="h-4 w-4 text-emerald-500" />
            Р СѓС‡РЅР°СЏ Р·Р°СЏРІРєР°
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Р”РѕР±Р°РІРёС‚СЊ РїРµСЂРµРјРµС‰РµРЅРёРµ РІ РѕС‡РµСЂРµРґСЊ Р±РµР· СЂРµРєРѕРјРµРЅРґР°С†РёРё Р°Р»РіРѕСЂРёС‚РјР°.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
        >
          {open ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {open ? 'РЎРєСЂС‹С‚СЊ' : 'Р”РѕР±Р°РІРёС‚СЊ'}
        </button>
      </div>

      {open ? (
        <div className="border-t border-border px-4 py-3">
          <datalist id={datalistId}>
            {warehouseOptions.map((option) => (
              <option key={`${option.name}-${option.officeId ?? 'none'}`} value={option.name} />
            ))}
          </datalist>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">РђСЂС‚РёРєСѓР» WB</span>
              <input
                value={form.nmId}
                onChange={(event) => updateField('nmId', event.target.value)}
                inputMode="numeric"
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="178896573"
              />
            </label>
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Р Р°Р·РјРµСЂ</span>
              <input
                value={form.sizeName}
                onChange={(event) => updateField('sizeName', event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="Р‘РµР· СЂР°Р·РјРµСЂР°"
              />
            </label>
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">РЁС‚СѓРє</span>
              <input
                value={form.transferUnits}
                onChange={(event) => updateField('transferUnits', event.target.value)}
                inputMode="numeric"
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="10"
              />
            </label>
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">РќР°Р·РІР°РЅРёРµ</span>
              <input
                value={form.vendorCode}
                onChange={(event) => updateField('vendorCode', event.target.value)}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="РЅРµРѕР±СЏР·Р°С‚РµР»СЊРЅРѕ"
              />
            </label>
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">РћС‚РєСѓРґР°</span>
              <input
                value={form.fromWarehouse}
                onChange={(event) => updateField('fromWarehouse', event.target.value)}
                list={datalistId}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="РўСѓР»Р°"
              />
            </label>
            <label className="md:col-span-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">РљСѓРґР°</span>
              <input
                value={form.toWarehouse}
                onChange={(event) => updateField('toWarehouse', event.target.value)}
                list={datalistId}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-emerald-500"
                placeholder="РЎР°СЂР°РїСѓР» WB"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-h-5 text-xs">
              {error ? <span className="text-rose-600 dark:text-rose-300">{error}</span> : null}
              {message ? <span className="text-emerald-700 dark:text-emerald-300">{message}</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => submitManualRequest(false)}
                disabled={creatingMode !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingMode === 'queue' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Р”РѕР±Р°РІРёС‚СЊ РІ РѕС‡РµСЂРµРґСЊ
              </button>
              <button
                type="button"
                onClick={() => submitManualRequest(true)}
                disabled={creatingMode !== null}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingMode === 'submit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Р”РѕР±Р°РІРёС‚СЊ Рё СЃРѕР·РґР°С‚СЊ РІ WB
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RedistributionPageClient({ tenantId: tenantIdProp }: { tenantId?: string }) {
  const { tenantId: tenantIdFromStore, dateFrom, dateTo } = useStore();
  const tenantId = tenantIdProp ?? tenantIdFromStore;
  const fromParam = toLocalDateParam(dateFrom);
  const toParam = toLocalDateParam(dateTo);

  const planQuery = useQuery<RedistributionPlan | null, Error>({
    queryKey: ['redistribution-plan-v2', tenantId, fromParam, toParam],
    queryFn: async () => {
      if (!tenantId) return null;
      const res = await fetch(
        `/api/views/redistribution?from=${fromParam}&to=${toParam}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error('РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°СЃСЃС‡РёС‚Р°С‚СЊ РїР»Р°РЅ РїРµСЂРµСЂР°СЃРїСЂРµРґРµР»РµРЅРёСЏ');
      return res.json();
    },
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  // РџР°СЂР°Р»Р»РµР»СЊРЅС‹Р№ Р·Р°РїСЂРѕСЃ РЅР° В«РЅР°СЃС‚РѕСЏС‰РµРµВ» Р·РЅР°С‡РµРЅРёРµ Р»РѕРєР°Р»РёР·Р°С†РёРё РёР· funnel_stats.
  // redistribution.ts СЃС‡РёС‚Р°РµС‚ Р»РѕРєР°Р»РёР·Р°С†РёСЋ РїРѕ stock_sizes-РјР°С‚СЂРёС†Рµ (РїСЂРѕРіРЅРѕР·РЅСѓСЋ),
  // С‡С‚Рѕ СЂР°СЃС…РѕРґРёС‚СЃСЏ СЃ WB-РєР°Р±РёРЅРµС‚РѕРј РЅР° ~6-7 Рї.Рї. Р§С‚РѕР±С‹ KPI СЃРѕРІРїР°РґР°Р»Рѕ СЃ С‚РµРј С‡С‚Рѕ
  // РІРёРґРёС‚ РїСЂРѕРґР°РІРµС† Сѓ WB, Р±РµСЂС‘Рј С‚Рѕ Р¶Рµ Р·РЅР°С‡РµРЅРёРµ С‡С‚Рѕ Рё /stocks-v2/localization.
  const stocksLocQuery = useQuery<{ kpi: { avgLocalizationPercent: number | null } } | null, Error>({
    queryKey: ['redistribution-real-localization', tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const res = await fetch('/api/views/stocks-v2?targetDays=30&leadTimeDays=46&demandPeriodDays=30', {
        cache: 'no-store',
      });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  const robotQuery = useQuery<RobotSessionStatus | null, Error>({
    queryKey: ['redistribution-robot-status', tenantId],
    queryFn: async () => (tenantId ? getRobotSessionStatus(tenantId) : null),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
  });

  const executionLogQuery = useQuery<RedistributionExecutionLog | null, Error>({
    queryKey: ['redistribution-execution-log', tenantId],
    queryFn: async () => {
      if (!tenantId) return null;
      const res = await fetch('/api/views/redistribution/execution-log', {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РіСЂСѓР·РёС‚СЊ Р¶СѓСЂРЅР°Р» РїРµСЂРµСЂР°СЃРїСЂРµРґРµР»РµРЅРёСЏ');
      return res.json();
    },
    enabled: Boolean(tenantId),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const [exporting, setExporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [runningSlotMonitor, setRunningSlotMonitor] = useState(false);
  const [manualSubmitMessage, setManualSubmitMessage] = useState<string | null>(null);
  // Р“РѕСЂРёР·РѕРЅС‚ WB-РїРµСЂРµСЃС‡С‘С‚Р° РёРЅРґРµРєСЃР° (СЃРєРѕР»СЊР·СЏС‰РµРµ РѕРєРЅРѕ 13 РЅРµРґРµР»СЊ).
  const [horizonWeeks, setHorizonWeeks] = useState<1 | 13>(13);

  const sortedRecommendations = useMemo(() => {
    const recs = planQuery.data?.recommendations ?? [];
    return [...recs].sort((a, b) => b.priorityScore - a.priorityScore);
  }, [planQuery.data]);

  // Р“СЂСѓРїРїРёСЂРѕРІРєР°: РѕРґРЅР° РєР°СЂС‚РѕС‡РєР°-Р·Р°СЏРІРєР° РЅР° Р°СЂС‚РёРєСѓР», РІРЅСѓС‚СЂРё вЂ” РјР°СЂС€СЂСѓС‚С‹
  // (РѕС‚РєСѓРґР°в†’РєСѓРґР°), Р° РІ РєР°Р¶РґРѕРј РјР°СЂС€СЂСѓС‚Рµ СЃРїРёСЃРѕРє СЂР°Р·РјРµСЂРѕРІ. РўР°Рє 519-10 РЅРµ
  // СЂР°СЃРїР°РґР°РµС‚СЃСЏ РЅР° 5 СЃС‚СЂРѕРє РїРѕ СЂР°Р·РјРµСЂР°Рј, Р° СЃРѕР±РёСЂР°РµС‚СЃСЏ РІ РѕРґРЅСѓ Р·Р°СЏРІРєСѓ.
  const groupedByArticle = useMemo(() => {
    const byNm = new Map<number, ArticleRecGroup>();
    for (const rec of sortedRecommendations) {
      let g = byNm.get(rec.nmId);
      if (!g) {
        g = {
          nmId: rec.nmId,
          vendorCode: rec.vendorCode,
          brand: rec.brand,
          totalUnits: 0,
          totalSavingsRub: 0,
          maxPriority: 0,
          localWeighted: 0,
          simLocalWeighted: 0,
          krpWeighted: 0,
          simKrpWeighted: 0,
          legs: new Map(),
        };
        byNm.set(rec.nmId, g);
      }
      const routeKey = `${rec.fromWarehouse} в†’ ${rec.toWarehouse}`;
      let leg = g.legs.get(routeKey);
      if (!leg) {
        leg = {
          fromWarehouse: rec.fromWarehouse,
          toWarehouse: rec.toWarehouse,
          fromRegionName: rec.fromRegionName,
          toRegionName: rec.toRegionName,
          totalUnits: 0,
          savingsRub: 0,
          sizes: [],
        };
        g.legs.set(routeKey, leg);
      }
      leg.sizes.push({ size: rec.sizeName, units: rec.transferUnits });
      leg.totalUnits += rec.transferUnits;
      leg.savingsRub += rec.estimatedSavingsRub;
      g.totalUnits += rec.transferUnits;
      g.totalSavingsRub += rec.estimatedSavingsRub;
      g.maxPriority = Math.max(g.maxPriority, rec.priorityScore);
      g.localWeighted += rec.currentLocalSharePct * rec.transferUnits;
      g.simLocalWeighted += rec.simulatedLocalSharePct * rec.transferUnits;
      g.krpWeighted += rec.currentKrpPct * rec.transferUnits;
      g.simKrpWeighted += rec.simulatedKrpPct * rec.transferUnits;
    }
    return Array.from(byNm.values())
      .map((g) => ({
        ...g,
        legsList: Array.from(g.legs.values())
          .map((leg) => ({
            ...leg,
            sizes: leg.sizes.slice().sort((a, b) => parseFloat(a.size) - parseFloat(b.size)),
          }))
          .sort((a, b) => b.totalUnits - a.totalUnits),
        currentLocalSharePct: g.totalUnits > 0 ? g.localWeighted / g.totalUnits : 0,
        simulatedLocalSharePct: g.totalUnits > 0 ? g.simLocalWeighted / g.totalUnits : 0,
        currentKrpPct: g.totalUnits > 0 ? g.krpWeighted / g.totalUnits : 0,
        simulatedKrpPct: g.totalUnits > 0 ? g.simKrpWeighted / g.totalUnits : 0,
      }))
      .sort((a, b) => b.maxPriority - a.maxPriority);
  }, [sortedRecommendations]);

  const warehouseOptions = useMemo(() => {
    const options = new Map<string, WarehouseOption>();
    const addWarehouse = (name: string | null | undefined, officeId: number | null | undefined) => {
      const safeName = name?.replace(/\s+/g, ' ').trim();
      if (!safeName) return;
      const key = normalizeWarehouseOptionName(safeName);
      const existing = options.get(key);
      if (!existing || (existing.officeId == null && officeId != null)) {
        options.set(key, { name: safeName, officeId: officeId ?? null });
      }
    };

    for (const rec of sortedRecommendations) {
      addWarehouse(rec.fromWarehouse, rec.fromOfficeId);
      addWarehouse(rec.toWarehouse, rec.toOfficeId);
    }
    for (const item of executionLogQuery.data?.items ?? []) {
      addWarehouse(item.fromWarehouse, item.fromOfficeId);
      addWarehouse(item.toWarehouse, item.toOfficeId);
    }
    for (const attempt of executionLogQuery.data?.attempts ?? []) {
      addWarehouse(attempt.fromWarehouse, attempt.fromOfficeId);
      addWarehouse(attempt.toWarehouse, attempt.toOfficeId);
    }

    return Array.from(options.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [executionLogQuery.data, sortedRecommendations]);

  // РџР°РіРёРЅР°С†РёСЏ РїРѕ РђР РўРРљРЈР›РђРњ (СЃРіСЂСѓРїРїРёСЂРѕРІР°РЅРЅС‹Рј Р·Р°СЏРІРєР°Рј), РЅРµ РїРѕ СЃС‚СЂРѕРєР°Рј СЂР°Р·РјРµСЂРѕРІ.
  const totalPages = Math.max(1, Math.ceil(groupedByArticle.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, groupedByArticle.length);
  const pagedGroups = groupedByArticle.slice(pageStart, pageEnd);

  if (planQuery.isLoading) {
    return (
      <div className="flex h-[55vh] flex-col items-center justify-center gap-4 text-emerald-600">
        <Loader2 className="h-10 w-10 animate-spin" />
        <p className="animate-pulse font-medium text-muted-foreground">
          РЎС‡РёС‚Р°РµРј С‡С‚Рѕ РєСѓРґР° РІРµР·С‚РёвЂ¦
        </p>
      </div>
    );
  }
  if (planQuery.error) {
    return (
      <OperatorState
        icon={AlertCircle}
        tone="danger"
        title="РќРµ СѓРґР°Р»РѕСЃСЊ СЂР°СЃСЃС‡РёС‚Р°С‚СЊ РїР»Р°РЅ"
        description={planQuery.error.message}
        actionLabel="РџРѕРІС‚РѕСЂРёС‚СЊ"
        action={() => planQuery.refetch()}
      />
    );
  }
  if (!planQuery.data) {
    return (
      <OperatorState
        icon={MapPin}
        tone="default"
        title="РќРµС‚ РґР°РЅРЅС‹С…"
        description="РџРѕСЃР»Рµ РїРµСЂРІРѕР№ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё СЃ WB Р·РґРµСЃСЊ РїРѕСЏРІРёС‚СЃСЏ РїР»Р°РЅ РїРµСЂРµРјРµС‰РµРЅРёР№."
      />
    );
  }

  const plan = planQuery.data;
  const summary = plan.summary;

  // Р›РѕРєР°Р»РёР·Р°С†РёСЏ РёР· funnel_stats (РєР°Рє WB РєР°Р±РёРЅРµС‚ РїРѕРєР°Р·С‹РІР°РµС‚) вЂ” РїСЂРёРѕСЂРёС‚РµС‚.
  // Р”РµР»СЊС‚Сѓ СЃРёРјСѓР»СЏС†РёРё РёР· redistribution РїСЂРёРјРµРЅСЏРµРј Рє РЅРµР№.
  const realCurrentLocal = stocksLocQuery.data?.kpi?.avgLocalizationPercent ?? null;
  const simulationDelta = summary.simulatedLocalSharePct - summary.currentLocalSharePct;
  const displayCurrentLocal = realCurrentLocal != null ? realCurrentLocal : summary.currentLocalSharePct;
  const displaySimulatedLocal = realCurrentLocal != null
    ? Math.min(100, realCurrentLocal + simulationDelta)
    : summary.simulatedLocalSharePct;
  const localDelta = displaySimulatedLocal - displayCurrentLocal;

  // Р РµР°Р»СЊРЅР°СЏ РґРѕРїР»Р°С‚Р° WB РїРѕ РѕС„РёС†РёР°Р»СЊРЅРѕР№ СЃРµС‚РєРµ РљР Рџ.
  // РџСЂРё Р»РѕРєР°Р»РёР·Р°С†РёРё в‰Ґ60% в†’ 0%. РЎРёРјСѓР»СЏС†РёСЏ redistribution.summary РґР°С‘С‚ В«РїСЂРѕРіРЅРѕР·РЅС‹Р№В»
  // РљР Рџ РЅР° РѕСЃРЅРѕРІРµ stock_sizes; РµСЃР»Рё СЂРµР°Р»СЊРЅР°СЏ Р»РѕРєР°Р»РёР·Р°С†РёСЏ СѓР¶Рµ в‰Ґ60%, СЌРєРѕРЅРѕРјРёС‚СЊ
  // РЅРµС‡РµРіРѕ, РєР°РєРёРµ Р±С‹ С†РёС„СЂС‹ redistribution РЅРµ РЅР°СЂРёСЃРѕРІР°Р».
  const realCurrentKrp = realCurrentLocal != null ? resolveIrpFromLocalization(realCurrentLocal) : summary.currentKrpPct;
  const realSimulatedKrp = resolveIrpFromLocalization(displaySimulatedLocal);
  const krpDelta = Math.max(0, realCurrentKrp - realSimulatedKrp);
  // Р•СЃР»Рё СЂРµР°Р»СЊРЅР°СЏ РґРѕРїР»Р°С‚Р° СѓР¶Рµ 0 вЂ” СЌРєРѕРЅРѕРјРёРё РЅРµС‚, РєР°РєРёРµ Р±С‹ С†РёС„СЂС‹ redistribution
  // РЅРµ РІС‹РґР°Р» (РѕРЅ СЃС‡РёС‚Р°РµС‚ РїРѕ РґСЂСѓРіРѕР№ РјРµС‚РѕРґРёРєРµ, РїРѕСЌС‚РѕРјСѓ РјРѕР¶РµС‚ СЂРёСЃРѕРІР°С‚СЊ В«-1.35%В»
  // С‚Р°Рј РіРґРµ РµС‘ РЅР° СЃР°РјРѕРј РґРµР»Рµ РЅРµС‚).
  const displaySavingsRub = realCurrentKrp === 0 ? 0 : summary.estimatedSavingsRub;
  const noSavingsBecauseAlreadyAtTarget = realCurrentLocal != null && realCurrentKrp === 0;

  const handleExport = async () => {
    if (!plan) return;
    setExporting(true);
    try {
      await exportRedistributionXlsx(plan);
    } catch (err) {
      console.error('[redistribution-export]', err);
    } finally {
      setExporting(false);
    }
  };

  const handleRunSlotMonitor = async () => {
    setRunningSlotMonitor(true);
    setManualSubmitMessage(null);
    try {
      const res = await fetch('/api/views/redistribution/slot-monitor', {
        method: 'POST',
        cache: 'no-store',
      });
      const payload = await res.json().catch(() => null) as {
        monitorResult?: {
          message?: string;
          probedItems?: number;
          openedSlots?: number;
          autoSubmit?: boolean;
        };
        error?: string;
      } | null;
      if (!res.ok) {
        setManualSubmitMessage(payload?.error ?? `РћС€РёР±РєР° Р·Р°РїСѓСЃРєР°: HTTP ${res.status}`);
        return;
      }
      const result = payload?.monitorResult;
      const details = result
        ? `${result.message ?? 'Р·Р°РїСѓСЃРє РІС‹РїРѕР»РЅРµРЅ'} В· РїСЂРѕРІРµСЂРµРЅРѕ ${result.probedItems ?? 0} В· СЃР»РѕС‚РѕРІ ${result.openedSlots ?? 0}`
        : 'Р·Р°РїСѓСЃРє РІС‹РїРѕР»РЅРµРЅ';
      setManualSubmitMessage(details);
      await Promise.all([
        executionLogQuery.refetch(),
        planQuery.refetch(),
      ]);
    } catch (err) {
      setManualSubmitMessage(err instanceof Error ? err.message : 'РќРµ СѓРґР°Р»РѕСЃСЊ Р·Р°РїСѓСЃС‚РёС‚СЊ Р°РІС‚РѕСЃРѕР·РґР°РЅРёРµ.');
    } finally {
      setRunningSlotMonitor(false);
    }
  };

  const handleManualRequestCreated = async (submitNow: boolean) => {
    await executionLogQuery.refetch();
    if (submitNow) {
      await handleRunSlotMonitor();
    }
  };

  const robot = robotQuery.data;

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4 pb-10 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/stocks-v2"
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Р”Р°С€Р±РѕСЂРґ
          </Link>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting || sortedRecommendations.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Download className="h-4 w-4" />
          {exporting ? 'Р“РѕС‚РѕРІР»СЋвЂ¦' : 'РЎРєР°С‡Р°С‚СЊ Excel'}
        </button>
      </div>

      {/* 3 KPI */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <HeroTile
          icon={TrendingUp}
          iconClass={noSavingsBecauseAlreadyAtTarget ? 'text-emerald-500' : displaySavingsRub > 0 ? 'text-emerald-500' : 'text-muted-foreground'}
          label="РЎСЌРєРѕРЅРѕРјРёС‚Рµ Р·Р° РјРµСЃСЏС†"
          primary={
            noSavingsBecauseAlreadyAtTarget
              ? '0 в‚Ѕ'
              : formatCurrency(displaySavingsRub, 0)
          }
          secondary={
            noSavingsBecauseAlreadyAtTarget
              ? `WB СѓР¶Рµ РЅРµ Р±РµСЂС‘С‚ РґРѕРїР»Р°С‚Сѓ (Р»РѕРєР°Р»РёР·Р°С†РёСЏ в‰Ґ 60%) вЂ” СЌРєРѕРЅРѕРјРёС‚СЊ РЅРµС‡РµРіРѕ`
              : `РЅР° РґРѕРїР»Р°С‚Рµ WB Р·Р° РґР°Р»СЊРЅРѕСЃС‚СЊ (РєРѕРјРёСЃСЃРёСЏ 0.5% СѓР¶Рµ СѓС‡С‚РµРЅР°)`
          }
          tone={noSavingsBecauseAlreadyAtTarget ? 'ok' : displaySavingsRub > 0 ? 'ok' : 'default'}
        />
        <HeroTile
          icon={Package}
          iconClass="text-sky-500"
          label="РџРµСЂРµРјРµС‰РµРЅРёР№"
          primary={`${formatNumber(summary.transferUnits, 0)} С€С‚`}
          secondary={`РїРѕ ${summary.skuCount} С‚РѕРІР°СЂР°Рј В· ${summary.recommendationCount} РјР°СЂС€СЂСѓС‚РѕРІ`}
        />
        <HeroTile
          icon={MapPin}
          iconClass={realCurrentKrp === 0 ? 'text-emerald-500' : 'text-amber-500'}
          label="Р›РѕРєР°Р»РёР·Р°С†РёСЏ"
          primary={`${formatPercent(displayCurrentLocal, 1)} в†’ ${formatPercent(displaySimulatedLocal, 1)}`}
          secondary={
            realCurrentLocal == null
              ? 'РґР°РЅРЅС‹С… РѕС‚ WB РїРѕРєР° РЅРµС‚'
              : realCurrentKrp === 0
                ? `WB РЅРµ Р±РµСЂС‘С‚ РґРѕРїР»Р°С‚Сѓ В· СѓР¶Рµ РЅР° С†РµР»Рё в‰Ґ 60%`
                : localDelta > 0
                  ? `+${formatPercent(localDelta, 1)} В· РґРѕРїР»Р°С‚Р° WB СѓРїР°РґС‘С‚ РЅР° ${formatPercent(krpDelta, 2)}`
                  : 'Р±РµР· Р·РЅР°С‡РёРјС‹С… РїРµСЂРµРјРµС‰РµРЅРёР№'
          }
          tone={realCurrentKrp === 0 ? 'ok' : localDelta > 0 ? 'ok' : 'default'}
        />
      </div>

      {/* РР› / РР Рџ РёРЅРґРµРєСЃС‹ + СЃРїР»РёС‚ СЌРєРѕРЅРѕРјРёРё + РіРѕСЂРёР·РѕРЅС‚ WB-РїРµСЂРµСЃС‡С‘С‚Р° */}
      {displaySavingsRub > 0 ? (
        <div className="rounded-2xl border border-border bg-card px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              РРЅРґРµРєСЃС‹ WB Рё СЌС„С„РµРєС‚ РїРµСЂРµРІРѕР·РєРё
            </div>
            {/* Р“РѕСЂРёР·РѕРЅС‚: WB РїРµСЂРµСЃС‡РёС‚С‹РІР°РµС‚ РР› РЅР° СЃРєРѕР»СЊР·СЏС‰РµРј РѕРєРЅРµ 13 РЅРµРґРµР»СЊ */}
            <div className="inline-flex rounded-full border border-border bg-subtle p-0.5 text-[11px] font-bold">
              {([1, 13] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setHorizonWeeks(w)}
                  className={`rounded-full px-2.5 py-1 transition-colors ${horizonWeeks === w ? 'bg-foreground text-card' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  С‡РµСЂРµР· {w} РЅРµРґ
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const w = horizonWeeks / 13; // РґРѕР»СЏ СЂРµР°Р»РёР·Р°С†РёРё СѓР»СѓС‡С€РµРЅРёСЏ
            const blendedLocal = displayCurrentLocal + localDelta * w;
            const ilNow = resolveKtrFromLocalization(displayCurrentLocal);
            const ilFuture = resolveKtrFromLocalization(blendedLocal);
            const krpFuture = resolveIrpFromLocalization(blendedLocal);
            const savingsAtHorizon = displaySavingsRub * w;
            const krpPart = realCurrentKrp === 0 ? 0 : summary.krpSavingsRub * w;
            const ktrPart = realCurrentKrp === 0 ? 0 : summary.ktrLogisticsSavingsRub * w;
            return (
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-border bg-subtle/40 px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground">РР› (Р»РѕРіРёСЃС‚РёРєР°)</div>
                  <div className="mt-0.5 font-mono text-[15px] font-bold text-foreground">
                    {ilNow.toFixed(2)} <span className="text-emerald-600">в†’ {ilFuture.toFixed(2)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">РјРЅРѕР¶РёС‚РµР»СЊ С‚Р°СЂРёС„Р°, РЅРёР¶Рµ вЂ” Р»СѓС‡С€Рµ</div>
                </div>
                <div className="rounded-xl border border-border bg-subtle/40 px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground">РР Рџ (РєРѕРјРёСЃСЃРёСЏ)</div>
                  <div className="mt-0.5 font-mono text-[15px] font-bold text-foreground">
                    {realCurrentKrp.toFixed(2)}% <span className="text-emerald-600">в†’ {krpFuture.toFixed(2)}%</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">РґРѕРїР»Р°С‚Р° Р·Р° РґР°Р»СЊРЅРѕСЃС‚СЊ</div>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Р­РєРѕРЅРѕРјРёСЏ Р»РѕРіРёСЃС‚РёРєР°</div>
                  <div className="mt-0.5 font-mono text-[15px] font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(ktrPart, 0)}</div>
                  <div className="text-[10px] text-muted-foreground">РљРўР  вЂ” С‚Р°СЂРёС„ РґРѕСЃС‚Р°РІРєРё</div>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
                  <div className="text-[10px] uppercase text-muted-foreground">Р­РєРѕРЅРѕРјРёСЏ РєРѕРјРёСЃСЃРёСЏ</div>
                  <div className="mt-0.5 font-mono text-[15px] font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(krpPart, 0)}</div>
                  <div className="text-[10px] text-muted-foreground">РљР Рџ вЂ” РґРѕРїР»Р°С‚Р° %</div>
                </div>
                <div className="col-span-2 text-[11px] text-muted-foreground md:col-span-4">
                  WB РїРµСЂРµСЃС‡РёС‚С‹РІР°РµС‚ РёРЅРґРµРєСЃ Р»РѕРєР°Р»РёР·Р°С†РёРё РЅР° СЃРєРѕР»СЊР·СЏС‰РµРј РѕРєРЅРµ 13 РЅРµРґРµР»СЊ. {horizonWeeks === 13
                    ? 'Р§РµСЂРµР· 13 РЅРµРґРµР»СЊ СЌС„С„РµРєС‚ РїРµСЂРµРІРѕР·РєРё СЂРµР°Р»РёР·СѓРµС‚СЃСЏ РїРѕР»РЅРѕСЃС‚СЊСЋ.'
                    : `Р§РµСЂРµР· ${horizonWeeks} РЅРµРґ СЂРµР°Р»РёР·СѓРµС‚СЃСЏ ~${Math.round(w * 100)}% СЌС„С„РµРєС‚Р° вЂ” РёС‚РѕРіРѕ ${formatCurrency(savingsAtHorizon, 0)}.`}
                </div>
              </div>
            );
          })()}
        </div>
      ) : null}

      {/* Р•СЃР»Рё СЂРµР°Р»СЊРЅР°СЏ РґРѕРїР»Р°С‚Р° СѓР¶Рµ 0% вЂ” Р·Р°РјРµС‚РЅС‹Р№ Р±Р»РѕРє В«РІСЃС‘ С…РѕСЂРѕС€РѕВ» */}
      {noSavingsBecauseAlreadyAtTarget && (
        <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 px-5 py-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-500" />
            <div className="text-sm">
              <div className="font-semibold text-foreground">
                РџСЂСЏРјРѕ СЃРµР№С‡Р°СЃ РїРµСЂРµРјРµС‰Р°С‚СЊ РЅРёС‡РµРіРѕ РЅРµ РЅСѓР¶РЅРѕ
              </div>
              <div className="mt-1 text-muted-foreground">
                Р’Р°С€Р° Р»РѕРєР°Р»РёР·Р°С†РёСЏ {formatPercent(displayCurrentLocal, 1)} вЂ”
                СЌС‚Рѕ СѓР¶Рµ Р±РѕР»СЊС€Рµ {formatPercent(60, 0)}, РїРѕСЌС‚РѕРјСѓ WB РЅРµ Р±РµСЂС‘С‚
                РґРѕРїР»Р°С‚Сѓ Р·Р° РґР°Р»СЊРЅРѕСЃС‚СЊ. РџРµСЂРµРјРµС‰РµРЅРёСЏ РЅРёР¶Рµ вЂ” РЅР° СЃР»СѓС‡Р°Р№ РµСЃР»Рё
                Р»РѕРєР°Р»РёР·Р°С†РёСЏ СѓРїР°РґС‘С‚ (РЅР°РїСЂРёРјРµСЂ, РїСЂРё СЂРѕСЃС‚Рµ РїСЂРѕРґР°Р¶ РІ РґР°Р»СЊРЅРёС…
                СЂРµРіРёРѕРЅР°С…) РёР»Рё РµСЃР»Рё РІС‹ С…РѕС‚РёС‚Рµ РµС‰С‘ РїСЂРёР±Р°РІРёС‚СЊ Р·Р°РїР°СЃ РїСЂРѕС‡РЅРѕСЃС‚Рё.
                Р’ РґРµРЅСЊРіР°С… РїСЂСЏРјРѕ СЃРµР№С‡Р°СЃ РѕРЅРё РЅРµ СЃСЌРєРѕРЅРѕРјСЏС‚.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Robot status */}
      {robot ? (
        <RobotStatusBlock status={robot} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" />
          РџСЂРѕРІРµСЂСЏСЋ СЃС‚Р°С‚СѓСЃ СЂРѕР±РѕС‚Р°вЂ¦
        </div>
      )}

      <ManualRequestBlock
        warehouseOptions={warehouseOptions}
        onCreated={handleManualRequestCreated}
      />

      <ExecutionLogBlock
        log={executionLogQuery.data}
        loading={executionLogQuery.isLoading}
        refreshing={executionLogQuery.isFetching}
        runningSlotMonitor={runningSlotMonitor}
        manualSubmitMessage={manualSubmitMessage}
        onRefresh={() => executionLogQuery.refetch()}
        onRunSlotMonitor={handleRunSlotMonitor}
      />

      {/* Recommendations */}
      {sortedRecommendations.length === 0 ? (
        <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 px-5 py-6 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
          <div className="text-sm font-semibold text-foreground">
            РџРµСЂРµРјРµС‰Р°С‚СЊ РЅРёС‡РµРіРѕ РЅРµ РЅСѓР¶РЅРѕ
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            РџРѕ С‚РµРєСѓС‰РёРј РґР°РЅРЅС‹Рј СЃРєР»Р°РґС‹ СЂР°СЃРїСЂРµРґРµР»РµРЅС‹ СЂРѕРІРЅРѕ вЂ” Р·Р°РјРµС‚РЅРѕРіРѕ СЌС„С„РµРєС‚Р° РїРѕ
            Р»РѕРєР°Р»РёР·Р°С†РёРё/РґРѕРїР»Р°С‚Рµ РЅРµ РїСЂРѕРіРЅРѕР·РёСЂСѓРµС‚СЃСЏ.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Sparkles className="h-4 w-4 text-emerald-500" />
                Р§С‚Рѕ РЅСѓР¶РЅРѕ СЃРґРµР»Р°С‚СЊ ({groupedByArticle.length}{groupedByArticle.length === 1 ? ' Р°СЂС‚РёРєСѓР»' : ' Р°СЂС‚РёРєСѓР»РѕРІ'} В· {sortedRecommendations.length} РїРµСЂРµРјРµС‰РµРЅРёР№)
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                РћРґРЅР° Р·Р°СЏРІРєР° РЅР° Р°СЂС‚РёРєСѓР» вЂ” РІРЅСѓС‚СЂРё РјР°СЂС€СЂСѓС‚С‹ Рё СЂР°Р·РјРµСЂС‹. РћС‚СЃРѕСЂС‚РёСЂРѕРІР°РЅРѕ РїРѕ РІС‹РіРѕРґРµ.
              </div>
            </div>
            {totalPages > 1 && (
              <div className="text-xs text-muted-foreground tabular-nums">
                РџРѕРєР°Р·Р°РЅС‹ <span className="font-semibold text-foreground">{pageStart + 1}вЂ“{pageEnd}</span> РёР· {groupedByArticle.length} Р°СЂС‚РёРєСѓР»РѕРІ
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 p-4">
            {pagedGroups.map((group, idx) => (
              <ArticleRecommendationCard
                key={`${group.nmId}-${pageStart + idx}`}
                group={group}
                rank={pageStart + idx + 1}
              />
            ))}
          </div>
          {/* Pagination footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3 text-xs">
            {totalPages > 1 ? (
              <Pagination
                currentPage={safePage}
                totalPages={totalPages}
                onChange={(p) => {
                  setCurrentPage(p);
                  // РїР»Р°РІРЅС‹Р№ СЃРєСЂРѕР»Р» Рє РЅР°С‡Р°Р»Сѓ СЃРїРёСЃРєР°
                  if (typeof window !== 'undefined') {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
              />
            ) : (
              <span className="text-muted-foreground">
                Р’СЃРµ {sortedRecommendations.length} РїРµСЂРµРјРµС‰РµРЅРёР№ РїРѕРєР°Р·Р°РЅС‹.
              </span>
            )}
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-300"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              РЎРєР°С‡Р°С‚СЊ Excel СЃРѕ РІСЃРµРј РїР»Р°РЅРѕРј
            </button>
          </div>
        </div>
      )}

      {/* Footer note about methodology */}
      <div className="rounded-xl border border-border bg-muted/40 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="font-semibold">РљР°Рє СЃС‡РёС‚Р°РµРј:</span> {plan.assumptions.methodology}.
        Р¦РµР»РµРІРѕРµ РїРѕРєСЂС‹С‚РёРµ вЂ” {plan.assumptions.targetCoverageDays} РґРЅ, РіРѕСЂРёР·РѕРЅС‚ РїСЂРѕРіРЅРѕР·Р° вЂ” {plan.assumptions.forecastHorizonDays} РґРЅ.
        РџР»Р°РЅ РїРѕСЃС‚СЂРѕРµРЅ {new Date(plan.generatedAt).toLocaleString('ru-RU')}.
      </div>
    </div>
  );
}
