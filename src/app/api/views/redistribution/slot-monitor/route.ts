import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { getRouteScanOverview } from "@/server/redistribution/route-scan";
import { runSlotMonitorForTenant } from "@/server/redistribution/slot-monitor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const POST = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request, ["owner", "admin"]);
  const monitorResult = await runSlotMonitorForTenant(tenantId, {
    triggerSource: "manual_ui",
    monitorMode: "manual",
  });
  const overview = await getRouteScanOverview(tenantId);

  return NextResponse.json({
    ok: true,
    tenantId,
    monitorResult,
    overview,
  });
});
