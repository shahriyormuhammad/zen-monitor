'use client';

import { useEffect } from 'react';

// global-error.tsx replaces the root layout on error, so <html>/<body> are required.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Browser console fallback (client-only boundary; pino logger is server-side).
    console.error('[global error boundary]', error);
    // Forward to Sentry if configured. No-op when SENTRY_DSN is empty.
    if (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SENTRY_DSN) {
      import('@sentry/nextjs')
        .then((Sentry) => Sentry.captureException(error))
        .catch(() => { /* swallow import failure */ });
    }
  }, [error]);

  return (
    <html lang="ru">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#0f0f0f',
          color: '#e5e5e5',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1.5rem',
            padding: '2rem',
            maxWidth: '480px',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              background: 'rgba(239,68,68,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
            }}
          >
            ⚠
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>
              Критическая ошибка приложения
            </h2>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#a3a3a3' }}>
              Произошла непредвиденная ошибка. Обновите страницу или обратитесь в
              поддержку.
            </p>
            {error.digest && (
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#737373', fontFamily: 'monospace' }}>
                Код: {error.digest}
              </p>
            )}
          </div>
          <button
            onClick={reset}
            style={{
              padding: '0.5rem 1.5rem',
              borderRadius: '0.375rem',
              border: 'none',
              background: '#3b82f6',
              color: '#fff',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Перезагрузить
          </button>
        </div>
      </body>
    </html>
  );
}
