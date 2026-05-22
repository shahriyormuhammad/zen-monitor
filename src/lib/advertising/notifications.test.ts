import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatAdAlert,
  shouldThrottle,
  markAlertSent,
  __resetThrottleForTests,
  ALERT_THROTTLE_MS,
} from './notifications';

const BASE = { appBaseUrl: 'https://app.example.com' };

describe('formatAdAlert', () => {
  describe('auto_pause', () => {
    it('включает эмодзи, название кампании, reason из explainAction и ссылку', () => {
      const { text, parseMode } = formatAdAlert(
        {
          type: 'auto_pause',
          action: { type: 'pause_drr', drrPct: 55, thresholdPct: 45 },
          campaignName: 'Кофемашина Осень',
          campaignId: 12345,
        },
        BASE,
      );
      expect(parseMode).toBe('Markdown');
      expect(text).toContain('⏸');
      expect(text).toContain('Автопауза');
      expect(text).toContain('Кофемашина Осень');
      expect(text).toContain('12345');
      expect(text).toContain('55');
      expect(text).toContain('45');
      expect(text).toContain('https://app.example.com/advertising');
    });
  });

  describe('daily_cap_reached', () => {
    it('содержит сумму потрачено/лимит и количество кампаний', () => {
      const { text } = formatAdAlert(
        {
          type: 'daily_cap_reached',
          capRub: 5000,
          spentRub: 5120,
          campaignsPaused: 3,
        },
        BASE,
      );
      expect(text).toContain('🛑');
      expect(text).toContain('5');
      expect(text).toContain('120');
      expect(text).toContain('000');
      expect(text).toContain('*3*');
    });
  });

  describe('balance_low', () => {
    it('с прогнозом дней', () => {
      const { text } = formatAdAlert(
        {
          type: 'balance_low',
          currentRub: 800,
          thresholdRub: 1000,
          daysLeft: 4,
        },
        BASE,
      );
      expect(text).toContain('💳');
      expect(text).toContain('800');
      expect(text).toContain('1');
      expect(text).toContain('000');
      expect(text).toContain('*4*');
    });

    it('без прогноза когда daysLeft = null', () => {
      const { text } = formatAdAlert(
        {
          type: 'balance_low',
          currentRub: 800,
          thresholdRub: 1000,
          daysLeft: null,
        },
        BASE,
      );
      expect(text).not.toMatch(/хватит на/);
    });
  });

  describe('advisor_daily_digest', () => {
    it('показывает первые 5 предложений и общее число', () => {
      const suggestions = Array.from({ length: 8 }, (_, i) => ({
        nmId: 1000 + i,
        reason: `reason ${i}`,
      }));
      const { text } = formatAdAlert(
        {
          type: 'advisor_daily_digest',
          suggestions,
          totalCount: 12,
        },
        BASE,
      );
      expect(text).toContain('💡');
      expect(text).toContain('*12*');
      expect(text).toContain('`1000`');
      expect(text).toContain('`1004`');
      expect(text).not.toContain('`1005`');
      expect(text).toMatch(/ещё \*7\*/);
    });

    it('пустой список — без секции топа', () => {
      const { text } = formatAdAlert(
        {
          type: 'advisor_daily_digest',
          suggestions: [],
          totalCount: 0,
        },
        BASE,
      );
      expect(text).toContain('*0*');
    });
  });

  describe('learning_period_ended', () => {
    it('содержит название стратегии', () => {
      const { text } = formatAdAlert(
        {
          type: 'learning_period_ended',
          strategyName: 'Стратегия A',
          switchedAt: new Date('2026-04-17T10:00:00Z'),
        },
        BASE,
      );
      expect(text).toContain('🎓');
      expect(text).toContain('Стратегия A');
      expect(text).toContain('Автопилот');
    });
  });

  it('обрезает trailing slash в appBaseUrl', () => {
    const { text } = formatAdAlert(
      {
        type: 'daily_cap_reached',
        capRub: 1000,
        spentRub: 1000,
        campaignsPaused: 1,
      },
      { appBaseUrl: 'https://app.example.com/' },
    );
    expect(text).toContain('https://app.example.com/advertising');
    expect(text).not.toContain('.com//advertising');
  });
});

