import { describe, expect, it } from 'vitest';

import { buildAdvertisingDecisionCards } from './advertising-decision-center';
import type { AdvertisingOverviewResponse, AdvertisingSkuRow } from './advertising';

const skuBase: AdvertisingSkuRow = {
  nmId: 1001,
  vendorCode: 'SKU-1001',
  brand: 'Brand',
  photoUrl: null,
  attributionScope: 'sku',
  groupId: null,
  groupName: null,
  groupNmCount: 1,
  advertisedNmCount: 1,
  adSpend: 0,
  spendSharePct: 0,
  views: 0,
  clicks: 0,
  clusterOrders: 0,
  ctrPct: null,
  cpc: null,
  revenue: 0,
  salesCount: 0,
  netProfit: 0,
  netProfitBeforeAds: 0,
  profitMarginPct: null,
  adSpendToProfitBeforeAdsPct: null,
  acosPct: null,
  roas: null,
  productSignals: {
    stockQty: null,
    sellerPrice: null,
    customerPrice: null,
    photosCount: null,
    hasVideo: null,
    characteristicsCount: null,
    avgSearchPosition: null,
    searchKeywordCount: 0,
    competitorAvgPrice: null,
    competitorCount: 0,
  },
  productCheck: {
    status: 'ok',
    reasons: [],
    reasonCodes: [],
    checks: [],
    checklist: [],
  },
};

function overview(partial: Partial<AdvertisingOverviewResponse>): AdvertisingOverviewResponse {
  return {
    generatedAt: '2026-05-12T00:00:00.000Z',
    dateWindowDays: 7,
    hasData: true,
    summary: {
      adSpendEffective: 0,
      adSpendCostsRaw: 0,
      adSpendClustersRaw: 0,
      adSpendUnknownPlacement: 0,
      revenue: 0,
      netProfit: 0,
      netProfitBeforeAds: 0,
      views: 0,
      clicks: 0,
      clusterOrders: 0,
      activeSkuCount: 0,
      riskySkuCount: 0,
      acosPct: null,
      profitMarginPct: null,
      adSpendToProfitBeforeAdsPct: null,
      roas: null,
      ctrPct: null,
      cpc: null,
      cpo: null,
    },
    daily: [],
    topSku: [],
    topClusters: [],
    placements: [],
    actionItems: [],
    ...partial,
  };
}

