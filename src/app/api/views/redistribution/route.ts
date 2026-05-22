import { z } from "zod";
import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { parseApiDateParam } from "@/lib/date-range";
import { parseRequestQuery } from "@/lib/api-parse";
import { AppError } from "@/lib/errors";
import { getRedistributionPlan } from "@/server/analytics/redistribution";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const querySchema = z.object({
  from: z.string().min(1, "from is required"),
  to: z.string().min(1, "to is required"),
});

export const GET = apiRoute(async (request: Request) => {
  const { from, to } = parseRequestQuery(request, querySchema);

  const parsedFrom = parseApiDateParam(from);
  const parsedTo = parseApiDateParam(to);
  if (!parsedFrom || !parsedTo) {
    throw new AppError("Invalid date parameters", 400);
  }

  const { tenantId } = await requireActiveTenant(request);
  const plan = await getRedistributionPlan(tenantId, parsedFrom, parsedTo);

  return NextResponse.json(plan);
});
