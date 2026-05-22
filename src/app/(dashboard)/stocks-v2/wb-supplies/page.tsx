import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq, sql } from "drizzle-orm";

import { db, withTenantContext } from "@/lib/db";
import { wbSupplyWriteoffs } from "@/lib/db/schema";
import {
  readActiveTenantCookie,
  requireTenantFeatureAccess,
} from "@/lib/auth/tenant-access";
import { reconcileWbSupplyWriteoffsForTenant } from "@/server/analytics/stocks-v2/supply-writeoffs";

type PageSearchParams = {
  ran?: string;
  supplies?: string;
  lines?: string;
  written?: string;
  diff?: string;
  errors?: string;
  error?: string;
};

type DateValue = Date | string | number | null;
type NumberValue = number | string | null | undefined;

type WbSupplyWriteoffRow = {
  id: string;
  supplyKey: string;
  supplyId: number | null;
  preorderId: number | null;
  statusId: number | null;
  nmId: number;
  barcode: string;
  vendorCode: string | null;
  warehouseName: string | null;
  actualWarehouseName: string | null;
  supplyDate: DateValue;
  factDate: DateValue;
  wbQuantity: number;
  localWrittenOffQuantity: number;
  acceptedQuantity: number | null;
  discrepancyQuantity: number | null;
  writeOffStatus: string;
  writeOffError: string | null;
  discrepancyStatus: string;
  writtenOffAt: DateValue;
  discrepancyNotifiedAt: DateValue;
  lastSeenAt: DateValue;
};

