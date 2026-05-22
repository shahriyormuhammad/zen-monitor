import { afterEach, describe, expect, it, vi } from 'vitest';

import { wbDepositAdBudget, wbGetAdBalance, wbGetAdBudget } from './ads-balance';

const jsonResponse = (payload: unknown, status = 200) => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  },
);

describe('wb advertising balance api helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('loads balance with cashback metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      balance: 11083,
      net: 9000,
      bonus: 15187,
      cashbacks: [
        {
          sum: 10672,
          percent: 50,
          expiration_date: '2026-04-17T10:46:02.176174Z',
        },
      ],
    }));

    vi.stubGlobal('fetch', fetchMock);

    await expect(wbGetAdBalance('token')).resolves.toEqual({
      realMoney: 11083,
      bonus: {
        sum: 15187,
        percent: 50,
        expiresAt: '2026-04-17T10:46:02.176174Z',
      },
    });
  });

  it('deposits campaign budget with WB POST body contract', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ total: 7289 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(wbDepositAdBudget('token', 1234567, 5000.4)).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://advert-api.wildberries.ru/adv/v1/budget/deposit?id=1234567',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        sum: 5000,
        type: 1,
        return: true,
      }),
    });
  });

  it('loads campaign budget by campaign id', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      cash: 100,
      netting: 400,
      total: 500,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(wbGetAdBudget('token', 1234567)).resolves.toEqual({
      cash: 100,
      netting: 400,
      total: 500,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://advert-api.wildberries.ru/adv/v1/budget?id=1234567',
    );
  });
});
