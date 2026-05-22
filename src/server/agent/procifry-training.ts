import type { AgentReportId, ProcifryWorkerId } from '@/lib/agent-api';

export type ProcifryTrainingReportRef = AgentReportId | 'catalog';

export type ProcifryWorkerCheatsheet = {
  title: string;
  focus: string;
  reports: readonly AgentReportId[] | '*';
  primaryFields: readonly string[];
  rules: readonly string[];
};

export type ProcifryTaskReportMapping = {
  task: string;
  workerId: ProcifryWorkerId;
  reports: readonly ProcifryTrainingReportRef[];
  fields: readonly string[];
  notes: string;
};

export type ProcifryEvalCase = {
  id: string;
  workerId: ProcifryWorkerId;
  prompt: string;
  expectedReports: readonly ProcifryTrainingReportRef[];
  expectedChecks: readonly string[];
  expectedDataState: keyof typeof PROCIFRY_DATA_STATE_TEMPLATES;
};

type JarvisProcifryWorkerId = Extract<
  ProcifryWorkerId,
  | 'wb-chief'
  | 'wb-data'
  | 'wb-economics'
  | 'wb-ads'
  | 'wb-content'
  | 'wb-ops'
  | 'wb-reviews'
  | 'wb-market'
>;
type LegacyProcifryWorkerId = Exclude<ProcifryWorkerId, JarvisProcifryWorkerId>;

export const PROCIFRY_CORE_CONTEXT_REPORTS = [
  'catalog',
  'dashboard_summary',
  'unit_economics_summary',
  'sync_status',
  'cost_snapshot',
  'cost_breakdown_detail',
  'cost_warehouse_delivery_config',
  'sales_funnel_summary',
  'advertising_by_nm_summary',
  'stocks_summary',
  'stock_history',
  'oos_history',
  'reviews_summary',
  'questions_summary',
  'card_content_summary',
  'card_group_summary',
  'price_history',
  'advertising_campaigns',
  'advertising_campaign_stats',
  'search_positions_summary',
  'competitor_cards_summary',
  'ab_tests_summary',
  'finance_realization_detail',
  'orders_sales_summary',
  'fulfillment_summary',
  'tariffs_rules_summary',
  'worker_artifacts_summary',
  'niche_category_summary',
] as const satisfies readonly ProcifryTrainingReportRef[];

