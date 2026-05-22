import { advertisingInngestFunctions } from "./advertising-functions";
import { opsInngestFunctions } from "./ops-functions";
import { redistributionInngestFunctions } from "./redistribution-functions";
import { reviewsQuestionsInngestFunctions } from "./reviews-functions";
import { syncInngestFunctions } from "./sync-functions";

export {
  advertisingInngestFunctions,
  opsInngestFunctions,
  redistributionInngestFunctions,
  reviewsQuestionsInngestFunctions,
  syncInngestFunctions,
};

export const inngestFunctions = [
  ...syncInngestFunctions,
  ...redistributionInngestFunctions,
  ...advertisingInngestFunctions,
  ...reviewsQuestionsInngestFunctions,
  ...opsInngestFunctions,
];
