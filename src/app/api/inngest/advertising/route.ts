import { advertisingInngestFunctions } from "@/server/jobs/advertising-functions";
import { createInngestRoute } from "@/server/inngest/route-handler";

export const dynamic = "force-dynamic";

const route = createInngestRoute(advertisingInngestFunctions);

export const GET = route.GET;
export const POST = route.POST;
export const PUT = route.PUT;