describe('buildAdvertisingDecisionCards', () => {
  it('prioritizes stop cards for spend without revenue on a group', () => {
    const result = buildAdvertisingDecisionCards(overview({
      actionItems: [{
        id: 'spend_without_revenue:group-1',
        priority: 'high',
        code: 'spend_without_revenue',
        title: 'Расход есть, выручки по склейке нет',
        details: 'Склейка: Test group.',
        metric: '2 000 ₽ без выручки',
        reasonCode: 'traffic_quality',
        reasonLabel: 'Трафик',
        nmId: 1001,
        vendorCode: 'SKU-1001',
        brand: 'Brand',
        attributionScope: 'group',
        groupId: 'group-1',
        groupName: 'Test group',
        groupNmCount: 3,
      }],
    }));

    expect(result.cards[0]).toMatchObject({
      type: 'stop_now',
      risk: 'high',
      groupId: 'group-1',
      attributionScope: 'group',
    });
  });

  it('adds a raise card for efficient spend', () => {
    const result = buildAdvertisingDecisionCards(overview({
      topSku: [{
        ...skuBase,
        adSpend: 500,
        revenue: 3500,
        netProfit: 900,
        netProfitBeforeAds: 1400,
        profitMarginPct: 25.71,
        adSpendToProfitBeforeAdsPct: 35,
        clusterOrders: 8,
        acosPct: 14.29,
        roas: 7,
      }],
    }));

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({
      type: 'raise_bid',
      risk: 'low',
      action: 'confirm_raise_bid',
    });
  });

  it('stops ads when net profit is negative after ads', () => {
    const result = buildAdvertisingDecisionCards(overview({
      actionItems: [{
        id: 'negative_profit_after_ads:1001',
        priority: 'high',
        code: 'negative_profit_after_ads',
        title: 'Чистая прибыль по SKU ушла в минус',
        details: 'Решение принимается по чистой прибыли после рекламы.',
        metric: 'ЧП -500 ₽ · реклама 1 200 ₽',
        reasonCode: 'bid_economics',
        reasonLabel: 'Ставка',
        nmId: 1001,
        vendorCode: 'SKU-1001',
        brand: 'Brand',
        attributionScope: 'sku',
        groupId: null,
        groupName: null,
        groupNmCount: 1,
      }],
    }));

    expect(result.cards[0]).toMatchObject({
      type: 'stop_now',
      risk: 'high',
      action: 'confirm_cleanup',
      reasonCode: 'bid_economics',
    });
  });

  it('lowers bids when ads eat pre-ad profit', () => {
    const result = buildAdvertisingDecisionCards(overview({
      actionItems: [{
        id: 'profit_eaten_by_ads:group-1',
        priority: 'medium',
        code: 'profit_eaten_by_ads',
        title: 'Реклама съедает прибыль по склейке',
        details: 'До рекламы склейка прибыльна, но расход забирает 65% прибыли.',
        metric: 'ЧП до рекламы 2 000 ₽ · после 700 ₽',
        reasonCode: 'bid_economics',
        reasonLabel: 'Ставка',
        nmId: 1001,
        vendorCode: 'SKU-1001',
        brand: 'Brand',
        attributionScope: 'group',
        groupId: 'group-1',
        groupName: 'Test group',
        groupNmCount: 3,
      }],
    }));

    expect(result.cards[0]).toMatchObject({
      type: 'lower_bid',
      risk: 'medium',
      action: 'confirm_lower_bid',
      groupId: 'group-1',
    });
  });

  it('returns quiet card when no decision signals exist', () => {
    const result = buildAdvertisingDecisionCards(overview({}));

    expect(result.cards).toEqual([
      expect.objectContaining({
        type: 'quiet',
        risk: 'none',
      }),
    ]);
  });

  it('uses structured product reason codes for check-product cards', () => {
    const result = buildAdvertisingDecisionCards(overview({
      topSku: [{
        ...skuBase,
        views: 3000,
        clicks: 8,
        adSpend: 700,
        ctrPct: 0.27,
        productCheck: {
          status: 'fix',
          reasons: ['CTR 0.27%: проверить первый экран и релевантность запросов.'],
          reasonCodes: ['card_content'],
          checks: [{
            code: 'card_content',
            label: 'Карточка',
            status: 'fix',
            message: 'CTR 0.27%: проверить первый экран и релевантность запросов.',
          }],
          checklist: ['Фото/CTR', 'SEO'],
        },
      }],
      actionItems: [{
        id: 'low_ctr:1001',
        priority: 'low',
        code: 'low_ctr',
        title: 'Низкий CTR в кластерах',
        details: 'Проверьте релевантность запросов и первый экран карточки.',
        metric: 'CTR 0.27%',
        reasonCode: 'card_content',
        reasonLabel: 'Карточка',
        nmId: 1001,
        vendorCode: 'SKU-1001',
        brand: 'Brand',
        attributionScope: 'sku',
        groupId: null,
        groupName: null,
        groupNmCount: 1,
      }],
    }));

    expect(result.cards[0]).toMatchObject({
      type: 'check_product',
      reasonCode: 'card_content',
      reasonLabel: 'Карточка',
    });
  });

  it('ignores stable overview action items and returns quiet card', () => {
    const result = buildAdvertisingDecisionCards(overview({
      actionItems: [{
        id: 'stable',
        priority: 'low',
        code: 'stable',
        title: 'Явных критичных отклонений не найдено',
        details: 'Фокус на масштабировании SKU с лучшим ROAS.',
        metric: 'Стабильный рекламный контур',
        reasonCode: null,
        reasonLabel: null,
        nmId: null,
        vendorCode: null,
        brand: null,
        attributionScope: 'sku',
        groupId: null,
        groupName: null,
        groupNmCount: 1,
      }],
    }));

    expect(result.cards[0]).toMatchObject({
      type: 'quiet',
      risk: 'none',
    });
  });
});
