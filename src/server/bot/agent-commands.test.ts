import { describe, expect, it } from 'vitest';

import {
  assertReportCommandChatType,
  buildAgentHelpMessage,
  formatAgentReportMessage,
  parseAdsCommandArgs,
  parseDashboardCommandArgs,
  parseReviewsCommandArgs,
  parseStockCommandArgs,
  parseUnitEconomicsCommandArgs,
  REPORT_COMMAND_GROUP_ERROR,
} from './agent-commands';

describe('parseDashboardCommandArgs', () => {
  it('uses default days when args are empty', () => {
    expect(parseDashboardCommandArgs('')).toEqual({ days: 7 });
  });

  it('parses explicit days', () => {
    expect(parseDashboardCommandArgs('14')).toEqual({ days: 14 });
  });

  it('rejects invalid syntax', () => {
    expect(() => parseDashboardCommandArgs('7 extra')).toThrow('Сводка 14');
  });
});

describe('parseUnitEconomicsCommandArgs', () => {
  it('parses nmId with default days', () => {
    expect(parseUnitEconomicsCommandArgs('12345678')).toEqual({ nmId: 12345678, days: 7 });
  });

  it('parses nmId and days', () => {
    expect(parseUnitEconomicsCommandArgs('12345678 30')).toEqual({ nmId: 12345678, days: 30 });
  });

  it('requires nmId', () => {
    expect(() => parseUnitEconomicsCommandArgs('')).toThrow('Юнит 12345678');
  });
});

describe('parseStockCommandArgs', () => {
  it('parses required nmId', () => {
    expect(parseStockCommandArgs('12345678')).toEqual({ nmId: 12345678 });
  });

  it('rejects missing nmId', () => {
    expect(() => parseStockCommandArgs('')).toThrow('Остатки 12345678');
  });
});

describe('parseAdsCommandArgs', () => {
  it('parses nmId with default days', () => {
    expect(parseAdsCommandArgs('12345678')).toEqual({ nmId: 12345678, days: 7 });
  });

  it('parses nmId and days', () => {
    expect(parseAdsCommandArgs('12345678 14')).toEqual({ nmId: 12345678, days: 14 });
  });
});

describe('parseReviewsCommandArgs', () => {
  it('uses default limit', () => {
    expect(parseReviewsCommandArgs('')).toEqual({ limit: 10 });
  });

  it('parses explicit limit', () => {
    expect(parseReviewsCommandArgs('20')).toEqual({ limit: 20 });
  });

  it('rejects invalid syntax', () => {
    expect(() => parseReviewsCommandArgs('10 extra')).toThrow('Отзывы 20');
  });
});

describe('buildAgentHelpMessage', () => {
  it('includes the linked chat id', () => {
    expect(buildAgentHelpMessage(12345)).toContain('<code>12345</code>');
  });

  it('documents private chat report scope', () => {
    expect(buildAgentHelpMessage(12345)).toContain('только в личном чате');
  });

  it('does not expose slash command names in the help text', () => {
    expect(buildAgentHelpMessage(12345)).not.toContain('/dashboard');
    expect(buildAgentHelpMessage(12345)).toContain('Сводка 14');
  });
});

describe('assertReportCommandChatType', () => {
  it('allows private chats', () => {
    expect(() => assertReportCommandChatType('private')).not.toThrow();
  });

  it('rejects group chats by default', () => {
    expect(() => assertReportCommandChatType('group')).toThrow(REPORT_COMMAND_GROUP_ERROR);
  });

  it('can be explicitly opened for group chats', () => {
    expect(() => assertReportCommandChatType('supergroup', { allowGroupReportCommands: true })).not.toThrow();
  });
});