const LEGACY_PROCIFRY_WORKER_CHEATSHEETS = {
  'wb-data-integrator': {
    title: 'Дима: источники и свежесть',
    focus: 'Синхронизация, freshness, gaps, диагностика источников.',
    reports: '*',
    primaryFields: ['freshness.sourceUpdatedAt', 'dateCoverage', 'syncRuns', 'source', 'confidence'],
    rules: ['Всегда начинать с catalog.', 'Не делать бизнес-вывод, если freshness stale/missing.', 'Тяжелый backfill оформлять как task или approval request.'],
  },
  'wb-economics-analyst': {
    title: 'Ирина: финансы и unit economics',
    focus: 'Прибыль, себестоимость, налог, эквайринг, комиссии WB.',
    reports: ['finance_realization_detail', 'unit_economics_summary', 'cost_snapshot', 'cost_breakdown_detail', 'cost_warehouse_delivery_config', 'advertising_by_nm_summary', 'advertising_campaign_stats', 'price_history'],
    primaryFields: ['retailAmount', 'toSellerRub', 'commissionAmount', 'logisticsRub', 'acquiringFee', 'purchasePrice', 'fullCostPerUnit', 'deliveryToWbPerUnit', 'netProfit', 'taxAmount'],
    rules: ['Всегда проверять coverage реализации.', 'Себестоимость и склады/delivery-to-WB менять только через approval.', 'ИЛ/ИРП (localityIndexPercent/irpPercent) менять только через unit_economics_indices_update approval.', 'Если unit_economics покрывает период частично, явно писать это в ответе.'],
  },
  'wb-ads-analyst': {
    title: 'Артем: реклама и ДРР',
    focus: 'Кампании, расходы, ставки, ДРР, кластеры, рекламные действия.',
    reports: ['advertising_campaigns', 'advertising_campaign_stats', 'advertising_by_nm_summary', 'ab_tests_summary', 'card_group_summary', 'sales_funnel_summary'],
    primaryFields: ['campaignId', 'nmId', 'spend', 'orders', 'revenue', 'drrPct', 'bid', 'budget', 'ctr', 'cpc', 'testId', 'variant', 'significance'],
    rules: ['Перед действием читать catalog и рекламный report.', 'Для автономных действий использовать advertising/action и проверять audit.', 'A/B вывод делать только если ab_tests_summary имеет sourceStatus=ready.', 'Не смешивать кабинеты без multi_tenant=true.'],
  },
  'wb-assortment-ops': {
    title: 'Витя: остатки и OOS',
    focus: 'Остатки, OOS, поставки, фулфилмент, оборачиваемость.',
    reports: ['stocks_summary', 'stock_history', 'oos_history', 'orders_sales_summary', 'fulfillment_summary'],
    primaryFields: ['nmId', 'warehouse', 'qty', 'inTransit', 'lostOrders', 'orders', 'sales', 'estimatedDeliveryAt'],
    rules: ['Сверять текущий остаток с историей OOS.', 'Поставки и перемещения только как draft/approval.', 'Пустой OOS report не считать ошибкой без проверки coverage.'],
  },
  'wb-seo-card-analyst': {
    title: 'Оля: SEO и карточки',
    focus: 'Контент карточек, позиции, запросы, отзывы и вопросы.',
    reports: ['card_content_summary', 'search_positions_summary', 'competitor_cards_summary', 'sales_funnel_summary', 'reviews_summary', 'questions_summary'],
    primaryFields: ['nmId', 'title', 'description', 'subject', 'characteristics', 'keyword', 'position', 'competitorNmId', 'price', 'rating', 'text'],
    rules: ['Правки карточки писать как draft/ТЗ.', 'Не менять название, описание и характеристики напрямую.', 'Если search_positions или competitor_cards пустые/sourceStatus!=ready, указывать внешний blocker.'],
  },
  'wb-competitor-analyst': {
    title: 'Паша: конкуренты',
    focus: 'Конкурентные карточки, цены, отзывы, позиции, слабые места.',
    reports: ['competitor_cards_summary', 'search_positions_summary', 'card_group_summary', 'price_history'],
    primaryFields: ['competitorNmId', 'ourNmId', 'keyword', 'price', 'rating', 'reviews', 'orders', 'revenue', 'positions'],
    rules: ['Только аналитика и задачи профильным worker-ам.', 'Не предлагать внешнее действие как выполненное.', 'Отделять отсутствие данных от отсутствия доступа.'],
  },
  'wb-creative-designer': {
    title: 'Аня: креативы',
    focus: 'Медиа карточек, отзывы/вопросы, визуальные референсы конкурентов.',
    reports: ['card_content_summary', 'reviews_summary', 'questions_summary', 'competitor_cards_summary', 'sales_funnel_summary'],
    primaryFields: ['photos', 'video', 'text', 'rating', 'competitorNmId', 'photos', 'videos', 'ctr'],
    rules: ['Писать brief, ТЗ, тексты и варианты.', 'Загрузка медиа только через approval/action executor.', 'Не делать вывод о победителе без метрик Кира/AB.'],
  },
  'wb-creative-performance-analyst': {
    title: 'Кира: креативная эффективность',
    focus: 'A/B тесты, CTR, корзины, заказы, вердикт по вариантам.',
    reports: ['ab_tests_summary', 'sales_funnel_summary', 'card_content_summary', 'advertising_campaign_stats'],
    primaryFields: ['testId', 'variant', 'impressions', 'clicks', 'ctr', 'carts', 'orders', 'revenue', 'profit', 'significance', 'status'],
    rules: ['Не объявлять победителя без significance/status.', 'Учитывать цену, рекламу и остатки в окне теста.', 'Применение победителя оформлять отдельным действием.'],
  },
  'wb-pricing-promo-analyst': {
    title: 'Макс: цена и промо',
    focus: 'Цена продавца/покупателя, СПП, акции, конкуренты, безопасная цена.',
    reports: ['price_history', 'competitor_cards_summary', 'unit_economics_summary', 'cost_breakdown_detail', 'sales_funnel_summary'],
    primaryFields: ['sellerPrice', 'customerPrice', 'priceAfterSpp', 'sellerDiscount', 'spp', 'fullCostPerUnit', 'netProfit', 'competitorNmId'],
    rules: ['Не менять цену без approval/action policy.', 'Сценарий цены должен ссылаться на минимальную безопасную цену.', 'Не сравнивать цены без проверки dateCoverage.'],
  },
  'wb-reviews-qna-manager': {
    title: 'Лена: отзывы и вопросы',
    focus: 'Отзывы, вопросы, статусы ответов, боль клиентов.',
    reports: ['reviews_summary', 'questions_summary'],
    primaryFields: ['feedbackId', 'questionId', 'nmId', 'rating', 'text', 'answerStatus', 'moderationStatus', 'hasAnswer'],
    rules: ['Писать черновики ответов, не публиковать без разрешенного действия.', 'Классифицировать боль и ставить задачи Вите/Ане/Оле.', 'Не считать live API пустым без проверки ошибки ответа.'],
  },
  'wb-market-watchdog': {
    title: 'Никита: рынок, тарифы, правила',
    focus: 'WB release notes, тарифы, комиссии, API status.',
    reports: ['sync_status', 'tariffs_rules_summary'],
    primaryFields: ['kind', 'type', 'date', 'rowCount', 'sourceUpdatedAt', 'syncRuns'],
    rules: ['Методики и формулы менять только после review.', 'Алёрт должен содержать impact и кому ставится задача.', 'Ссылаться только на подтвержденный источник.'],
  },
  'wb-niche-researcher': {
    title: 'Женя: ниши',
    focus: 'Ниши, спрос, конкуренты, сезонность, reject/hold/pass.',
    reports: ['niche_category_summary', 'competitor_cards_summary', 'search_positions_summary', 'sales_funnel_summary', 'price_history'],
    primaryFields: ['category', 'skuCount', 'orders', 'ordersSum', 'buyouts', 'buyoutsSum', 'keyword', 'price'],
    rules: ['Закупку/поставщика/запуск товара не исполнять напрямую.', 'Отдельно помечать MPStats как подключен/не подключен.', 'Scorecard должен показывать источники и confidence.'],
  },
  'wb-report-compiler': {
    title: 'Саша: отчеты',
    focus: 'Сбор итоговых отчетов из подтвержденных цифр и worker artifacts.',
    reports: '*',
    primaryFields: ['summaryText', 'totals', 'items', 'confidence', 'approvalRequestId', 'createdAt'],
    rules: ['Не менять цифры.', 'Всегда отделять подтвержденные данные от blockers.', 'Для нескольких кабинетов обязательно multi_tenant=true.'],
  },
  'wb-growth-manager': {
    title: 'Управляющий: рост и routing',
    focus: 'Общая сводка, приоритеты P0/P1/P2, routing задач, автономная реклама.',
    reports: '*',
    primaryFields: ['totals', 'profit', 'ads', 'stocks', 'tasks', 'approvalStatus', 'blockers'],
    rules: ['Решения строить из catalog -> reports -> freshness.', 'Прямые нерекламные действия не исполнять без approval.', 'Рекламные действия допустимы только через advertising/action и audit.'],
  },
  'wb-packaging-buyout': {
    title: 'Упаковка/выкуп',
    focus: 'Упаковка, выкуп, возвраты, повреждения, логистика.',
    reports: ['reviews_summary', 'stocks_summary', 'stock_history', 'finance_realization_detail', 'sales_funnel_summary'],
    primaryFields: ['rating', 'text', 'buyoutPct', 'returnAmount', 'logisticsRub', 'warehouse', 'qty'],
    rules: ['Писать гипотезы и ТЗ.', 'Комплектацию/упаковку менять только через approval.', 'Отделять жалобы на упаковку от логистических удержаний.'],
  },
  'wb-procifry-operator': {
    title: 'Procifry оператор согласований',
    focus: 'Единая точка для постановки изменений в approval и контроля применения.',
    reports: '*',
    primaryFields: ['actionType', 'approvalRequestId', 'status', 'sourceUpdatedAt', 'dateCoverage', 'items'],
    rules: ['Принимает задачи от профильных воркеров и формирует только approval-заявки.', 'Не пишет “применено”, пока статус не executed в /approvals.', 'Перед action всегда проверяет catalog + текущий report по целевым полям.'],
  },
  'procifry-action-executor': {
    title: 'Executor: approved/autonomous actions',
    focus: 'Исполнение разрешенных внешних действий и audit trail.',
    reports: ['sync_status'],
    primaryFields: ['approvalId', 'actionType', 'auditLogId', 'executedAt', 'status'],
    rules: ['Исполнять только разрешенный action contract.', 'Всегда писать audit log.', 'После действия делать post-check.'],
  },
} as const satisfies Record<LegacyProcifryWorkerId, ProcifryWorkerCheatsheet>;

