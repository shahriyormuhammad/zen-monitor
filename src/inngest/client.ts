import { Inngest } from "inngest";

export const isInngestDev = Boolean(process.env.INNGEST_DEV);

const inngestAppId = process.env.INNGEST_APP_ID
  || (process.env.WORKER_ROLE
    ? `enterprise-wb-analytics-${process.env.WORKER_ROLE}`
    : "enterprise-wb-analytics");

export const inngest = new Inngest({
  id: inngestAppId,
  signingKey: process.env.INNGEST_SIGNING_KEY || undefined,
  eventKey: process.env.INNGEST_EVENT_KEY || undefined,
  baseUrl: process.env.INNGEST_BASE_URL || undefined,
});
