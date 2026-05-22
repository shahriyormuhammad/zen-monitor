export type ManualRedistributionRequestInput = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  sizeName: string;
  chrtId: number | null;
  fromWarehouse: string;
  fromOfficeId: number | null;
  fromRegionName: string;
  toWarehouse: string;
  toOfficeId: number | null;
  toRegionName: string;
  transferUnits: number;
};

export type ManualRedistributionRequestParseResult =
  | { ok: true; input: ManualRedistributionRequestInput }
  | { ok: false; error: string };

const MAX_TRANSFER_UNITS = 100_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  options: { required?: boolean; fallback?: string; max?: number } = {},
) {
  const raw = record[key];
  const value = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  const fallback = options.fallback?.trim() ?? "";
  const result = value || fallback;

  if (options.required && !result) {
    return { ok: false as const, error: `${key} is required` };
  }
  if (options.max && result.length > options.max) {
    return { ok: false as const, error: `${key} is too long` };
  }

  return { ok: true as const, value: result || null };
}

function readPositiveInt(
  record: Record<string, unknown>,
  key: string,
  options: { required?: boolean; max?: number } = {},
) {
  const raw = record[key];
  if (raw === null || raw === undefined || raw === "") {
    if (options.required) {
      return { ok: false as const, error: `${key} is required` };
    }
    return { ok: true as const, value: null };
  }

  const value = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false as const, error: `${key} must be a positive integer` };
  }

  const parsed = Math.floor(value);
  if (options.max && parsed > options.max) {
    return { ok: false as const, error: `${key} is too large` };
  }

  return { ok: true as const, value: parsed };
}

export function normalizeManualRedistributionWarehouseName(value: string) {
  return value
    .toLowerCase()
    .replace(/[«»"']/g, "")
    .replace(/\bwb\b/g, "")
    .replace(/[^a-zа-яё0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseManualRedistributionRequestPayload(
  payload: unknown,
): ManualRedistributionRequestParseResult {
  const record = asRecord(payload);
  if (!record) {
    return { ok: false, error: "Request body must be an object" };
  }

  const nmId = readPositiveInt(record, "nmId", { required: true });
  if (!nmId.ok) return { ok: false, error: nmId.error };

  const transferUnits = readPositiveInt(record, "transferUnits", {
    required: true,
    max: MAX_TRANSFER_UNITS,
  });
  if (!transferUnits.ok) return { ok: false, error: transferUnits.error };

  const vendorCode = readString(record, "vendorCode", { max: 255 });
  if (!vendorCode.ok) return { ok: false, error: vendorCode.error };

  const brand = readString(record, "brand", { max: 255 });
  if (!brand.ok) return { ok: false, error: brand.error };

  const sizeName = readString(record, "sizeName", {
    fallback: "Без размера",
    max: 64,
  });
  if (!sizeName.ok) return { ok: false, error: sizeName.error };

  const chrtId = readPositiveInt(record, "chrtId");
  if (!chrtId.ok) return { ok: false, error: chrtId.error };

  const fromWarehouse = readString(record, "fromWarehouse", {
    required: true,
    max: 255,
  });
  if (!fromWarehouse.ok) return { ok: false, error: fromWarehouse.error };

  const fromOfficeId = readPositiveInt(record, "fromOfficeId");
  if (!fromOfficeId.ok) return { ok: false, error: fromOfficeId.error };

  const fromRegionName = readString(record, "fromRegionName", {
    fallback: "Ручной ввод",
    max: 255,
  });
  if (!fromRegionName.ok) return { ok: false, error: fromRegionName.error };

  const toWarehouse = readString(record, "toWarehouse", {
    required: true,
    max: 255,
  });
  if (!toWarehouse.ok) return { ok: false, error: toWarehouse.error };

  const toOfficeId = readPositiveInt(record, "toOfficeId");
  if (!toOfficeId.ok) return { ok: false, error: toOfficeId.error };

  const toRegionName = readString(record, "toRegionName", {
    fallback: "Ручной ввод",
    max: 255,
  });
  if (!toRegionName.ok) return { ok: false, error: toRegionName.error };

  const fromKey = normalizeManualRedistributionWarehouseName(fromWarehouse.value ?? "");
  const toKey = normalizeManualRedistributionWarehouseName(toWarehouse.value ?? "");
  if (fromKey && toKey && fromKey === toKey) {
    return { ok: false, error: "fromWarehouse and toWarehouse must differ" };
  }

  return {
    ok: true,
    input: {
      nmId: nmId.value!,
      vendorCode: vendorCode.value,
      brand: brand.value,
      sizeName: sizeName.value ?? "Без размера",
      chrtId: chrtId.value,
      fromWarehouse: fromWarehouse.value!,
      fromOfficeId: fromOfficeId.value,
      fromRegionName: fromRegionName.value ?? "Ручной ввод",
      toWarehouse: toWarehouse.value!,
      toOfficeId: toOfficeId.value,
      toRegionName: toRegionName.value ?? "Ручной ввод",
      transferUnits: transferUnits.value!,
    },
  };
}

export function buildManualRedistributionApplicationComment(input: ManualRedistributionRequestInput) {
  return `Ручная заявка: переместить ${input.transferUnits} шт размера ${input.sizeName} с ${input.fromWarehouse} на ${input.toWarehouse}`;
}