describe('formatAgentReportMessage', () => {
  it('formats dashboard summary and link', () => {
    const report = {
      report: 'dashboard_summary' as const,
      tenantId: 'tenant-1',
      generatedAt: '2026-04-24T10:00:00.000Z',
      summaryText: 'Сводка за 7 дн.',
      data: {
        topSelling: [
          { nmId: 123, vendorCode: 'ABC-1', soldQuantity: 10, grossRevenue: 15000 },
        ],
      },
    };

    const message = formatAgentReportMessage(report, (href) => `https://example.com${href}`);
    expect(message).toContain('Сводка кабинета');
    expect(message).toContain('ABC-1');
    expect(message).toContain('https://example.com/overview');
  });

  it('formats sales funnel summary and overview link', () => {
    const report = {
      report: 'sales_funnel_summary' as const,
      tenantId: 'tenant-1',
      generatedAt: '2026-04-27T10:00:00.000Z',
      summaryText: 'Воронка продаж за 1 дн.',
      data: {
        totals: {
          openCardCount: 100,
          ordersCount: 10,
          buyoutsCount: 8,
        },
        items: [
          {
            nmId: 123,
            title: 'Товар 1',
            ordersCount: 5,
            buyoutsCount: 4,
            ordersSumRub: 12500,
          },
        ],
      },
    };

    const message = formatAgentReportMessage(report, (href) => `https://example.com${href}`);
    expect(message).toContain('Воронка продаж');
    expect(message).toContain('Товар 1');
    expect(message).toContain('https://example.com/overview');
  });

  it('formats advertising by nm summary and advertising link', () => {
    const report = {
      report: 'advertising_by_nm_summary' as const,
      tenantId: 'tenant-1',
      generatedAt: '2026-04-27T10:00:00.000Z',
      summaryText: 'Реклама по артикулам за 1 дн.',
      data: {
        totals: {
          adSpend: 22276,
          campaignCount: 53,
          nmCount: 25,
        },
        items: [
          {
            nmId: 123,
            title: 'Товар 1',
            adSpend: 1234.56,
            ordersCount: 10,
            drrPct: 24.69,
          },
        ],
      },
    };

    const message = formatAgentReportMessage(report, (href) => `https://example.com${href}`);
    expect(message).toContain('Реклама по артикулам');
    expect(message).toContain('Товар 1');
    expect(message).toContain('https://example.com/advertising');
  });

  it('formats stocks summary and stock link', () => {
    const report = {
      report: 'stocks_summary' as const,
      tenantId: 'tenant-1',
      generatedAt: '2026-05-19T10:00:00.000Z',
      summaryText: 'Остатки: 1 строк, 10 шт в WB-снимке.',
      data: {
        items: [
          {
            nmId: 123,
            vendorCode: 'ABC-1',
            warehouse: 'Коледино',
            qty: 10,
            inTransit: 2,
            ownStockQty: 5,
            fulfillmentInTransitQty: 7,
          },
        ],
      },
    };

    const message = formatAgentReportMessage(report, (href) => `https://example.com${href}`);
    expect(message).toContain('Остатки');
    expect(message).toContain('Коледино');
    expect(message).toContain('https://example.com/stocks-v2');
  });

  it('formats unanswered reviews summary and reviews link', () => {
    const report = {
      report: 'reviews_summary' as const,
      tenantId: 'tenant-1',
      generatedAt: '2026-05-19T10:00:00.000Z',
      summaryText: 'Отзывы WB: 1 строка.',
      data: {
        items: [
          {
            nmId: 123,
            rating: 4,
            text: 'Хороший товар, но есть вопрос по упаковке',
          },
        ],
      },
    };

    const message = formatAgentReportMessage(report, (href) => `https://example.com${href}`);
    expect(message).toContain('Отзывы без ответа');
    expect(message).toContain('упаковке');
    expect(message).toContain('https://example.com/reviews-qa');
  });

  it('formats cost snapshot summary and economics link', () => {
    const report = {
      report: 'cost_snapshot' as const,
      tenantId: 'tenant-1',
      generatedAt: '2026-04-24T10:00:00.000Z',
      summaryText: 'Слепок себестоимости по 2 кабинетам.',
      data: {
        items: [
          {
            tenantName: 'ИП Бербека',
            nmId: 123,
            vendorCode: 'ABC-1',
            purchasePrice: 320,
            lastFullCostPerUnit: 455,
          },
        ],
      },
    };

    const message = formatAgentReportMessage(report, (href) => `https://example.com${href}`);
    expect(message).toContain('Слепок себестоимости');
    expect(message).toContain('ИП Бербека');
    expect(message).toContain('https://example.com/economics');
  });

  it('formats cost breakdown detail report and economics link', () => {
    const report = {
      report: 'cost_breakdown_detail' as const,
      tenantId: 'tenant-1',
      tenantIds: ['tenant-1'],
      generatedAt: '2026-04-26T10:00:00.000Z',
      summaryText: 'Детализация себестоимости за 7 дн.',
      data: {
        items: [
          {
            tenantName: 'ИП Бербека',
            nmId: 123,
            vendorCode: 'ABC-1',
            fullCostPerUnit: 455,
            components: {
              purchase: 320,
              commission: 55,
              advertising: 20,
            },
          },
        ],
        dataFreshness: [
          {
            tenantName: 'ИП Бербека',
            sales: {
              status: 'fresh',
            },
          },
        ],
      },
    };

    const message = formatAgentReportMessage(report, (href) => `https://example.com${href}`);
    expect(message).toContain('Детализация себестоимости');
    expect(message).toContain('ABC-1');
    expect(message).toContain('актуально');
    expect(message).toContain('https://example.com/economics');
  });
});
