export const TENANT_FEATURES = [
  'overview',
  'signals',
  'salesPlan',
  'costs',
  'economics',
  'finance',
  'aosn',
  'advertising',
  'seo',
  'stocks',
  'dynamics',
  'explorer',
  'redistribution',
  'supply',
  'reviews',
  'approvals',
  'settings',
  'team',
] as const;

export type TenantFeature = (typeof TENANT_FEATURES)[number];
export type TenantFeaturePermissions = Record<TenantFeature, boolean>;
export type TenantAccessPreset =
  | 'all'
  | 'analyst'
  | 'advertising_manager'
  | 'supply_manager'
  | 'finance_manager'
  | 'support_manager'
  | 'viewer'
  | 'custom';

export const TENANT_FEATURE_LABELS: Record<TenantFeature, string> = {
  overview: 'Дашборд',
  signals: 'Что сделать',
  salesPlan: 'План продаж',
  costs: 'Себестоимость',
  economics: 'Юнит-экономика',
  finance: 'Финансы',
  aosn: 'АУСН',
  advertising: 'Реклама',
  seo: 'SEO',
  stocks: 'Остатки',
  dynamics: 'Динамика',
  explorer: 'Проводник',
  redistribution: 'Перераспределение',
  supply: 'Поставка',
  reviews: 'Отзывы',
  approvals: 'Согласования',
  settings: 'Настройки',
  team: 'Команда',
};

export const EMPTY_TENANT_FEATURE_PERMISSIONS = Object.fromEntries(
  TENANT_FEATURES.map((feature) => [feature, false]),
) as TenantFeaturePermissions;

export const ALL_TENANT_FEATURE_PERMISSIONS = Object.fromEntries(
  TENANT_FEATURES.map((feature) => [feature, true]),
) as TenantFeaturePermissions;

export const TENANT_ACCESS_PRESETS: Record<TenantAccessPreset, {
  label: string;
  description: string;
  permissions: TenantFeaturePermissions;
}> = {
  all: {
    label: 'Полный доступ',
    description: 'Владелец или администратор: все разделы, настройки и команда.',
    permissions: ALL_TENANT_FEATURE_PERMISSIONS,
  },
  analyst: {
    label: 'Аналитик',
    description: 'Основная аналитика без настроек, ключей и управления командой.',
    permissions: {
      ...EMPTY_TENANT_FEATURE_PERMISSIONS,
      overview: true,
      signals: true,
      salesPlan: true,
      costs: true,
      economics: true,
      finance: true,
      aosn: true,
      seo: true,
      stocks: true,
      dynamics: true,
      explorer: true,
      approvals: true,
    },
  },
  advertising_manager: {
    label: 'Менеджер рекламы',
    description: 'Рекламный контур и дашборд, без финансовых и складских разделов.',
    permissions: {
      ...EMPTY_TENANT_FEATURE_PERMISSIONS,
      overview: true,
      signals: true,
      advertising: true,
      seo: true,
      approvals: true,
    },
  },
  supply_manager: {
    label: 'Закупки и склад',
    description: 'Остатки, план продаж и перераспределение.',
    permissions: {
      ...EMPTY_TENANT_FEATURE_PERMISSIONS,
      overview: true,
      salesPlan: true,
      stocks: true,
      redistribution: true,
      supply: true,
    },
  },
  finance_manager: {
    label: 'Финансы',
    description: 'Финансы, налоги, себестоимость и экономика.',
    permissions: {
      ...EMPTY_TENANT_FEATURE_PERMISSIONS,
      overview: true,
      costs: true,
      economics: true,
      finance: true,
      aosn: true,
    },
  },
  support_manager: {
    label: 'Отзывы и поддержка',
    description: 'Отзывы, вопросы и рабочие сигналы по клиентскому контуру.',
    permissions: {
      ...EMPTY_TENANT_FEATURE_PERMISSIONS,
      overview: true,
      signals: true,
      reviews: true,
    },
  },
  viewer: {
    label: 'Наблюдатель',
    description: 'Только общий дашборд без операционных разделов.',
    permissions: {
      ...EMPTY_TENANT_FEATURE_PERMISSIONS,
      overview: true,
    },
  },
  custom: {
    label: 'Индивидуально',
    description: 'Ручной набор функций под конкретного сотрудника.',
    permissions: EMPTY_TENANT_FEATURE_PERMISSIONS,
  },
};

export function resolveTenantFeaturePermissions(
  role: string | null | undefined,
  stored: Partial<TenantFeaturePermissions> | null | undefined,
): TenantFeaturePermissions {
  if (role === 'owner' || role === 'admin') {
    return ALL_TENANT_FEATURE_PERMISSIONS;
  }

  const base = role === 'viewer'
    ? TENANT_ACCESS_PRESETS.viewer.permissions
    : EMPTY_TENANT_FEATURE_PERMISSIONS;

  return {
    ...base,
    ...Object.fromEntries(
      TENANT_FEATURES.map((feature) => [feature, Boolean(stored?.[feature])]),
    ),
  } as TenantFeaturePermissions;
}

export function permissionsForPreset(preset: TenantAccessPreset): TenantFeaturePermissions {
  return TENANT_ACCESS_PRESETS[preset]?.permissions ?? TENANT_ACCESS_PRESETS.viewer.permissions;
}

export function userCanAccessFeature(
  role: string | null | undefined,
  permissions: Partial<TenantFeaturePermissions> | null | undefined,
  feature: TenantFeature,
) {
  if (role === 'owner' || role === 'admin') {
    return true;
  }

  return Boolean(resolveTenantFeaturePermissions(role, permissions)[feature]);
}
