import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetForTest,
  awaitUserResponse,
  closeSession,
  createAuthSession,
  getActiveSessionCount,
  getAuthSession,
  pushEvent,
  pushUserResponse,
  subscribeEvents,
  type AuthEvent,
} from './auth-channel';

describe('wb-rpa/auth-channel', () => {
  beforeEach(() => {
    __resetForTest();
  });
  afterEach(() => {
    __resetForTest();
  });

  it('создаёт сессию с уникальным id', () => {
    const a = createAuthSession('tenant-1');
    const b = createAuthSession('tenant-2');
    expect(a).not.toBe(b);
    expect(getActiveSessionCount()).toBe(2);
  });

  it('getAuthSession возвращает state нашей сессии', () => {
    const id = createAuthSession('tenant-1');
    const s = getAuthSession(id);
    expect(s?.tenantId).toBe('tenant-1');
    expect(s?.status).toBe('connecting');
    expect(s?.closed).toBe(false);
  });

  it('pushEvent обновляет status у сессии', () => {
    const id = createAuthSession('tenant-1');
    pushEvent(id, { type: 'status', status: 'awaiting_sms' });
    expect(getAuthSession(id)?.status).toBe('awaiting_sms');
  });

  it('subscribeEvents отдаёт push-события по порядку', async () => {
    const id = createAuthSession('tenant-1');

    // События пушим из соседнего таска, чтобы итератор реально подписался первым.
    queueMicrotask(() => {
      pushEvent(id, { type: 'status', status: 'awaiting_sms' });
      pushEvent(id, { type: 'sms_required' });
      closeSession(id, true);
    });

    const events: AuthEvent[] = [];
    for await (const e of subscribeEvents(id)) {
      events.push(e);
      if (e.type === 'completed') break;
    }
    expect(events.map((e) => e.type)).toEqual(['status', 'sms_required', 'completed']);
  });

  it('subscribeEvents отдаёт события которые пришли ДО начала итерации (буфер)', async () => {
    const id = createAuthSession('tenant-1');

    // Пушим до того как кто-то начал слушать. EventEmitter без подписчика их не сохранит,
    // поэтому начинаем подписку и сразу пушим.
    const iter = subscribeEvents(id)[Symbol.asyncIterator]();
    pushEvent(id, { type: 'status', status: 'awaiting_captcha' });
    pushEvent(id, { type: 'captcha_image', dataUrl: 'data:image/png;base64,xxx' });
    closeSession(id, true);

    const e1 = await iter.next();
    const e2 = await iter.next();
    const e3 = await iter.next();
    expect(e1.value?.type).toBe('status');
    expect(e2.value?.type).toBe('captcha_image');
    expect(e3.value?.type).toBe('completed');
  });

  it('awaitUserResponse получает следующий ответ юзера', async () => {
    const id = createAuthSession('tenant-1');
    const promise = awaitUserResponse(id, 1000);
    pushUserResponse(id, { type: 'sms_code', code: '12345' });
    const r = await promise;
    expect(r).toEqual({ type: 'sms_code', code: '12345' });
  });

  it('awaitUserResponse падает по таймауту', async () => {
    const id = createAuthSession('tenant-1');
    await expect(awaitUserResponse(id, 50)).rejects.toThrow(/timeout/i);
  });

  it('pushEvent на закрытую сессию возвращает false и не падает', () => {
    const id = createAuthSession('tenant-1');
    closeSession(id, false, 'test');
    expect(pushEvent(id, { type: 'log', level: 'info', message: 'after close' })).toBe(false);
  });

  it('pushUserResponse на закрытую сессию возвращает false', () => {
    const id = createAuthSession('tenant-1');
    closeSession(id, false);
    expect(pushUserResponse(id, { type: 'cancel' })).toBe(false);
  });

  it('closeSession эмитит completed-событие подписчикам', async () => {
    const id = createAuthSession('tenant-1');
    const iter = subscribeEvents(id)[Symbol.asyncIterator]();
    closeSession(id, true, 'success');
    const ev = await iter.next();
    expect(ev.value).toEqual({ type: 'completed', success: true, reason: 'success' });
  });

  it('после closeSession + 5.5с сессия удаляется из реестра', async () => {
    const id = createAuthSession('tenant-1');
    closeSession(id, true);
    await new Promise((r) => setTimeout(r, 5_100));
    expect(getAuthSession(id)).toBeNull();
    expect(getActiveSessionCount()).toBe(0);
  }, 10_000);

  it('replay buffer: подписка ПОСЛЕ pushEvent отдаёт прошлые события', async () => {
    const id = createAuthSession('tenant-1');

    // Пушим события до подписки (race condition сценарий).
    pushEvent(id, { type: 'log', level: 'info', message: 'event 1 (early)' });
    pushEvent(id, { type: 'status', status: 'awaiting_captcha' });
    pushEvent(id, { type: 'log', level: 'error', message: 'something broke' });
    closeSession(id, false, 'test-failure');

    // Поздняя подписка — должна получить ВСЕ 4 события (включая completed).
    const events: AuthEvent[] = [];
    for await (const e of subscribeEvents(id)) {
      events.push(e);
      if (e.type === 'completed') break;
    }
    expect(events.map((e) => e.type)).toEqual(['log', 'status', 'log', 'completed']);
    const completed = events[events.length - 1];
    if (completed?.type === 'completed') {
      expect(completed.success).toBe(false);
      expect(completed.reason).toBe('test-failure');
    } else {
      throw new Error('expected completed event last');
    }
  });
});
