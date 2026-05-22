import { describe, expect, it } from 'vitest';
import type { Cookie } from 'playwright';

import { findWbTokenV3InCookies } from './token-v3';

function makeCookie(name: string, value: string, domain = '.wildberries.ru'): Cookie {
  return {
    name,
    value,
    domain,
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  };
}

describe('wb-rpa/token-v3 / findWbTokenV3InCookies', () => {
  it('находит WBTokenV3 в массиве куков', () => {
    const cookies = [
      makeCookie('SESSION_ID', 'abc'),
      makeCookie('WBTokenV3', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig'),
      makeCookie('locale', 'ru'),
    ];
    expect(findWbTokenV3InCookies(cookies)).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig');
  });

  it('возвращает null если токена нет', () => {
    const cookies = [makeCookie('SESSION_ID', 'abc'), makeCookie('locale', 'ru')];
    expect(findWbTokenV3InCookies(cookies)).toBeNull();
  });

  it('возвращает null если токен есть но пустой', () => {
    const cookies = [makeCookie('WBTokenV3', '')];
    expect(findWbTokenV3InCookies(cookies)).toBeNull();
  });

  it('игнорирует похожие имена', () => {
    const cookies = [
      makeCookie('WBToken', 'old-token'),
      makeCookie('WBTokenV3Backup', 'fake'),
    ];
    expect(findWbTokenV3InCookies(cookies)).toBeNull();
  });

  it('берёт первый WBTokenV3 если их несколько (для разных доменов)', () => {
    const cookies = [
      makeCookie('WBTokenV3', 'first', '.wildberries.ru'),
      makeCookie('WBTokenV3', 'second', 'seller.wildberries.ru'),
    ];
    expect(findWbTokenV3InCookies(cookies)).toBe('first');
  });

  it('пустой массив → null', () => {
    expect(findWbTokenV3InCookies([])).toBeNull();
  });
});
