/**
 * In-memory channel для bidirectional общения между фоновым WB-LK auth flow
 * (Playwright) и Settings UI через SSE.
 *
 * Жизненный цикл:
 *   1. Settings UI вызывает createSession(tenantId) → sessionId.
 *   2. UI открывает SSE-стрим subscribeEvents(sessionId).
 *   3. Параллельно стартует Playwright login flow с этим sessionId.
 *   4. Когда Playwright встречает CAPTCHA / SMS — pushEvent(...) → UI рендерит.
 *   5. UI отправляет ответ юзера → pushUserResponse(...).
 *   6. Playwright awaitUserResponse(...) получает ответ и продолжает flow.
 *   7. На success / failed — closeSession(...).
 *
 * In-memory + per-process: для multi-instance потребуется Redis-pubsub.
 * Сейчас ожидаем 1-2 одновременных авторизации, этого хватит.
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { logger } from '@/lib/logger';

/** События которые сервер шлёт в UI (SSE). */
export type AuthEvent =
  | { type: 'status'; status: AuthStatus; message?: string }
  | { type: 'captcha_image'; dataUrl: string; hint?: string }
  | { type: 'sms_required'; hint?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'completed'; success: boolean; reason?: string };

/** Ответы юзера которые UI шлёт обратно (POST → channel). */
export type UserResponse =
  | { type: 'sms_code'; code: string }
  | { type: 'captcha_answer'; answer: string }
  | { type: 'cancel' };

export type AuthStatus =
  | 'connecting'         // открываем браузер, идём на WB
  | 'awaiting_phone'     // вводим телефон
  | 'awaiting_captcha'   // показали CAPTCHA, ждём от юзера
  | 'awaiting_sms'       // отправили SMS, ждём от юзера
  | 'finalizing'         // успешный вход, сохраняем сессию
  | 'success'            // готово
  | 'failed';            // ошибка

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 минут максимум на одну авторизацию
const USER_RESPONSE_DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 минут на ответ юзера

type Session = {
  sessionId: string;
  tenantId: string;
  createdAt: Date;
  lastActivityAt: Date;
  status: AuthStatus;
  emitter: EventEmitter; // 'event' (AuthEvent) и 'response' (UserResponse)
  /**
   * Persistent buffer всех событий с момента создания. Нужен потому что
   * Playwright job стартует асинхронно сразу после `createAuthSession`,
   * а UI подписывается на SSE через 100-300мс. События которые произошли
   * ДО подписки иначе теряются — и пользователь видит «Ошибка» без деталей.
   * Ограничен 200 событиями (TTL сессии 30 мин — этого достаточно).
   */
  buffer: AuthEvent[];
  closed: boolean;
};

const MAX_BUFFER_SIZE = 200;

const sessions = new Map<string, Session>();

let cleanupInterval: NodeJS.Timeout | null = null;
function ensureCleanupRunning() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.lastActivityAt.getTime() > SESSION_TTL_MS) {
        logger.warn({ sessionId: id, tenantId: s.tenantId }, '[auth-channel] session expired (TTL), closing');
        s.closed = true;
        s.emitter.emit('event', { type: 'completed', success: false, reason: 'TTL expired' } satisfies AuthEvent);
        s.emitter.removeAllListeners();
        sessions.delete(id);
      }
    }
  }, 60 * 1000).unref();
}

export function createAuthSession(tenantId: string): string {
  ensureCleanupRunning();
  const sessionId = randomUUID();
  const now = new Date();
  sessions.set(sessionId, {
    sessionId,
    tenantId,
    createdAt: now,
    lastActivityAt: now,
    status: 'connecting',
    emitter: new EventEmitter(),
    buffer: [],
    closed: false,
  });
  logger.info({ sessionId, tenantId }, '[auth-channel] session created');
  return sessionId;
}

export function getAuthSession(sessionId: string): Session | null {
  return sessions.get(sessionId) ?? null;
}

