import { redistributionInngestFunctions } from "@/server/jobs/redistribution-functions";
import { createInngestRoute } from "@/server/inngest/route-handler";

export const dynamic = "force-dynamic";

const route = createInngestRoute(redistributionInngestFunctions);

export const GET = route.GET;
export const POST = route.POST;
export const PUT = route.PUT;
