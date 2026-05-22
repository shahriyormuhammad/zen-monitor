import { syncWildberriesData } from "@/inngest/sync-wb";
import { inngestFunctions } from "@/server/jobs";
import { createInngestRoute } from "@/server/inngest/route-handler";

export const dynamic = "force-dynamic";

const route = createInngestRoute([
  syncWildberriesData,
  ...inngestFunctions,
]);

export const GET = route.GET;
export const POST = route.POST;
export const PUT = route.PUT;