export function pushEvent(sessionId: string, event: AuthEvent): boolean {
  const s = sessions.get(sessionId);
  if (!s || s.closed) return false;
  s.lastActivityAt = new Date();
  if (event.type === 'status') s.status = event.status;
  // Сохраняем в persistent buffer — чтобы поздняя подписка не теряла события.
  s.buffer.push(event);
  if (s.buffer.length > MAX_BUFFER_SIZE) s.buffer.shift();
  s.emitter.emit('event', event);
  return true;
}

export function pushUserResponse(sessionId: string, response: UserResponse): boolean {
  const s = sessions.get(sessionId);
  if (!s || s.closed) return false;
  s.lastActivityAt = new Date();
  s.emitter.emit('response', response);
  return true;
}

/**
 * Promise который резолвится первым ответом юзера или отклоняется по таймауту.
 * Используется в Playwright flow когда нужно дождаться ввода CAPTCHA / SMS.
 */
export function awaitUserResponse(
  sessionId: string,
  timeoutMs: number = USER_RESPONSE_DEFAULT_TIMEOUT_MS,
): Promise<UserResponse> {
  return new Promise((resolve, reject) => {
    const s = sessions.get(sessionId);
    if (!s || s.closed) {
      reject(new Error('Session not found or closed'));
      return;
    }
    const onResponse = (response: UserResponse) => {
      cleanup();
      resolve(response);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`User response timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      s?.emitter.off('response', onResponse);
    }
    s.emitter.on('response', onResponse);
  });
}

/**
 * Async-iterable для потребления событий через `for await`. Используется в SSE.
 * Завершается когда сессия закрыта (получено completed-событие) или TTL.
 *
 * Важно: подписка на emitter происходит СИНХРОННО при вызове функции, а не
 * при первом next(). Иначе события которые произойдут между созданием
 * iterator и первым next() — потеряются.
 */
export function subscribeEvents(sessionId: string): AsyncIterable<AuthEvent> {
  const s = sessions.get(sessionId);
  if (!s) {
    return (async function* () {
      // empty
    })();
  }

  // Replay buffer: всё что произошло до подписки — отдаём первым.
  const queue: AuthEvent[] = [...s.buffer];
  let pending: ((event: AuthEvent | null) => void) | null = null;

  const onEvent = (event: AuthEvent) => {
    if (pending) {
      const r = pending;
      pending = null;
      r(event);
    } else {
      queue.push(event);
    }
  };
  // Подписываемся СИНХРОННО, чтобы не пропустить события между
  // subscribeEvents() и первым .next().
  s.emitter.on('event', onEvent);

  return (async function* gen() {
    try {
      // Если сессия уже закрыта (например, упала до подписки), и в буфере
      // уже есть completed — yield-им весь буфер и завершаемся.
      const alreadyClosed = s.closed;
      while (true) {
        let event: AuthEvent | null;
        if (queue.length > 0) {
          event = queue.shift()!;
        } else if (alreadyClosed) {
          break;
        } else {
          event = await new Promise<AuthEvent | null>((resolve) => {
            pending = resolve;
          });
        }
        if (event === null) break;
        yield event;
        if (event.type === 'completed') break;
      }
    } finally {
      s.emitter.off('event', onEvent);
    }
  })();
}

export function closeSession(sessionId: string, success: boolean, reason?: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  if (!s.closed) {
    s.closed = true;
    const completed: AuthEvent = { type: 'completed', success, reason };
    // Сохраняем completed в buffer тоже — чтобы поздняя подписка увидела.
    s.buffer.push(completed);
    if (s.buffer.length > MAX_BUFFER_SIZE) s.buffer.shift();
    s.emitter.emit('event', completed);
  }
  // Даём подписчикам время дочитать очередь до закрытия. TTL увеличен до 5с,
  // чтобы поздно подписавшийся клиент успел прочитать buffer.
  setTimeout(() => {
    s.emitter.removeAllListeners();
    sessions.delete(sessionId);
  }, 5_000).unref();
}

/** Только для тестов — сбросить весь state. */
export function __resetForTest(): void {
  for (const s of sessions.values()) {
    s.closed = true;
    s.emitter.removeAllListeners();
  }
  sessions.clear();
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export function getActiveSessionCount(): number {
  return sessions.size;
}
