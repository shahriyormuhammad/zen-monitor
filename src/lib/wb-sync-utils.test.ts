import { describe, expect, it } from "vitest";

import {
  dedupePaidStorageItems,
  dedupeStockOfficeMetricItems,
  dedupeStockSizeMetricItems,
} from "@/lib/wb-sync-utils";

describe("wb sync utils", () => {
  it("aggregates paid storage rows by nm, warehouse and day before DB upsert", () => {
    expect(dedupePaidStorageItems([
      {
        nmId: 777,
        warehouseName: " Коледино ",
        storageAmount: 10,
        date: "2026-04-05",
      },
      {
        nmId: 777,
        warehouseName: "Коледино",
        storageAmount: 12,
        date: "2026-04-05T00:00:00.000Z",
      },
      {
        nmId: 888,
        warehouseName: "",
        storageAmount: 4,
        date: "2026-04-05",
      },
    ])).toEqual([
      {
        nmId: 777,
        warehouseName: "Коледино",
        storageAmount: 22,
        date: "2026-04-05T00:00:00.000Z",
      },
      {
        nmId: 888,
        warehouseName: "Unknown",
        storageAmount: 4,
        date: "2026-04-05T00:00:00.000Z",
      },
    ]);
  });

  it("dedupes stock size rows by normalized key and keeps the richest metrics row", () => {
    expect(dedupeStockSizeMetricItems([
      {
        stockType: "wb",
        nmId: 111,
        sizeName: " Без размера ",
        chrtId: null,
        regionName: " Центральный ",
        officeId: 507,
        officeName: " Коледино ",
        ordersCount: 0,
        ordersSum: 0,
        buyoutCount: 0,
        buyoutSum: 0,
        stockCount: 10,
        stockSum: 1000,
        toClientCount: 0,
        fromClientCount: 0,
        lostOrdersCount: 0,
        lostOrdersSum: 0,
        avgStockTurnoverDays: null,
        saleRateDays: null,
      },
      {
        stockType: "wb",
        nmId: 111,
        sizeName: "Без размера",
        chrtId: null,
        regionName: "Центральный",
        officeId: 507,
        officeName: "Коледино",
        ordersCount: 2,
        ordersSum: 200,
        buyoutCount: 1,
        buyoutSum: 100,
        stockCount: 12,
        stockSum: 1200,
        toClientCount: 1,
        fromClientCount: 1,
        lostOrdersCount: 0,
        lostOrdersSum: 0,
        avgStockTurnoverDays: 5,
        saleRateDays: 3,
      },
    ])).toEqual([
      {
        stockType: "wb",
        nmId: 111,
        sizeName: "Без размера",
        chrtId: null,
        regionName: "Центральный",
        officeId: 507,
        officeName: "Коледино",
        ordersCount: 2,
        ordersSum: 200,
        buyoutCount: 1,
        buyoutSum: 100,
        stockCount: 12,
        stockSum: 1200,
        toClientCount: 1,
        fromClientCount: 1,
        lostOrdersCount: 0,
        lostOrdersSum: 0,
        avgStockTurnoverDays: 5,
        saleRateDays: 3,
      },
    ]);
  });

  it("dedupes stock office rows by normalized key and keeps the richest metrics row", () => {
    expect(dedupeStockOfficeMetricItems([
      {
        stockType: "wb",
        regionName: " Центральный ",
        officeId: null,
        officeName: "  ",
        ordersCount: 0,
        ordersSum: 0,
        buyoutCount: 0,
        buyoutSum: 0,
        stockCount: 5,
        stockSum: 500,
        toClientCount: 0,
        fromClientCount: 0,
        lostOrdersCount: 0,
        lostOrdersSum: 0,
        avgStockTurnoverDays: null,
        saleRateDays: null,
      },
      {
        stockType: "wb",
        regionName: "Центральный",
        officeId: null,
        officeName: "Unknown",
        ordersCount: 2,
        ordersSum: 200,
        buyoutCount: 1,
        buyoutSum: 100,
        stockCount: 6,
        stockSum: 600,
        toClientCount: 1,
        fromClientCount: 1,
        lostOrdersCount: 0,
        lostOrdersSum: 0,
        avgStockTurnoverDays: 7,
        saleRateDays: 3,
      },
    ])).toEqual([
      {
        stockType: "wb",
        regionName: "Центральный",
        officeId: null,
        officeName: "Unknown",
        ordersCount: 2,
        ordersSum: 200,
        buyoutCount: 1,
        buyoutSum: 100,
        stockCount: 6,
        stockSum: 600,
        toClientCount: 1,
        fromClientCount: 1,
        lostOrdersCount: 0,
        lostOrdersSum: 0,
        avgStockTurnoverDays: 7,
        saleRateDays: 3,
      },
    ]);
  });
});
