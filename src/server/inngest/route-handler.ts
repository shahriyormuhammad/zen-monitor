import type { NextRequest } from "next/server";
import { serve } from "inngest/next";

import { inngest, isInngestDev } from "@/inngest/client";
import { logger } from "@/lib/logger";

type InngestServeOptions = Parameters<typeof serve>[0];
type InngestServeFunction = InngestServeOptions["functions"][number];

export function createInngestRoute(functions: InngestServeFunction[]) {
  const handler = serve({
    client: inngest,
    functions,
  });

  let devWarningLogged = false;

  function guardSigningKey() {
    if (process.env.NODE_ENV === "production" && !isInngestDev && !process.env.INNGEST_SIGNING_KEY) {
      logger.error("INNGEST_SIGNING_KEY is required in production without INNGEST_DEV");
      return new Response("Service Unavailable", { status: 503 });
    }
    if (process.env.NODE_ENV === "production" && isInngestDev && !devWarningLogged) {
      devWarningLogged = true;
      logger.warn(
        "INNGEST_DEV=1 in production; signing key verification is disabled. "
          + "Remove INNGEST_DEV and set INNGEST_SIGNING_KEY when switching to signed Inngest runtime.",
      );
    }
    return null;
  }

  return {
    GET(req: NextRequest, ctx: unknown) {
      const blocked = guardSigningKey();
      if (blocked) return blocked;
      return handler.GET(req, ctx);
    },
    POST(req: NextRequest, ctx: unknown) {
      const blocked = guardSigningKey();
      if (blocked) return blocked;
      return handler.POST(req, ctx);
    },
    PUT(req: NextRequest, ctx: unknown) {
      const blocked = guardSigningKey();
      if (blocked) return blocked;
      return handler.PUT(req, ctx);
    },
  };
}
