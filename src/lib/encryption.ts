import crypto from 'crypto';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const ALGORITHM = 'aes-256-gcm';

// NIST SP 800-38D рекомендует 96-bit IV для AES-GCM (performance + security sweet spot).
// v1 writes из прошлого использовали 128-bit IV — всё ещё валидно по стандарту, но не оптимально.
// decrypt() принимает оба, encrypt() пишет только v2.
const IV_LENGTH_V2_BYTES = 12;
const V2_PREFIX = 'v2';

let cachedKey: Buffer | null = null;
let warnedLegacyKeyFormat = false;

const HEX_32_BYTE_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

function parseHexKey(rawValue: string): Buffer | null {
  const normalized = rawValue.trim();
  const candidate = normalized.startsWith('hex:') ? normalized.slice(4) : normalized;

  if (!HEX_32_BYTE_KEY_PATTERN.test(candidate)) {
    return null;
  }

  const decoded = Buffer.from(candidate, 'hex');
  return decoded.length === 32 ? decoded : null;
}

function getEncryptionKey() {
  if (cachedKey) {
    return cachedKey;
  }

  const keyRaw = process.env.ENCRYPTION_KEY;
  if (!keyRaw) {
    throw new Error(
      '[encryption] ENCRYPTION_KEY не задана. Установите переменную окружения длиной не менее 32 символов.'
    );
  }

  const hexKey = parseHexKey(keyRaw);
  if (hexKey) {
    cachedKey = hexKey;
    return cachedKey;
  }

  const rawKeyBuffer = Buffer.from(keyRaw.trim(), 'utf-8');
  if (rawKeyBuffer.length < 32) {
    throw new Error(
      '[encryption] ENCRYPTION_KEY слишком короткий. Требуется минимум 32 символа.'
    );
  }

  // Обратная совместимость для существующих установок:
  // legacy-формат (UTF-8 строка >= 32 байт) оставляем рабочим, но рекомендуем hex-ключ.
  if (!warnedLegacyKeyFormat) {
    logger.warn('[encryption] ENCRYPTION_KEY использует legacy UTF-8 формат. Рекомендуется перейти на 64-символьный hex-ключ.');
    warnedLegacyKeyFormat = true;
  }

  cachedKey = rawKeyBuffer.subarray(0, 32);
  return cachedKey;
}

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH_V2_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Формат v2: `v2:IV:AUTH_TAG:ENCRYPTED` (4 hex-части через двоеточие).
  return `${V2_PREFIX}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

type DecryptComponents = { iv: Buffer; authTag: Buffer; encrypted: Buffer };

function parseCiphertext(hash: string): DecryptComponents | null {
  const parts = hash.split(':');

  // v2: `v2:iv-12:authTag:ciphertext` → 4 parts.
  if (parts.length === 4 && parts[0] === V2_PREFIX) {
    return {
      iv: Buffer.from(parts[1]!, 'hex'),
      authTag: Buffer.from(parts[2]!, 'hex'),
      encrypted: Buffer.from(parts[3]!, 'hex'),
    };
  }

  // v1 legacy: `iv-16:authTag:ciphertext` → 3 parts.
  if (parts.length === 3) {
    return {
      iv: Buffer.from(parts[0]!, 'hex'),
      authTag: Buffer.from(parts[1]!, 'hex'),
      encrypted: Buffer.from(parts[2]!, 'hex'),
    };
  }

  return null;
}

export function decrypt(hash: string): string {
  const components = parseCiphertext(hash);
  if (!components) {
    throw new Error('[encryption] Invalid ciphertext format');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), components.iv);
  decipher.setAuthTag(components.authTag);

  const decrypted = Buffer.concat([decipher.update(components.encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function decryptIfNeeded(value: string, tenantId?: string): string {
  if (!value) {
    return value;
  }

  if (!parseCiphertext(value)) {
    return value;
  }

  try {
    return decrypt(value);
  } catch (error) {
    const context = tenantId ? ` (tenant: ${tenantId})` : '';
    logger.error({ err: error, tenantId: tenantId ?? null }, `[encryption] decryptIfNeeded: decrypt failed${context}`);
    throw new AppError(
      `Не удалось расшифровать WB API токен${context}. Проверьте ENCRYPTION_KEY.`,
      500
    );
  }
}
