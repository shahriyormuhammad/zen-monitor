'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Browser console fallback (client-only boundary; pino logger is server-side).
    console.error('[dashboard error boundary]', error);
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import('@sentry/nextjs')
        .then((Sentry) => Sentry.captureException(error))
        .catch(() => { /* swallow import failure */ });
    }
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center p-6">
      <div className="flex flex-col items-center gap-3">
        <div className="rounded-full bg-destructive/10 p-4">
          <svg
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          Что-то пошло не так
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Произошла ошибка при загрузке страницы. Попробуйте обновить данные или
          вернитесь на предыдущую страницу.
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground font-mono">
            Код: {error.digest}
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Повторить
        </button>
        <button
          onClick={() => (window.location.href = '/overview')}
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          На главную
        </button>
      </div>
    </div>
  );
}
