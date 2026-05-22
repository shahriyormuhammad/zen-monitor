import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {},
  withTenantContext: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  rawApiStockSizes: {},
  rawApiStocks: {},
  redistributionRouteAvailability: {},
  redistributionRouteAvailabilityEvents: {},
  redistributionSlotMonitorRuns: {},
  redistributionWarehouseRegistry: {},
  tenants: {},
}));

import { isOfficialRedistributionWarehouse } from "./route-scan";

describe("redistribution official warehouse filter", () => {
  it("accepts official redistribution warehouses and known WB aliases", () => {
    expect(isOfficialRedistributionWarehouse("Сарапул WB")).toBe(true);
    expect(isOfficialRedistributionWarehouse("Самара (Новосемейкино)")).toBe(true);
    expect(isOfficialRedistributionWarehouse("Екатеринбург - Перспективная 14")).toBe(true);
    expect(isOfficialRedistributionWarehouse("Екатеринбург - Испытателей 14г")).toBe(true);
    expect(isOfficialRedistributionWarehouse("Новосибирск WB")).toBe(true);
    expect(isOfficialRedistributionWarehouse("СПБ Шушары")).toBe(true);
  });

  it("rejects warehouses absent from the official redistribution list", () => {
    expect(isOfficialRedistributionWarehouse("Воронеж WB")).toBe(false);
    expect(isOfficialRedistributionWarehouse("Актобе")).toBe(false);
  });
});
