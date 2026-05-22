#!/usr/bin/env node
/**
 * rotate-encryption-key.mjs
 *
 * Плавная ротация ENCRYPTION_KEY: читает все wb_api_token из таблицы tenants,
 * расшифровывает старым ключом, шифрует новым, обновляет строки.
 *
 * Usage:
 *   node scripts/rotate-encryption-key.mjs \
 *     --old-key <64-char-hex> \
 *     --new-key <64-char-hex> \
 *     [--dry-run]
 *
 * Либо через env-переменные:
 *   ROTATE_OLD_KEY=<hex> ROTATE_NEW_KEY=<hex> node scripts/rotate-encryption-key.mjs
 *
 * DATABASE_URL берётся из env или из .env.production в корне проекта.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };
  return {
    oldKey: get('--old-key') ?? process.env.ROTATE_OLD_KEY,
    newKey: get('--new-key') ?? process.env.ROTATE_NEW_KEY,
    dryRun: args.includes('--dry-run'),
  };
}

function loadEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env.production');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

const HEX_32_PATTERN = /^[0-9a-fA-F]{64}$/;

function parseHexKey(raw) {
  if (!raw) return null;
  const candidate = raw.trim().startsWith('hex:') ? raw.trim().slice(4) : raw.trim();
  if (!HEX_32_PATTERN.test(candidate)) return null;
  const buf = Buffer.from(candidate, 'hex');
  return buf.length === 32 ? buf : null;
}

function encryptWithKey(text, keyBuf) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptWithKey(hash, keyBuf) {
  const [ivHex, authTagHex, encryptedHex] = hash.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function looksEncrypted(value) {
  return typeof value === 'string' && value.split(':').length === 3;
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  loadEnvFile();

  const { oldKey: oldKeyRaw, newKey: newKeyRaw, dryRun } = parseArgs();

  if (!oldKeyRaw || !newKeyRaw) {
    console.error('Error: --old-key and --new-key are required (or ROTATE_OLD_KEY / ROTATE_NEW_KEY env vars).');
    process.exit(1);
  }

  const oldKeyBuf = parseHexKey(oldKeyRaw);
  const newKeyBuf = parseHexKey(newKeyRaw);

  if (!oldKeyBuf) {
    console.error('Error: --old-key must be a 64-character hex string (optionally prefixed with "hex:").');
    process.exit(1);
  }
  if (!newKeyBuf) {
    console.error('Error: --new-key must be a 64-character hex string (optionally prefixed with "hex:").');
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('Error: DATABASE_URL is not set. Set it in env or ensure .env.production is present.');
    process.exit(1);
  }

  if (dryRun) {
    console.log('[dry-run] No database writes will be performed.');
  }

  // Динамический импорт postgres (зависит от окружения, где установлен пакет)
  let sql;
  try {
    const { default: postgres } = await import('postgres');
    sql = postgres(databaseUrl, { max: 1, idle_timeout: 10 });
  } catch {
    console.error('Error: cannot import "postgres" package. Run: npm install postgres');
    process.exit(1);
  }

  try {
    const rows = await sql`SELECT id, name, wb_api_token FROM tenants WHERE wb_api_token IS NOT NULL`;
    console.log(`Found ${rows.length} tenant(s) with wb_api_token.`);

    let rotated = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      const { id, name, wb_api_token } = row;

      if (!looksEncrypted(wb_api_token)) {
        console.log(`  [skip] tenant ${id} (${name}): token does not look encrypted — skipping.`);
        skipped++;
        continue;
      }

      let plaintext;
      try {
        plaintext = decryptWithKey(wb_api_token, oldKeyBuf);
      } catch (err) {
        console.error(`  [fail] tenant ${id} (${name}): decrypt with old key failed — ${err.message}`);
        failed++;
        continue;
      }

      const newCiphertext = encryptWithKey(plaintext, newKeyBuf);

      if (dryRun) {
        console.log(`  [dry-run] tenant ${id} (${name}): would re-encrypt token (${wb_api_token.slice(0, 8)}... → ${newCiphertext.slice(0, 8)}...)`);
      } else {
        await sql`UPDATE tenants SET wb_api_token = ${newCiphertext} WHERE id = ${id}`;
        console.log(`  [ok] tenant ${id} (${name}): token re-encrypted.`);
      }
      rotated++;
    }

    console.log(`\nDone. rotated=${rotated} skipped=${skipped} failed=${failed}`);
    if (failed > 0) {
      console.error('Some tokens could not be decrypted with the old key. Check ROTATE_OLD_KEY.');
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
