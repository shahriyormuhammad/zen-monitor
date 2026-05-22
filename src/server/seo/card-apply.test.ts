import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: {},
  withTenantContext: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { AppError } from '@/lib/errors';
import { buildWbCardUpdatePayload } from './card-apply';
import type { WbProductCard } from '@/lib/wb-api';

describe('buildWbCardUpdatePayload', () => {
  it('keeps only fields safe for WB cards/update and applies text patch', () => {
    const payload = buildWbCardUpdatePayload({
      nmID: 123,
      vendorCode: 'sku-123',
      brand: 'Brand',
      kizMarked: true,
      title: 'Old title',
      description: 'Old description',
      dimensions: {
        length: 10,
        width: 20,
        height: 5,
        weightBrutto: 0.3,
        isValid: false,
      },
      characteristics: [
        { id: 12, name: 'Цвет', value: ['черный'] },
      ],
      sizes: [
        { chrtID: 555, techSize: '0', wbSize: '42', skus: ['1234567890123'], price: 999 },
      ],
      photos: [{ big: 'https://example.test/1.webp' }],
      video: 'https://example.test/video.m3u8',
      tags: [{ id: 1 }],
    } as WbProductCard, {
      title: 'New title',
      description: 'New description',
    });

    expect(payload).toEqual({
      nmID: 123,
      vendorCode: 'sku-123',
      brand: 'Brand',
      kizMarked: true,
      title: 'New title',
      description: 'New description',
      dimensions: {
        length: 10,
        width: 20,
        height: 5,
        weightBrutto: 0.3,
      },
      characteristics: [
        { id: 12, value: ['черный'] },
      ],
      sizes: [
        { chrtID: 555, techSize: '0', wbSize: '42', skus: ['1234567890123'] },
      ],
    });
    expect(payload).not.toHaveProperty('photos');
    expect(payload).not.toHaveProperty('video');
    expect(payload).not.toHaveProperty('tags');
  });

  it('stops apply when the WB card snapshot is incomplete', () => {
    expect(() => buildWbCardUpdatePayload({
      nmID: 123,
      vendorCode: 'sku-123',
      dimensions: { length: 10 },
      characteristics: [],
    } as WbProductCard, {
      title: 'New title',
      description: 'New description',
    })).toThrow(AppError);
  });
});
