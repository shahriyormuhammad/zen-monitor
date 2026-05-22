import { NextResponse } from "next/server";
import { z } from "zod";

import { apiRoute } from "@/lib/api-response";
import { parseRequestQuery } from "@/lib/api-parse";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { parseApiDateParam } from "@/lib/date-range";
import { AppError } from "@/lib/errors";
import { getRedistributionPlan } from "@/server/analytics/redistribution";
import { probeRedistributionSlotsHttp } from "@/server/redistribution/wb-lk-http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const querySchema = z.object({
  from: z.string().min(1, "from is required"),
  to: z.string().min(1, "to is required"),
  limit: z.string().optional(),
});

function parseLimit(value: string | null) {
  const parsed = Number.parseInt(value ?? "20", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 20;
  }
  return Math.min(parsed, 50);
}

export const POST = apiRoute(async (request: Request) => {
  const query = parseRequestQuery(request, querySchema);
  const { tenantId } = await requireActiveTenant(request, ["owner", "admin"]);
  const from = parseApiDateParam(query.from);
  const to = parseApiDateParam(query.to);
  if (!from || !to) {
    throw new AppError("Invalid date parameters", 400);
  }
  const limit = parseLimit(query.limit ?? null);

  const plan = await getRedistributionPlan(tenantId, from, to);
  const recommendations = [...plan.recommendations]
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, limit);

  const probe = await probeRedistributionSlotsHttp({
    tenantId,
    recommendations,
    limit,
    persistAvailability: true,
  });

  return NextResponse.json({
    ...probe,
    planGeneratedAt: plan.generatedAt,
  });
});
