/**
 * Telegram-алерты рекламных событий (P70).
 *
 * Здесь — чистая логика: форматирование сообщения и throttle.
 * Серверная отправка через grammy — в `src/server/advertising/send-alert.ts`.
 */

import { explainAction, type ExplainableAction } from './explanations';

export type AdAlertType =
  | 'auto_pause'
  | 'daily_cap_reached'
  | 'balance_low'
  | 'advisor_daily_digest'
  | 'learning_period_ended'
  | 'ab_test_won';

export type AdAlertPayload =
  | {
      type: 'auto_pause';
      /** Конкретный триггер автопаузы — используем explainAction для описания */
      action: Extract<
        ExplainableAction,
        { type: 'pause_drr' | 'pause_stock' | 'pause_no_orders' | 'pause_low_cr' | 'kill_switch' }
      >;
      campaignName: string;
      campaignId: number;
    }
  | {
      type: 'daily_cap_reached';
      capRub: number;
      spentRub: number;
      campaignsPaused: number;
    }
  | {
      type: 'balance_low';
      currentRub: number;
      thresholdRub: number;
      /** Прогноз: на сколько дней хватит при текущей скорости расхода */
      daysLeft: number | null;
    }
  | {
      type: 'advisor_daily_digest';
      /** Топ-N предложений советника за сутки */
      suggestions: Array<{
        nmId: number;
        reason: string;
      }>;
      totalCount: number;
      outcomes?: {
        savingsRub: number;
        extraOrders: number;
        rollbackCount: number;
        rolledBackCount: number;
      };
    }
  | {
      type: 'learning_period_ended';
      strategyName: string;
      /** Когда стратегия перешла из Advisor в Autopilot */
      switchedAt: Date;
    }
  | {
      type: 'ab_test_won';
      strategyName: string;
      /** Победившая политика: thompson_beta или thompson_normal. */
      winnerPolicy: 'thompson_beta' | 'thompson_normal';
      /** P(thompson > baseline), 0..1. */
      confidence: number;
      /** Суммарное число наблюдений у Thompson-агента. */
      obsCount: number;
    };

/** Интервалы throttle по типу алерта, мс. 0 = без throttle (немедленно). */
export const ALERT_THROTTLE_MS: Record<AdAlertType, number> = {
  auto_pause: 0,
  daily_cap_reached: 0,
  balance_low: 6 * 60 * 60 * 1000,
  advisor_daily_digest: 24 * 60 * 60 * 1000,
  learning_period_ended: 365 * 24 * 60 * 60 * 1000,
  // Один алерт per стратегия в неделю (subkey = strategyId).
  ab_test_won: 7 * 24 * 60 * 60 * 1000,
};

function fmtRub(value: number): string {
  return `${Math.round(value).toLocaleString('ru-RU')}\u00A0₽`;
}

/**
 * Форматирует сообщение для Telegram (parse_mode: Markdown).
 * Формат: эмодзи + описание (из P69 для auto_pause) + ссылка на раздел кабинета.
 */
