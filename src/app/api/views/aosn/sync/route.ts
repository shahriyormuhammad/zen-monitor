import { NextResponse } from "next/server";

import { apiRoute } from "@/lib/api-response";
import { requireActiveTenant } from "@/lib/auth/tenant-access";
import { normalizeAusnMonth } from "@/server/analytics/services/ausn";
import { syncAusnFromWbDocuments } from "@/server/analytics/services/ausn-auto";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const POST = apiRoute(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const month = normalizeAusnMonth(typeof body.month === "string" ? body.month : null);
  const { tenantId } = await requireActiveTenant(request, ["owner", "admin"]);
  const result = await syncAusnFromWbDocuments(tenantId, month);

  return NextResponse.json(result);
});
