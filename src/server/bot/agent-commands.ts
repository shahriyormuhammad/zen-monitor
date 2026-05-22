import { AppError } from '@/lib/errors';
import type { AgentReportResult } from '@/server/agent/reports';

const DEFAULT_DAYS = 7;
const MAX_DAYS = 365;
const MAX_TOP_ITEMS = 3;
const DEFAULT_REVIEWS_LIMIT = 10;
const MAX_REVIEWS_LIMIT = 50;
export const REPORT_COMMAND_GROUP_ERROR =
  'Команды с данными доступны только в личном чате с ботом. Групповые чаты используем для уведомлений, чтобы не раскрывать данные кабинета случайным участникам.';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function parsePositiveInt(raw: string, field: string, min: number, max: number) {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new AppError(`${field} должен быть целым числом`, 400);
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new AppError(`${field} должен быть в диапазоне ${min}-${max}`, 400);
  }

  return Math.trunc(value);
}

export function parseDashboardCommandArgs(input: string) {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { days: DEFAULT_DAYS };
  }
  if (parts.length > 1) {
    throw new AppError('Укажи период одним числом. Например: «Сводка 14».', 400);
  }
  return {
    days: parsePositiveInt(parts[0]!, 'дней', 1, MAX_DAYS),
  };
}

export function parseUnitEconomicsCommandArgs(input: string) {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) {
    throw new AppError('Укажи артикул WB и период, если нужен. Например: «Юнит 12345678 14».', 400);
  }

  return {
    nmId: parsePositiveInt(parts[0]!, 'артикул WB', 1, 2_147_483_647),
    days: parts[1] ? parsePositiveInt(parts[1], 'дней', 1, MAX_DAYS) : DEFAULT_DAYS,
  };
}

export function parseStockCommandArgs(input: string) {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 1) {
    throw new AppError('Укажи артикул WB. Например: «Остатки 12345678».', 400);
  }

  return {
    nmId: parsePositiveInt(parts[0]!, 'артикул WB', 1, 2_147_483_647),
  };
}

export function parseAdsCommandArgs(input: string) {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || parts.length > 2) {
    throw new AppError('Укажи артикул WB и период, если нужен. Например: «Реклама 12345678 14».', 400);
  }

  return {
    nmId: parsePositiveInt(parts[0]!, 'артикул WB', 1, 2_147_483_647),
    days: parts[1] ? parsePositiveInt(parts[1], 'дней', 1, MAX_DAYS) : DEFAULT_DAYS,
  };
}

export function parseReviewsCommandArgs(input: string) {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { limit: DEFAULT_REVIEWS_LIMIT };
  }
  if (parts.length > 1) {
    throw new AppError('Укажи лимит одним числом. Например: «Отзывы 20».', 400);
  }

  return {
    limit: parsePositiveInt(parts[0]!, 'лимит', 1, MAX_REVIEWS_LIMIT),
  };
}

export function buildAgentHelpMessage(chatId: number) {
  return [
    '🤖 <b>ПроЦифры Ассистент</b>',
    'Нажимай кнопки ниже или пиши текстом:',
    '',
    `<b>Сводка</b> — сводка по кабинету за ${DEFAULT_DAYS} дней`,
    '<b>Сводка 14</b> — сводка за 14 дней',
    '<b>Юнит 12345678</b> — юнит-экономика артикула WB',
    '<b>Остатки 12345678</b> — остатки по артикулу WB',
    `<b>Реклама 12345678</b> — реклама за ${DEFAULT_DAYS} дней`,
    `<b>Отзывы</b> — ${DEFAULT_REVIEWS_LIMIT} отзывов без ответа`,
    '<b>Статус</b> — состояние синхронизаций',
    '<b>Поддержка текст вопроса</b> — отправить вопрос оператору',
    '',
    'Отчёты с данными кабинета работают только в личном чате с ботом.',
    `ID этого чата: <code>${chatId}</code>.`,
  ].join('\n');
}

