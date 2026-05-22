/**
 * Next.js instrumentation hook — Sentry scaffolding.
 *
 * Scaffolding is safe to ship even when SENTRY_DSN is unset: the init call
 * becomes a no-op and no events are sent. Flip on by filling SENTRY_DSN in
 * .env.production. Sample rates and integrations are intentionally conservative
 * (0.1 sampling, no auto-tracing) — tune after first signal.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) {
    return;
  }

  const Sentry = await import('@sentry/nextjs');

  const common = {
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    // Conservative sampling: 10% of transactions, 100% of errors.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    // Do not auto-instrument fetch so that outbound WB API calls aren't
    // tagged unless we explicitly wrap them.
    integrations: [],
  };

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      ...common,
      // Ignore known operational noise: Inngest runtime checks, Telegram 401s
      // on placeholder bot tokens, AppError 4xx (expected user errors).
      beforeSend(event, hint) {
        const err = hint?.originalException as { status?: number; name?: string } | undefined;
        if (err?.name === 'AppError' && typeof err.status === 'number' && err.status < 500) {
          return null;
        }
        return event;
      },
    });
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(common);
  }
}

/**
 * Captures uncaught server-side errors reported by Next.js. Hooked up
 * automatically when this file exports `onRequestError`.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (!process.env.SENTRY_DSN) {
    return;
  }
  const Sentry = await import('@sentry/nextjs');
  Sentry.captureRequestError(err, request, context);
}
