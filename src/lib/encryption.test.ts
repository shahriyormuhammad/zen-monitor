import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppError as AppErrorType } from '@/lib/errors';

// Set a valid 64-char hex key before importing the module
const VALID_HEX_KEY = 'a'.repeat(64);
const KEY_BUFFER = Buffer.from(VALID_HEX_KEY, 'hex');

/**
 * Construct a legacy v1 ciphertext (16-byte IV, no version prefix) the way
 * the old encrypt() used to write before AES-GCM IV was moved to 12 bytes.
 * Used to verify backwards-compatible decrypt path.
 */
function makeV1Ciphertext(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY_BUFFER, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

describe('encryption', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ENCRYPTION_KEY = VALID_HEX_KEY;
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    vi.restoreAllMocks();
  });

  describe('encrypt / decrypt round-trip', () => {
    it('encrypts and decrypts a string', async () => {
      const { encrypt, decrypt } = await import('@/lib/encryption');
      const original = 'secret-wb-token-12345';
      const ciphertext = encrypt(original);
      expect(ciphertext).not.toBe(original);
      expect(decrypt(ciphertext)).toBe(original);
    });

    it('produces v2-prefixed ciphertext with 12-byte IV', async () => {
      const { encrypt } = await import('@/lib/encryption');
      const ciphertext = encrypt('token');
      const parts = ciphertext.split(':');
      expect(parts.length).toBe(4);
      expect(parts[0]).toBe('v2');
      // 12-byte IV → 24 hex chars
      expect(parts[1]).toHaveLength(24);
      // auth tag is 16 bytes → 32 hex chars
      expect(parts[2]).toHaveLength(32);
    });

    it('produces different ciphertext for the same input each time (random IV)', async () => {
      const { encrypt } = await import('@/lib/encryption');
      const ct1 = encrypt('same');
      const ct2 = encrypt('same');
      expect(ct1).not.toBe(ct2);
    });
  });

  describe('backwards compatibility — v1 legacy ciphertext', () => {
    it('decrypts v1 ciphertext (16-byte IV, no prefix) written by the old encrypt()', async () => {
      const { decrypt } = await import('@/lib/encryption');
      const original = 'legacy-wb-token-v1';
      const ciphertext = makeV1Ciphertext(original);
      // v1 shape: `iv-16:authTag:ciphertext` — 3 colon-separated parts
      expect(ciphertext.split(':').length).toBe(3);
      expect(decrypt(ciphertext)).toBe(original);
    });

    it('decryptIfNeeded accepts v1 legacy payloads', async () => {
      const { decryptIfNeeded } = await import('@/lib/encryption');
      const original = 'legacy-token';
      const ciphertext = makeV1Ciphertext(original);
      expect(decryptIfNeeded(ciphertext)).toBe(original);
    });

    it('handles mixed storage: v1 read + v2 write', async () => {
      const { encrypt, decrypt } = await import('@/lib/encryption');
      const v1 = makeV1Ciphertext('old-token');
      const v2 = encrypt('new-token');
      expect(decrypt(v1)).toBe('old-token');
      expect(decrypt(v2)).toBe('new-token');
      // v1 should NOT have the v2 prefix; v2 should
      expect(v1.startsWith('v2:')).toBe(false);
      expect(v2.startsWith('v2:')).toBe(true);
    });
  });

  describe('decryptIfNeeded', () => {
    it('returns value as-is when it does not look encrypted (< 3 colon-parts)', async () => {
      const { decryptIfNeeded } = await import('@/lib/encryption');
      expect(decryptIfNeeded('plain-token')).toBe('plain-token');
    });

    it('returns 4-part strings without v2 prefix as-is (not recognised as ciphertext)', async () => {
      const { decryptIfNeeded } = await import('@/lib/encryption');
      expect(decryptIfNeeded('foo:bar:baz:qux')).toBe('foo:bar:baz:qux');
    });

    it('returns empty string as-is', async () => {
      const { decryptIfNeeded } = await import('@/lib/encryption');
      expect(decryptIfNeeded('')).toBe('');
    });

    it('decrypts an encrypted value', async () => {
      const { encrypt, decryptIfNeeded } = await import('@/lib/encryption');
      const original = 'my-api-token';
      const ciphertext = encrypt(original);
      expect(decryptIfNeeded(ciphertext)).toBe(original);
    });

    it('throws AppError when value looks encrypted but decryption fails', async () => {
      const { decryptIfNeeded } = await import('@/lib/encryption');
      const { AppError } = await import('@/lib/errors');
      const corrupt = 'aabbcc:ddeeff:001122';
      expect(() => decryptIfNeeded(corrupt)).toThrow(AppError);
    });

    it('includes tenantId in AppError message when provided', async () => {
      const { decryptIfNeeded } = await import('@/lib/encryption');
      const { AppError } = await import('@/lib/errors');
      const corrupt = 'aabbcc:ddeeff:001122';
      expect(() => decryptIfNeeded(corrupt, 'tenant-abc')).toThrow(AppError);
      try {
        decryptIfNeeded(corrupt, 'tenant-abc');
      } catch (e) {
        expect((e as AppErrorType).message).toContain('tenant-abc');
      }
    });

    it('throws AppError status 500 on decrypt failure', async () => {
      const { decryptIfNeeded } = await import('@/lib/encryption');
      const { AppError } = await import('@/lib/errors');
      const corrupt = 'aabbcc:ddeeff:001122';
      try {
        decryptIfNeeded(corrupt);
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppErrorType).status).toBe(500);
      }
    });
  });

  describe('key parsing', () => {
    it('throws when ENCRYPTION_KEY is not set', async () => {
      delete process.env.ENCRYPTION_KEY;
      const { encrypt } = await import('@/lib/encryption');
      expect(() => encrypt('test')).toThrow(/ENCRYPTION_KEY/);
    });

    it('throws when ENCRYPTION_KEY is too short (UTF-8 path)', async () => {
      process.env.ENCRYPTION_KEY = 'short';
      const { encrypt } = await import('@/lib/encryption');
      expect(() => encrypt('test')).toThrow(/короткий|short|32/i);
    });

    it('accepts 64-char hex key', async () => {
      process.env.ENCRYPTION_KEY = VALID_HEX_KEY;
      const { encrypt, decrypt } = await import('@/lib/encryption');
      const ct = encrypt('hello');
      expect(decrypt(ct)).toBe('hello');
    });

    it('accepts hex key with hex: prefix', async () => {
      process.env.ENCRYPTION_KEY = `hex:${VALID_HEX_KEY}`;
      const { encrypt, decrypt } = await import('@/lib/encryption');
      const ct = encrypt('world');
      expect(decrypt(ct)).toBe('world');
    });

    it('accepts legacy UTF-8 key >= 32 chars and emits a warning', async () => {
      const legacyKey = 'a'.repeat(32);
      process.env.ENCRYPTION_KEY = legacyKey;
      const { logger } = await import('@/lib/logger');
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const { encrypt, decrypt } = await import('@/lib/encryption');
      const ct = encrypt('legacy');
      expect(decrypt(ct)).toBe('legacy');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('legacy UTF-8'));
    });
  });
});
