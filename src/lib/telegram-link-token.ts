import { createHash } from 'node:crypto';

const TELEGRAM_LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,160}$/;

export function normalizeTelegramStartToken(value: string | undefined | null) {
  const token = value?.trim();
  if (!token || !TELEGRAM_LINK_TOKEN_PATTERN.test(token)) {
    return null;
  }

  return token;
}

export function hashTelegramLinkToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
