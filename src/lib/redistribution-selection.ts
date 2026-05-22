export type RedistributionRecommendationSelectionLike = {
  nmId: number;
  chrtId: number | null;
  sizeName: string;
  fromOfficeId: number | null;
  fromWarehouse: string;
  toOfficeId: number | null;
  toWarehouse: string;
  transferUnits: number;
};

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function normalizeNullableNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "na";
  }
  if (!Number.isFinite(value)) {
    return "na";
  }
  return String(value);
}

export function buildRedistributionRecommendationSelectionKey(
  item: RedistributionRecommendationSelectionLike,
) {
  return [
    String(item.nmId),
    normalizeNullableNumber(item.chrtId),
    normalizeText(item.sizeName),
    normalizeNullableNumber(item.fromOfficeId),
    normalizeText(item.fromWarehouse),
    normalizeNullableNumber(item.toOfficeId),
    normalizeText(item.toWarehouse),
    String(item.transferUnits),
  ].join("::");
}
