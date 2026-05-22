export type AdvertisingPriority = 'high' | 'medium' | 'low';
export type ClusterRiskLevel = 'high' | 'medium' | 'low' | 'none';
export type AdvertisingProductCheckStatus = 'ok' | 'watch' | 'fix';
export type AdvertisingProductReasonCode =
  | 'stock'
  | 'card_content'
  | 'seo'
  | 'price'
  | 'competitor'
  | 'semantic'
  | 'bid_economics'
  | 'traffic_quality'
  | 'group_attribution';

export type AdvertisingTabKey =
  | 'summary'
  | 'terminal'
  | 'products'
  | 'bids'
  | 'balance'
  | 'history'
  | 'settings';

export type AdvertisingActionItem = {
  id: string;
  priority: AdvertisingPriority;
  title: string;
  details: string;
  metric: string;
  reasonCode: AdvertisingProductReasonCode | null;
  reasonLabel: string | null;
  nmId: number | null;
  vendorCode: string | null;
  brand: string | null;
  attributionScope: 'sku' | 'group';
  groupId: string | null;
  groupName: string | null;
  groupNmCount: number;
};

export type AdvertisingDailyPoint = {
  day: string;
  adSpend: number;
  revenue: number;
  netProfit: number;
  netProfitBeforeAds: number;
  views: number;
  clicks: number;
  orders: number;
  activeSkuCount: number;
  acosPct: number | null;
  profitMarginPct: number | null;
  cpc: number | null;
  ctrPct: number | null;
};

export type AdvertisingSkuRow = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  attributionScope: 'sku' | 'group';
  groupId: string | null;
  groupName: string | null;
  groupNmCount: number;
  advertisedNmCount: number;
  adSpend: number;
  spendSharePct: number;
  views: number;
  clicks: number;
  clusterOrders: number;
  ctrPct: number | null;
  cpc: number | null;
  revenue: number;
  salesCount: number;
  netProfit: number;
  netProfitBeforeAds: number;
  profitMarginPct: number | null;
  adSpendToProfitBeforeAdsPct: number | null;
  acosPct: number | null;
  roas: number | null;
  productSignals: {
    stockQty: number | null;
    sellerPrice: number | null;
    customerPrice: number | null;
    photosCount: number | null;
    hasVideo: boolean | null;
    characteristicsCount: number | null;
    avgSearchPosition: number | null;
    searchKeywordCount: number;
    competitorAvgPrice: number | null;
    competitorCount: number;
  };
  productCheck: {
    status: AdvertisingProductCheckStatus;
    reasons: string[];
    reasonCodes: AdvertisingProductReasonCode[];
    checks: Array<{
      code: AdvertisingProductReasonCode;
      label: string;
      status: AdvertisingProductCheckStatus;
      message: string;
    }>;
    checklist: string[];
  };
};

export type AdvertisingClusterRow = {
  cluster: string;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  ctrPct: number | null;
  cpc: number | null;
  skuCount: number;
};

export type AdvertisingPlacementRow = {
  placement: string;
  amount: number;
  sharePct: number;
};

export type AdvertisingOverviewResponse = {
  generatedAt: string;
  dateWindowDays: number;
  hasData: boolean;
  summary: {
    adSpendEffective: number;
    adSpendCostsRaw: number;
    adSpendClustersRaw: number;
    adSpendUnknownPlacement: number;
    revenue: number;
    netProfit: number;
    netProfitBeforeAds: number;
    views: number;
    clicks: number;
    clusterOrders: number;
    activeSkuCount: number;
    riskySkuCount: number;
    acosPct: number | null;
    profitMarginPct: number | null;
    adSpendToProfitBeforeAdsPct: number | null;
    roas: number | null;
    ctrPct: number | null;
    cpc: number | null;
    cpo: number | null;
  };
  daily: AdvertisingDailyPoint[];
  topSku: AdvertisingSkuRow[];
  topClusters: AdvertisingClusterRow[];
  placements: AdvertisingPlacementRow[];
  actionItems: AdvertisingActionItem[];
};

export type AdvertisingProductListRow = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  title: string | null;
  attributionScope: 'sku' | 'group';
  groupId: string | null;
  groupName: string | null;
  groupNmCount: number;
  advertisedNmCount: number;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  revenue: number;
  acosPct: number | null;
  roas: number | null;
  ctrPct: number | null;
  cpc: number | null;
  risk: 'good' | 'warning' | 'danger';
  reason: string;
};

export type AdvertisingProductsResponse = {
  generatedAt: string;
  hasData: boolean;
  total: number;
  rows: AdvertisingProductListRow[];
};

export type AdvertisingClusterListRow = {
  nmId: number;
  cluster: string;
  vendorCode: string | null;
  brand: string | null;
  adSpend: number;
  views: number;
  clicks: number;
  orders: number;
  activeDays: number;
  revenue: number;
  ctrPct: number | null;
  cpc: number | null;
  orderRatePct: number | null;
  acosProxyPct: number | null;
  riskLevel: ClusterRiskLevel;
  riskReason: string | null;
};

export type AdvertisingClusterListResponse = {
  generatedAt: string;
  hasData: boolean;
  total: number;
  summary: {
    adSpend: number;
    clicks: number;
    orders: number;
    revenue: number;
    highRiskClusters: number;
  };
  rows: AdvertisingClusterListRow[];
};

export type AdvertisingClusterCampaignState = {
  advertId: number;
  status: number | null;
  paymentType: 'cpm' | 'cpc' | null;
  searchPlacement: boolean;
  recommendationPlacement: boolean;
  actionable: boolean;
  isExcluded: boolean;
  minusPhrasesCount: number;
  currentBid: number | null;
};

export type AdvertisingClusterActionLog = {
  id: string;
  createdAt: string;
  action: 'exclude' | 'include';
  status: 'success' | 'failed';
  advertId: number;
  beforeMinusCount: number;
  afterMinusCount: number;
  errorMessage: string | null;
};

export type AdvertisingClusterControlResponse = {
  generatedAt: string;
  nmId: number;
  cluster: string;
  campaigns: AdvertisingClusterCampaignState[];
  recommendation: {
    advertId: number;
    baseCompetitiveBidRub: number | null;
    baseLeadersBidRub: number | null;
    baseTop2BidRub: number | null;
    clusterReachMinRub: number | null;
    clusterReachMediumRub: number | null;
    clusterReachMaxRub: number | null;
    clusterReachMaxMinRub: number | null;
  } | null;
  recentActions: AdvertisingClusterActionLog[];
};

export type AdvertisingClusterToggleResponse = {
  ok: true;
  changed: boolean;
  mode: 'exclude' | 'include';
  advertId: number;
  nmId: number;
  cluster: string;
  minusPhrasesCount: number;
};

export type ActionMessage = { tone: 'success' | 'error'; text: string } | null;
export type SelectedCluster = { nmId: number; cluster: string } | null;