export function assertReportCommandChatType(
  chatType: string | undefined,
  options: { allowGroupReportCommands?: boolean } = {},
) {
  if (chatType === 'private' || options.allowGroupReportCommands === true) {
    return;
  }

  throw new AppError(REPORT_COMMAND_GROUP_ERROR, 403);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatStatusLabel(value: unknown) {
  const key = String(value ?? '').trim().toLowerCase();
  const labels: Record<string, string> = {
    success: 'успешно',
    completed: 'завершено',
    running: 'в работе',
    pending: 'ожидает',
    failed: 'ошибка',
    error: 'ошибка',
    warning: 'предупреждение',
    skipped: 'пропущено',
    cancelled: 'отменено',
    fresh: 'актуально',
    stale: 'устарело',
    missing: 'нет данных',
    manual: 'ручной запуск',
    cron: 'по расписанию',
    scheduler: 'по расписанию',
    webhook: 'веб-событие',
    unknown: 'неизвестно',
  };

  return labels[key] ?? String(value ?? 'неизвестно');
}

function reportPath(report: AgentReportResult['report']) {
  switch (report) {
    case 'dashboard_summary':
    case 'sales_funnel_summary':
      return '/overview';
    case 'advertising_by_nm_summary':
      return '/advertising';
    case 'stocks_summary':
      return '/stocks-v2';
    case 'reviews_summary':
    case 'questions_summary':
      return '/reviews-qa';
    case 'unit_economics_summary':
    case 'cost_snapshot':
    case 'cost_breakdown_detail':
      return '/economics';
    case 'sync_status':
      return '/settings';
    default:
      return '/overview';
  }
}

function formatDashboardReport(report: AgentReportResult) {
  const topSelling = Array.isArray((report.data as { topSelling?: unknown }).topSelling)
    ? ((report.data as { topSelling: Array<Record<string, unknown>> }).topSelling).slice(0, MAX_TOP_ITEMS)
    : [];

  const lines = [
    '📊 <b>Сводка кабинета</b>',
    escapeHtml(report.summaryText),
  ];

  if (topSelling.length > 0) {
    lines.push('', '<b>Топ артикулов:</b>');
    for (const [index, item] of topSelling.entries()) {
      const vendorCode = typeof item.vendorCode === 'string' && item.vendorCode.trim() ? item.vendorCode : '—';
      const nmId = Number(item.nmId ?? 0);
      const soldQuantity = Number(item.soldQuantity ?? 0);
      const revenue = Number(item.grossRevenue ?? 0);
      lines.push(
        `${index + 1}. <code>${nmId}</code> ${escapeHtml(vendorCode)} — ${soldQuantity} шт, ${formatMoney(revenue)} ₽`
      );
    }
  }

  return lines.join('\n');
}

function formatUnitEconomicsReport(report: AgentReportResult) {
  const data = report.data as {
    focusItem?: Record<string, unknown> | null;
    worstProfitItems?: Array<Record<string, unknown>>;
  };
  const focusItem = data.focusItem ?? null;
  const worstProfitItems = Array.isArray(data.worstProfitItems) ? data.worstProfitItems.slice(0, MAX_TOP_ITEMS) : [];

  const lines = [
    '💸 <b>Юнит-экономика</b>',
    escapeHtml(report.summaryText),
  ];

  if (!focusItem && worstProfitItems.length > 0) {
    lines.push('', '<b>Артикулы с худшей прибылью:</b>');
    for (const [index, item] of worstProfitItems.entries()) {
      const vendorCode = typeof item.vendorCode === 'string' && item.vendorCode.trim() ? item.vendorCode : '—';
      const nmId = Number(item.nmId ?? 0);
      const netProfit = Number(item.netProfit ?? 0);
      const adSpend = Number(item.adSpend ?? 0);
      lines.push(
        `${index + 1}. <code>${nmId}</code> ${escapeHtml(vendorCode)} — прибыль ${formatMoney(netProfit)} ₽, реклама ${formatMoney(adSpend)} ₽`
      );
    }
  }

  return lines.join('\n');
}

function formatSyncStatusReport(report: AgentReportResult) {
  const data = report.data as {
    syncRuns?: {
      latest?: Record<string, unknown> | null;
      summary?: Record<string, unknown>;
    };
    redistributionRuns?: {
      latest?: Record<string, unknown> | null;
    };
  };

  const latestSync = data.syncRuns?.latest ?? null;
  const latestRedistribution = data.redistributionRuns?.latest ?? null;
  const lines = [
    '🛠 <b>Статус синков</b>',
    escapeHtml(report.summaryText),
  ];

  if (latestSync) {
    lines.push(
      '',
      `<b>Последняя синхронизация:</b> <code>${escapeHtml(formatStatusLabel(latestSync.status))}</code>`,
      `Источник: <code>${escapeHtml(formatStatusLabel(latestSync.triggerSource))}</code>`,
    );
  }

  if (latestRedistribution) {
    lines.push(
      '',
      `<b>Перераспределение:</b> <code>${escapeHtml(formatStatusLabel(latestRedistribution.status))}</code>`,
      `Рекомендаций: <b>${escapeHtml(String(latestRedistribution.recommendationCount ?? 0))}</b>`,
    );
  }

  return lines.join('\n');
}

function formatCostSnapshotReport(report: AgentReportResult) {
  const items = Array.isArray((report.data as { items?: unknown }).items)
    ? ((report.data as { items: Array<Record<string, unknown>> }).items).slice(0, MAX_TOP_ITEMS)
    : [];

  const lines = [
    '📦 <b>Слепок себестоимости</b>',
    escapeHtml(report.summaryText),
  ];

  if (items.length > 0) {
    lines.push('', '<b>Первые артикулы:</b>');
    for (const [index, item] of items.entries()) {
      const tenantName = typeof item.tenantName === 'string' && item.tenantName.trim() ? item.tenantName : '—';
      const vendorCode = typeof item.vendorCode === 'string' && item.vendorCode.trim() ? item.vendorCode : '—';
      const nmId = Number(item.nmId ?? 0);
      const purchasePrice = Number(item.purchasePrice ?? 0);
      const fullCostPerUnit = item.lastFullCostPerUnit == null ? null : Number(item.lastFullCostPerUnit);
      lines.push(
        `${index + 1}. ${escapeHtml(tenantName)} — <code>${nmId}</code> ${escapeHtml(vendorCode)}: `
        + `закупка ${formatMoney(purchasePrice)} ₽, полная/шт ${fullCostPerUnit == null ? 'н/д' : `${formatMoney(fullCostPerUnit)} ₽`}`
      );
    }
  }

  return lines.join('\n');
}

function formatCostBreakdownDetailReport(report: AgentReportResult) {
  const items = Array.isArray((report.data as { items?: unknown }).items)
    ? ((report.data as { items: Array<Record<string, unknown>> }).items).slice(0, MAX_TOP_ITEMS)
    : [];
  const freshness = Array.isArray((report.data as { dataFreshness?: unknown; data_freshness?: unknown }).dataFreshness)
    ? ((report.data as { dataFreshness: Array<Record<string, unknown>> }).dataFreshness)
    : Array.isArray((report.data as { data_freshness?: unknown }).data_freshness)
      ? ((report.data as { data_freshness: Array<Record<string, unknown>> }).data_freshness)
      : [];

  const lines = [
    '🧾 <b>Детализация себестоимости</b>',
    escapeHtml(report.summaryText),
  ];

  if (items.length > 0) {
    lines.push('', '<b>Первые артикулы:</b>');
    for (const [index, item] of items.entries()) {
      const tenantName = typeof item.tenantName === 'string' && item.tenantName.trim() ? item.tenantName : '—';
      const vendorCode = typeof item.vendorCode === 'string' && item.vendorCode.trim() ? item.vendorCode : '—';
      const nmId = Number(item.nmId ?? 0);
      const fullCostPerUnit = Number(item.fullCostPerUnit ?? 0);
      const components = item.components && typeof item.components === 'object'
        ? item.components as Record<string, unknown>
        : {};
      const purchase = Number(components.purchase ?? 0);
      const commission = Number(components.commission ?? 0);
      const advertising = Number(components.advertising ?? 0);
      lines.push(
        `${index + 1}. ${escapeHtml(tenantName)} — <code>${nmId}</code> ${escapeHtml(vendorCode)}: `
        + `полная/шт ${formatMoney(fullCostPerUnit)} ₽ `
        + `(закупка ${formatMoney(purchase)} ₽, комиссия ${formatMoney(commission)} ₽, реклама ${formatMoney(advertising)} ₽)`
      );
    }
  }

  if (freshness.length > 0) {
    lines.push('', '<b>Актуальность данных:</b>');
    for (const item of freshness.slice(0, MAX_TOP_ITEMS)) {
      const tenantName = typeof item.tenantName === 'string' && item.tenantName.trim() ? item.tenantName : '—';
      const sales = item.sales && typeof item.sales === 'object'
        ? item.sales as Record<string, unknown>
        : {};
      lines.push(
        `${escapeHtml(tenantName)} — продажи <code>${escapeHtml(formatStatusLabel(sales.status))}</code>`
      );
    }
  }

  return lines.join('\n');
}

function formatSalesFunnelSummaryReport(report: AgentReportResult) {
  const data = report.data as {
    totals?: Record<string, unknown>;
    items?: Array<Record<string, unknown>>;
  };
  const totals = data.totals ?? {};
  const items = Array.isArray(data.items) ? data.items.slice(0, MAX_TOP_ITEMS) : [];

  const lines = [
    '📈 <b>Воронка продаж</b>',
    escapeHtml(report.summaryText),
  ];

  if (items.length > 0) {
    lines.push('', '<b>Топ артикулов по заказам:</b>');
    for (const [index, item] of items.entries()) {
      const title = typeof item.title === 'string' && item.title.trim() ? item.title : '—';
      const nmId = Number(item.nmId ?? 0);
      const ordersCount = Number(item.ordersCount ?? 0);
      const buyoutsCount = Number(item.buyoutsCount ?? 0);
      const ordersSumRub = Number(item.ordersSumRub ?? 0);
      lines.push(
        `${index + 1}. <code>${nmId}</code> ${escapeHtml(title)} — `
        + `заказов ${ordersCount}, выкупов ${buyoutsCount}, заказов на ${formatMoney(ordersSumRub)} ₽`
      );
    }
  } else {
    lines.push(
      '',
      `Карточки: <b>${escapeHtml(String(totals.openCardCount ?? 0))}</b>, `
      + `заказы: <b>${escapeHtml(String(totals.ordersCount ?? 0))}</b>, `
      + `выкупы: <b>${escapeHtml(String(totals.buyoutsCount ?? 0))}</b>.`,
    );
  }

  return lines.join('\n');
}

function formatAdvertisingByNmSummaryReport(report: AgentReportResult) {
  const data = report.data as {
    totals?: Record<string, unknown>;
    items?: Array<Record<string, unknown>>;
  };
  const totals = data.totals ?? {};
  const items = Array.isArray(data.items) ? data.items.slice(0, MAX_TOP_ITEMS) : [];

  const lines = [
    '📣 <b>Реклама по артикулам</b>',
    escapeHtml(report.summaryText),
  ];

  if (items.length > 0) {
    lines.push('', '<b>Артикулы с расходом:</b>');
    for (const [index, item] of items.entries()) {
      const title = typeof item.title === 'string' && item.title.trim() ? item.title : '—';
      const nmId = Number(item.nmId ?? 0);
      const adSpend = Number(item.adSpend ?? 0);
      const ordersCount = Number(item.ordersCount ?? 0);
      const drrPct = Number(item.drrPct ?? 0);
      lines.push(
        `${index + 1}. <code>${nmId}</code> ${escapeHtml(title)} — `
        + `реклама ${formatMoney(adSpend)} ₽, заказов ${ordersCount}, ДРР ${drrPct.toFixed(1)}%`
      );
    }
  } else {
    lines.push(
      '',
      `Реклама: <b>${escapeHtml(String(totals.adSpend ?? 0))}</b>, `
      + `артикулов: <b>${escapeHtml(String(totals.nmCount ?? 0))}</b>, `
      + `кампаний: <b>${escapeHtml(String(totals.campaignCount ?? 0))}</b>.`,
    );
  }

  return lines.join('\n');
}

function formatStocksSummaryReport(report: AgentReportResult) {
  const items = Array.isArray((report.data as { items?: unknown }).items)
    ? ((report.data as { items: Array<Record<string, unknown>> }).items).slice(0, MAX_TOP_ITEMS)
    : [];

  const lines = [
    '📦 <b>Остатки</b>',
    escapeHtml(report.summaryText),
  ];

  if (items.length > 0) {
    lines.push('', '<b>Склады:</b>');
    for (const [index, item] of items.entries()) {
      const nmId = Number(item.nmId ?? 0);
      const vendorCode = typeof item.vendorCode === 'string' && item.vendorCode.trim() ? item.vendorCode : '—';
      const warehouse = typeof item.warehouse === 'string' && item.warehouse.trim() ? item.warehouse : '—';
      const qty = Number(item.qty ?? 0);
      const inTransit = Number(item.inTransit ?? 0);
      const ownStockQty = Number(item.ownStockQty ?? 0);
      const fulfillmentInTransitQty = Number(item.fulfillmentInTransitQty ?? 0);
      lines.push(
        `${index + 1}. <code>${nmId}</code> ${escapeHtml(vendorCode)} — ${escapeHtml(warehouse)}: `
        + `${qty} шт WB, в пути ${inTransit}, свой/ФФ ${ownStockQty}/${fulfillmentInTransitQty}`
      );
    }
  }

  return lines.join('\n');
}

function formatReviewsSummaryReport(report: AgentReportResult) {
  const items = Array.isArray((report.data as { items?: unknown }).items)
    ? ((report.data as { items: Array<Record<string, unknown>> }).items).slice(0, MAX_TOP_ITEMS)
    : [];

  const lines = [
    '💬 <b>Отзывы без ответа</b>',
    escapeHtml(report.summaryText),
  ];

  if (items.length > 0) {
    lines.push('', '<b>Первые отзывы:</b>');
    for (const [index, item] of items.entries()) {
      const nmId = Number(item.nmId ?? 0);
      const rating = item.rating == null ? 'н/д' : String(item.rating);
      const text = typeof item.text === 'string' && item.text.trim()
        ? item.text.trim().slice(0, 140)
        : 'Без текста';
      lines.push(`${index + 1}. <code>${nmId}</code>, оценка ${escapeHtml(rating)} — ${escapeHtml(text)}`);
    }
  }

  return lines.join('\n');
}

export function formatAgentReportMessage(report: AgentReportResult, buildAbsoluteAppUrl: (href: string) => string) {
  let body: string;

  switch (report.report) {
    case 'dashboard_summary':
      body = formatDashboardReport(report);
      break;
    case 'sales_funnel_summary':
      body = formatSalesFunnelSummaryReport(report);
      break;
    case 'advertising_by_nm_summary':
      body = formatAdvertisingByNmSummaryReport(report);
      break;
    case 'stocks_summary':
      body = formatStocksSummaryReport(report);
      break;
    case 'reviews_summary':
      body = formatReviewsSummaryReport(report);
      break;
    case 'unit_economics_summary':
      body = formatUnitEconomicsReport(report);
      break;
    case 'sync_status':
      body = formatSyncStatusReport(report);
      break;
    case 'cost_snapshot':
      body = formatCostSnapshotReport(report);
      break;
    case 'cost_breakdown_detail':
      body = formatCostBreakdownDetailReport(report);
      break;
    default:
      body = escapeHtml(report.summaryText);
      break;
  }

  return [
    body,
    '',
    `<a href="${escapeHtml(buildAbsoluteAppUrl(reportPath(report.report)))}">Открыть в приложении</a>`,
  ].join('\n');
}
