import { describe, expect, it } from 'vitest';

import { hashTelegramLinkToken, normalizeTelegramStartToken } from './telegram-link-token';

describe('normalizeTelegramStartToken', () => {
  it('accepts Telegram-safe one-time tokens', () => {
    expect(normalizeTelegramStartToken('abcDEF_123-xyzABC_123-xyzABC_123')).toBe('abcDEF_123-xyzABC_123-xyzABC_123');
  });

  it('trims valid tokens', () => {
    expect(normalizeTelegramStartToken('  abcDEF_123-xyzABC_123-xyzABC_123  ')).toBe('abcDEF_123-xyzABC_123-xyzABC_123');
  });

  it('rejects short or unsafe values', () => {
    expect(normalizeTelegramStartToken('short')).toBeNull();
    expect(normalizeTelegramStartToken('abcDEF_123-xyzABC_123-xyzABC_123!')).toBeNull();
  });
});

describe('hashTelegramLinkToken', () => {
  it('returns a stable sha256 hex hash', () => {
    const token = 'abcDEF_123-xyzABC_123-xyzABC_123';
    expect(hashTelegramLinkToken(token)).toBe(hashTelegramLinkToken(token));
    expect(hashTelegramLinkToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });
});
