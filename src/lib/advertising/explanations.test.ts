import { describe, it, expect } from 'vitest';
import { explainAction } from './explanations';

describe('explainAction', () => {
  describe('bid_raise', () => {
    it('содержит старую и новую ставку, кластер, метрики', () => {
      const text = explainAction({
        type: 'bid_raise',
        oldBid: 50,
        newBid: 75,
        cluster: 'кофемашина капсульная',
        days: 7,
        crPct: 2.5,
        drrPct: 18,
        deltaPct: 12,
      });
      expect(text).toContain('50');
      expect(text).toContain('75');
      expect(text).toContain('кофемашина капсульная');
      expect(text).toContain('7');
      expect(text).toContain('2.50%');
      expect(text).toContain('18');
      expect(text).toContain('12');
      expect(text).toMatch(/^Поднял ставку/);
    });
  });

  describe('bid_lower', () => {
    it('объясняет снижение по превышению ДРР', () => {
      const text = explainAction({
        type: 'bid_lower',
        oldBid: 100,
        newBid: 80,
        drrPct: 45,
        targetDrrPct: 30,
        hours: 6,
      });
      expect(text).toMatch(/^Снизил ставку/);
      expect(text).toContain('100');
      expect(text).toContain('80');
      expect(text).toContain('45');
      expect(text).toContain('30');
      expect(text).toContain('6');
    });
  });

  describe('pause_drr', () => {
    it('содержит ДРР и порог', () => {
      const text = explainAction({ type: 'pause_drr', drrPct: 55, thresholdPct: 45 });
      expect(text).toMatch(/паузу/);
      expect(text).toContain('55');
      expect(text).toContain('45');
    });
  });

  describe('pause_stock', () => {
    it('содержит остатки и порог', () => {
      const text = explainAction({ type: 'pause_stock', stockQty: 2, thresholdQty: 3 });
      expect(text).toMatch(/остатки/);
      expect(text).toContain('2');
      expect(text).toContain('3');
    });
  });

  describe('pause_no_orders', () => {
    it('использует 24ч по умолчанию', () => {
      const text = explainAction({ type: 'pause_no_orders', spentRub: 800 });
      expect(text).toContain('800');
      expect(text).toContain('24');
    });

    it('принимает кастомное окно', () => {
      const text = explainAction({ type: 'pause_no_orders', spentRub: 1200, hoursWindow: 12 });
      expect(text).toContain('12');
      expect(text).not.toContain('24');
    });
  });

  describe('pause_low_cr', () => {
    it('содержит CR и порог, дефолтное окно 7 дней', () => {
      const text = explainAction({ type: 'pause_low_cr', crPct: 0.05, thresholdPct: 0.1 });
      expect(text).toContain('0.05');
      expect(text).toContain('0.10');
      expect(text).toContain('7');
    });
  });

  describe('dayparting_pause', () => {
    it('форматирует час как HH:00', () => {
      expect(explainAction({ type: 'dayparting_pause', hour: 2 })).toContain('02:00');
      expect(explainAction({ type: 'dayparting_pause', hour: 23 })).toContain('23:00');
    });

    it('обрабатывает некорректный час', () => {
      expect(explainAction({ type: 'dayparting_pause', hour: 25 })).toContain('23:00');
      expect(explainAction({ type: 'dayparting_pause', hour: -1 })).toContain('00:00');
    });
  });

  describe('dayparting_resume', () => {
    it('содержит «Включил» и час', () => {
      const text = explainAction({ type: 'dayparting_resume', hour: 9 });
      expect(text).toMatch(/Включил/);
      expect(text).toContain('09:00');
    });
  });

  describe('cap_reached', () => {
    it('содержит лимит', () => {
      const text = explainAction({ type: 'cap_reached', capRub: 5000 });
      expect(text).toMatch(/дневной лимит/);
      expect(text).toContain('5');
      expect(text).toContain('000');
    });
  });

  describe('kill_switch', () => {
    it('возвращает фразу про kill switch', () => {
      const text = explainAction({ type: 'kill_switch' });
      expect(text).toMatch(/kill switch/i);
      expect(text).toMatch(/остановлены/);
    });
  });

  describe('advisor_suggestion', () => {
    it('содержит ставку, reason и CTA', () => {
      const text = explainAction({
        type: 'advisor_suggestion',
        proposedBid: 65,
        reason: 'CR растёт 3 дня подряд',
      });
      expect(text).toMatch(/^Предлагаю поднять ставку/);
      expect(text).toContain('65');
      expect(text).toContain('CR растёт 3 дня подряд');
      expect(text).toContain('«Применить»');
    });
  });

  describe('manual', () => {
    it('без note — «Ручное действие»', () => {
      expect(explainAction({ type: 'manual' })).toBe('Ручное действие');
    });

    it('с note — добавляет текст', () => {
      expect(explainAction({ type: 'manual', note: 'Откат изменения' })).toBe(
        'Ручное действие: Откат изменения',
      );
    });

    it('пустая note — без добавления', () => {
      expect(explainAction({ type: 'manual', note: '   ' })).toBe('Ручное действие');
    });
  });
});
