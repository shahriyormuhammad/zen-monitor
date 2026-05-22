import { syncWildberriesData } from "@/inngest/sync-wb";
import { syncInngestFunctions } from "@/server/jobs/sync-functions";
import { createInngestRoute } from "@/server/inngest/route-handler";

export const dynamic = "force-dynamic";

const route = createInngestRoute([
  syncWildberriesData,
  ...syncInngestFunctions,
]);

export const GET = route.GET;
export const POST = route.POST;
export const PUT = route.PUT;
