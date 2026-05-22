import { describe, expect, it } from "vitest";

import {
  buildSlotProbeItem,
  normalizeWbWarehouseName,
  wbWarehouseMatches,
} from "./wb-lk-http";

const recommendation = {
  nmId: 183690498,
  vendorCode: "Тапочки 5 / Классика Голубые",
  sizeName: "44-45",
  fromWarehouse: "Сарапул WB",
  fromOfficeId: 301987,
  toWarehouse: "Новосемейкино",
  toOfficeId: 301805,
  transferUnits: 4,
};

describe("wb-lk-http redistribution slot probe helpers", () => {
  it("normalizes WB suffix and punctuation for warehouse matching", () => {
    expect(normalizeWbWarehouseName("Сарапул WB")).toBe("сарапул");
    expect(
      wbWarehouseMatches(
        { officeID: 301805, officeName: "Самара (Новосемейкино)" },
        { warehouseName: "Новосемейкино" },
      ),
    ).toBe(true);
  });

  it("prefers exact office ID matches even when names differ", () => {
    expect(
      wbWarehouseMatches(
        { officeID: 301987, officeName: "Сарапул" },
        { officeId: 301987, warehouseName: "Другое имя" },
      ),
    ).toBe(true);
  });

  it("marks route available only when source, destination, stock and quotas exist", () => {
    const item = buildSlotProbeItem({
      recommendation,
      sourceWarehouse: {
        officeID: 301987,
        officeName: "Сарапул",
        inStock: [{ techSize: "44-45", chrtID: 302767855, count: 21 }],
      },
      destinationWarehouse: { officeID: 301805, officeName: "Самара (Новосемейкино)" },
      size: { techSize: "44-45", chrtID: 302767855, count: 21 },
      srcQuota: 10,
      dstQuota: 8,
    });

    expect(item.status).toBe("available");
    expect(item.reason).toBe("http_slot_available");
    expect(item.canSubmitUnits).toBe(4);
    expect(item.chrtId).toBe(302767855);
  });

  it("blocks by source quota before any submit can be attempted", () => {
    const item = buildSlotProbeItem({
      recommendation,
      sourceWarehouse: {
        officeID: 301987,
        officeName: "Сарапул",
        inStock: [{ techSize: "44-45", chrtID: 302767855, count: 21 }],
      },
      destinationWarehouse: { officeID: 301805, officeName: "Самара (Новосемейкино)" },
      size: { techSize: "44-45", chrtID: 302767855, count: 21 },
      srcQuota: 0,
      dstQuota: 8,
    });

    expect(item.status).toBe("limit_exhausted");
    expect(item.reason).toBe("src_quota_zero");
    expect(item.canSubmitUnits).toBe(0);
  });

  it("marks missing size as unavailable", () => {
    const item = buildSlotProbeItem({
      recommendation,
      sourceWarehouse: {
        officeID: 301987,
        officeName: "Сарапул",
        inStock: [{ techSize: "42-43", chrtID: 302767854, count: 33 }],
      },
      destinationWarehouse: { officeID: 301805, officeName: "Самара (Новосемейкино)" },
      size: null,
      srcQuota: 10,
      dstQuota: 8,
    });

    expect(item.status).toBe("route_unavailable");
    expect(item.reason).toBe("size_not_in_source_stock");
  });
});
