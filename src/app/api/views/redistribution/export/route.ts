import { z } from "zod";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { parseApiDateParam } from "@/lib/date-range";
import { parseRequestQuery } from "@/lib/api-parse";
import { AppError } from "@/lib/errors";
import { buildRedistributionCsvContent, buildRedistributionCsvFilename } from "@/server/analytics/redistribution-csv";
import { getRedistributionPlan } from "@/server/analytics/redistribution";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const querySchema = z.object({
  from: z.string().min(1, "from is required"),
  to: z.string().min(1, "to is required"),
});

export const GET = apiRoute(async (request: Request) => {
  const { from: dateFrom, to: dateTo } = parseRequestQuery(request, querySchema);

  const parsedDateFrom = parseApiDateParam(dateFrom);
  const parsedDateTo = parseApiDateParam(dateTo);
  if (!parsedDateFrom || !parsedDateTo) {
    throw new AppError("Invalid date parameters", 400);
  }

  const { tenantId } = await requireActiveTenant(request);
  const plan = await getRedistributionPlan(tenantId, parsedDateFrom, parsedDateTo);
  const csvContent = buildRedistributionCsvContent(plan);
  const filename = buildRedistributionCsvFilename({
    from: dateFrom,
    to: dateTo,
  });

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