export const PROCIFRY_WORKER_CHEATSHEETS = {
  ...LEGACY_PROCIFRY_WORKER_CHEATSHEETS,
  'wb-chief': {
    ...LEGACY_PROCIFRY_WORKER_CHEATSHEETS['wb-growth-manager'],
    title: 'wb-chief: штаб и routing',
  },
  'wb-data': {
    ...LEGACY_PROCIFRY_WORKER_CHEATSHEETS['wb-data-integrator'],
    title: 'wb-data: источники и свежесть',
  },
  'wb-economics': {
    ...LEGACY_PROCIFRY_WORKER_CHEATSHEETS['wb-economics-analyst'],
    title: 'wb-economics: финансы и unit economics',
  },
  'wb-ads': {
    ...LEGACY_PROCIFRY_WORKER_CHEATSHEETS['wb-ads-analyst'],
    title: 'wb-ads: реклама и автономные действия',
  },
  'wb-content': {
    ...LEGACY_PROCIFRY_WORKER_CHEATSHEETS['wb-seo-card-analyst'],
    title: 'wb-content: SEO и карточки',
  },
  'wb-ops': {
    ...LEGACY_PROCIFRY_WORKER_CHEATSHEETS['wb-assortment-ops'],
    title: 'wb-ops: остатки и поставки',
  },
  'wb-reviews': {
    ...LEGACY_PROCIFRY_WORKER_CHEATSHEETS['wb-reviews-qna-manager'],
    title: 'wb-reviews: отзывы и вопросы',
  },
  'wb-market': {
    ...LEGACY_PROCIFRY_WORKER_CHEATSHEETS['wb-niche-researcher'],
    title: 'wb-market: ниши и конкуренты',
    reports: [
      'niche_category_summary',
      'competitor_cards_summary',
      'search_positions_summary',
      'sales_funnel_summary',
      'price_history',
      'card_group_summary',
    ],
  },
} as const satisfies Record<ProcifryWorkerId, ProcifryWorkerCheatsheet>;

