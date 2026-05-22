'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  Phone,
  ShieldQuestion,
  X,
} from 'lucide-react';

type Phase =
  | 'idle'              // показываем форму ввода телефона
  | 'starting'          // POST /start, ждём sessionId
  | 'connecting'        // браузер открывается
  | 'awaiting_phone'    // вводим телефон в WB
  | 'awaiting_captcha'  // показали CAPTCHA, ждём от юзера
  | 'awaiting_sms'      // ждём SMS от юзера
  | 'finalizing'        // сохраняем сессию
  | 'success'
  | 'failed';

type LogLine = { level: 'info' | 'warn' | 'error'; message: string; ts: number };

type EventFromServer =
  | { type: 'status'; status: Phase; message?: string }
  | { type: 'captcha_image'; dataUrl: string; hint?: string }
  | { type: 'sms_required'; hint?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'completed'; success: boolean; reason?: string };

const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Готов к старту',
  starting: 'Запускаю робота…',
  connecting: 'Открываю браузер на сервере…',
  awaiting_phone: 'Ввожу номер телефона…',
  awaiting_captcha: 'WB просит проверочный код с картинки',
  awaiting_sms: 'WB отправил SMS — введите код',
  finalizing: 'Сохраняю сессию…',
  success: 'Готово — вход выполнен',
  failed: 'Ошибка',
};