type WbSupplyWriteoffSummaryRow = {
  totalLines: NumberValue;
  writtenOffUnits: NumberValue;
  openDiscrepancies: NumberValue;
  writeOffErrors: NumberValue;
  lastSeenAt: DateValue;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function toValidDate(value: DateValue) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDateTime(value: DateValue) {
  const date = toValidDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDate(value: DateValue) {
  const date = toValidDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(date);
}

function formatNumber(value: NumberValue) {
  if (value == null) return "—";
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("ru-RU").format(numeric);
}

function getSupplyLabel(row: WbSupplyWriteoffRow) {
  if (row.supplyId) return String(row.supplyId);
  if (row.preorderId) return `предзаказ ${row.preorderId}`;
  return row.supplyKey;
}

function getWriteOffBadge(row: WbSupplyWriteoffRow) {
  if (row.writeOffStatus === "written_off") {
    return {
      label: "Списано",
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }

  if (row.writeOffStatus === "insufficient_stock") {
    return {
      label: "Нет остатка",
      className: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    };
  }

  if (row.writeOffStatus === "ignored_insufficient_stock") {
    return {
      label: "Исключение",
      className: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    };
  }

  return {
    label: "Ожидает",
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  };
}

function getDiscrepancyBadge(row: WbSupplyWriteoffRow) {
  if (row.discrepancyStatus === "mismatch") {
    return {
      label: `Разница ${formatNumber(row.discrepancyQuantity)}`,
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  if (row.discrepancyStatus === "ok") {
    return {
      label: "Сошлось",
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }

  return {
    label: "Ждем данные",
    className: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  };
}

async function loadWbSupplyWriteoffs(tenantId: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [rows, summaryRows] = await Promise.all([
      tx.select({
        id: wbSupplyWriteoffs.id,
        supplyKey: wbSupplyWriteoffs.supplyKey,
        supplyId: wbSupplyWriteoffs.supplyId,
        preorderId: wbSupplyWriteoffs.preorderId,
        statusId: wbSupplyWriteoffs.statusId,
        nmId: wbSupplyWriteoffs.nmId,
        barcode: wbSupplyWriteoffs.barcode,
        vendorCode: wbSupplyWriteoffs.vendorCode,
        warehouseName: wbSupplyWriteoffs.warehouseName,
        actualWarehouseName: wbSupplyWriteoffs.actualWarehouseName,
        supplyDate: wbSupplyWriteoffs.supplyDate,
        factDate: wbSupplyWriteoffs.factDate,
        wbQuantity: wbSupplyWriteoffs.wbQuantity,
        localWrittenOffQuantity: wbSupplyWriteoffs.localWrittenOffQuantity,
        acceptedQuantity: wbSupplyWriteoffs.acceptedQuantity,
        discrepancyQuantity: wbSupplyWriteoffs.discrepancyQuantity,
        writeOffStatus: wbSupplyWriteoffs.writeOffStatus,
        writeOffError: wbSupplyWriteoffs.writeOffError,
        discrepancyStatus: wbSupplyWriteoffs.discrepancyStatus,
        writtenOffAt: wbSupplyWriteoffs.writtenOffAt,
        discrepancyNotifiedAt: wbSupplyWriteoffs.discrepancyNotifiedAt,
        lastSeenAt: wbSupplyWriteoffs.lastSeenAt,
      })
        .from(wbSupplyWriteoffs)
        .where(eq(wbSupplyWriteoffs.tenantId, tenantId))
        .orderBy(desc(wbSupplyWriteoffs.lastSeenAt))
        .limit(250),
      tx.select({
        totalLines: sql<number>`COUNT(*)::int`,
        writtenOffUnits: sql<number>`COALESCE(SUM(${wbSupplyWriteoffs.localWrittenOffQuantity}), 0)::int`,
        openDiscrepancies: sql<number>`COUNT(*) FILTER (WHERE ${wbSupplyWriteoffs.discrepancyStatus} = 'mismatch')::int`,
        writeOffErrors: sql<number>`COUNT(*) FILTER (WHERE ${wbSupplyWriteoffs.writeOffStatus} NOT IN ('written_off', 'ignored_insufficient_stock'))::int`,
        lastSeenAt: sql<Date | null>`MAX(${wbSupplyWriteoffs.lastSeenAt})`,
      })
        .from(wbSupplyWriteoffs)
        .where(eq(wbSupplyWriteoffs.tenantId, tenantId)),
    ]);

    return {
      rows: rows as WbSupplyWriteoffRow[],
      summary: (summaryRows[0] ?? {
        totalLines: 0,
        writtenOffUnits: 0,
        openDiscrepancies: 0,
        writeOffErrors: 0,
        lastSeenAt: null,
      }) as WbSupplyWriteoffSummaryRow,
    };
  });
}

async function runWbSupplyWriteoffNow() {
  "use server";

  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect("/settings");
  await requireTenantFeatureAccess(tenantId, "stocks", ["owner", "admin", "manager"]);

  let targetHref: string;
  try {
    const summary = await reconcileWbSupplyWriteoffsForTenant(tenantId);
    revalidatePath("/stocks-v2");
    revalidatePath("/stocks-v2/own-stock");
    revalidatePath("/stocks-v2/wb-supplies");

    const params = new URLSearchParams({
      ran: "1",
      supplies: String(summary.suppliesScanned),
      lines: String(summary.linesSeen),
      written: String(summary.writtenOffUnits),
      diff: String(summary.discrepancies),
      errors: String(summary.writeOffErrors),
    });
    targetHref = `/stocks-v2/wb-supplies?${params.toString()}`;
  } catch (error) {
    const params = new URLSearchParams({
      error: getErrorMessage(error).slice(0, 300),
    });
    targetHref = `/stocks-v2/wb-supplies?${params.toString()}`;
  }

  redirect(targetHref);
}

export default async function WbSuppliesPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const tenantId = await readActiveTenantCookie();
  if (!tenantId) redirect("/settings");
  await requireTenantFeatureAccess(tenantId, "stocks");

  const params = await searchParams;
  const { rows, summary } = await loadWbSupplyWriteoffs(tenantId);

  return (
    <div className="space-y-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2">
            <Link
              href="/stocks-v2"
              prefetch={false}
              className="text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              ← Остатки
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            WB-поставки и автосписания
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Здесь видно, какие принятые поставки WB уже списали свой склад,
            где WB принял другое количество и где не хватило остатка для FIFO-списания.
          </p>
        </div>

        <form action={runWbSupplyWriteoffNow}>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
          >
            Запустить сверку сейчас
          </button>
        </form>
      </div>

      {params.ran === "1" ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
          Сверка завершена: поставок {params.supplies ?? 0}, строк {params.lines ?? 0},
          списано {params.written ?? 0} шт, расхождений {params.diff ?? 0},
          ошибок списания {params.errors ?? 0}.
        </div>
      ) : null}

      {params.error ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          Не удалось запустить сверку: {params.error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Строк учтено</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(summary.totalLines)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Списано со склада</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(summary.writtenOffUnits)} шт</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Открытые расхождения</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(summary.openDiscrepancies)}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Последняя проверка</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">{formatDateTime(summary.lastSeenAt)}</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Последние строки поставок</h2>
            <p className="text-xs text-muted-foreground">Показываются последние 250 строк.</p>
          </div>
          <div className="text-xs font-medium text-muted-foreground">
            Списания также видны в движениях своего склада с причиной `shipped_to_wb`.
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Пока нет обработанных WB-поставок. Нажми “Запустить сверку сейчас”,
            чтобы подтянуть принятые поставки за текущее окно.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/50 text-left text-xs font-semibold uppercase text-muted-foreground">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3">Поставка</th>
                  <th className="whitespace-nowrap px-4 py-3">SKU</th>
                  <th className="whitespace-nowrap px-4 py-3">Склад</th>
                  <th className="whitespace-nowrap px-4 py-3">Дата WB</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Заявлено</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Принято WB</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right">Списано</th>
                  <th className="whitespace-nowrap px-4 py-3">Статус</th>
                  <th className="whitespace-nowrap px-4 py-3">Расхождение</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => {
                  const writeOffBadge = getWriteOffBadge(row);
                  const discrepancyBadge = getDiscrepancyBadge(row);
                  return (
                    <tr key={row.id} className="align-top hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="font-semibold text-foreground">{getSupplyLabel(row)}</div>
                        <div className="text-xs text-muted-foreground">statusID {row.statusId ?? "—"}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-foreground">
                          {row.vendorCode ?? `nmId ${row.nmId}`}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          nmId {row.nmId}{row.barcode ? ` · ${row.barcode}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{row.actualWarehouseName ?? row.warehouseName ?? "—"}</div>
                        {row.warehouseName && row.actualWarehouseName && row.warehouseName !== row.actualWarehouseName ? (
                          <div className="text-xs text-muted-foreground">план: {row.warehouseName}</div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="text-foreground">{formatDate(row.factDate ?? row.supplyDate)}</div>
                        <div className="text-xs text-muted-foreground">обновлено {formatDateTime(row.lastSeenAt)}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatNumber(row.wbQuantity)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatNumber(row.acceptedQuantity)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatNumber(row.localWrittenOffQuantity)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${writeOffBadge.className}`}>
                          {writeOffBadge.label}
                        </span>
                        {row.writeOffError ? (
                          <div className="mt-1 max-w-xs text-xs text-rose-600 dark:text-rose-300">{row.writeOffError}</div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${discrepancyBadge.className}`}>
                          {discrepancyBadge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