export const PROCIFRY_TASK_REPORT_MAP = [
  {
    task: 'Сводка за вчера по Лаврову и Бербеке',
    workerId: 'wb-chief',
    reports: ['catalog', 'dashboard_summary'],
    fields: ['tenantIds', 'multi_tenant', 'dateFrom', 'dateTo', 'totals', 'data.cabinets'],
    notes: 'Для двух кабинетов params.tenantIds + multi_tenant=true; range.days должен остаться 1.',
  },
  {
    task: 'Почему в отчете нули',
    workerId: 'wb-data',
    reports: ['catalog', 'sync_status'],
    fields: ['available', 'freshness.sourceUpdatedAt', 'dateCoverage', 'syncRuns', 'items.length'],
    notes: 'Сначала классифицировать: нет доступа, нет данных, stale, report не выдан worker-у, источник не подключен.',
  },
  {
    task: 'Прибыль за период',
    workerId: 'wb-economics',
    reports: ['catalog', 'unit_economics_summary', 'finance_realization_detail', 'cost_breakdown_detail', 'cost_warehouse_delivery_config'],
    fields: ['netProfit', 'dataFreshness.realizationReports', 'dateCoverage', 'sourceUpdatedAt', 'fullCostPerUnit', 'deliveryToWbPerUnit'],
    notes: 'Если realization coverage частичный, цифры за хвост периода помечать partial/stale.',
  },
  {
    task: 'Заполнить склады / доставка до ВБ',
    workerId: 'wb-economics',
    reports: ['catalog', 'cost_warehouse_delivery_config'],
    fields: ['nmId', 'warehouses.enabled', 'warehouses.deliveryToWbPerUnit', 'unitEconomicsDeliveryToWbMode', 'updatedAt'],
    notes: 'Реальное изменение только через warehouse_delivery_cost_update approval; без action нельзя писать “заполнил”.',
  },
  {
    task: 'Заполнить ИЛ/ИРП в юнит-экономике',
    workerId: 'wb-economics',
    reports: ['catalog', 'cost_warehouse_delivery_config'],
    fields: ['nmId', 'localityIndexPercent', 'irpPercent', 'updatedAt'],
    notes: 'Изменение только через unit_economics_indices_update approval; без approval нельзя писать “применил в Procifry”.',
  },
  {
    task: 'Поставить изменение в Procifry на согласование',
    workerId: 'wb-procifry-operator',
    reports: ['catalog', 'cost_warehouse_delivery_config', 'fulfillment_summary', 'stocks_summary'],
    fields: ['actionType', 'approvalRequestId', 'status', 'items', 'sourceUpdatedAt', 'dateCoverage'],
    notes: 'Оператор ставит заявку в approval, но не исполняет изменение до ручного подтверждения в /approvals.',
  },
  {
    task: 'Рекламный ДРР и действия',
    workerId: 'wb-ads',
    reports: ['catalog', 'advertising_campaigns', 'advertising_campaign_stats', 'advertising_by_nm_summary', 'sales_funnel_summary'],
    fields: ['campaignId', 'nmId', 'spend', 'orders', 'revenue', 'drrPct', 'bid', 'budget'],
    notes: 'Автономные действия идут только через /api/agent/v1/advertising/action с audit log.',
  },
  {
    task: 'OOS и план поставки',
    workerId: 'wb-ops',
    reports: ['catalog', 'stocks_summary', 'stock_history', 'oos_history', 'orders_sales_summary', 'fulfillment_summary'],
    fields: ['qty', 'inTransit', 'lostOrders', 'orders', 'sales', 'estimatedDeliveryAt'],
    notes: 'План поставки писать как draft/task; внешнее создание поставки требует approval.',
  },
  {
    task: 'SEO аудит карточки',
    workerId: 'wb-content',
    reports: ['catalog', 'card_content_summary', 'search_positions_summary', 'reviews_summary', 'questions_summary'],
    fields: ['title', 'description', 'characteristics', 'keyword', 'position', 'text', 'rating'],
    notes: 'Правки карточки только draft/ТЗ; если search_positions unavailable, это blocker источника.',
  },
  {
    task: 'Проверить конкурентов',
    workerId: 'wb-market',
    reports: ['catalog', 'competitor_cards_summary', 'search_positions_summary', 'price_history', 'card_group_summary'],
    fields: ['competitorNmId', 'ourNmId', 'keyword', 'price', 'rating', 'reviews', 'orders', 'positions'],
    notes: 'Только аналитика и задачи другим worker-ам, без внешнего исполнения.',
  },
  {
    task: 'Вердикт по A/B тесту креатива',
    workerId: 'wb-creative-performance-analyst',
    reports: ['catalog', 'ab_tests_summary', 'sales_funnel_summary', 'advertising_campaign_stats'],
    fields: ['testId', 'variant', 'ctr', 'carts', 'orders', 'revenue', 'profit', 'significance', 'status'],
    notes: 'Если significance/status не подтверждены, ответ должен быть wait/insufficient data.',
  },
  {
    task: 'Ценовой сценарий',
    workerId: 'wb-pricing-promo-analyst',
    reports: ['catalog', 'price_history', 'unit_economics_summary', 'cost_breakdown_detail', 'competitor_cards_summary'],
    fields: ['sellerPrice', 'customerPrice', 'spp', 'sellerDiscount', 'fullCostPerUnit', 'netProfit', 'competitor price'],
    notes: 'Сценарий цены не равен изменению цены; изменение цены только через разрешенный action flow.',
  },
  {
    task: 'Ответы на отзывы и вопросы',
    workerId: 'wb-reviews',
    reports: ['catalog', 'reviews_summary', 'questions_summary'],
    fields: ['feedbackId', 'questionId', 'rating', 'text', 'answerStatus', 'hasAnswer'],
    notes: 'Писать draft ответа и классификацию боли; публикация отдельно.',
  },
] as const satisfies readonly ProcifryTaskReportMapping[];

