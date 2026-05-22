import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import {
  getRouteScanOverview,
  runRouteScanForTenant,
} from "@/server/redistribution/route-scan";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request);
  const overview = await getRouteScanOverview(tenantId);
  return NextResponse.json(overview);
});

export const POST = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request, ["owner", "admin"]);
  const scan = await runRouteScanForTenant(tenantId);
  return NextResponse.json({
    ok: true,
    tenantId,
    refreshed: scan.refreshed,
    overview: scan.overview,
  });
});
