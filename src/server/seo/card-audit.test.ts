import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {},
  withTenantContext: vi.fn(),
}));

import { auditSeoCard, buildSeoTextDraft, validateSeoTextPatch } from './card-audit';

const baseCard = {
  nmId: 123,
  vendorCode: 'sku-123',
  brand: 'Brand',
  category: 'Категория',
  photoUrl: null,
  title: 'Термокружка дорожная стальная с крышкой',
  description: 'Удобная термокружка для горячих и холодных напитков. Подходит для поездок, офиса и прогулок, держит температуру и помещается в автомобильный держатель.',
  updatedAt: '2026-05-15T09:00:00.000Z',
  photosCount: 6,
  hasVideo: true,
  characteristicsCount: 8,
  openCardCount: 1000,
  addToCartCount: 120,
  orderCount: 60,
  buyoutCount: 45,
  stockQty: 25,
};

describe('auditSeoCard', () => {
  it('marks a well-filled card as OK', () => {
    const row = auditSeoCard(baseCard);

    expect(row.priority).toBe('OK');
    expect(row.score).toBe(100);
    expect(row.issues).toHaveLength(0);
  });

  it('raises blocking issues for forbidden links, missing media and empty stock', () => {
    const row = auditSeoCard({
      ...baseCard,
      title: '',
      description: 'Подробнее на example.ru #seo ключевые слова',
      photosCount: 0,
      stockQty: 0,
    });

    expect(row.priority).toBe('P0');
    expect(row.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'title_missing',
      'description_domain',
      'photos_missing',
      'stock_empty',
    ]));
  });

  it('uses funnel metrics to point out weak card conversion', () => {
    const row = auditSeoCard({
      ...baseCard,
      openCardCount: 800,
      addToCartCount: 20,
      orderCount: 8,
    });

    expect(row.priority).toBe('P1');
    expect(row.issues.map((issue) => issue.code)).toContain('weak_cart_conversion');
  });

  it('builds a safe text draft and blocks unsafe apply text', () => {
    const draft = buildSeoTextDraft(
      'Очень длинное название товара с повтором повтором повтором и ссылкой example.ru',
      'SEO: купить товар #теги на www.example.ru ***',
    );

    expect(draft.title.length).toBeLessThanOrEqual(60);
    expect(draft.title).not.toContain('example.ru');
    expect(draft.description).not.toMatch(/seo|#|www\./i);
    expect(validateSeoTextPatch({ title: draft.title, description: draft.description })).toEqual([]);
    expect(validateSeoTextPatch({ title: '', description: 'example.ru' })).toEqual(expect.arrayContaining([
      'Название обязательно для применения SEO-правки.',
      'В названии и описании нельзя оставлять домены или ссылки.',
    ]));
  });
});