describe('throttle', () => {
  beforeEach(() => {
    __resetThrottleForTests();
  });

  it('auto_pause — всегда без throttle', () => {
    markAlertSent('tenant-1', 'auto_pause', 1000);
    expect(shouldThrottle('tenant-1', 'auto_pause', 1001)).toBe(false);
    expect(shouldThrottle('tenant-1', 'auto_pause', 2000)).toBe(false);
  });

  it('daily_cap_reached — всегда без throttle', () => {
    markAlertSent('tenant-1', 'daily_cap_reached', 1000);
    expect(shouldThrottle('tenant-1', 'daily_cap_reached', 1001)).toBe(false);
  });

  it('balance_low — throttle 6ч', () => {
    const now = Date.now();
    markAlertSent('tenant-1', 'balance_low', now);
    expect(shouldThrottle('tenant-1', 'balance_low', now + 60_000)).toBe(true);
    expect(shouldThrottle('tenant-1', 'balance_low', now + 5 * 60 * 60 * 1000)).toBe(true);
    expect(shouldThrottle('tenant-1', 'balance_low', now + 6 * 60 * 60 * 1000 + 1)).toBe(false);
  });

  it('advisor_daily_digest — throttle 24ч', () => {
    const now = Date.now();
    markAlertSent('tenant-1', 'advisor_daily_digest', now);
    expect(shouldThrottle('tenant-1', 'advisor_daily_digest', now + 23 * 60 * 60 * 1000)).toBe(true);
    expect(shouldThrottle('tenant-1', 'advisor_daily_digest', now + 24 * 60 * 60 * 1000 + 1)).toBe(false);
  });

  it('learning_period_ended — практически one-shot (365 дней)', () => {
    const now = Date.now();
    markAlertSent('tenant-1', 'learning_period_ended', now);
    expect(shouldThrottle('tenant-1', 'learning_period_ended', now + 30 * 24 * 60 * 60 * 1000)).toBe(true);
  });

  it('независимые throttle-бакеты по (tenant, type)', () => {
    markAlertSent('tenant-1', 'balance_low', 1000);
    expect(shouldThrottle('tenant-2', 'balance_low', 1001)).toBe(false);
    expect(shouldThrottle('tenant-1', 'advisor_daily_digest', 1001)).toBe(false);
  });

  it('не throttle если markAlertSent не вызван', () => {
    expect(shouldThrottle('tenant-1', 'balance_low')).toBe(false);
  });

  it('throttle-окна определены для всех типов', () => {
    const types = [
      'auto_pause',
      'daily_cap_reached',
      'balance_low',
      'advisor_daily_digest',
      'learning_period_ended',
    ] as const;
    for (const t of types) {
      expect(ALERT_THROTTLE_MS[t]).toBeGreaterThanOrEqual(0);
    }
  });

  describe('subkey + custom window', () => {
    it('subkey изолирует throttle-бакеты в рамках типа', () => {
      const now = 1000;
      markAlertSent('tenant-1', 'auto_pause', now, { subkey: 'strategy-10' });
      // Тот же tenant+type, другой subkey — не throttle
      expect(
        shouldThrottle('tenant-1', 'auto_pause', now + 100, {
          subkey: 'strategy-20',
          windowMs: 60_000,
        }),
      ).toBe(false);
      // Тот же subkey в пределах окна — throttle
      expect(
        shouldThrottle('tenant-1', 'auto_pause', now + 100, {
          subkey: 'strategy-10',
          windowMs: 60_000,
        }),
      ).toBe(true);
    });

    it('custom windowMs переопределяет дефолт типа', () => {
      const now = 1000;
      // balance_low имеет дефолт 6ч, но переопределяем на 1 мин
      markAlertSent('tenant-1', 'balance_low', now);
      expect(
        shouldThrottle('tenant-1', 'balance_low', now + 2 * 60_000, { windowMs: 60_000 }),
      ).toBe(false);
    });

    it('auto_pause с windowMs = 3600_000 (1ч) — spamProtection per-strategy', () => {
      const now = 1000;
      markAlertSent('tenant-1', 'auto_pause', now, { subkey: 'strategy-42' });
      expect(
        shouldThrottle('tenant-1', 'auto_pause', now + 30 * 60_000, {
          subkey: 'strategy-42',
          windowMs: 60 * 60_000,
        }),
      ).toBe(true);
      expect(
        shouldThrottle('tenant-1', 'auto_pause', now + 61 * 60_000, {
          subkey: 'strategy-42',
          windowMs: 60 * 60_000,
        }),
      ).toBe(false);
    });

    it('без subkey — совместимо со старым поведением', () => {
      const now = Date.now();
      markAlertSent('tenant-1', 'balance_low', now);
      // Тот же вызов без options — старое поведение сохранено
      expect(shouldThrottle('tenant-1', 'balance_low', now + 60_000)).toBe(true);
    });
  });
});
