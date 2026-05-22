export type AdvertisingPaymentType = 'cpc' | 'cpm' | 'unknown';
export type AdvertisingBidType = 'manual' | 'unified' | 'unknown';
export type AdvertisingBidControlSurface =
  | 'api_campaign_card'
  | 'api_search_cluster'
  | 'lk_assisted'
  | 'analytics_only';

export type AdvertisingCapabilityStatus = 'supported' | 'fallback' | 'analytics';

export type AdvertisingCapabilityItem = {
  id: string;
  label: string;
  status: AdvertisingCapabilityStatus;
  controlSurface: AdvertisingBidControlSurface;
  controlLabel: string;
  summary: string;
  operatorNote: string;
};

export type ResolveAdvertisingBidCapabilityInput = {
  paymentType?: string | null;
  bidType?: string | null;
  hasCurrentBid?: boolean;
  prefersClusterBid?: boolean;
};

const CPC_CAPABILITY: AdvertisingCapabilityItem = {
    id: 'cpc',
    label: 'CPC / за клики',
    status: 'supported',
    controlSurface: 'api_campaign_card',
    controlLabel: 'API: ставка карточки',
    summary: 'Меняем ставку поиска или рекомендаций через WB Promotion API.',
    operatorNote: 'Если WB не вернул текущую ставку карточки, уходим в ручную/LK-проверку, а не меняем вслепую.',
};

const CPM_MANUAL_CAPABILITY: AdvertisingCapabilityItem = {
    id: 'cpm_manual',
    label: 'CPM manual',
    status: 'supported',
    controlSurface: 'api_search_cluster',
    controlLabel: 'API: ставка кластера',
    summary: 'Меняем ставки поисковых кластеров и проверяем read-after-write.',
    operatorNote: 'Подходит для кластерного автопилота, dayparting и post-action отката.',
};

const CPM_UNIFIED_CAPABILITY: AdvertisingCapabilityItem = {
    id: 'cpm_unified',
    label: 'CPM / auto / unified',
    status: 'fallback',
    controlSurface: 'lk_assisted',
    controlLabel: 'API если есть ставка, иначе ЛК',
    summary: 'Анализируем экономику, а изменение ставки делаем только когда WB отдаёт управляемую поверхность.',
    operatorNote: 'Автодействие без подтверждённой текущей ставки запрещено guardrails.',
};

export const ADVERTISING_CAPABILITIES: AdvertisingCapabilityItem[] = [
  CPC_CAPABILITY,
  CPM_MANUAL_CAPABILITY,
  CPM_UNIFIED_CAPABILITY,
  {
    id: 'search_stats',
    label: 'Поисковые кластеры',
    status: 'supported',
    controlSurface: 'api_search_cluster',
    controlLabel: 'API: статистика и кластеры',
    summary: 'Считаем ДРР/CPC/заказы по кластерам, включая CPC-статистику, когда WB её отдаёт.',
    operatorNote: 'Плохие кластеры идут в рекомендации, хорошие — в рост ставки или расписание.',
  },
];

function normalizePaymentType(value: string | null | undefined): AdvertisingPaymentType {
  return value === 'cpc' || value === 'cpm' ? value : 'unknown';
}

function normalizeBidType(value: string | null | undefined): AdvertisingBidType {
  return value === 'manual' || value === 'unified' ? value : 'unknown';
}

export function resolveAdvertisingBidCapability(
  input: ResolveAdvertisingBidCapabilityInput,
): AdvertisingCapabilityItem {
  const paymentType = normalizePaymentType(input.paymentType);
  const bidType = normalizeBidType(input.bidType);

  if (paymentType === 'cpc') {
    return input.hasCurrentBid === false
      ? {
          ...CPC_CAPABILITY,
          status: 'fallback',
          controlSurface: 'lk_assisted',
          controlLabel: 'ЛК fallback',
        }
      : CPC_CAPABILITY;
  }

  if (paymentType === 'cpm' && bidType === 'manual' && input.prefersClusterBid !== false) {
    return CPM_MANUAL_CAPABILITY;
  }

  if (paymentType === 'cpm') {
    return CPM_UNIFIED_CAPABILITY;
  }

  return {
    id: 'unknown',
    label: 'Тип рекламы не определён',
    status: 'analytics',
    controlSurface: 'analytics_only',
    controlLabel: 'Только анализ',
    summary: 'WB не вернул тип оплаты или тип ставки.',
    operatorNote: 'Показываем аналитику и не применяем изменение, пока не определим управляемую поверхность.',
  };
}

export function capabilityUnsupportedReason(input: ResolveAdvertisingBidCapabilityInput) {
  const capability = resolveAdvertisingBidCapability(input);
  if (capability.controlSurface === 'api_campaign_card' || capability.controlSurface === 'api_search_cluster') {
    return null;
  }
  return `${capability.summary} ${capability.operatorNote}`;
}
