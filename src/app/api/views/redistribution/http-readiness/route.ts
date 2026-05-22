import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { checkRedistributionHttpReadiness } from "@/server/redistribution/http-readiness";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const POST = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request, ["owner", "admin"]);
  const readiness = await checkRedistributionHttpReadiness(tenantId, {
    persistHealth: true,
    timeoutMs: 15_000,
  });

  return NextResponse.json(readiness);
});
