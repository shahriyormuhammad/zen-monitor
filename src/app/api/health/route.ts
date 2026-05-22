import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { isInngestDev } from "@/inngest/client";
import { withRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const baseEnvKeys = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "ENCRYPTION_KEY",
] as const;

/**
 * Telegram webhook secret is required ONLY when a real bot token is configured.
 * A tenant running without Telegram integration (placeholder/empty token) gets
 * health green; once the real token is set, the webhook secret becomes mandatory.
 */
function hasRealBotToken(): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  return token.length > 0 && !token.includes("your_bot_token") && !token.includes("placeholder");
}

const requiredEnvKeys: readonly string[] = [
  ...baseEnvKeys,
  // Inngest signing key is required unless running local dev server (INNGEST_DEV=1)
  ...(process.env.INNGEST_DEV ? [] : ["INNGEST_SIGNING_KEY"]),
  // Telegram webhook secret is only required when a real bot token is set
  ...(hasRealBotToken() ? ["TELEGRAM_WEBHOOK_SECRET"] : []),
];

type CheckStatus = "ok" | "error" | "skip";

/** Ping Supabase GoTrue health endpoint. Times out in 3 s. */
async function checkSupabase(): Promise<CheckStatus> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return "error";

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3000);
  try {
    const res = await fetch(`${url}/auth/v1/health`, {
      signal: ac.signal,
      headers: { apikey: anonKey },
      cache: "no-store",
    });
    clearTimeout(timer);
    return res.ok ? "ok" : "error";
  } catch {
    clearTimeout(timer);
    return "error";
  }
}

/**
 * Ping the Inngest server:
 *  - dev mode  → INNGEST_BASE_URL (default http://127.0.0.1:8288)
 *  - cloud     → https://api.inngest.com/ (expect 200/301/404, not 5xx)
 * Times out in 3 s.
 */
async function checkInngest(): Promise<CheckStatus> {
  const baseUrl =
    process.env.INNGEST_BASE_URL ||
    (isInngestDev ? "http://127.0.0.1:8288" : "https://api.inngest.com");

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3000);
  try {
    const res = await fetch(baseUrl, {
      signal: ac.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    // Accept any non-5xx response as "reachable"
    return res.status < 500 ? "ok" : "error";
  } catch {
    clearTimeout(timer);
    return "error";
  }
}

export const GET = withRateLimit(async () => {
  const startedAt = Date.now();
  const missingEnv = requiredEnvKeys.filter((key) => !process.env[key]);

  // Run all external checks in parallel
  const [dbResult, supabaseResult, inngestResult] = await Promise.allSettled([
    db.execute(sql`select 1 as ok`),
    checkSupabase(),
    checkInngest(),
  ]);

  const dbStatus: CheckStatus =
    dbResult.status === "fulfilled" ? "ok" : "error";

  const supabaseStatus: CheckStatus =
    supabaseResult.status === "fulfilled" ? supabaseResult.value : "error";

  const inngestStatus: CheckStatus =
    inngestResult.status === "fulfilled" ? inngestResult.value : "error";

  const envStatus = missingEnv.length > 0 ? "missing" : "ok";

  // Hard failure: DB down or required env missing
  const hardFail = dbStatus === "error" || missingEnv.length > 0;
  // Soft degraded: Supabase or Inngest unreachable (background jobs affected but web may still serve)
  const softDegraded = supabaseStatus === "error" || inngestStatus === "error";

  const overallOk = !hardFail && !softDegraded;
  const httpStatus = hardFail ? 503 : softDegraded ? 207 : 200;

  const isProd = process.env.NODE_ENV === "production";

  const body: Record<string, unknown> = {
    ok: overallOk,
    service: "enterprise-wb-analytics",
    timestamp: new Date().toISOString(),
    responseTimeMs: Date.now() - startedAt,
    checks: {
      app: "ok",
      db: dbStatus,
      supabase: supabaseStatus,
      inngest: inngestStatus,
      env: envStatus,
    },
    // In production we only expose a count, not variable names, to avoid giving
    // attackers a map of which secrets are missing on the host.
    missingEnvCount: missingEnv.length,
    ...(isProd ? {} : { missingEnv }),
  };

  if (dbResult.status === "rejected") {
    const err = dbResult.reason;
    body.error =
      err instanceof Error ? err.message : "Unknown healthcheck error";
  }

  return NextResponse.json(body, { status: httpStatus });
}, { per: "ip", limit: 30, window: 60 });
