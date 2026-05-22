import type { GuardrailConfig, GuardrailContext, GuardrailTrigger } from '@/lib/advertising/guardrails';
import type { ExplainableAction } from '@/lib/advertising/explanations';

type AutoPauseAction = Extract<
  ExplainableAction,
  { type: 'pause_drr' | 'pause_stock' | 'pause_no_orders' | 'pause_low_cr' | 'kill_switch' }
>;

/**
 * Маппинг guardrail-триггера на `ExplainableAction` для Telegram-алерта `auto_pause` (P70).
 *
 * Возвращает `null` для триггеров, которые не заслуживают отдельного уведомления пользователю:
 *  - `learning_period` — не пауза, а режим советника;
 *  - `cooldown` — техническая пауза между изменениями ставки;
 *  - `daily_cap` — алертится через отдельный тип `daily_cap_reached`;
 *  - `max_bid_delta`, `max_bid` — срабатывают на уровне cluster-proposal, а не strategy-run.
 */
export function mapGuardrailToAutoPauseAction(
  trigger: GuardrailTrigger,
  ctx: GuardrailContext,
  config: GuardrailConfig,
): AutoPauseAction | null {
  switch (trigger) {
    case 'kill_switch':
      return { type: 'kill_switch' };

    case 'low_stock':
      return {
        type: 'pause_stock',
        stockQty: ctx.stockQty ?? 0,
        thresholdQty: config.minStockThreshold,
      };

    case 'high_drr': {
      const threshold = config.maxDRRPct != null ? config.maxDRRPct : ctx.targetAcosPct * 1.5;
      return {
        type: 'pause_drr',
        drrPct: ctx.drrLookbackPct ?? 0,
        thresholdPct: threshold,
      };
    }

    case 'spend_no_orders':
      return {
        type: 'pause_no_orders',
        spentRub: ctx.spendRub24h,
        hoursWindow: 24,
      };

    case 'low_cr':
      return {
        type: 'pause_low_cr',
        crPct: ctx.crPct7d ?? 0,
        thresholdPct: config.minCRPct,
        daysWindow: 7,
      };

    case 'learning_period':
    case 'cooldown':
    case 'daily_cap':
    case 'max_bid_delta':
    case 'max_bid':
      return null;
  }
}
