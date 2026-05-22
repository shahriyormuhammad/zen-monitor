/**
 * Словарь рекламных терминов — human-readable лейблы и подсказки
 * для замены сырых английских кодов в UI (P68 Slice 1).
 *
 * Использование:
 *   import { getTerm, TERMS } from '@/lib/advertising/terms';
 *   const t = getTerm('DRR');
 *   <span title={t.tooltip}>{t.label}</span>
 */

export type TermCode =
  | 'DRR'
  | 'ACOS'
  | 'ROAS'
  | 'CPO'
  | 'CPC'
  | 'CTR'
  | 'CPM'
  | 'CVR'
  | 'CR'
  | 'AOV'
  | 'BREAKEVEN_CPM'
  | 'NM_ID'
  | 'AUTOPILOT'
  | 'ADVISOR'
  | 'GUARDRAIL'
  | 'KILL_SWITCH'
  | 'LEARNING_PERIOD'
  | 'COOLDOWN'
  | 'DAILY_CAP'
  | 'CLUSTER'
  | 'DAYPARTING'
  | 'BOOST'
  | 'AUTO_REFILL';

export type Term = {
  code: TermCode;
  /** Короткий лейбл для UI (bedge, заголовок столбца) */
  label: string;
  /** Расширенное описание для tooltip/hint */
  tooltip: string;
  /** Опциональная единица измерения */
  unit?: string;
};

export const TERMS: Record<TermCode, Term> = {
  DRR: {
    code: 'DRR',
    label: 'ДРР',
    tooltip: 'Доля рекламных расходов: какая часть выручки ушла на рекламу. Формула: расход ÷ выручка × 100%. Чем ниже — тем лучше.',
    unit: '%',
  },
  ACOS: {
    code: 'ACOS',
    label: 'ACoS',
    tooltip: 'Advertising Cost of Sale — англоязычный аналог ДРР. Доля расхода в атрибуционной выручке, %.',
    unit: '%',
  },
  ROAS: {
    code: 'ROAS',
    label: 'ROAS',
    tooltip: 'Return on Ad Spend — выручка на каждый рубль рекламного расхода. Обратное к ДРР: ROAS 10 = ДРР 10%. Чем выше — тем лучше.',
    unit: '×',
  },
  CPO: {
    code: 'CPO',
    label: 'CPO',
    tooltip: 'Cost per Order — средняя стоимость одного заказа, привлечённого рекламой. Формула: расход ÷ заказы.',
    unit: '₽',
  },
  CPC: {
    code: 'CPC',
    label: 'CPC',
    tooltip: 'Cost per Click — средняя стоимость одного клика. Формула: расход ÷ клики.',
    unit: '₽',
  },
  CTR: {
    code: 'CTR',
    label: 'CTR',
    tooltip: 'Click-Through Rate — конверсия показа в клик. Формула: клики ÷ показы × 100%. Показатель релевантности карточки.',
    unit: '%',
  },
  CPM: {
    code: 'CPM',
    label: 'CPM',
    tooltip: 'Cost per Mille — стоимость 1000 показов. Формула: расход ÷ показы × 1000.',
    unit: '₽/1000 показов',
  },
  CVR: {
    code: 'CVR',
    label: 'CVR',
    tooltip: 'Conversion Rate — конверсия клика в заказ. Формула: заказы ÷ клики × 100%.',
    unit: '%',
  },
  CR: {
    code: 'CR',
    label: 'CR',
    tooltip: 'Conversion Rate — сводная конверсия показ→заказ (при расчёте Break-even CPM). Доля, не процент.',
    unit: '',
  },
  AOV: {
    code: 'AOV',
    label: 'Средний чек',
    tooltip: 'Average Order Value — средняя выручка с одного заказа. Формула: выручка ÷ заказы.',
    unit: '₽',
  },
  BREAKEVEN_CPM: {
    code: 'BREAKEVEN_CPM',
    label: 'Break-even CPM',
    tooltip: 'Максимальный CPM при нулевой прибыли. Выше этого значения реклама убыточна. Формула: (маржа × CR × средний чек) / 10.',
    unit: '₽/1000 показов',
  },
  NM_ID: {
    code: 'NM_ID',
    label: 'Артикул WB',
    tooltip: 'Числовой идентификатор карточки товара в Wildberries (nmID).',
  },
  AUTOPILOT: {
    code: 'AUTOPILOT',
    label: 'Автопилот',
    tooltip: 'Автоматическое управление ставками по стратегии: система сама повышает/понижает ставку, опираясь на позицию, заказы и целевую ДРР.',
  },
  ADVISOR: {
    code: 'ADVISOR',
    label: 'Советник',
    tooltip: 'Режим рекомендаций: система предлагает новую ставку, но не применяет её автоматически. Активен первые 7 дней стратегии (learning period).',
  },
  GUARDRAIL: {
    code: 'GUARDRAIL',
    label: 'Предохранитель',
    tooltip: 'Правило автопаузы или ограничения: останавливает изменения ставки при низких остатках, высоком ДРР, нуле заказов при расходе и т.п.',
  },
  KILL_SWITCH: {
    code: 'KILL_SWITCH',
    label: 'Аварийное отключение',
    tooltip: 'Глобальный выключатель автопилота на уровне кабинета. При выключении все стратегии перестают применять ставки.',
  },
  LEARNING_PERIOD: {
    code: 'LEARNING_PERIOD',
    label: 'Период обучения',
    tooltip: 'Первые 7 дней после старта стратегии: система работает только в режиме советника, собирая статистику. Bid-изменения логируются как предложения, но не применяются.',
  },
  COOLDOWN: {
    code: 'COOLDOWN',
    label: 'Пауза между изменениями',
    tooltip: 'Минимальный интервал между реальными изменениями ставки (по умолчанию 60 мин) — защищает от «дрожания».',
  },
  DAILY_CAP: {
    code: 'DAILY_CAP',
    label: 'Дневной лимит',
    tooltip: 'Максимальный суммарный расход стратегии за сутки. При достижении — автопауза всех кампаний стратегии.',
    unit: '₽',
  },
  CLUSTER: {
    code: 'CLUSTER',
    label: 'Поисковый кластер',
    tooltip: 'Группа запросов, по которым товар показывается в рекламе. Кластер — единица управления ставкой: одна ставка применяется ко всем запросам кластера.',
  },
  DAYPARTING: {
    code: 'DAYPARTING',
    label: 'Расписание показов',
    tooltip: 'Настройка часов/дней недели, когда кампания активна. Позволяет не тратить бюджет ночью или в непродающие дни.',
  },
  BOOST: {
    code: 'BOOST',
    label: 'Бустер ставок',
    tooltip: 'Временное повышение ставки (обычно на 10–30%) на период всплеска спроса: выходные, акции, сезон.',
  },
  AUTO_REFILL: {
    code: 'AUTO_REFILL',
    label: 'Автопополнение баланса',
    tooltip: 'Автоматическое пополнение рекламного баланса при падении ниже порога. Guardrails: не чаще 1 раза в 6 ч, лимит 10 000 ₽/день.',
  },
};

export function getTerm(code: TermCode): Term {
  return TERMS[code];
}
