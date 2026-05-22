const WB_SELLER_DEFAULT_ORIGIN = 'https://seller.wildberries.ru';

const WB_REDISTRIBUTION_PATH_CANDIDATES = [
  '/analytics-reports/warehouse-remains',
  '/analytics-reports/warehouse-remains/',
  '/analytics-reports/warehouse-remains?from=button',
  '/supplies-management/warehouses-limits',
  '/supplies-management/warehouses-restrictions',
  '/supplies-management/supplies-plan',
  '/supplies-management',
  '/supply-plan-upload/upload',
] as const;

function normalizeConfiguredRedistributionUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).toString();
    }

    const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return new URL(path, WB_SELLER_DEFAULT_ORIGIN).toString();
  } catch {
    return null;
  }
}

export function buildWbRedistributionUrlCandidates(configuredUrl: string): string[] {
  const normalizedConfigured = normalizeConfiguredRedistributionUrl(configuredUrl);
  const origin = normalizedConfigured
    ? new URL(normalizedConfigured).origin
    : WB_SELLER_DEFAULT_ORIGIN;

  const result = new Set<string>();
  if (normalizedConfigured) {
    result.add(normalizedConfigured);
  }

  for (const path of WB_REDISTRIBUTION_PATH_CANDIDATES) {
    result.add(new URL(path, origin).toString());
  }

  return Array.from(result);
}