export function WbLkAuthFlow({
  initialPhone,
  onSuccess,
}: {
  initialPhone?: string | null;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [phase, setPhase] = useState<Phase>('idle');
  const [phaseMessage, setPhaseMessage] = useState<string>('');
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [captchaDataUrl, setCaptchaDataUrl] = useState<string | null>(null);
  const [captchaHint, setCaptchaHint] = useState<string>('');
  const [smsHint, setSmsHint] = useState<string>('');
  const [userInput, setUserInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const reset = useCallback(() => {
    cleanup();
    setPhase('idle');
    setPhaseMessage('');
    setLogs([]);
    setCaptchaDataUrl(null);
    setCaptchaHint('');
    setSmsHint('');
    setUserInput('');
    setSessionId(null);
    setError(null);
    setSubmitting(false);
  }, [cleanup]);

  const handleClose = useCallback(async () => {
    if (sessionId && phase !== 'success' && phase !== 'failed') {
      // Cancel session backend-side.
      try {
        await fetch(`/api/admin/wb-lk-auth/respond/${sessionId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'cancel' }),
        });
      } catch {
        /* ignore */
      }
    }
    reset();
    setOpen(false);
  }, [sessionId, phase, reset]);

  const startLogin = async () => {
    if (!phone.trim()) {
      setError('Введите номер телефона');
      return;
    }
    setError(null);
    setLogs([]);
    setPhase('starting');
    setSubmitting(true);
    try {
      const r = await fetch('/api/admin/wb-lk-auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error?.message || body.error || `HTTP ${r.status}`);
      }
      const { sessionId: sid } = (await r.json()) as { sessionId: string };
      setSessionId(sid);

      // Подписываемся на SSE
      const es = new EventSource(`/api/admin/wb-lk-auth/stream/${sid}`);
      eventSourceRef.current = es;

      const handleEvent = (eventType: string) => (msg: MessageEvent) => {
        try {
          const data = JSON.parse(msg.data) as EventFromServer | { status: Phase };
          if (eventType === 'status' && 'status' in data) {
            setPhase(data.status);
            if ('message' in data && data.message) setPhaseMessage(data.message);
            return;
          }
          if (!('type' in data)) return;
          switch (data.type) {
            case 'status':
              setPhase(data.status);
              if (data.message) setPhaseMessage(data.message);
              break;
            case 'captcha_image':
              setCaptchaDataUrl(data.dataUrl);
              setCaptchaHint(data.hint ?? 'Введите код с картинки');
              setUserInput('');
              break;
            case 'sms_required':
              setSmsHint(data.hint ?? 'Введите код из SMS');
              setUserInput('');
              break;
            case 'log':
              setLogs((prev) => [...prev, { level: data.level, message: data.message, ts: Date.now() }]);
              break;
            case 'completed':
              if (data.success) {
                setPhase('success');
                onSuccess?.();
              } else {
                setPhase('failed');
                if (data.reason) setError(data.reason);
              }
              cleanup();
              break;
          }
        } catch {
          /* ignore parse errors */
        }
      };
      es.addEventListener('status', handleEvent('status'));
      es.addEventListener('captcha_image', handleEvent('captcha_image'));
      es.addEventListener('sms_required', handleEvent('sms_required'));
      es.addEventListener('log', handleEvent('log'));
      es.addEventListener('completed', handleEvent('completed'));
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          // SSE закрыт — это нормально на completed.
          return;
        }
        setError('Связь с сервером прервалась');
      };
    } catch (err) {
      setError((err as Error).message);
      setPhase('failed');
    } finally {
      setSubmitting(false);
    }
  };

  const submitResponse = async (kind: 'captcha_answer' | 'sms_code') => {
    if (!sessionId || !userInput.trim()) return;
    setSubmitting(true);
    try {
      const body =
        kind === 'captcha_answer'
          ? { type: 'captcha_answer', answer: userInput.trim() }
          : { type: 'sms_code', code: userInput.trim() };
      const r = await fetch(`/api/admin/wb-lk-auth/respond/${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.error?.message || data.error || `HTTP ${r.status}`);
      }
      setUserInput('');
      setCaptchaDataUrl(null); // ждём след. событие от сервера
      setSmsHint('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          reset();
          setPhone(initialPhone ?? '');
          setOpen(true);
        }}
        className="inline-flex items-center gap-2 rounded-xl border-2 border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-bold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300"
      >
        <ShieldQuestion className="h-4 w-4" />
        Войти в WB ЛК (с CAPTCHA в окне)
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Lock className="h-4 w-4 text-emerald-500" />
            Вход в WB ЛК
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Текущий статус */}
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
            {phase === 'success' ? (
              <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-emerald-500" />
            ) : phase === 'failed' ? (
              <AlertCircle className="h-5 w-5 flex-shrink-0 text-rose-500" />
            ) : phase === 'idle' ? (
              <Lock className="h-5 w-5 flex-shrink-0 text-emerald-500" />
            ) : (
              <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-emerald-500" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{PHASE_LABEL[phase]}</div>
              {phaseMessage && (
                <div className="mt-0.5 text-xs text-muted-foreground">{phaseMessage}</div>
              )}
            </div>
          </div>

          {/* Расширенный error блок: показываем reason + последний error/warn log */}
          {(error || phase === 'failed') && (() => {
            const lastErrorLog = [...logs].reverse().find((l) => l.level === 'error' || l.level === 'warn');
            return (
              <div className="space-y-2 rounded-xl border border-rose-500/40 bg-rose-500/5 px-4 py-3">
                <div className="text-sm font-semibold text-rose-700 dark:text-rose-400">
                  {error || 'Не удалось завершить вход'}
                </div>
                {lastErrorLog && lastErrorLog.message !== error && (
                  <div className="break-all rounded-lg border border-rose-500/20 bg-white/40 p-2 font-mono text-[11px] text-rose-700 dark:bg-rose-900/10 dark:text-rose-300">
                    {lastErrorLog.message}
                  </div>
                )}
                <div className="text-[11px] text-muted-foreground">
                  Что попробовать: проверить, установлен ли Chromium на сервере
                  (<code>npx playwright install chromium</code>), что в .env заполнены
                  WB_RPA_LOGIN_URL / SELECTOR / SUBMIT_SELECTOR, и что номер телефона
                  совпадает с привязанным к WB ЛК.
                </div>
              </div>
            );
          })()}

          {/* idle: phone input */}
          {phase === 'idle' && (
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Номер телефона WB ЛК
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+7 999 123-45-67"
                    className="w-full rounded-lg border border-border bg-card py-2 pl-10 pr-3 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={startLogin}
                  disabled={submitting}
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Войти
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Робот откроет WB на сервере, попросит вас пройти CAPTCHA
                (картинку покажем здесь же) и ввести SMS-код.
              </p>
            </div>
          )}

          {/* CAPTCHA — picture + input */}
          {phase === 'awaiting_captcha' && captchaDataUrl && (
            <div className="space-y-2 rounded-xl border-2 border-amber-500/40 bg-amber-500/5 p-4">
              <div className="text-sm font-semibold text-foreground">{captchaHint}</div>
              <Image
                src={captchaDataUrl}
                alt="CAPTCHA"
                width={480}
                height={180}
                unoptimized
                className="mx-auto h-auto max-h-64 w-auto rounded border border-border bg-white"
              />
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="text"
                  autoFocus
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitResponse('captcha_answer'); }}
                  placeholder="Код с картинки"
                  className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => submitResponse('captcha_answer')}
                  disabled={submitting || !userInput.trim()}
                  className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Отправить
                </button>
              </div>
            </div>
          )}

          {/* SMS — input */}
          {phase === 'awaiting_sms' && (
            <div className="space-y-2 rounded-xl border-2 border-sky-500/40 bg-sky-500/5 p-4">
              <div className="text-sm font-semibold text-foreground">{smsHint || 'Введите код из SMS'}</div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitResponse('sms_code'); }}
                  placeholder="123456"
                  className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-center text-lg tracking-[0.4em] tabular-nums focus:border-sky-500 focus:outline-none"
                  maxLength={8}
                />
                <button
                  type="button"
                  onClick={() => submitResponse('sms_code')}
                  disabled={submitting || !userInput.trim()}
                  className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Отправить
                </button>
              </div>
            </div>
          )}

          {/* Лог под спойлером — авто-открыт при ошибке */}
          {logs.length > 0 && (
            <details
              className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-xs"
              open={phase === 'failed'}
            >
              <summary className="cursor-pointer font-semibold text-muted-foreground">
                Подробно ({logs.length})
              </summary>
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto font-mono">
                {logs.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.level === 'error'
                        ? 'text-rose-700 dark:text-rose-400'
                        : line.level === 'warn'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-muted-foreground'
                    }
                  >
                    [{new Date(line.ts).toLocaleTimeString('ru-RU')}] {line.message}
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* success / failed → close */}
          {(phase === 'success' || phase === 'failed') && (
            <div className="flex items-center justify-end gap-2">
              {phase === 'failed' && (
                <button
                  type="button"
                  onClick={() => { reset(); setPhone(initialPhone ?? ''); }}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Попробовать снова
                </button>
              )}
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600"
              >
                Закрыть
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