export function formatAdAlert(
  payload: AdAlertPayload,
  options: { appBaseUrl: string },
): { text: string; parseMode: 'Markdown' } {
  const base = options.appBaseUrl.replace(/\/$/, '');
  const advertisingUrl = `${base}/advertising`;

  switch (payload.type) {
    case 'auto_pause': {
      const reason = explainAction(payload.action);
      return {
        text:
          `⏸ *Автопауза кампании*\n\n` +
          `📢 «${payload.campaignName}» (ID ${payload.campaignId})\n` +
          `${reason}\n\n` +
          `🔗 [Открыть рекламу](${advertisingUrl})`,
        parseMode: 'Markdown',
      };
    }
    case 'daily_cap_reached':
      return {
        text:
          `🛑 *Дневной лимит достигнут*\n\n` +
          `Потрачено ${fmtRub(payload.spentRub)} из ${fmtRub(payload.capRub)}.\n` +
          `Приостановлено кампаний: *${payload.campaignsPaused}*.\n\n` +
          `🔗 [Открыть рекламу](${advertisingUrl})`,
        parseMode: 'Markdown',
      };
    case 'balance_low': {
      const forecast =
        payload.daysLeft !== null
          ? `\nПри текущей скорости хватит на *${payload.daysLeft}*\u00A0дн.`
          : '';
      return {
        text:
          `💳 *Низкий баланс рекламы*\n\n` +
          `Остаток ${fmtRub(payload.currentRub)} ниже порога ${fmtRub(payload.thresholdRub)}.` +
          forecast +
          `\n\n` +
          `🔗 [Пополнить баланс](${advertisingUrl})`,
        parseMode: 'Markdown',
      };
    }
    case 'advisor_daily_digest': {
      const shown = payload.suggestions.slice(0, 5);
      const top = shown.map((s, i) => `${i + 1}. \`${s.nmId}\` — ${s.reason}`).join('\n');
      const remainder = payload.totalCount - shown.length;
      const more = remainder > 0
        ? `\n…и ещё *${remainder}* предложений.`
        : '';
      const outcomes = payload.outcomes;
      const outcomeLine = outcomes && (
        outcomes.savingsRub > 0
        || outcomes.extraOrders > 0
        || outcomes.rollbackCount > 0
        || outcomes.rolledBackCount > 0
      )
        ? `\nИтоги проверок: экономия *${fmtRub(outcomes.savingsRub)}*, доп. заказы *${outcomes.extraOrders}*, к откату *${outcomes.rollbackCount}*, откатили *${outcomes.rolledBackCount}*.\n`
        : '';
      return {
        text:
          `💡 *Советник: рекомендации за сутки*\n\n` +
          `Всего предложений: *${payload.totalCount}*\n\n` +
          outcomeLine +
          (top.length > 0 ? `${top}${more}\n\n` : '') +
          `🔗 [Открыть рекламу](${advertisingUrl})`,
        parseMode: 'Markdown',
      };
    }
    case 'learning_period_ended':
      return {
        text:
          `🎓 *Период обучения завершён*\n\n` +
          `Стратегия «${payload.strategyName}» переключена в режим *Автопилот*.\n` +
          `Теперь изменения ставок применяются автоматически.\n\n` +
          `🔗 [Открыть рекламу](${advertisingUrl})`,
        parseMode: 'Markdown',
      };
    case 'ab_test_won': {
      const policyName =
        payload.winnerPolicy === 'thompson_beta' ? 'Thompson Beta' : 'Thompson Normal';
      return {
        text:
          `🏆 *A/B тест завершён: Thompson победил*\n\n` +
          `Стратегия «${payload.strategyName}»\n` +
          `Алгоритм *${policyName}* опережает baseline с вероятностью *${Math.round(payload.confidence * 100)}%*.\n` +
          `Наблюдений: ${payload.obsCount}.\n` +
          `Политика обновлена автоматически.\n\n` +
          `🔗 [Открыть рекламу](${advertisingUrl})`,
        parseMode: 'Markdown',
      };
    }
  }
}

/**
 * In-memory throttle-хранилище. Ключ: `${tenantId}:${type}[:${subkey}]`.
 * При рестарте процесса — сбрасывается. Допустимо для окон 6ч/24ч: разовый дубликат после рестарта —
 * редкий и не критичный случай.
 *
 * `subkey` используется для auto_pause и других алертов с throttle = 0, где мы хотим
 * дедуплицировать по конкретному объекту (strategy.id, campaignId) с кастомным окном.
 */
const throttleStore = new Map<string, number>();

function makeThrottleKey(tenantId: string, type: AdAlertType, subkey?: string): string {
  return subkey ? `${tenantId}:${type}:${subkey}` : `${tenantId}:${type}`;
}

export type ThrottleOptions = {
  /** Доп. сегмент ключа для дедупликации в рамках типа (например, `strategy-42`, `campaign-99`) */
  subkey?: string;
  /** Переопределить окно throttle (мс) — полезно для auto_pause per-strategy с окном 1ч */
  windowMs?: number;
};

/**
 * Нужно ли отбросить алерт из-за throttle. Возвращает `true` если последняя отправка была
 * недавнее, чем окно (из `options.windowMs` или `ALERT_THROTTLE_MS[type]`). Не изменяет состояние.
 */
export function shouldThrottle(
  tenantId: string,
  type: AdAlertType,
  nowMs: number = Date.now(),
  options?: ThrottleOptions,
): boolean {
  const windowMs = options?.windowMs ?? ALERT_THROTTLE_MS[type];
  if (windowMs === 0) return false;
  const last = throttleStore.get(makeThrottleKey(tenantId, type, options?.subkey));
  if (last === undefined) return false;
  return nowMs - last < windowMs;
}

/**
 * Отмечает, что алерт данного типа отправлен — обновляет throttle-таймер.
 */
export function markAlertSent(
  tenantId: string,
  type: AdAlertType,
  nowMs: number = Date.now(),
  options?: Pick<ThrottleOptions, 'subkey'>,
): void {
  throttleStore.set(makeThrottleKey(tenantId, type, options?.subkey), nowMs);
}

/**
 * Сбрасывает throttle — для тестов.
 */
export function __resetThrottleForTests(): void {
  throttleStore.clear();
}
