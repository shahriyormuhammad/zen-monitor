import type { RedistributionPlan, RedistributionTransferRecommendation } from "@/server/analytics/redistribution";

const REDISTRIBUTION_CSV_HEADERS = [
  "priority_score",
  "nm_id",
  "vendor_code",
  "brand",
  "size_name",
  "chrt_id",
  "from_region",
  "from_warehouse",
  "from_office_id",
  "to_region",
  "to_warehouse",
  "to_office_id",
  "transfer_units",
  "estimated_savings_rub",
  "current_local_share_pct",
  "simulated_local_share_pct",
  "current_krp_pct",
  "simulated_krp_pct",
  "from_coverage_days_before",
  "to_coverage_days_before",
  "application_comment",
] as const;

function escapeCsvCell(value: unknown) {
  const normalized = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(normalized)) {
    return `"${normalized.replaceAll('"', '""')}"`;
  }

  return normalized;
}

function toCsvLine(values: unknown[]) {
  return values.map((value) => escapeCsvCell(value)).join(",");
}

function toRecommendationCsvRow(item: RedistributionTransferRecommendation) {
  return [
    item.priorityScore,
    item.nmId,
    item.vendorCode,
    item.brand,
    item.sizeName,
    item.chrtId,
    item.fromRegionName,
    item.fromWarehouse,
    item.fromOfficeId,
    item.toRegionName,
    item.toWarehouse,
    item.toOfficeId,
    item.transferUnits,
    item.estimatedSavingsRub,
    item.currentLocalSharePct,
    item.simulatedLocalSharePct,
    item.currentKrpPct,
    item.simulatedKrpPct,
    item.fromCoverageDaysBefore,
    item.toCoverageDaysBefore,
    `Переместить ${item.transferUnits} шт размера ${item.sizeName} с ${item.fromWarehouse} (${item.fromRegionName}) на ${item.toWarehouse} (${item.toRegionName})`,
  ] satisfies unknown[];
}

export function buildRedistributionCsvContent(
  plan: Pick<RedistributionPlan, "recommendations">,
  options?: {
    includeBom?: boolean;
  },
) {
  const rows: unknown[][] = [
    [...REDISTRIBUTION_CSV_HEADERS],
    ...plan.recommendations.map((item) => toRecommendationCsvRow(item)),
  ];
  const csvBody = rows.map((row) => toCsvLine(row)).join("\n");
  return options?.includeBom === false ? csvBody : `\uFEFF${csvBody}`;
}

export function buildRedistributionCsvFilename(input: {
  tenantName?: string | null;
  from: string;
  to: string;
  runId?: string;
}) {
  const normalizedTenant = (input.tenantName ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^0-9a-zа-яё_-]+/gi, "")
    .slice(0, 64);
  const tenantPart = normalizedTenant.length > 0 ? normalizedTenant : "tenant";
  const runPart = input.runId ? `-${input.runId.slice(0, 8)}` : "";
  return `redistribution-requests-${tenantPart}-${input.from}_${input.to}${runPart}.csv`;
}
