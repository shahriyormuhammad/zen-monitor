import process from 'node:process';

export function normalizeBaseUrl(value) {
  return (value || 'http://localhost:3000').replace(/\/$/, '');
}

export function readIntEnv(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function readFloatEnv(name, fallback, { min = 0, max = Number.MAX_VALUE } = {}) {
  const parsed = Number.parseFloat(process.env[name] ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function readBoolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function buildDefaultDateRange(days = 30) {
  const to = new Date();
  const from = new Date(to.getTime() - Math.max(1, days) * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitter(baseMs) {
  if (baseMs <= 0) return 0;
  return Math.round(baseMs * (0.5 + Math.random()));
}
