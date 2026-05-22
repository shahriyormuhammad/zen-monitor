import { createInngestRoute } from "@/server/inngest/route-handler";
import { opsInngestFunctions } from "@/server/jobs/ops-functions";

export const dynamic = "force-dynamic";

const route = createInngestRoute(opsInngestFunctions);

export const GET = route.GET;
export const POST = route.POST;
export const PUT = route.PUT;