export const PROCIFRY_DATA_STATE_TEMPLATES = {
  ok: 'Данные подтверждены: report доступен, freshness свежий, dateCoverage покрывает запрошенный период.',
  no_access: 'Нет доступа: ключ/tenant/cabinet не разрешен. Нужен другой API client или allowlist.',
  report_not_assigned: 'Report есть в Procifry, но не выдан этому worker-у по RBAC. Нужен другой worker или правка scope.',
  source_not_connected: 'Report описан в контракте, но source/table не подключены. Это blocker источника, не runtime-баг.',
  no_data_for_period: 'Report доступен, но за период нет строк. Возвращаем ok=true, items=[], freshness/dateCoverage/sourceUpdatedAt и не выдаем это за ошибку.',
  stale: 'Источник устарел или покрывает только часть периода. Вывод допустим только с confidence=stale/partial и явной оговоркой.',
  missing: 'Нет freshness/dateCoverage/sourceUpdatedAt. Нельзя делать числовой вывод без диагностики источника.',
} as const;

export const PROCIFRY_EVAL_CASES = [
  {
    id: 'yesterday_multi_tenant_summary',
    workerId: 'wb-chief',
    prompt: 'Дай вчера по кабинетам Лавров и Бербека.',
    expectedReports: ['catalog', 'dashboard_summary'],
    expectedChecks: ['tenantIds contains both cabinets', 'multi_tenant=true', 'dateFrom=dateTo=yesterday', 'range.days=1', 'freshness reviewed'],
    expectedDataState: 'ok',
  },
  {
    id: 'why_zeroes',
    workerId: 'wb-data',
    prompt: 'Почему нули в отчете?',
    expectedReports: ['catalog', 'sync_status'],
    expectedChecks: ['available checked', 'dateCoverage checked', 'sourceUpdatedAt checked', 'items=[] distinguished from unavailable=false'],
    expectedDataState: 'no_data_for_period',
  },
  {
    id: 'partial_unit_economics_coverage',
    workerId: 'wb-economics',
    prompt: 'Посчитай прибыль за период, где unit_economics не покрывает весь период.',
    expectedReports: ['catalog', 'unit_economics_summary', 'finance_realization_detail'],
    expectedChecks: ['dataFreshness.realizationReports checked', 'coverage gap stated', 'confidence=partial or stale'],
    expectedDataState: 'stale',
  },
  {
    id: 'available_report_empty_items',
    workerId: 'wb-ops',
    prompt: 'Report доступен, но items пустой. Что отвечать?',
    expectedReports: ['catalog', 'oos_history'],
    expectedChecks: ['ok=true accepted', 'items=[] not treated as unavailable', 'freshness/dateCoverage/sourceUpdatedAt included'],
    expectedDataState: 'no_data_for_period',
  },
  {
    id: 'report_not_assigned_to_worker',
    workerId: 'wb-reviews',
    prompt: 'Лена, дай price_history по SKU.',
    expectedReports: ['catalog', 'price_history'],
    expectedChecks: ['403 handled', 'RBAC scope explained', 'request rerouted to wb-pricing-promo-analyst'],
    expectedDataState: 'report_not_assigned',
  },
  {
    id: 'source_not_connected_external_reports',
    workerId: 'wb-content',
    prompt: 'Оля, дай позиции по ключам, если search_positions_summary не подключен.',
    expectedReports: ['catalog', 'search_positions_summary'],
    expectedChecks: ['available=false handled', 'source blocker stated', 'no hallucinated positions'],
    expectedDataState: 'source_not_connected',
  },
  {
    id: 'operator_approval_only_flow',
    workerId: 'wb-procifry-operator',
    prompt: 'Поставь ИЛ=1.01 и ИРП=0.31 по Лаврову на все активные SKU.',
    expectedReports: ['catalog', 'cost_warehouse_delivery_config'],
    expectedChecks: ['action is approval_required', 'returns approvalRequestId', 'does not claim executed before /approvals'],
    expectedDataState: 'ok',
  },
] as const satisfies readonly ProcifryEvalCase[];
