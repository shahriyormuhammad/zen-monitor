import { reviewsQuestionsInngestFunctions } from "@/server/jobs/reviews-functions";
import { createInngestRoute } from "@/server/inngest/route-handler";

export const dynamic = "force-dynamic";

const route = createInngestRoute(reviewsQuestionsInngestFunctions);

export const GET = route.GET;
export const POST = route.POST;
export const PUT = route.PUT;
