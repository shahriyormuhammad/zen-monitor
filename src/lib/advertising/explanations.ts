/**
 * Статические шаблоны объяснений к автодействиям (P69).
 *
 * Без LLM — детерминированная подстановка параметров в готовые фразы.
 * Используется:
 *  - в аудит-логе (колонка «Причина»): `writeAuditEntry({ reason: explainAction(...) })`
 *  - в Telegram-алертах (P70)
 */

export type ExplainableAction =
  | {
      type: 'bid_raise';
      oldBid: number;
      newBid: number;
      cluster: string;
      days: number;
      crPct: number;
      drrPct: number;
      /** Насколько ДРР лучше цели, % (положительное число = лучше) */
      deltaPct: number;
    }
  | {
      type: 'bid_lower';
      oldBid: number;
      newBid: number;
      drrPct: number;
      targetDrrPct: number;
      hours: number;
    }
  | { type: 'pause_drr'; drrPct: number; thresholdPct: number }
  | { type: 'pause_stock'; stockQty: number; thresholdQty: number }
  | { type: 'pause_no_orders'; spentRub: number; hoursWindow?: number }
  | { type: 'pause_low_cr'; crPct: number; thresholdPct: number; daysWindow?: number }
  | { type: 'dayparting_pause'; hour: number }
  | { type: 'dayparting_resume'; hour: number }
  | { type: 'cap_reached'; capRub: number }
  | { type: 'kill_switch' }
  | { type: 'advisor_suggestion'; proposedBid: number; reason: string }
  | { type: 'manual'; note?: string };

function fmtRub(value: number): string {
  const rounded = Math.round(value);
  return `${rounded.toLocaleString('ru-RU')}\u00A0₽`;
}

function fmtPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—%';
  const abs = Math.abs(value);
  const fixed = abs >= 10 ? abs.toFixed(digits > 0 ? 0 : 0) : abs.toFixed(digits);
  return `${value < 0 ? '−' : ''}${fixed}%`;
}

function fmtInt(value: number): string {
  return Math.round(value).toLocaleString('ru-RU');
}

function fmtHour(hour: number): string {
  const h = Math.max(0, Math.min(23, Math.round(hour)));
  return `${h.toString().padStart(2, '0')}:00`;
}

/**
 * Возвращает человекочитаемое объяснение действия.
 * Для `manual` без `note` — возвращает «Ручное действие».
 */
export function explainAction(action: ExplainableAction): string {
  switch (action.type) {
    case 'bid_raise':
      return (
        `Поднял ставку с ${fmtRub(action.oldBid)} до ${fmtRub(action.newBid)} — ` +
        `кластер «${action.cluster}» за ${fmtInt(action.days)}\u00A0дн. ` +
        `дал CR ${fmtPct(action.crPct, 2)} при ДРР ${fmtPct(action.drrPct)}, ` +
        `лучше цели на ${fmtPct(action.deltaPct)}`
      );
    case 'bid_lower':
      return (
        `Снизил ставку с ${fmtRub(action.oldBid)} до ${fmtRub(action.newBid)} — ` +
        `ДРР ${fmtPct(action.drrPct)} превысил цель ${fmtPct(action.targetDrrPct)} ` +
        `на протяжении ${fmtInt(action.hours)}\u00A0ч`
      );
    case 'pause_drr':
      return `Поставил на паузу — ДРР ${fmtPct(action.drrPct)} превысил порог ${fmtPct(action.thresholdPct)}`;
    case 'pause_stock':
      return `Поставил на паузу — остатки ${fmtInt(action.stockQty)}\u00A0шт. ниже порога ${fmtInt(action.thresholdQty)}\u00A0шт.`;
    case 'pause_no_orders': {
      const window = action.hoursWindow ?? 24;
      return `Поставил на паузу — потрачено ${fmtRub(action.spentRub)} за ${fmtInt(window)}\u00A0ч без единого заказа`;
    }
    case 'pause_low_cr': {
      const days = action.daysWindow ?? 7;
      return `Поставил на паузу — конверсия ${fmtPct(action.crPct, 2)} ниже ${fmtPct(action.thresholdPct, 2)} за ${fmtInt(days)}\u00A0дн.`;
    }
    case 'dayparting_pause':
      return `Выключил по расписанию — ночные часы (${fmtHour(action.hour)})`;
    case 'dayparting_resume':
      return `Включил по расписанию — утро (${fmtHour(action.hour)})`;
    case 'cap_reached':
      return `Остановил все кампании — достигнут дневной лимит ${fmtRub(action.capRub)}`;
    case 'kill_switch':
      return 'Все кампании остановлены — сработал общий kill switch автопилота';
    case 'advisor_suggestion':
      return `Предлагаю поднять ставку до ${fmtRub(action.proposedBid)} — ${action.reason}. Нажмите «Применить»`;
    case 'manual':
      return action.note?.trim() ? `Ручное действие: ${action.note.trim()}` : 'Ручное действие';
  }
}
