import { afterEach, describe, expect, it, vi } from "vitest";

import { wbApi } from "@/lib/wb-api";

const jsonResponse = (payload: unknown, status = 200) => new Response(
  JSON.stringify(payload),
  {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  }
);

describe("wb advertising api helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("loads promotion campaigns through summary and details endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        adverts: [
          {
            type: 6,
            advert_list: [{ advertId: 1001 }],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        adverts: [
          {
            id: 1001,
            status: 9,
            settings: {
              payment_type: "cpc",
              placements: {
                search: true,
                recommendations: false,
              },
            },
            nm_settings: [
              { nm_id: 777 },
              { nm_id: 888 },
              { nm_id: 777 },
            ],
          },
        ],
      }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getAdCampaigns("token")).resolves.toEqual([
      expect.objectContaining({
        advertId: 1001,
        type: 6,
        status: 9,
        paymentType: "cpc",
        searchPlacement: true,
        recommendationPlacement: false,
        nmIds: [777, 888],
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://advert-api.wildberries.ru/adv/v1/promotion/count");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://advert-api.wildberries.ru/api/advert/v2/adverts?ids=1001");
  });

  it("loads campaign details directly by advert ids", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        adverts: [
          {
            id: 1001,
            status: 9,
            settings: {
              payment_type: "cpc",
              placements: {
                search: true,
                recommendations: false,
              },
            },
            nm_settings: [{ nm_id: 777 }],
          },
          {
            id: 1002,
            status: 11,
            settings: {
              payment_type: "cpm",
              placements: {
                search: false,
                recommendations: true,
              },
            },
            nm_settings: [{ nm_id: 888 }, { nm_id: 999 }],
          },
        ],
      }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getAdCampaignsByAdvertIds("token", [1001, 1002])).resolves.toEqual([
      expect.objectContaining({
        advertId: 1001,
        type: undefined,
        status: 9,
        paymentType: "cpc",
        searchPlacement: true,
        recommendationPlacement: false,
        nmIds: [777],
        timestamps: undefined,
      }),
      expect.objectContaining({
        advertId: 1002,
        type: undefined,
        status: 11,
        paymentType: "cpm",
        searchPlacement: false,
        recommendationPlacement: true,
        nmIds: [888, 999],
        timestamps: undefined,
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://advert-api.wildberries.ru/api/advert/v2/adverts?ids=1001%2C1002");
  });

  it("flattens daily search cluster stats and preserves nm ids", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      items: [
        {
          advertId: 1001,
          nmId: 777,
          dailyStats: [
            {
              date: "2026-04-05",
              stat: {
                normQuery: "foo",
                views: 120,
                clicks: 12,
                ctr: 10,
                spend: 44.5,
                atbs: 3,
                orders: 2,
              },
            },
            {
              date: "2026-04-05",
              stat: {
                normQuery: "bar",
                views: 30,
                clicks: 2,
                ctr: 6.67,
                spend: 10,
              },
            },
          ],
        },
      ],
    }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getSearchClusterStats(
      "token",
      "2026-04-01T00:00:00.000Z",
      "2026-04-05T23:59:59.000Z",
      [{ advertId: 1001, nmId: 777 }]
    )).resolves.toEqual([
      {
        advertId: 1001,
        nmId: 777,
        date: "2026-04-05",
        keyword: "foo",
        views: 120,
        clicks: 12,
        ctr: 10,
        sum: 44.5,
        atbs: 3,
        orders: 2,
        cpc: 0,
        cpm: 0,
        avgPos: 0,
        shks: 0,
      },
      {
        advertId: 1001,
        nmId: 777,
        date: "2026-04-05",
        keyword: "bar",
        views: 30,
        clicks: 2,
        ctr: 6.67,
        sum: 10,
        atbs: 0,
        orders: 0,
        cpc: 0,
        cpm: 0,
        avgPos: 0,
        shks: 0,
      },
    ]);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(request?.method).toBe("POST");
    expect(request?.body).toBe(JSON.stringify({
      from: "2026-04-01",
      to: "2026-04-05",
      items: [{ advertId: 1001, nmId: 777 }],
    }));
  });

  it("splits long search cluster ranges into 30-day windows", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        items: [
          {
            advertId: 1001,
            nmId: 777,
            dailyStats: [
              {
                date: "2026-03-30",
                stat: {
                  normQuery: "foo",
                  views: 10,
                  clicks: 1,
                  ctr: 10,
                  spend: 5,
                  atbs: 1,
                  orders: 1,
                },
              },
            ],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [
          {
            advertId: 1001,
            nmId: 777,
            dailyStats: [
              {
                date: "2026-04-05",
                stat: {
                  normQuery: "bar",
                  views: 20,
                  clicks: 2,
                  ctr: 10,
                  spend: 12,
                  atbs: 2,
                  orders: 2,
                },
              },
            ],
          },
        ],
      }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getSearchClusterStats(
      "token",
      "2026-03-01T00:00:00.000Z",
      "2026-04-05T23:59:59.000Z",
      [{ advertId: 1001, nmId: 777 }]
    )).resolves.toEqual([
      {
        advertId: 1001,
        nmId: 777,
        date: "2026-03-30",
        keyword: "foo",
        views: 10,
        clicks: 1,
        ctr: 10,
        sum: 5,
        atbs: 1,
        orders: 1,
        cpc: 0,
        cpm: 0,
        avgPos: 0,
        shks: 0,
      },
      {
        advertId: 1001,
        nmId: 777,
        date: "2026-04-05",
        keyword: "bar",
        views: 20,
        clicks: 2,
        ctr: 10,
        sum: 12,
        atbs: 2,
        orders: 2,
        cpc: 0,
        cpm: 0,
        avgPos: 0,
        shks: 0,
      },
    ]);

    expect(fetchMock.mock.calls).toHaveLength(2);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body).toBe(JSON.stringify({
      from: "2026-03-01",
      to: "2026-03-30",
      items: [{ advertId: 1001, nmId: 777 }],
    }));
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body).toBe(JSON.stringify({
      from: "2026-03-31",
      to: "2026-04-05",
      items: [{ advertId: 1001, nmId: 777 }],
    }));
  });

  it("loads search cluster bids and maps advert/nm identifiers", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      bids: [
        {
          advert_id: 1001,
          nm_id: 777,
          norm_query: "кластер 1",
          bid: 1300,
        },
      ],
    }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getSearchClusterBids(
      "token",
      [{ advertId: 1001, nmId: 777 }],
    )).resolves.toEqual([
      {
        advertId: 1001,
        nmId: 777,
        keyword: "кластер 1",
        bid: 1300,
      },
    ]);

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(request?.method).toBe("POST");
    expect(request?.body).toBe(JSON.stringify({
      items: [{ advert_id: 1001, nm_id: 777 }],
    }));
  });

  it("sets search cluster bids and verifies WB state", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({
        bids: [
          {
            advert_id: 1001,
            nm_id: 777,
            norm_query: "кластер 1",
            bid: 1400,
          },
        ],
      }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.setSearchClusterBids(
      "token",
      [{ advertId: 1001, nmId: 777, keyword: "кластер 1", bid: 1400.2 }],
    )).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://advert-api.wildberries.ru/adv/v0/normquery/bids");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body).toBe(JSON.stringify({
      bids: [{ advert_id: 1001, nm_id: 777, norm_query: "кластер 1", bid: 1400 }],
    }));
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://advert-api.wildberries.ru/adv/v0/normquery/get-bids");
  });

  it("fails setSearchClusterBids when WB does not confirm the new bid", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({
        bids: [
          {
            advert_id: 1001,
            nm_id: 777,
            norm_query: "кластер 1",
            bid: 1200,
          },
        ],
      }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.setSearchClusterBids(
      "token",
      [{ advertId: 1001, nmId: 777, keyword: "кластер 1", bid: 1400 }],
    )).rejects.toThrow("WB API не подтвердил изменение ставок");
  });

  it("loads campaign minus phrases for advert and nm", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      items: [
        {
          advert_id: 1001,
          nm_id: 777,
          norm_queries: ["кластер 1", "кластер 2"],
        },
      ],
    }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getCampaignMinusPhrases(
      "token",
      [{ advertId: 1001, nmId: 777 }],
    )).resolves.toEqual([
      {
        advertId: 1001,
        nmId: 777,
        normQueries: ["кластер 1", "кластер 2"],
      },
    ]);
  });

  it("sends set-minus payload for campaign minus phrases and verifies WB state", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({
        items: [
          {
            advert_id: 1001,
            nm_id: 777,
            norm_queries: ["кластер 1", "кластер 2"],
          },
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      wbApi.setCampaignMinusPhrases("token", 1001, 777, ["кластер 1", "кластер 2"]),
    ).resolves.toBeUndefined();

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(request?.method).toBe("POST");
    expect(request?.body).toBe(JSON.stringify({
      advert_id: 1001,
      nm_id: 777,
      norm_queries: ["кластер 1", "кластер 2"],
    }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://advert-api.wildberries.ru/adv/v0/normquery/get-minus");
  });

  it("fails set-minus when WB does not confirm the expected minus phrases", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({
        items: [
          {
            advert_id: 1001,
            nm_id: 777,
            norm_queries: ["кластер 1"],
          },
        ],
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      wbApi.setCampaignMinusPhrases("token", 1001, 777, ["кластер 1", "кластер 2"]),
    ).rejects.toThrow("WB API не подтвердил актуальный список минус-фраз");
  });

  it("loads bid recommendations and keeps kopecks values", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      advertId: 1001,
      nmId: 777,
      base: {
        competitiveBid: { bidKopecks: 12000 },
        leadersBid: { bidKopecks: 18000 },
        top2: { bidKopecks: 21000 },
      },
      normQueries: [
        {
          normQuery: "кластер 1",
          reachMin: { bidKopecks: 8000 },
          reachMedium: { bidKopecks: 11000 },
          reachMax: { bidKopecks: 16000, bidKopecksMin: 15000 },
        },
      ],
    }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      wbApi.getBidsRecommendations("token", 1001, 777),
    ).resolves.toEqual({
      advertId: 1001,
      nmId: 777,
      base: {
        competitiveBidKopecks: 12000,
        leadersBidKopecks: 18000,
        top2BidKopecks: 21000,
      },
      normQueries: [
        {
          keyword: "кластер 1",
          reachMinBidKopecks: 8000,
          reachMediumBidKopecks: 11000,
          reachMaxBidKopecks: 16000,
          reachMaxMinBidKopecks: 15000,
        },
      ],
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/advert/v0/bids/recommendations");
  });

  it("uses current WB campaign pause/start endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ adverts: [{ id: 1001, status: 11 }] }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ adverts: [{ id: 1001, status: 9 }] }));

    vi.stubGlobal("fetch", fetchMock);

    await wbApi.pauseAdvert("token", 1001);
    await wbApi.resumeAdvert("token", 1001);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://advert-api.wildberries.ru/adv/v0/pause?id=1001");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/api/advert/v2/adverts?ids=1001");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://advert-api.wildberries.ru/adv/v0/start?id=1001");
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain("/api/advert/v2/adverts?ids=1001");
  });

  it("throws when WB does not verify campaign pause status", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ adverts: [{ id: 1001, status: 9 }] }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.pauseAdvert("token", 1001)).rejects.toMatchObject({
      name: "WbAdActionVerificationError",
      failedItems: [{ advertId: 1001, expectedStatus: 11, actualStatus: 9 }],
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://advert-api.wildberries.ru/adv/v0/pause?id=1001");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/api/advert/v2/adverts?ids=1001");
  });

  it("can skip campaign status verification for pause/start", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({}));

    vi.stubGlobal("fetch", fetchMock);

    await wbApi.pauseAdvert("token", 1001, { verify: false });
    await wbApi.resumeAdvert("token", 1001, { verify: false });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://advert-api.wildberries.ru/adv/v0/pause?id=1001");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://advert-api.wildberries.ru/adv/v0/start?id=1001");
  });

  it("loads ad spend from fullstats and aggregates by nm and day", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        adverts: [
          {
            type: 6,
            advert_list: [{ advertId: 1001 }],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        adverts: [
          {
            id: 1001,
            status: 9,
            settings: {
              payment_type: "cpc",
              placements: {
                search: true,
                recommendations: true,
              },
            },
            nm_settings: [{ nm_id: 777 }],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse([
        {
          advertId: 1001,
          days: [
            {
              date: "2026-04-05T00:00:00Z",
              apps: [
                {
                  nms: [
                    {
                      nmId: 777,
                      sum: 100,
                      views: 1000,
                      clicks: 50,
                    },
                  ],
                },
                {
                  nms: [
                    {
                      nmId: 777,
                      sum: 25,
                      views: 200,
                      clicks: 10,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getAdSpend(
      "token",
      "2026-04-01T00:00:00.000Z",
      "2026-04-05T23:59:59.000Z"
    )).resolves.toEqual([
      {
        nmId: 777,
        date: "2026-04-05T00:00:00Z",
        sum: 125,
        orderSum: 0,
        orderCount: 0,
        views: 1200,
        clicks: 60,
        ctr: 5,
        cpc: 125 / 60,
      },
    ]);

    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://advert-api.wildberries.ru/adv/v3/fullstats?ids=1001&beginDate=2026-04-01&endDate=2026-04-05"
    );
  });

  it("can keep fullstats split by campaign, nm and day", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        adverts: [
          {
            type: 6,
            advert_list: [{ advertId: 1001 }, { advertId: 1002 }],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        adverts: [
          {
            id: 1001,
            status: 9,
            settings: { payment_type: "cpc", placements: { search: true } },
            nm_settings: [{ nm_id: 777 }],
          },
          {
            id: 1002,
            status: 9,
            settings: { payment_type: "cpc", placements: { search: true } },
            nm_settings: [{ nm_id: 777 }],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse([
        {
          advertId: 1001,
          days: [
            {
              date: "2026-04-05T00:00:00Z",
              apps: [{ nms: [{ nmId: 777, sum: 100, views: 1000, clicks: 50 }] }],
            },
          ],
        },
        {
          advertId: 1002,
          days: [
            {
              date: "2026-04-05T00:00:00Z",
              apps: [{ nms: [{ nmId: 777, sum: 25, views: 200, clicks: 10 }] }],
            },
          ],
        },
      ]));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getAdSpend(
      "token",
      "2026-04-01T00:00:00.000Z",
      "2026-04-05T23:59:59.000Z",
      { groupBy: "advert_nm_date" }
    )).resolves.toEqual([
      {
        advertId: 1001,
        nmId: 777,
        date: "2026-04-05T00:00:00Z",
        sum: 100,
        orderSum: 0,
        orderCount: 0,
        views: 1000,
        clicks: 50,
        ctr: 5,
        cpc: 2,
      },
      {
        advertId: 1002,
        nmId: 777,
        date: "2026-04-05T00:00:00Z",
        sum: 25,
        orderSum: 0,
        orderCount: 0,
        views: 200,
        clicks: 10,
        ctr: 5,
        cpc: 2.5,
      },
    ]);
  });

  it("treats null fullstats payload as empty advertising spend instead of crashing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        adverts: [
          {
            type: 6,
            advert_list: [{ advertId: 1001 }],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        adverts: [
          {
            id: 1001,
            status: 9,
            settings: {
              payment_type: "cpc",
              placements: {
                search: true,
                recommendations: false,
              },
            },
            nm_settings: [{ nm_id: 777 }],
          },
        ],
      }))
      .mockResolvedValueOnce(new Response("null\n", {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getAdSpend(
      "token",
      "2026-04-01T00:00:00.000Z",
      "2026-04-05T23:59:59.000Z"
    )).resolves.toEqual([]);
  });

  it("splits long fullstats ranges into 31-day windows", async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        adverts: [
          {
            type: 6,
            advert_list: [{ advertId: 1001 }],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        adverts: [
          {
            id: 1001,
            status: 9,
            settings: {
              payment_type: "cpc",
              placements: {
                search: true,
                recommendations: false,
              },
            },
            nm_settings: [{ nm_id: 777 }],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse([
        {
          advertId: 1001,
          days: [
            {
              date: "2026-03-31T00:00:00Z",
              apps: [{ nms: [{ nmId: 777, sum: 100, views: 1000, clicks: 50 }] }],
            },
          ],
        },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        {
          advertId: 1001,
          days: [
            {
              date: "2026-04-05T00:00:00Z",
              apps: [{ nms: [{ nmId: 777, sum: 50, views: 500, clicks: 25 }] }],
            },
          ],
        },
      ]));

    vi.stubGlobal("fetch", fetchMock);

    const pending = wbApi.getAdSpend(
      "token",
      "2026-03-01T00:00:00.000Z",
      "2026-04-05T23:59:59.000Z"
    );

    await vi.advanceTimersByTimeAsync(20_000);

    await expect(pending).resolves.toEqual([
      {
        nmId: 777,
        date: "2026-03-31T00:00:00Z",
        sum: 100,
        orderSum: 0,
        orderCount: 0,
        views: 1000,
        clicks: 50,
        ctr: 5,
        cpc: 2,
      },
      {
        nmId: 777,
        date: "2026-04-05T00:00:00Z",
        sum: 50,
        orderSum: 0,
        orderCount: 0,
        views: 500,
        clicks: 25,
        ctr: 5,
        cpc: 2,
      },
    ]);

    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://advert-api.wildberries.ru/adv/v3/fullstats?ids=1001&beginDate=2026-03-01&endDate=2026-03-31"
    );
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://advert-api.wildberries.ru/adv/v3/fullstats?ids=1001&beginDate=2026-04-01&endDate=2026-04-05"
    );
  });

  it("paces sequential fullstats requests so WB 20-second rate limits are respected", async () => {
    vi.useFakeTimers();

    const requestTimes: number[] = [];
    const fetchMock = vi.fn((url: string | URL) => {
      requestTimes.push(Date.now());

      if (String(url).includes("/adv/v1/promotion/count")) {
        return Promise.resolve(jsonResponse({
          adverts: [
            {
              type: 6,
              advert_list: [{ advertId: 1001 }],
            },
          ],
        }));
      }

      if (String(url).includes("/api/advert/v2/adverts")) {
        return Promise.resolve(jsonResponse({
          adverts: [
            {
              id: 1001,
              status: 9,
              settings: {
                payment_type: "cpc",
                placements: {
                  search: true,
                  recommendations: false,
                },
              },
              nm_settings: [{ nm_id: 777 }],
            },
          ],
        }));
      }

      return Promise.resolve(jsonResponse([
        {
          advertId: 1001,
          days: [],
        },
      ]));
    });

    vi.stubGlobal("fetch", fetchMock);

    const pending = wbApi.getAdSpend(
      "token",
      "2026-03-01T00:00:00.000Z",
      "2026-04-05T23:59:59.000Z"
    );

    await vi.advanceTimersByTimeAsync(20_000);

    await expect(pending).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requestTimes[3]!).toBeGreaterThanOrEqual(requestTimes[2]! + 20_000);
  });

  it("loads funnel stats from analytics v3 and maps selected-period metrics", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        products: [
          {
            product: {
              nmId: 777,
            },
            statistic: {
              selected: {
                openCount: 145,
                cartCount: 34,
                orderCount: 19,
                orderSum: 12345.67,
                buyoutCount: 18,
                buyoutSum: 11777.5,
                cancelCount: 1,
                cancelSum: 568.17,
                avgPrice: 649.77,
                conversions: {
                  addToCartPercent: 23.4,
                  cartToOrderPercent: 55.9,
                  buyoutPercent: 94.7,
                },
              },
            },
          },
        ],
      },
    }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getNomenclatureReport(
      "token",
      "2026-03-01T00:00:00.000Z",
      "2026-03-05T23:59:59.000Z"
    )).resolves.toEqual([
      {
        nmId: 777,
        orderCount: 19,
        orderSum: 12345.67,
        buyoutsCount: 18,
        buyoutsSum: 11777.5,
        cancelCount: 1,
        cancelSum: 568.17,
        avgPrice: 649.77,
        addToCartCount: 34,
        addToCartPercent: 23.4,
        cartToOrderPercent: 55.9,
        orderToBuyoutPercent: 94.7,
        openCardCount: 145,
        localizationPercent: 0,
      },
    ]);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products"
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(request?.method).toBe("POST");
    expect(request?.body).toBe(JSON.stringify({
      selectedPeriod: {
        start: "2026-03-01",
        end: "2026-03-05",
      },
      pastPeriod: {
        start: "2026-02-24",
        end: "2026-02-28",
      },
      nmIds: [],
      skipDeletedNm: false,
      limit: 1000,
      offset: 0,
    }));
  });

  it("loads daily funnel stats window-by-window for a selected range", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "csv report unavailable" }, 404))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          products: [
            {
              product: { nmId: 101 },
              statistic: {
                selected: {
                  openCount: 10,
                  cartCount: 2,
                  orderCount: 1,
                  orderSum: 100,
                  buyoutCount: 1,
                  buyoutSum: 90,
                },
              },
            },
          ],
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          products: [
            {
              product: { nmId: 101 },
              statistic: {
                selected: {
                  openCount: 20,
                  cartCount: 3,
                  orderCount: 2,
                  orderSum: 240,
                  buyoutCount: 1,
                  buyoutSum: 120,
                },
              },
            },
          ],
        },
      }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getDailyNomenclatureReport(
      "token",
      "2026-03-01T00:00:00.000Z",
      "2026-03-02T23:59:59.000Z"
    )).resolves.toEqual([
      {
        periodStart: "2026-03-01T00:00:00.000Z",
        periodEnd: "2026-03-01T00:00:00.000Z",
        items: [
          {
            nmId: 101,
            orderCount: 1,
            orderSum: 100,
            buyoutsCount: 1,
            buyoutsSum: 90,
            cancelCount: 0,
            cancelSum: 0,
            avgPrice: 0,
            addToCartCount: 2,
            addToCartPercent: 0,
            cartToOrderPercent: 0,
            orderToBuyoutPercent: 0,
            openCardCount: 10,
            localizationPercent: 0,
          },
        ],
      },
      {
        periodStart: "2026-03-02T00:00:00.000Z",
        periodEnd: "2026-03-02T00:00:00.000Z",
        items: [
          {
            nmId: 101,
            orderCount: 2,
            orderSum: 240,
            buyoutsCount: 1,
            buyoutsSum: 120,
            cancelCount: 0,
            cancelSum: 0,
            avgPrice: 0,
            addToCartCount: 3,
            addToCartPercent: 0,
            cartToOrderPercent: 0,
            orderToBuyoutPercent: 0,
            openCardCount: 20,
            localizationPercent: 0,
          },
        ],
      },
    ]);

    const firstRequest = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const secondRequest = fetchMock.mock.calls[2]?.[1] as RequestInit | undefined;

    expect(firstRequest?.body).toBe(JSON.stringify({
      selectedPeriod: {
        start: "2026-03-01",
        end: "2026-03-01",
      },
      pastPeriod: {
        start: "2026-02-28",
        end: "2026-02-28",
      },
      nmIds: [],
      skipDeletedNm: false,
      limit: 1000,
      offset: 0,
    }));
    expect(secondRequest?.body).toBe(JSON.stringify({
      selectedPeriod: {
        start: "2026-03-02",
        end: "2026-03-02",
      },
      pastPeriod: {
        start: "2026-03-01",
        end: "2026-03-01",
      },
      nmIds: [],
      skipDeletedNm: false,
      limit: 1000,
      offset: 0,
    }));
  });

  it("loads orders through the operational orders endpoint from the range start", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([
        {
          srid: "order-1",
          nmId: 101,
          date: "2026-03-01T10:00:00.000Z",
          totalPrice: 1200,
          isCancel: false,
        },
        {
          srid: "order-2",
          nmId: 101,
          date: "2026-03-02T11:00:00.000Z",
          totalPrice: 1500,
          isCancel: false,
        },
      ]));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      wbApi.getOrders(
        "token",
        "2026-03-01T00:00:00.000Z",
        "2026-03-02T23:59:59.000Z"
      )
    ).resolves.toEqual([
      {
        srid: "order-1",
        nmId: 101,
        date: "2026-03-01T10:00:00.000Z",
        totalPrice: 1200,
        isCancel: false,
      },
      {
        srid: "order-2",
        nmId: 101,
        date: "2026-03-02T11:00:00.000Z",
        totalPrice: 1500,
        isCancel: false,
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=2026-03-01T00%3A00%3A00.000Z&flag=0"
    );
  });

  it("loads realization reports through the Finance API and normalizes fields", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([
        {
          reportId: 123,
          dateFrom: "2026-04-01",
          dateTo: "2026-04-07",
          rrdId: 10,
          nmId: 197805852,
          brandName: "Brand",
          vendorCode: "ART-1",
          docTypeName: "Продажа",
          quantity: 1,
          retailAmount: "367",
          commissionPercent: "12.5",
          sellerOperName: "Продажа",
          saleDt: "2026-04-03T23:30:00Z",
          officeName: "Пенза",
          retailPriceWithDisc: "399.68",
          deliveryService: "50",
          returnAmount: "0",
          spp: "25.31",
          kvwBase: "15",
          kvw: "12.5",
          ppvzSalesCommission: "33.62",
          forPay: "315.38",
          acquiringFee: "4.41",
          penalty: "0",
          additionalPayment: "0",
          rebillLogisticCost: "7.5",
          paidStorage: "2.1",
          deduction: "1.2",
          paidAcceptance: "3.4",
          cashbackAmount: "0",
          cashbackDiscount: "0.5",
          paymentSchedule: "0.6",
          fixTariffDateFrom: "2026-03-01",
          fixTariffDateTo: "2026-05-30",
          dlvPrc: "1.65",
          isPaidDeliveryService: true,
        },
      ]));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      wbApi.getRealizationReport("token", "2026-04-01", "2026-04-07")
    ).resolves.toEqual([
      expect.objectContaining({
        rrd_id: 10,
        realizationreport_id: 123,
        date_from: "2026-04-01",
        date_to: "2026-04-07",
        sale_dt: "2026-04-04",
        nm_id: 197805852,
        brand_name: "Brand",
        sa_name: "ART-1",
        supplier_oper_name: "Продажа",
        office_name: "Пенза",
        retail_amount: 367,
        commission_amount: 33.62,
        delivery_rub: 50,
        rebill_logistic_cost: 7.5,
        storage_fee_rub: 2.1,
        penalty_rub: 0,
        spp_rub: 32.68,
        payment_schedule_rub: 0.6,
        ppvz_for_pay: 315.38,
        deduction: 1.2,
        acquiring_fee: 4.41,
        retail_price_withdisc_rub: 399.68,
        acceptance: 3.4,
        cashback_amount: 0.5,
        ppvz_spp_prc: 25.31,
        ppvz_kvw_prc_base: 15,
        ppvz_kvw_prc: 12.5,
        fixation_start_date: "2026-03-01",
        fixation_end_date: "2026-05-30",
        fixed_warehouse_coefficient: 1.65,
        is_paid_delivery_service: true,
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed"
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      dateFrom: "2026-04-01",
      dateTo: "2026-04-07",
      limit: 100000,
      rrdId: 0,
      period: "weekly",
    });
  });

  it("normalizes Finance API UTC timestamps to WB Moscow report dates", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([
        {
          reportId: 123,
          dateFrom: "2026-03-30",
          dateTo: "2026-04-05",
          rrdId: 12,
          nmId: 0,
          sellerOperName: "Удержание",
          bonusTypeName: "Оказание услуг «WB Продвижение», документ №291746522",
          saleDt: "2026-03-31T23:15:54Z",
          quantity: 0,
          retailAmount: "0",
          forPay: "0",
          deduction: "21148",
        },
      ]));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      wbApi.getRealizationReport("token", "2026-03-30", "2026-04-05")
    ).resolves.toEqual([
      expect.objectContaining({
        rrd_id: 12,
        sale_dt: "2026-04-01",
        deduction: 21148,
      }),
    ]);
  });

  it("aligns paid storage postings to the WB weekly report date", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([
        {
          reportId: 123,
          dateFrom: "2026-01-01",
          dateTo: "2026-01-04",
          rrdId: 11,
          nmId: 0,
          sellerOperName: "Хранение",
          saleDt: "2025-12-31",
          quantity: 0,
          retailAmount: "0",
          forPay: "0",
          paidStorage: "638.49",
        },
      ]));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      wbApi.getRealizationReport("token", "2026-01-01", "2026-01-04")
    ).resolves.toEqual([
      expect.objectContaining({
        rrd_id: 11,
        nm_id: 0,
        sale_dt: "2026-01-01",
        storage_fee_rub: 638.49,
      }),
    ]);
  });

  it("paginates realization reports with Finance API rrdId", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([
        {
          reportId: 123,
          dateFrom: "2026-04-01",
          dateTo: "2026-04-07",
          rrdId: 10,
          nmId: 197805852,
        },
      ]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      wbApi.getAllRealizationReports("token", "2026-04-01", "2026-04-07", 1)
    ).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ rrdId: 0 });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ rrdId: 10 });
  });

  it("stops realization pagination when page is smaller than limit", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([
        {
          reportId: 123,
          dateFrom: "2026-04-01",
          dateTo: "2026-04-07",
          rrdId: 10,
          nmId: 197805852,
        },
      ]));

    vi.stubGlobal("fetch", fetchMock);

    await expect(
      wbApi.getAllRealizationReports("token", "2026-04-01", "2026-04-07", 100000)
    ).resolves.toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes prices from size-level WB payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      data: {
        listGoods: [
          {
            nmID: 197805852,
            discount: 52,
            clubDiscount: 0,
            price: 0,
            sizes: [
              {
                techSizeName: "38-39",
                price: 2611,
                discountedPrice: 1253.28,
                clubDiscountedPrice: 1253.28,
              },
            ],
          },
        ],
      },
    }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getPrices("token", 1000)).resolves.toEqual([
      expect.objectContaining({
        nmID: 197805852,
        price: 2611,
        discount: 52,
        spp: 0,
      }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000"
    );
  });

  it("loads public WB card customer prices in rubles", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      products: [
        {
          id: 97542007,
          sizes: [
            {
              price: {
                basic: 99000,
                product: 28600,
              },
            },
          ],
        },
      ],
    }));

    vi.stubGlobal("fetch", fetchMock);

    const prices = await wbApi.getPublicCardPrices([97542007], { dest: "-1257786", spp: 30 });

    expect(prices.get(97542007)).toEqual({
      nmID: 97542007,
      basicPrice: 990,
      customerPrice: 286,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=-1257786&spp=30&nm=97542007"
    );
  });

  it("falls back from wb-warehouses to products summary for base tokens", async () => {
    const { logger } = await import("@/lib/logger");
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        title: "forbidden",
        detail: "base token is not allowed",
      }, 403))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          items: [
            {
              nmID: 183690498,
              metrics: {
                stockCount: 1943,
                toClientCount: 7,
                fromClientCount: 2,
              },
            },
            {
              nmID: 197805852,
              metrics: {
                stockCount: 1472,
                toClientCount: 13,
                fromClientCount: 5,
              },
            },
          ],
        },
      }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getStocks("token")).resolves.toEqual([
      {
        nmId: 183690498,
        warehouseName: "WB summary",
        quantity: 1943,
        inWayToClient: 7,
        inWayFromClient: 2,
      },
      {
        nmId: 197805852,
        warehouseName: "WB summary",
        quantity: 1472,
        inWayToClient: 13,
        inWayFromClient: 5,
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://seller-analytics-api.wildberries.ru/api/v2/stocks-report/products/products"
    );
    expect(infoSpy).toHaveBeenCalledWith(
      expect.any(Object),
      expect.stringContaining("falling back to products summary"),
    );
  });

  it("loads all content cards through cursor pagination and dedupes by nm id", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        cards: [
          {
            nmID: 101,
            vendorCode: "sku-101",
            title: "Card 101",
          },
          {
            nmID: 202,
            vendorCode: "sku-202",
            title: "Card 202",
          },
        ],
        cursor: {
          updatedAt: "2026-04-05T10:00:00.000Z",
          nmID: 202,
          total: 3,
        },
        total: 3,
      }))
      .mockResolvedValueOnce(jsonResponse({
        cards: [
          {
            nmID: 202,
            vendorCode: "sku-202-updated",
            title: "Card 202 updated",
          },
          {
            nmID: 303,
            vendorCode: "sku-303",
            title: "Card 303",
          },
        ],
        cursor: {
          updatedAt: "2026-04-05T10:01:00.000Z",
          nmID: 303,
          total: 3,
        },
        total: 3,
      }))
      .mockResolvedValueOnce(jsonResponse({
        cards: [],
        cursor: {
          updatedAt: "2026-04-05T10:01:00.000Z",
          nmID: 303,
          total: 3,
        },
        total: 3,
      }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getAllCardsList("token", 2)).resolves.toEqual([
      {
        nmID: 101,
        vendorCode: "sku-101",
        title: "Card 101",
      },
      {
        nmID: 202,
        vendorCode: "sku-202-updated",
        title: "Card 202 updated",
      },
      {
        nmID: 303,
        vendorCode: "sku-303",
        title: "Card 303",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://content-api.wildberries.ru/content/v2/get/cards/list");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        settings: {
          sort: {
            ascending: true,
          },
          cursor: {
            limit: 2,
          },
          filter: { withRoot: true },
        },
      }),
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        settings: {
          sort: {
            ascending: true,
          },
          cursor: {
            limit: 2,
            updatedAt: "2026-04-05T10:00:00.000Z",
            nmID: 202,
          },
          filter: { withRoot: true },
        },
      }),
    });
  });

  it("loads a single content card by nm id through text search", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      cards: [
        { nmID: 111, vendorCode: "other" },
        { nmID: 222, vendorCode: "target" },
      ],
    }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getCardByNmId("token", 222)).resolves.toEqual({ nmID: 222, vendorCode: "target" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://content-api.wildberries.ru/content/v2/get/cards/list",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          settings: {
            sort: { ascending: false },
            cursor: { limit: 100 },
            filter: {
              textSearch: "222",
              withPhoto: -1,
            },
          },
        }),
      }),
    );
  });

  it("updates content cards through cards/update and surfaces WB payload errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: null, error: false, errorText: "", additionalErrors: {} }))
      .mockResolvedValueOnce(jsonResponse({ data: null, error: true, errorText: "bad title", additionalErrors: { title: ["bad"] } }));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.updateProductCards("token", [{
      nmID: 222,
      vendorCode: "target",
      title: "New title",
      description: "New description",
      dimensions: { length: 1, width: 2, height: 3, weightBrutto: 0.1 },
      characteristics: [],
      sizes: [{ skus: ["123"] }],
    }])).resolves.toMatchObject({ error: false });

    await expect(wbApi.updateProductCards("token", [{
      nmID: 222,
      vendorCode: "target",
      title: "Bad",
      description: "Bad",
      dimensions: { length: 1 },
      characteristics: [],
      sizes: [{ skus: ["123"] }],
    }])).rejects.toMatchObject({
      operation: "updateProductCards",
      retryable: false,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://content-api.wildberries.ru/content/v2/cards/update");
  });

  it("loads paid storage through task-based report flow", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: {
          taskId: "task-1",
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          id: "task-1",
          status: "done",
        },
      }))
      .mockResolvedValueOnce(jsonResponse([
        {
          date: "2026-04-05",
          warehouse: "Коледино",
          warehousePrice: 123.45,
          nmId: 777,
        },
      ]));

    vi.stubGlobal("fetch", fetchMock);

    await expect(wbApi.getPaidStorage(
      "token",
      "2026-04-01T00:00:00.000Z",
      "2026-04-05T23:59:59.000Z"
    )).resolves.toEqual([
      {
        nmId: 777,
        warehouseName: "Коледино",
        storageAmount: 123.45,
        date: "2026-04-05",
      },
    ]);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://seller-analytics-api.wildberries.ru/api/v1/paid_storage?dateFrom=2026-04-01&dateTo=2026-04-05"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://seller-analytics-api.wildberries.ru/api/v1/paid_storage/tasks/task-1/status"
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://seller-analytics-api.wildberries.ru/api/v1/paid_storage/tasks/task-1/download"
    );
  });
});
