import { describe, expect, it } from "vitest";

import {
  buildManualRedistributionApplicationComment,
  normalizeManualRedistributionWarehouseName,
  parseManualRedistributionRequestPayload,
} from "./manual-request";

describe("manual redistribution request helpers", () => {
  it("normalizes WB warehouse aliases for route comparison", () => {
    expect(normalizeManualRedistributionWarehouseName("Сарапул WB")).toBe("сарапул");
    expect(normalizeManualRedistributionWarehouseName("Самара (Новосемейкино)")).toBe("самара новосемейкино");
  });

  it("parses a compact manual request and defaults one-size items", () => {
    const result = parseManualRedistributionRequestPayload({
      nmId: "178896573",
      transferUnits: "12",
      fromWarehouse: "Тула",
      toWarehouse: "Сарапул WB",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.input).toMatchObject({
      nmId: 178896573,
      transferUnits: 12,
      sizeName: "Без размера",
      fromRegionName: "Ручной ввод",
      toRegionName: "Ручной ввод",
    });
  });

  it("rejects same source and destination warehouses", () => {
    const result = parseManualRedistributionRequestPayload({
      nmId: 178896573,
      sizeName: "Без размера",
      transferUnits: 12,
      fromWarehouse: "Сарапул WB",
      toWarehouse: "Сарапул",
    });

    expect(result).toEqual({
      ok: false,
      error: "fromWarehouse and toWarehouse must differ",
    });
  });

  it("builds the WB operator comment from manual input", () => {
    const result = parseManualRedistributionRequestPayload({
      nmId: 178896573,
      transferUnits: 12,
      sizeName: "Без размера",
      fromWarehouse: "Тула",
      toWarehouse: "Сарапул WB",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildManualRedistributionApplicationComment(result.input)).toBe(
      "Ручная заявка: переместить 12 шт размера Без размера с Тула на Сарапул WB",
    );
  });
});
