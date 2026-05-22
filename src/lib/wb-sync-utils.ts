import type { WbPaidStorageItem, WbStockOfficeMetricItem, WbStockSizeMetricItem } from "@/lib/wb-api";

const normalizeWarehouseName = (warehouseName?: string | null) => {
  const trimmed = warehouseName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Unknown";
};

const normalizeStorageDate = (date: string) => {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toISOString();
};

export const dedupePaidStorageItems = (items: WbPaidStorageItem[]) => {
  const deduped = new Map<string, WbPaidStorageItem>();

  for (const item of items) {
    const warehouseName = normalizeWarehouseName(item.warehouseName);
    const normalizedDate = normalizeStorageDate(item.date);
    const key = `${item.nmId}:${warehouseName}:${normalizedDate}`;
    const existing = deduped.get(key);
    if (existing) {
      deduped.set(key, {
        ...existing,
        storageAmount: (existing.storageAmount || 0) + (item.storageAmount || 0),
      });
      continue;
    }

    deduped.set(key, {
      ...item,
      warehouseName,
      date: normalizedDate,
      storageAmount: item.storageAmount || 0,
    });
  }

  return Array.from(deduped.values());
};

const normalizeText = (value?: string | null, fallback = "Unknown") => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const stockSizePriorityScore = (item: WbStockSizeMetricItem) => (
  (item.stockCount || 0)
  + (item.toClientCount || 0)
  + (item.fromClientCount || 0)
  + (item.ordersCount || 0)
  + (item.buyoutCount || 0)
  + (item.lostOrdersCount || 0)
);

export const dedupeStockSizeMetricItems = (items: WbStockSizeMetricItem[]) => {
  const deduped = new Map<string, WbStockSizeMetricItem>();

  for (const raw of items) {
    const item: WbStockSizeMetricItem = {
      ...raw,
      stockType: raw.stockType || "wb",
      sizeName: normalizeText(raw.sizeName, "Без размера"),
      regionName: normalizeText(raw.regionName),
      officeName: normalizeText(raw.officeName),
      officeId: raw.officeId ?? null,
      chrtId: raw.chrtId ?? null,
    };

    const key = [
      item.nmId,
      item.stockType,
      item.sizeName,
      item.chrtId ?? "__NULL__",
      item.regionName,
      item.officeId ?? "__NULL__",
      item.officeName,
    ].join(":");

    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }

    if (stockSizePriorityScore(item) >= stockSizePriorityScore(existing)) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values());
};

const stockOfficePriorityScore = (item: WbStockOfficeMetricItem) => (
  (item.stockCount || 0)
  + (item.toClientCount || 0)
  + (item.fromClientCount || 0)
  + (item.ordersCount || 0)
  + (item.buyoutCount || 0)
  + (item.lostOrdersCount || 0)
);

export const dedupeStockOfficeMetricItems = (items: WbStockOfficeMetricItem[]) => {
  const deduped = new Map<string, WbStockOfficeMetricItem>();

  for (const raw of items) {
    const item: WbStockOfficeMetricItem = {
      ...raw,
      stockType: raw.stockType || "wb",
      regionName: normalizeText(raw.regionName),
      officeName: normalizeText(raw.officeName),
      officeId: raw.officeId ?? null,
    };

    const key = [
      item.stockType,
      item.regionName,
      item.officeId ?? "__NULL__",
      item.officeName,
    ].join(":");

    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }

    if (stockOfficePriorityScore(item) >= stockOfficePriorityScore(existing)) {
      deduped.set(key, item);
    }
  }

  return Array.from(deduped.values());
};
