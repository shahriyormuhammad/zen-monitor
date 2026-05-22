import {
  ensureWbApiResponseOk,
  WbApiError,
  fetchWithExponentialBackoff,
} from './client';
import { logger } from '@/lib/logger';
import Papa from 'papaparse';
import { strFromU8, unzipSync } from 'fflate';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  WbFinanceDetailedSalesReportResponseSchema,
  WbRealizationReportResponseSchema,
  WbOrderResponseSchema,
  WbAdSpendItem,
  WbFunnelItem,
  WbFinanceDetailedSalesReportItem,
  WbRealizationReportItem,
  WbOrderItem,
} from '@/types/wb';

const execFileAsync = promisify(execFile);

const BASE_URL_V1 = 'https://statistics-api.wildberries.ru/api/v1';
const FINANCE_DETAILED_SALES_REPORT_URL = 'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed';
const DOCUMENTS_API_URL = 'https://documents-api.wildberries.ru/api/v1/documents';
const AD_PROMOTION_COUNT_URL = 'https://advert-api.wildberries.ru/adv/v1/promotion/count';
const AD_CAMPAIGN_DETAILS_URL = 'https://advert-api.wildberries.ru/api/advert/v2/adverts';
const AD_CAMPAIGN_BIDS_URL = 'https://advert-api.wildberries.ru/api/advert/v1/bids';
const AD_CAMPAIGN_MIN_BIDS_URL = 'https://advert-api.wildberries.ru/api/advert/v1/bids/min';
const AD_FULL_STATS_URL = 'https://advert-api.wildberries.ru/adv/v3/fullstats';
const AD_SEARCH_CLUSTER_STATS_URL = 'https://advert-api.wildberries.ru/adv/v1/normquery/stats';
const AD_SEARCH_CLUSTER_BIDS_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/get-bids';
const AD_SEARCH_CLUSTER_BIDS_SET_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/bids';
const AD_SEARCH_CLUSTER_MINUS_GET_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/get-minus';
const AD_SEARCH_CLUSTER_MINUS_SET_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/set-minus';
const AD_SEARCH_CLUSTER_LIST_URL = 'https://advert-api.wildberries.ru/adv/v0/normquery/list';
const AD_BIDS_RECOMMENDATIONS_URL = 'https://advert-api.wildberries.ru/api/advert/v0/bids/recommendations';
const FUNNEL_PRODUCTS_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products';
const STOCKS_WB_WAREHOUSES_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses';
const STOCKS_PRODUCTS_URL = 'https://seller-analytics-api.wildberries.ru/api/v2/stocks-report/products/products';
const STOCKS_OFFICES_URL = 'https://seller-analytics-api.wildberries.ru/api/v2/stocks-report/offices';
const STOCKS_SIZES_URL = 'https://seller-analytics-api.wildberries.ru/api/v2/stocks-report/products/sizes';
const WAREHOUSE_MEASUREMENTS_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/warehouse-measurements';
const MEASUREMENT_PENALTIES_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/measurement-penalties';
const NM_REPORT_DOWNLOADS_URL = 'https://seller-analytics-api.wildberries.ru/api/v2/nm-report/downloads';
const NM_REPORT_DOWNLOAD_FILE_URL = 'https://seller-analytics-api.wildberries.ru/api/v2/nm-report/downloads/file';
const PAID_STORAGE_REPORT_URL = 'https://seller-analytics-api.wildberries.ru/api/v1/paid_storage';
const REGION_SALE_URL = 'https://seller-analytics-api.wildberries.ru/api/v1/analytics/region-sale';
const WAREHOUSE_REMAINS_BASE_URL = 'https://seller-analytics-api.wildberries.ru/api/v1/warehouse_remains';
const FBW_SUPPLIES_BASE_URL = 'https://supplies-api.wildberries.ru/api/v1/supplies';
const CONTENT_CARDS_LIST_URL = 'https://content-api.wildberries.ru/content/v2/get/cards/list';
const CONTENT_CARDS_UPDATE_URL = 'https://content-api.wildberries.ru/content/v2/cards/update';
const BOX_TARIFFS_URL = 'https://common-api.wildberries.ru/api/v1/tariffs/box';
const RETURN_TARIFFS_URL = 'https://common-api.wildberries.ru/api/v1/tariffs/return';
const AD_CAMPAIGN_DETAILS_BATCH_SIZE = 20;
const AD_SEARCH_STATS_BATCH_SIZE = 100;
const AD_FULL_STATS_SUPPORTED_STATUSES = new Set([7, 9, 11]);
const AD_FULL_STATS_MAX_WINDOW_DAYS = 31;
const AD_FULL_STATS_MIN_INTERVAL_MS = 20_000;
const AD_SEARCH_CLUSTER_MAX_WINDOW_DAYS = 30;
const AD_SEARCH_CLUSTER_STATS_MIN_INTERVAL_MS = process.env.NODE_ENV === 'test' ? 0 : 6_000;
const AD_API_TIMEOUT_MS = 60_000;
const AD_STATUS_ACTIVE = 9;
const AD_STATUS_PAUSED = 11;
const AD_STATUS_VERIFY_ATTEMPTS = process.env.NODE_ENV === 'test' ? 1 : 3;
const AD_STATUS_VERIFY_INTERVAL_MS = process.env.NODE_ENV === 'test' ? 0 : 750;
const AD_API_GLOBAL_MIN_INTERVAL_MS = process.env.NODE_ENV === 'test'
  ? 0
  : Math.max(0, Number.parseInt(process.env.WB_AD_API_MIN_INTERVAL_MS ?? '1100', 10) || 0);
const REPORT_TASK_MAX_ATTEMPTS = 24;
const REPORT_TASK_POLL_INTERVAL_MS = 2_500;
const PAID_STORAGE_MAX_WINDOW_DAYS = 8;
const PAID_STORAGE_DOWNLOAD_MIN_INTERVAL_MS = 60_000;
const PAID_STORAGE_DOWNLOAD_MAX_ATTEMPTS = 3;
const PAID_STORAGE_DOWNLOAD_TIMEOUT_MS = 120_000;
const FUNNEL_PAGE_SIZE = 1000;
const FUNNEL_DAILY_WINDOW_MIN_INTERVAL_MS = 1_500;
const NM_REPORT_POLL_INTERVAL_MS = 5_000;
const NM_REPORT_POLL_MAX_ATTEMPTS = 36;

const isWbApiErrorWithDetails = (error: unknown, status: number, detailNeedle: string) => {
  if (!(error instanceof WbApiError) || error.status !== status) {
    return false;
  }

  const haystack = `${error.message}\n${error.details ?? ''}`.toLowerCase();
  return haystack.includes(detailNeedle.toLowerCase());
};
const STOCKS_PRODUCTS_PAGE_SIZE = 1000;
const STOCKS_REPORT_MIN_INTERVAL_MS = 20_000;
const STOCKS_PRODUCTS_AVAILABILITY_FILTERS = [
  'deficient',
  'actual',
  'balanced',
  'nonActual',
  'nonLiquid',
  'invalidData',
] as const;

export interface WbAdCampaign {
  advertId: number;
  type?: number;
  status?: number;
  bidType?: 'manual' | 'unified';
  paymentType?: 'cpm' | 'cpc';
  searchPlacement: boolean;
  recommendationPlacement: boolean;
  nmIds: number[];
  nmSettings: Array<{
    nmId: number;
    bidsKopecks: {
      search: number | null;
      recommendations: number | null;
    };
  }>;
  timestamps?: {
    created?: string;
    started?: string;
    deleted?: string;
    updated?: string;
  };
}

export interface WbSearchKeywordStat {
  advertId: number;
  nmId: number;
  date: string;
  keyword: string;
  views?: number;
  clicks?: number;
  ctr?: number;
  sum?: number;
  atbs?: number;
  orders?: number;
  cpc?: number;
  cpm?: number;
  avgPos?: number;
  shks?: number;
}

export interface WbSearchClusterBid {
  advertId: number;
  nmId: number;
  keyword: string;
  bid: number;
}

export type WbCampaignBidPlacement = 'search' | 'recommendations';

export interface WbCampaignMinimumBid {
  nmId: number;
  placement: string;
  value: number;
  currency: string | null;
}

export class WbAdActionVerificationError extends Error {
  failedItems: Array<{
    advertId: number;
    nmId?: number;
    keyword?: string;
    expectedBid?: number;
    actualBid?: number | null;
    expectedStatus?: number;
    actualStatus?: number | null;
  }>;

  constructor(
    message: string,
    failedItems: Array<{
      advertId: number;
      nmId?: number;
      keyword?: string;
      expectedBid?: number;
      actualBid?: number | null;
      expectedStatus?: number;
      actualStatus?: number | null;
    }>,
  ) {
    super(message);
    this.name = 'WbAdActionVerificationError';
    this.failedItems = failedItems;
  }
}

export interface WbCampaignMinusPhraseItem {
  advertId: number;
  nmId: number;
  normQueries: string[];
}

export interface WbNormQueryListItem {
  advertId: number;
  nmId: number;
  active: string[];
  excluded: string[];
}

export interface WbBidsRecommendation {
  advertId: number;
  nmId: number;
  base: {
    competitiveBidKopecks: number | null;
    leadersBidKopecks: number | null;
    top2BidKopecks: number | null;
  };
  normQueries: Array<{
    keyword: string;
    reachMinBidKopecks: number | null;
    reachMediumBidKopecks: number | null;
    reachMaxBidKopecks: number | null;
    reachMaxMinBidKopecks: number | null;
  }>;
}

type WbAdCampaignSummaryResponse = {
  adverts?: Array<{
    type?: number;
    advert_list?: Array<{
      advertId?: number;
    }>;
  }>;
};

type WbAdCampaignDetailsResponse = {
  adverts?: Array<{
    id?: number;
    status?: number;
    bid_type?: 'manual' | 'unified';
    settings?: {
      payment_type?: 'cpm' | 'cpc';
      placements?: {
        search?: boolean;
        recommendations?: boolean;
      };
    };
    timestamps?: {
      created?: string;
      started?: string;
      deleted?: string;
      updated?: string;
    };
    nm_settings?: Array<{
      nm_id?: number;
      bids_kopecks?: {
        search?: number;
        recommendations?: number;
      };
    }>;
  }>;
};

type WbCampaignBidsResponse = {
  bids?: Array<{
    advert_id?: number;
    nm_bids?: Array<{
      nm_id?: number;
      bid_kopecks?: number;
      placement?: string;
    }>;
  }>;
};

type WbCampaignBidUpdate = NonNullable<WbCampaignBidsResponse['bids']>[number];

type WbCampaignMinBidsResponse = {
  bids?: Array<{
    nm_id?: number;
    bids?: Array<{
      currency?: string;
      type?: string;
      value?: number;
    }>;
  }>;
};

type WbSearchClusterStatsResponse = {
  items?: Array<{
    advertId?: number;
    nmId?: number;
    dailyStats?: Array<{
      date?: string;
      stat?: {
        normQuery?: string;
        views?: number;
        clicks?: number;
        ctr?: number;
        spend?: number;
        atbs?: number;
        orders?: number;
        cpc?: number;
        cpm?: number;
        avgPos?: number;
        shks?: number;
      };
    }>;
  }>;
};

type WbSearchClusterBidsResponse = {
  bids?: Array<{
    advert_id?: number;
    nm_id?: number;
    norm_query?: string;
    bid?: number;
  }>;
};

type WbCampaignMinusPhrasesResponse = {
  items?: Array<{
    advert_id?: number;
    nm_id?: number;
    norm_queries?: string[];
  }>;
};

type WbNormQueryListResponse = {
  items?: Array<{
    advertId?: number;
    nmId?: number;
    normQueries?: {
      active?: string[] | null;
      excluded?: string[] | null;
    };
  }>;
};

type WbBidRecommendationsResponse = {
  advertId?: number;
  nmId?: number;
  base?: {
    competitiveBid?: { bidKopecks?: number };
    leadersBid?: { bidKopecks?: number };
    top2?: { bidKopecks?: number };
  };
  normQueries?: Array<{
    normQuery?: string;
    reachMin?: { bidKopecks?: number };
    reachMedium?: { bidKopecks?: number };
    reachMax?: {
      bidKopecks?: number;
      bidKopecksMin?: number;
    };
  }>;
};

type WbFullStatsResponse = Array<{
  advertId?: number;
  days?: Array<{
    date?: string;
    apps?: Array<{
      nms?: Array<{
        nmId?: number;
        sum?: number;
        sum_price?: number;
        orders?: number;
        views?: number;
        clicks?: number;
        ctr?: number;
        cpc?: number;
      }>;
    }>;
  }>;
}>;

type WbFullStatsPayload = WbFullStatsResponse | { items?: WbFullStatsResponse } | null;

type WbFunnelProductsResponse = {
  data?: {
    products?: Array<{
      product?: {
        nmId?: number;
      };
      statistic?: {
        selected?: {
          openCount?: number;
          cartCount?: number;
          orderCount?: number;
          orderSum?: number;
          buyoutCount?: number;
          buyoutSum?: number;
          cancelCount?: number;
          cancelSum?: number;
          avgPrice?: number;
          // Доля локальных заказов от WB API (0..100). Используется для
          // авторасчёта ИРП — см. resolveIrpFromLocalization() в economics/constants.
          localizationPercent?: number;
          conversions?: {
            addToCartPercent?: number;
            cartToOrderPercent?: number;
            buyoutPercent?: number;
          };
        };
      };
    }>;
  };
};

type WbReportTaskCreateResponse = {
  data?: {
    taskId?: string;
  };
};

type WbReportTaskStatusResponse = {
  data?: {
    id?: string;
    status?: string;
  };
};

type WbPaidStorageReportRow = {
  date?: string;
  warehouse?: string;
  warehousePrice?: number;
  nmId?: number;
};

export type WbFbwSupplyDateType = 'createDate' | 'supplyDate' | 'factDate' | 'updatedDate';

type WbFbwSupplyRaw = {
  phone?: unknown;
  supplyID?: unknown;
  preorderID?: unknown;
  createDate?: unknown;
  supplyDate?: unknown;
  factDate?: unknown;
  updatedDate?: unknown;
  statusID?: unknown;
  boxTypeID?: unknown;
  isBoxOnPallet?: unknown;
};

type WbFbwSupplyDetailsRaw = WbFbwSupplyRaw & {
  warehouseID?: unknown;
  warehouseName?: unknown;
  actualWarehouseID?: unknown;
  actualWarehouseName?: unknown;
  transitWarehouseID?: unknown;
  transitWarehouseName?: unknown;
  acceptanceCost?: unknown;
  paidAcceptanceCoefficient?: unknown;
  rejectReason?: unknown;
  supplierAssignName?: unknown;
  storageCoef?: unknown;
  deliveryCoef?: unknown;
  quantity?: unknown;
  readyForSaleQuantity?: unknown;
  acceptedQuantity?: unknown;
  unloadingQuantity?: unknown;
  depersonalizedQuantity?: unknown;
};

type WbFbwSupplyGoodRaw = {
  barcode?: unknown;
  vendorCode?: unknown;
  nmID?: unknown;
  nmId?: unknown;
  needKiz?: unknown;
  tnved?: unknown;
  techSize?: unknown;
  color?: unknown;
  supplierBoxAmount?: unknown;
  quantity?: unknown;
  readyForSaleQuantity?: unknown;
  unloadingQuantity?: unknown;
  acceptedQuantity?: unknown;
};

export type WbFbwSupplyListItem = {
  supplyId: number | null;
  preorderId: number | null;
  createDate: string | null;
  supplyDate: string | null;
  factDate: string | null;
  updatedDate: string | null;
  statusId: number | null;
  boxTypeId: number | null;
  isBoxOnPallet: boolean | null;
};

export type WbFbwSupplyDetails = WbFbwSupplyListItem & {
  warehouseId: number | null;
  warehouseName: string | null;
  actualWarehouseId: number | null;
  actualWarehouseName: string | null;
  transitWarehouseId: number | null;
  transitWarehouseName: string | null;
  acceptanceCost: number | null;
  paidAcceptanceCoefficient: number | null;
  rejectReason: string | null;
  supplierAssignName: string | null;
  quantity: number | null;
  readyForSaleQuantity: number | null;
  acceptedQuantity: number | null;
  unloadingQuantity: number | null;
};

export type WbFbwSupplyGood = {
  barcode: string | null;
  vendorCode: string | null;
  nmId: number | null;
  techSize: string | null;
  color: string | null;
  supplierBoxAmount: number | null;
  quantity: number;
  readyForSaleQuantity: number | null;
  unloadingQuantity: number | null;
  acceptedQuantity: number | null;
};

export type WbFbwSuppliesParams = {
  from: string;
  till: string;
  dateType?: WbFbwSupplyDateType;
  statusIds?: number[];
  limit?: number;
  signal?: AbortSignal;
};

type WbFbwSupplyRequestBody = {
  dates: Array<{
    from: string;
    till: string;
    type: WbFbwSupplyDateType;
  }>;
  statusIDs?: number[];
};

type WbAcceptanceTariffRaw = {
  date?: unknown;
  coefficient?: unknown;
  warehouseID?: unknown;
  warehouseName?: unknown;
  allowUnload?: unknown;
  boxTypeID?: unknown;
  storageCoef?: unknown;
  deliveryCoef?: unknown;
  deliveryBaseLiter?: unknown;
  deliveryAdditionalLiter?: unknown;
  storageBaseLiter?: unknown;
  storageAdditionalLiter?: unknown;
  isSortingCenter?: unknown;
};

type WbCategoryCommissionResponse = {
  report?: Array<{
    subjectID?: unknown;
    subjectName?: unknown;
    parentID?: unknown;
    parentName?: unknown;
    kgvpBooking?: unknown;
    kgvpMarketplace?: unknown;
    kgvpPickup?: unknown;
    kgvpSupplier?: unknown;
    kgvpSupplierExpress?: unknown;
    paidStorageKgvp?: unknown;
  }>;
};

type WbBoxTariffsResponse = {
  response?: {
    data?: {
      warehouseList?: Array<{
        warehouseName?: unknown;
        geoName?: unknown;
        boxDeliveryBase?: unknown;
        boxDeliveryLiter?: unknown;
        boxStorageBase?: unknown;
        boxStorageLiter?: unknown;
        boxDeliveryCoefExpr?: unknown;
        boxStorageCoefExpr?: unknown;
        boxDeliveryMarketplaceBase?: unknown;
        boxDeliveryMarketplaceLiter?: unknown;
        boxDeliveryMarketplaceCoefExpr?: unknown;
      }>;
    };
  };
};

type WbReturnTariffsResponse = {
  response?: {
    data?: {
      warehouseList?: Array<{
        warehouseName?: unknown;
        geoName?: unknown;
        deliveryDumpKgtOfficeBase?: unknown;
        deliveryDumpKgtOfficeLiter?: unknown;
        deliveryDumpKgtReturnExpr?: unknown;
        deliveryDumpSrgOfficeBase?: unknown;
        deliveryDumpSrgOfficeLiter?: unknown;
        deliveryDumpSrgReturnExpr?: unknown;
        deliveryDumpSupOfficeBase?: unknown;
        deliveryDumpSupOfficeLiter?: unknown;
        deliveryDumpSupReturnExpr?: unknown;
      }>;
    };
  };
};

type WbNmReportDownloadItem = {
  id?: string;
  downloadId?: string;
  status?: string;
  error?: string;
};

type WbNmReportDownloadsResponse = {
  data?: WbNmReportDownloadItem[];
};

export interface WbProductCard {
  nmID: number;
  imtID?: number;
  nmUUID?: string;
  subjectID?: number;
  vendorCode?: string;
  kizMarked?: boolean;
  needKiz?: boolean;
  brand?: string;
  subjectName?: string;
  title?: string;
  description?: string;
  wholesale?: unknown;
  dimensions?: unknown;
  photos?: Array<{
    big?: string;
    square?: string;
    tm?: string;
  }>;
  video?: unknown;
  characteristics?: unknown[];
  sizes?: unknown[];
  tags?: unknown[];
  createdAt?: string;
  updatedAt?: string;
}

export interface WbPriceSize {
  sizeID?: number;
  price?: number;
  discountedPrice?: number;
  clubDiscountedPrice?: number;
  techSizeName?: string;
}

export interface WbCardsListCursor {
  updatedAt?: string;
  nmID?: number;
  total?: number;
}

export interface WbCardsListResponse {
  cards?: WbProductCard[];
  cursor?: WbCardsListCursor;
  total?: number;
}

export type WbProductCardUpdatePayload = {
  nmID: number;
  vendorCode: string;
  kizMarked?: boolean;
  wholesale?: unknown;
  brand?: string;
  title?: string;
  description?: string;
  dimensions?: unknown;
  characteristics?: unknown[];
  sizes: unknown[];
};

export type WbContentMutationResponse = {
  data?: unknown;
  error?: boolean;
  errorText?: string;
  additionalErrors?: unknown;
};

export interface WbPriceItem {
  nmID: number;
  price?: number;
  discount?: number;
  spp?: number;
  clubDiscount?: number;
  sizes?: WbPriceSize[];
}

export interface WbPricesResponse {
  data?: {
    listGoods?: WbPriceItem[];
  };
}

export interface WbPublicCardPriceItem {
  nmID: number;
  basicPrice: number;
  customerPrice: number;
}

interface WbPublicCardPriceResponse {
  products?: Array<{
    id?: number;
    sizes?: Array<{
      price?: {
        basic?: number;
        product?: number;
      };
    }>;
  }>;
}

export interface WbStockItem {
  nmId: number;
  warehouseName?: string;
  quantity?: number;
  inWayToClient?: number;
  inWayFromClient?: number;
}

export type WbStockType = '' | 'wb' | 'mp';

export interface WbStockOfficeMetricItem {
  stockType: WbStockType;
  regionName: string;
  officeId: number | null;
  officeName: string;
  ordersCount: number;
  ordersSum: number;
  buyoutCount: number;
  buyoutSum: number;
  stockCount: number;
  stockSum: number;
  toClientCount: number;
  fromClientCount: number;
  lostOrdersCount: number;
  lostOrdersSum: number;
  avgStockTurnoverDays: number | null;
  saleRateDays: number | null;
}

export interface WbStockSizeMetricItem extends WbStockOfficeMetricItem {
  nmId: number;
  sizeName: string;
  chrtId: number | null;
}

type WbStocksWbWarehousesResponse = {
  data?: {
    items?: Array<{
      nmId?: number;
      warehouseName?: string;
      quantity?: number;
      inWayToClient?: number;
      inWayFromClient?: number;
    }>;
  };
};

type WbStocksProductsResponse = {
  data?: {
    items?: Array<{
      nmID?: number;
      metrics?: {
        stockCount?: number;
        toClientCount?: number;
        fromClientCount?: number;
      };
    }>;
  };
};

type WbStocksReportMetricsRaw = {
  ordersCount?: unknown;
  ordersSum?: unknown;
  buyoutCount?: unknown;
  buyoutSum?: unknown;
  stockCount?: unknown;
  stockSum?: unknown;
  toClientCount?: unknown;
  fromClientCount?: unknown;
  lostOrdersCount?: unknown;
  lostOrdersSum?: unknown;
  saleRate?: {
    days?: unknown;
    hours?: unknown;
  };
  avgStockTurnover?: {
    days?: unknown;
    hours?: unknown;
  };
};

type WbStocksReportOfficeRaw = {
  regionName?: unknown;
  officeID?: unknown;
  officeId?: unknown;
  officeName?: unknown;
  metrics?: WbStocksReportMetricsRaw;
};

type WbStocksOfficesResponse = {
  data?: {
    regions?: Array<{
      regionName?: unknown;
      metrics?: WbStocksReportMetricsRaw;
      offices?: WbStocksReportOfficeRaw[];
    }>;
  };
};

type WbStocksSizesResponse = {
  data?: {
    nmID?: unknown;
    offices?: WbStocksReportOfficeRaw[];
    sizes?: Array<{
      name?: unknown;
      chrtID?: unknown;
      metrics?: WbStocksReportMetricsRaw;
      offices?: WbStocksReportOfficeRaw[];
    }>;
  };
};

type WbDimensionsReportResponse = {
  data?: {
    reports?: Array<{
      nmId?: unknown;
      nmID?: unknown;
      subjectName?: unknown;
      dimId?: unknown;
      volume?: unknown;
      width?: unknown;
      length?: unknown;
      height?: unknown;
      volumeSup?: unknown;
      widthSup?: unknown;
      lengthSup?: unknown;
      heightSup?: unknown;
      dt?: unknown;
      dtBonus?: unknown;
      isValid?: unknown;
      isValidDt?: unknown;
      penaltyAmount?: unknown;
      reversalAmount?: unknown;
      prcOver?: unknown;
      photoUrls?: unknown;
    }>;
    total?: unknown;
  };
};

export interface WbPaidStorageItem {
  nmId: number;
  warehouseName?: string | null;
  storageAmount?: number;
  date: string;
}

export interface WbWarehouseMeasurementItem {
  nmId: number;
  subjectName: string | null;
  dimId: number | null;
  volume: number | null;
  width: number | null;
  length: number | null;
  height: number | null;
  photoUrls: string[];
  measuredAt: string | null;
}

export interface WbMeasurementPenaltyItem extends WbWarehouseMeasurementItem {
  volumeSup: number | null;
  widthSup: number | null;
  lengthSup: number | null;
  heightSup: number | null;
  dtBonus: string | null;
  isValid: boolean | null;
  isValidDt: string | null;
  penaltyAmount: number | null;
  reversalAmount: number | null;
  prcOver: number | null;
}

export interface WbAcceptanceTariffItem {
  date: string;
  coefficient: number | null;
  warehouseId: number | null;
  warehouseName: string;
  allowUnload: boolean;
  boxTypeId: number | null;
  storageCoef: number | null;
  deliveryCoef: number | null;
  deliveryBaseLiter: number | null;
  deliveryAdditionalLiter: number | null;
  storageBaseLiter: number | null;
  storageAdditionalLiter: number | null;
  isSortingCenter: boolean;
}

export interface WbBoxTariffItem {
  warehouseName: string;
  geoName: string | null;
  boxDeliveryBase: number;
  boxDeliveryLiter: number;
  boxStorageBase: number;
  boxStorageLiter: number;
  boxDeliveryCoefExpr: number;
  boxStorageCoefExpr: number;
  boxDeliveryMarketplaceBase: number;
  boxDeliveryMarketplaceLiter: number;
  boxDeliveryMarketplaceCoefExpr: number;
}

export interface WbReturnTariffItem {
  warehouseName: string;
  geoName: string | null;
  deliveryDumpKgtOfficeBase: number;
  deliveryDumpKgtOfficeLiter: number;
  deliveryDumpKgtReturnExpr: number;
  deliveryDumpSrgOfficeBase: number;
  deliveryDumpSrgOfficeLiter: number;
  deliveryDumpSrgReturnExpr: number;
  deliveryDumpSupOfficeBase: number;
  deliveryDumpSupOfficeLiter: number;
  deliveryDumpSupReturnExpr: number;
}

export interface WbCategoryCommissionItem {
  subjectId: number | null;
  subjectName: string;
  parentId: number | null;
  parentName: string | null;
  bookingCommission: number | null;
  marketplaceCommission: number | null;
  pickupCommission: number | null;
  supplierCommission: number | null;
  supplierExpressCommission: number | null;
  paidStorageCommission: number | null;
}

export interface WbDailyFunnelWindow {
  periodStart: string;
  periodEnd: string;
  items: WbFunnelItem[];
}

export interface WbSaleItem {
  saleID: string;
  nmId: number;
  date: string;
  forPay?: number;
  warehouseName?: string;
  isStorno?: number;
}

export interface WbDocumentListItem {
  serviceName: string;
  name: string;
  category: string;
  extensions: string[];
  creationTime: string;
  viewed?: boolean;
}

export interface WbDownloadedDocument {
  fileName: string;
  extension: string;
  document: string;
}

type WbDocumentsListResponse = {
  data?: {
    documents?: WbDocumentListItem[];
  };
};

type WbDocumentDownloadResponse = {
  data?: WbDownloadedDocument;
};

type WbDocumentsListParams = {
  beginTime?: string;
  endTime?: string;
  category?: string;
  serviceName?: string;
  limit?: number;
  offset?: number;
  locale?: string;
  sort?: 'date' | 'category';
  order?: 'asc' | 'desc';
};

const getHeaders = (token: string) => ({
  'Authorization': token,
  'Content-Type': 'application/json',
});

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object'
  && value !== null
);

const asNumber = (value: unknown) => (
  typeof value === 'number' && Number.isFinite(value) ? value : undefined
);

const asFiniteNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value
    .replace(/\u00a0/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .trim();

  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const asString = (value: unknown) => (
  typeof value === 'string' && value.length > 0 ? value : undefined
);

const asDateString = (value: unknown) => {
  const text = asString(value);
  return text ? text : null;
};

const asNullableNumber = (value: unknown) => {
  const direct = asNumber(value);
  if (direct !== undefined) return direct;
  const parsed = asFiniteNumber(value);
  return parsed !== undefined ? parsed : null;
};

const normalizeSearchClusterKey = (value: string) => value
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('ru-RU');

const asBoolean = (value: unknown) => (
  typeof value === 'boolean' ? value : undefined
);

const asDayDuration = (
  value: unknown
) => {
  const scalar = asNumber(value);
  if (scalar !== undefined) {
    return scalar;
  }

  if (!isObject(value)) {
    return null;
  }

  const days = asNumber(value.days);
  const hours = asNumber(value.hours);

  if (days === undefined && hours === undefined) {
    return null;
  }

  return (days ?? 0) + ((hours ?? 0) / 24);
};

const normalizeStockReportMetrics = (value: unknown) => {
  const metrics = isObject(value) ? value as WbStocksReportMetricsRaw : undefined;

  return {
    ordersCount: asNumber(metrics?.ordersCount) ?? 0,
    ordersSum: asNumber(metrics?.ordersSum) ?? 0,
    buyoutCount: asNumber(metrics?.buyoutCount) ?? 0,
    buyoutSum: asNumber(metrics?.buyoutSum) ?? 0,
    stockCount: Math.max(0, Math.round(asNumber(metrics?.stockCount) ?? 0)),
    stockSum: asNumber(metrics?.stockSum) ?? 0,
    toClientCount: Math.max(0, Math.round(asNumber(metrics?.toClientCount) ?? 0)),
    fromClientCount: Math.max(0, Math.round(asNumber(metrics?.fromClientCount) ?? 0)),
    lostOrdersCount: asNumber(metrics?.lostOrdersCount) ?? 0,
    lostOrdersSum: asNumber(metrics?.lostOrdersSum) ?? 0,
    avgStockTurnoverDays: asDayDuration(metrics?.avgStockTurnover),
    saleRateDays: asDayDuration(metrics?.saleRate),
  };
};

const parseCsvNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return 0;
  }

  const normalized = value
    .replace(/\u00a0/g, '')
    .replace(/\s+/g, '')
    .replace(',', '.')
    .trim();

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

const chunkArray = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const getAbortError = (signal?: AbortSignal) => {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    return reason;
  }

  return new DOMException('The operation was aborted.', 'AbortError');
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw getAbortError(signal);
  }
};

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) {
    reject(getAbortError(signal));
    return;
  }

  const timeout = setTimeout(() => {
    cleanup();
    resolve();
  }, ms);

  const onAbort = () => {
    clearTimeout(timeout);
    cleanup();
    reject(getAbortError(signal));
  };

  const cleanup = () => {
    signal?.removeEventListener('abort', onAbort);
  };

  signal?.addEventListener('abort', onAbort, { once: true });
});

const waitForMinInterval = async (lastRequestedAt: number, minIntervalMs: number, signal?: AbortSignal) => {
  throwIfAborted(signal);

  if (lastRequestedAt > 0) {
    const elapsed = Date.now() - lastRequestedAt;
    if (elapsed < minIntervalMs) {
      await wait(minIntervalMs - elapsed, signal);
    }
  }

  return Date.now();
};

let lastAdvertApiRequestedAt = 0;
let advertApiThrottleQueue: Promise<void> = Promise.resolve();
let lastSearchClusterStatsRequestedAt = 0;
let searchClusterStatsThrottleQueue: Promise<void> = Promise.resolve();

const waitForAdvertApiThrottle = async (signal?: AbortSignal) => {
  if (AD_API_GLOBAL_MIN_INTERVAL_MS <= 0) {
    return;
  }

  const queued = advertApiThrottleQueue.catch(() => undefined).then(async () => {
    lastAdvertApiRequestedAt = await waitForMinInterval(
      lastAdvertApiRequestedAt,
      AD_API_GLOBAL_MIN_INTERVAL_MS,
      signal,
    );
  });

  advertApiThrottleQueue = queued;
  await queued;
};

const waitForSearchClusterStatsThrottle = async (signal?: AbortSignal) => {
  if (AD_SEARCH_CLUSTER_STATS_MIN_INTERVAL_MS <= 0) {
    return;
  }

  const queued = searchClusterStatsThrottleQueue.catch(() => undefined).then(async () => {
    lastSearchClusterStatsRequestedAt = await waitForMinInterval(
      lastSearchClusterStatsRequestedAt,
      AD_SEARCH_CLUSTER_STATS_MIN_INTERVAL_MS,
      signal,
    );
  });

  searchClusterStatsThrottleQueue = queued;
  await queued;
};

const formatDateOnly = (value: string) => value.split('T')[0]!;

const getDateAtUtcStart = (value: string) => {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const addUtcDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getInclusiveUtcDaySpan = (dateFrom: string, dateTo: string) => {
  const start = getDateAtUtcStart(dateFrom);
  const end = getDateAtUtcStart(dateTo);
  const diff = Math.max(0, end.getTime() - start.getTime());
  return Math.floor(diff / 86_400_000) + 1;
};

const splitDateRangeByMaxDays = (
  dateFrom: string,
  dateTo: string,
  maxWindowDays: number
) => {
  const windows: Array<{ from: string; to: string }> = [];
  const normalizedStart = getDateAtUtcStart(dateFrom);
  const normalizedEnd = getDateAtUtcStart(dateTo);

  let cursor = normalizedStart;

  while (cursor.getTime() <= normalizedEnd.getTime()) {
    const windowEnd = new Date(Math.min(
      addUtcDays(cursor, maxWindowDays - 1).getTime(),
      normalizedEnd.getTime()
    ));

    windows.push({
      from: formatDateOnly(cursor.toISOString()),
      to: formatDateOnly(windowEnd.toISOString()),
    });

    cursor = addUtcDays(windowEnd, 1);
  }

  return windows;
};

const normalizeFullStatsPayload = (payload: WbFullStatsPayload): WbFullStatsResponse => {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && Array.isArray(payload.items)) {
    return payload.items;
  }

  return [];
};

const parseFinanceNumber = (value: unknown) => asFiniteNumber(value) ?? 0;

const parseFinanceInteger = (value: unknown) => {
  const numeric = parseFinanceNumber(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
};

const roundFinanceMoney = (value: number) => Math.round(value * 100) / 100;

const normalizeFinanceReportDate = (value: string | null | undefined, fallback: string) => {
  const raw = value?.trim() || fallback;
  const hasExplicitTimezone = /[tT].*(?:Z|[+-]\d{2}:?\d{2})$/.test(raw);
  if (hasExplicitTimezone) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Moscow',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);
      const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
      const year = getPart('year');
      const month = getPart('month');
      const day = getPart('day');
      if (year && month && day) {
        return `${year}-${month}-${day}`;
      }
    }
  }

  const datePart = raw.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return datePart ?? raw;
};

const addDaysToDateOnly = (dateOnly: string, days: number) => {
  const match = dateOnly.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return dateOnly;
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const isPaidStoragePosting = (item: WbFinanceDetailedSalesReportItem) => (
  parseFinanceNumber(item.paidStorage) !== 0
  && parseFinanceInteger(item.quantity) === 0
  && parseFinanceNumber(item.retailAmount) === 0
  && parseFinanceNumber(item.forPay) === 0
);

const normalizeFinanceSalesReportItem = (
  item: WbFinanceDetailedSalesReportItem
): WbRealizationReportItem => {
  const rawItem = item as unknown as Record<string, unknown>;
  const textField = (...keys: string[]) => {
    for (const key of keys) {
      const value = rawItem[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return '';
  };
  const nullableTextField = (...keys: string[]) => textField(...keys) || null;
  const optionalDateField = (...keys: string[]) => {
    const raw = nullableTextField(...keys);
    if (!raw) return null;
    return normalizeFinanceReportDate(raw, raw);
  };
  const optionalNumberField = (...keys: string[]) => {
    for (const key of keys) {
      const value = rawItem[key];
      const parsed = asFiniteNumber(value);
      if (parsed !== undefined) return parsed;
    }
    return null;
  };
  const optionalBooleanField = (...keys: string[]) => {
    for (const key of keys) {
      const value = rawItem[key];
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number' && Number.isFinite(value)) return value !== 0;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y', 'да'].includes(normalized)) return true;
        if (['false', '0', 'no', 'n', 'нет'].includes(normalized)) return false;
      }
    }
    return null;
  };
  const retailAmount = parseFinanceNumber(item.retailAmount);
  const retailPriceWithDisc = parseFinanceNumber(item.retailPriceWithDisc);
  const explicitSppRub = parseFinanceNumber((item as Record<string, unknown>).sppRub);
  const sppRub = explicitSppRub !== 0 ? explicitSppRub : roundFinanceMoney(retailPriceWithDisc - retailAmount);
  const cashbackDiscount = parseFinanceNumber(item.cashbackDiscount);
  const cashbackAmount = cashbackDiscount !== 0
    ? cashbackDiscount
    : parseFinanceNumber(item.cashbackAmount);
  const normalizedSaleDt = normalizeFinanceReportDate(item.saleDt, item.dateFrom);
  const saleDt = isPaidStoragePosting(item)
    ? addDaysToDateOnly(normalizedSaleDt, 1)
    : normalizedSaleDt;

  return WbRealizationReportResponseSchema.parse([{
    rrd_id: item.rrdId,
    realizationreport_id: item.reportId,
    date_from: item.dateFrom,
    date_to: item.dateTo,
    sale_dt: saleDt,
    srid: textField('srid', 'Srid'),
    nm_id: item.nmId,
    brand_name: item.brandName,
    sa_name: item.vendorCode,
    doc_type_name: item.docTypeName,
    supplier_oper_name: item.sellerOperName,
    bonus_type_name: textField('bonusTypeName', 'bonus_type_name', 'bonusType', 'bonus_type'),
    rebill_logistic_org: textField('rebillLogisticOrg', 'rebill_logistic_org'),
    office_name: nullableTextField('officeName', 'office_name', 'Склад', 'Склад отгрузки'),
    quantity: parseFinanceInteger(item.quantity),
    retail_amount: retailAmount,
    commission_amount: parseFinanceNumber(item.ppvzSalesCommission),
    ppvz_sales_commission: parseFinanceNumber(item.ppvzSalesCommission),
    commission_percent: parseFinanceNumber(item.commissionPercent),
    delivery_rub: parseFinanceNumber(item.deliveryService),
    rebill_logistic_cost: parseFinanceNumber(item.rebillLogisticCost),
    storage_fee_rub: parseFinanceNumber(item.paidStorage),
    storage_fee: parseFinanceNumber(item.paidStorage),
    penalty_rub: parseFinanceNumber(item.penalty),
    penalty: parseFinanceNumber(item.penalty),
    spp_rub: sppRub,
    payment_schedule_rub: parseFinanceNumber(item.paymentSchedule),
    payment_schedule: parseFinanceNumber(item.paymentSchedule),
    ppvz_for_pay: parseFinanceNumber(item.forPay),
    deduction: parseFinanceNumber(item.deduction),
    additional_payment: parseFinanceNumber(item.additionalPayment),
    acquiring_fee: parseFinanceNumber(item.acquiringFee),
    return_amount: parseFinanceNumber(item.returnAmount),
    retail_price_withdisc_rub: retailPriceWithDisc,
    acceptance: parseFinanceNumber(item.paidAcceptance),
    cashback_amount: cashbackAmount,
    ppvz_spp_prc: parseFinanceNumber(item.spp),
    ppvz_kvw_prc_base: parseFinanceNumber(item.kvwBase),
    ppvz_kvw_prc: parseFinanceNumber(item.kvw),
    fixation_start_date: optionalDateField('fixTariffDateFrom', 'fixationStartDate', 'fixation_start_date', 'Дата начала действия фиксации'),
    fixation_end_date: optionalDateField('fixTariffDateTo', 'fixationEndDate', 'fixation_end_date', 'Дата конца действия фиксации'),
    is_paid_delivery_service: optionalBooleanField('isPaidDeliveryService', 'is_paid_delivery_service', 'Признак услуги платной доставки'),
    fixed_warehouse_coefficient: optionalNumberField('dlvPrc', 'fixedWarehouseCoefficient', 'fixed_warehouse_coefficient', 'Фиксированный коэффициент склада по поставке'),
  }])![0]!;
};

const requestJson = async <T>(
  operation: string,
  url: string,
  options: RequestInit,
  emptyValue: T,
  config?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<T> => {
  const response = await fetchWithExponentialBackoff(url, options, {
    operation,
    timeoutMs: config?.timeoutMs,
    signal: config?.signal,
  });

  if (response.status === 204) {
    return emptyValue;
  }

  await ensureWbApiResponseOk(operation, response);
  return await response.json();
};

const requestAdvertJson = async <T>(
  operation: string,
  url: string,
  options: RequestInit,
  emptyValue: T,
  config?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  }
): Promise<T> => {
  await waitForAdvertApiThrottle(config?.signal);
  return requestJson(operation, url, options, emptyValue, config);
};

const requestBuffer = async (
  operation: string,
  url: string,
  options: RequestInit,
  config?: {
    timeoutMs?: number;
    signal?: AbortSignal;
  }
) => {
  const response = await fetchWithExponentialBackoff(url, options, {
    operation,
    timeoutMs: config?.timeoutMs,
    signal: config?.signal,
  });

  await ensureWbApiResponseOk(operation, response);
  return new Uint8Array(await response.arrayBuffer());
};

const WB_PUBLIC_CARD_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const requestPublicCardJsonWithCurl = async <T>(
  url: string,
  referer: string,
): Promise<T> => {
  const { stdout } = await execFileAsync('curl', [
    '-fsSL',
    '--max-time',
    '30',
    '-A',
    WB_PUBLIC_CARD_USER_AGENT,
    '-H',
    'Accept: application/json,text/plain,*/*',
    '-H',
    `Referer: ${referer}`,
    url,
  ], { maxBuffer: 10 * 1024 * 1024 });

  return JSON.parse(stdout) as T;
};

const createDetailedHistoryReportDownload = async (
  token: string,
  dateFrom: string,
  dateTo: string
) => {
  const downloadId = crypto.randomUUID();

  await requestJson(
    'createDetailedHistoryReportDownload',
    NM_REPORT_DOWNLOADS_URL,
    {
      method: 'POST',
      headers: getHeaders(token),
      body: JSON.stringify({
        id: downloadId,
        reportType: 'DETAIL_HISTORY_REPORT',
        params: {
          startDate: formatDateOnly(getDateAtUtcStart(dateFrom).toISOString()),
          endDate: formatDateOnly(getDateAtUtcStart(dateTo).toISOString()),
          timezone: 'Europe/Moscow',
          aggregationLevel: 'day',
          skipDeletedNm: false,
          nmIDs: [],
        },
      }),
    },
    {},
  );

  return downloadId;
};

const waitForDetailedHistoryReportReady = async (
  token: string,
  downloadId: string
) => {
  for (let attempt = 1; attempt <= NM_REPORT_POLL_MAX_ATTEMPTS; attempt += 1) {
    const url = new URL(NM_REPORT_DOWNLOADS_URL);
    url.searchParams.append('filter[downloadIds][]', downloadId);

    const response = await requestJson<WbNmReportDownloadsResponse>(
      'getDetailedHistoryReportStatus',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      { data: [] },
    );

    const report = response.data?.find((item) => item.downloadId === downloadId || item.id === downloadId);
    const status = report?.status?.toUpperCase();

    if (status === 'DONE' || status === 'SUCCESS') {
      return;
    }

    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELED' || status === 'CANCELLED') {
      throw new Error(report?.error || `DETAIL_HISTORY_REPORT failed with status ${status}`);
    }

    await wait(NM_REPORT_POLL_INTERVAL_MS);
  }

  throw new Error('DETAIL_HISTORY_REPORT timed out while waiting for completion');
};

const downloadDetailedHistoryReport = async (
  token: string,
  downloadId: string
) => {
  return await requestBuffer(
    'downloadDetailedHistoryReport',
    `${NM_REPORT_DOWNLOAD_FILE_URL}/${downloadId}`,
    {
      method: 'GET',
      headers: {
        Authorization: token,
      },
    },
    {
      timeoutMs: 120_000,
    }
  );
};

const parseDetailedHistoryReportArchive = (archive: Uint8Array): WbDailyFunnelWindow[] => {
  const files = unzipSync(archive);
  const csvEntry = Object.entries(files).find(([name]) => name.toLowerCase().endsWith('.csv'));

  if (!csvEntry) {
    throw new Error('DETAIL_HISTORY_REPORT archive does not contain a CSV file');
  }

  const csvText = strFromU8(csvEntry[1]);
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    throw new Error(`Failed to parse DETAIL_HISTORY_REPORT CSV: ${parsed.errors[0]?.message ?? 'Unknown CSV error'}`);
  }

  const groupedByDay = new Map<string, WbFunnelItem[]>();

  for (const row of parsed.data) {
    const nmId = parseCsvNumber(row.nmID ?? row.nmId);
    const rawDate = row.dt ?? row.date;

    if (!nmId || !rawDate) {
      continue;
    }

    const day = rawDate.slice(0, 10);
    const items = groupedByDay.get(day) ?? [];

    items.push({
      nmId,
      orderCount: parseCsvNumber(row.ordersCount ?? row.orderCount),
      orderSum: parseCsvNumber(row.ordersSumRub ?? row.orderSumRub ?? row.orderSum),
      buyoutsCount: parseCsvNumber(row.buyoutsCount ?? row.buyoutCount),
      buyoutsSum: parseCsvNumber(row.buyoutsSumRub ?? row.buyoutSumRub ?? row.buyoutSum),
      cancelCount: parseCsvNumber(row.cancelCount),
      cancelSum: parseCsvNumber(row.cancelSumRub ?? row.cancelSum),
      avgPrice: parseCsvNumber(row.avgPrice),
      addToCartCount: parseCsvNumber(row.addToCartCount),
      addToCartPercent: parseCsvNumber(row.addToCartConversion ?? row.addToCartPercent),
      cartToOrderPercent: parseCsvNumber(row.cartToOrderConversion ?? row.cartToOrderPercent),
      orderToBuyoutPercent: parseCsvNumber(row.buyoutPercent ?? row.orderToBuyoutPercent),
      openCardCount: parseCsvNumber(row.openCardCount),
      // Daily report (DETAIL_HISTORY) doesn't expose localizationPercent — only
      // the period-aggregate sales-funnel/products endpoint does. Set 0 here
      // and rely on period-level rows for the UI.
      localizationPercent: 0,
    });

    groupedByDay.set(day, items);
  }

  return [...groupedByDay.entries()]
    .sort(([dayA], [dayB]) => dayA.localeCompare(dayB))
    .map(([day, items]) => ({
      periodStart: `${day}T00:00:00.000Z`,
      periodEnd: `${day}T00:00:00.000Z`,
      items,
    }));
};

const getCampaignTypeById = (summary: WbAdCampaignSummaryResponse) => {
  const mapping = new Map<number, number>();
  const groups = Array.isArray(summary.adverts) ? summary.adverts : [];

  for (const group of groups) {
    const type = asNumber(group.type);
    const advertList = Array.isArray(group.advert_list) ? group.advert_list : [];

    for (const advert of advertList) {
      const advertId = asNumber(advert?.advertId);
      if (advertId === undefined || type === undefined) {
        continue;
      }

      mapping.set(advertId, type);
    }
  }

  return mapping;
};

const mapAdCampaignsFromDetails = (
  details: WbAdCampaignDetailsResponse,
  campaignTypeById?: ReadonlyMap<number, number>,
) => {
  const campaigns: WbAdCampaign[] = [];
  const adverts = Array.isArray(details.adverts) ? details.adverts : [];

  for (const advert of adverts) {
    const advertId = asNumber(advert.id);
    if (advertId === undefined) {
      continue;
    }

    const placements = isObject(advert.settings?.placements)
      ? advert.settings.placements
      : undefined;
    const nmSettings = Array.isArray(advert.nm_settings) ? advert.nm_settings : [];
    const nmIds = Array.from(new Set(
      nmSettings
        .map((item) => asNumber(item?.nm_id))
        .filter((value): value is number => value !== undefined)
    ));

    campaigns.push({
      advertId,
      type: campaignTypeById?.get(advertId),
      status: asNumber(advert.status),
      bidType: advert.bid_type,
      paymentType: advert.settings?.payment_type,
      searchPlacement: placements?.search === true,
      recommendationPlacement: placements?.recommendations === true,
      nmIds,
      nmSettings: nmSettings
        .map((item) => {
          const nmId = asNumber(item?.nm_id);
          if (nmId === undefined) {
            return null;
          }
          return {
            nmId,
            bidsKopecks: {
              search: asNumber(item?.bids_kopecks?.search) ?? null,
              recommendations: asNumber(item?.bids_kopecks?.recommendations) ?? null,
            },
          };
        })
        .filter((item): item is WbAdCampaign['nmSettings'][number] => item !== null),
      timestamps: isObject(advert.timestamps)
        ? {
            created: asString(advert.timestamps.created),
            started: asString(advert.timestamps.started),
            deleted: asString(advert.timestamps.deleted),
            updated: asString(advert.timestamps.updated),
          }
        : undefined,
    });
  }

  return campaigns;
};

const loadAdCampaignsByAdvertIds = async (
  token: string,
  advertIds: number[],
  options?: {
    signal?: AbortSignal;
  },
  campaignTypeById?: ReadonlyMap<number, number>,
): Promise<WbAdCampaign[]> => {
  const normalizedAdvertIds = Array.from(new Set(
    advertIds
      .filter((value): value is number => Number.isFinite(value) && value > 0)
      .map((value) => Math.trunc(value))
  ));

  if (normalizedAdvertIds.length === 0) {
    return [];
  }

  const campaigns: WbAdCampaign[] = [];

  for (const batch of chunkArray(normalizedAdvertIds, AD_CAMPAIGN_DETAILS_BATCH_SIZE)) {
    throwIfAborted(options?.signal);

    const url = new URL(AD_CAMPAIGN_DETAILS_URL);
    url.searchParams.set('ids', batch.join(','));

    const details = await requestAdvertJson<WbAdCampaignDetailsResponse>(
      'getAdCampaignDetails',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      { adverts: [] },
      {
        signal: options?.signal,
        timeoutMs: AD_API_TIMEOUT_MS,
      }
    );

    campaigns.push(...mapAdCampaignsFromDetails(details, campaignTypeById));
  }

  return campaigns;
};

const verifyAdvertStatus = async (
  token: string,
  campaignId: number,
  expectedStatus: number,
  operationLabel: string,
  options?: { signal?: AbortSignal },
) => {
  let actualStatus: number | null = null;

  for (let attempt = 1; attempt <= AD_STATUS_VERIFY_ATTEMPTS; attempt += 1) {
    const [campaign] = await loadAdCampaignsByAdvertIds(token, [campaignId], options);
    actualStatus = campaign?.status ?? null;
    if (actualStatus === expectedStatus) {
      return;
    }
    if (attempt < AD_STATUS_VERIFY_ATTEMPTS && AD_STATUS_VERIFY_INTERVAL_MS > 0) {
      await wait(AD_STATUS_VERIFY_INTERVAL_MS, options?.signal);
    }
  }

  throw new WbAdActionVerificationError(
    `WB API не подтвердил статус кампании после ${operationLabel}`,
    [{
      advertId: campaignId,
      expectedStatus,
      actualStatus,
    }],
  );
};

const createReportTask = async (
  operation: string,
  token: string,
  url: string,
  searchParams: Record<string, string>,
  signal?: AbortSignal
) => {
  const reportUrl = new URL(url);
  for (const [key, value] of Object.entries(searchParams)) {
    reportUrl.searchParams.set(key, value);
  }

  const response = await requestJson<WbReportTaskCreateResponse>(
    operation,
    reportUrl.toString(),
    {
      method: 'GET',
      headers: getHeaders(token),
    },
    { data: {} },
    { signal }
  );

  const taskId = asString(response.data?.taskId);
  if (!taskId) {
    throw new Error(`[WB API] ${operation} did not return a task id`);
  }

  return taskId;
};

const waitForReportTaskReady = async (
  operation: string,
  token: string,
  url: string,
  taskId: string,
  signal?: AbortSignal
) => {
  for (let attempt = 1; attempt <= REPORT_TASK_MAX_ATTEMPTS; attempt += 1) {
    throwIfAborted(signal);

    const response = await requestJson<WbReportTaskStatusResponse>(
      `${operation}Status`,
      `${url}/${taskId}/status`,
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      { data: {} },
      { signal }
    );

    const status = asString(response.data?.status)?.toLowerCase();
    if (status === 'done') {
      return;
    }

    if (status === 'failed') {
      throw new Error(`[WB API] ${operation} task ${taskId} failed`);
    }

    if (attempt === REPORT_TASK_MAX_ATTEMPTS) {
      throw new Error(`[WB API] ${operation} task ${taskId} timed out`);
    }

    await wait(REPORT_TASK_POLL_INTERVAL_MS, signal);
  }
};

const downloadPaidStorageReport = async (
  token: string,
  taskId: string,
  signal?: AbortSignal
) => {
  let attempt = 1;

  while (attempt <= PAID_STORAGE_DOWNLOAD_MAX_ATTEMPTS) {
    throwIfAborted(signal);

    try {
      return await requestJson<WbPaidStorageReportRow[]>(
        'getPaidStorageDownload',
        `${PAID_STORAGE_REPORT_URL}/tasks/${taskId}/download`,
        {
          method: 'GET',
          headers: getHeaders(token),
        },
        [],
        {
          signal,
          timeoutMs: PAID_STORAGE_DOWNLOAD_TIMEOUT_MS,
        }
      );
    } catch (error) {
      if (error instanceof WbApiError && error.status === 429 && attempt < PAID_STORAGE_DOWNLOAD_MAX_ATTEMPTS) {
        await wait(PAID_STORAGE_DOWNLOAD_MIN_INTERVAL_MS, signal);
        attempt += 1;
        continue;
      }

      throw error;
    }
  }

  return [];
};

const DEFAULT_REGION_NAME = 'Маркетплейс';
const DEFAULT_OFFICE_NAME = 'Все склады';

const normalizeRegionName = (value: unknown, fallback = DEFAULT_REGION_NAME) => (
  asString(value)?.trim() || fallback
);

const normalizeOfficeName = (value: unknown, fallback = DEFAULT_OFFICE_NAME) => (
  asString(value)?.trim() || fallback
);

const buildOfficeMetricItem = (
  stockType: WbStockType,
  office: WbStocksReportOfficeRaw | undefined,
  fallbackRegionName: string,
  fallbackOfficeName = DEFAULT_OFFICE_NAME,
  fallbackMetrics?: unknown
): WbStockOfficeMetricItem => {
  const metrics = normalizeStockReportMetrics(office?.metrics ?? fallbackMetrics);
  const officeId = asNumber(office?.officeID) ?? asNumber(office?.officeId) ?? null;

  return {
    stockType,
    regionName: normalizeRegionName(office?.regionName, fallbackRegionName),
    officeId,
    officeName: normalizeOfficeName(office?.officeName, fallbackOfficeName),
    ...metrics,
  };
};

const normalizeFbwSupply = (source: WbFbwSupplyRaw): WbFbwSupplyListItem => ({
  supplyId: asNullableNumber(source.supplyID),
  preorderId: asNullableNumber(source.preorderID),
  createDate: asDateString(source.createDate),
  supplyDate: asDateString(source.supplyDate),
  factDate: asDateString(source.factDate),
  updatedDate: asDateString(source.updatedDate),
  statusId: asNullableNumber(source.statusID),
  boxTypeId: asNullableNumber(source.boxTypeID),
  isBoxOnPallet: asBoolean(source.isBoxOnPallet) ?? null,
});

const normalizeFbwSupplyDetails = (source: WbFbwSupplyDetailsRaw): WbFbwSupplyDetails => ({
  ...normalizeFbwSupply(source),
  warehouseId: asNullableNumber(source.warehouseID),
  warehouseName: asString(source.warehouseName) ?? null,
  actualWarehouseId: asNullableNumber(source.actualWarehouseID),
  actualWarehouseName: asString(source.actualWarehouseName) ?? null,
  transitWarehouseId: asNullableNumber(source.transitWarehouseID),
  transitWarehouseName: asString(source.transitWarehouseName) ?? null,
  acceptanceCost: asNullableNumber(source.acceptanceCost),
  paidAcceptanceCoefficient: asNullableNumber(source.paidAcceptanceCoefficient),
  rejectReason: asString(source.rejectReason) ?? null,
  supplierAssignName: asString(source.supplierAssignName) ?? null,
  quantity: asNullableNumber(source.quantity),
  readyForSaleQuantity: asNullableNumber(source.readyForSaleQuantity),
  acceptedQuantity: asNullableNumber(source.acceptedQuantity),
  unloadingQuantity: asNullableNumber(source.unloadingQuantity),
});

const normalizeFbwSupplyGood = (source: WbFbwSupplyGoodRaw): WbFbwSupplyGood => ({
  barcode: asString(source.barcode) ?? null,
  vendorCode: asString(source.vendorCode) ?? null,
  nmId: asNullableNumber(source.nmID ?? source.nmId),
  techSize: asString(source.techSize) ?? null,
  color: asString(source.color) ?? null,
  supplierBoxAmount: asNullableNumber(source.supplierBoxAmount),
  quantity: asNullableNumber(source.quantity) ?? 0,
  readyForSaleQuantity: asNullableNumber(source.readyForSaleQuantity),
  unloadingQuantity: asNullableNumber(source.unloadingQuantity),
  acceptedQuantity: asNullableNumber(source.acceptedQuantity),
});

const pickFirstArray = <T>(payload: unknown, keys: string[]): T[] => {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (!isObject(payload)) {
    return [];
  }

  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value as T[];
    }
  }

  const nestedData = payload.data;
  if (nestedData && nestedData !== payload) {
    return pickFirstArray<T>(nestedData, keys);
  }

  return [];
};

const pickFirstObject = <T extends object>(payload: unknown): T | null => {
  if (!isObject(payload)) {
    return null;
  }

  if (isObject(payload.data)) {
    return payload.data as T;
  }

  return payload as T;
};

export const wbApi = {
  /**
   * WB FBW Supplies: список поставок за период.
   * POST /api/v1/supplies
   */
  getFbwSupplies: async (
    token: string,
    params: WbFbwSuppliesParams,
  ): Promise<WbFbwSupplyListItem[]> => {
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
    const allSupplies: WbFbwSupplyListItem[] = [];
    let offset = 0;

    while (true) {
      const url = new URL(FBW_SUPPLIES_BASE_URL);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));

      const body: WbFbwSupplyRequestBody = {
        dates: [{
          from: params.from,
          till: params.till,
          type: params.dateType ?? 'createDate',
        }],
      };

      if (params.statusIds && params.statusIds.length > 0) {
        body.statusIDs = params.statusIds;
      }

      const data = await requestJson<unknown>(
        'getFbwSupplies',
        url.toString(),
        {
          method: 'POST',
          headers: getHeaders(token),
          body: JSON.stringify(body),
        },
        [],
        { signal: params.signal },
      );

      const rawSupplies = pickFirstArray<WbFbwSupplyRaw>(data, ['supplies', 'items']);
      allSupplies.push(...rawSupplies.map(normalizeFbwSupply));

      if (rawSupplies.length < limit) {
        break;
      }

      offset += limit;
    }

    return allSupplies;
  },

  /**
   * WB FBW Supplies: параметры одной поставки.
   * GET /api/v1/supplies/{supplyID}
   */
  getFbwSupplyDetails: async (
    token: string,
    supplyId: number,
    options: { isPreorder?: boolean; signal?: AbortSignal } = {},
  ): Promise<WbFbwSupplyDetails | null> => {
    const url = new URL(`${FBW_SUPPLIES_BASE_URL}/${supplyId}`);
    if (options.isPreorder) {
      url.searchParams.set('isPreorderID', 'true');
    }

    const data = await requestJson<unknown>(
      'getFbwSupplyDetails',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      null,
      { signal: options.signal },
    );
    const rawDetails = pickFirstObject<WbFbwSupplyDetailsRaw>(data);

    return rawDetails ? normalizeFbwSupplyDetails(rawDetails) : null;
  },

  /**
   * WB FBW Supplies: товары одной поставки.
   * GET /api/v1/supplies/{supplyID}/goods
   */
  getFbwSupplyGoods: async (
    token: string,
    supplyId: number,
    options: { isPreorder?: boolean; limit?: number; signal?: AbortSignal } = {},
  ): Promise<WbFbwSupplyGood[]> => {
    const limit = Math.min(Math.max(options.limit ?? 1000, 1), 1000);
    const allGoods: WbFbwSupplyGood[] = [];
    let offset = 0;

    while (true) {
      const url = new URL(`${FBW_SUPPLIES_BASE_URL}/${supplyId}/goods`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      if (options.isPreorder) {
        url.searchParams.set('isPreorderID', 'true');
      }

      const data = await requestJson<unknown>(
        'getFbwSupplyGoods',
        url.toString(),
        {
          method: 'GET',
          headers: getHeaders(token),
        },
        [],
        { signal: options.signal },
      );

      const rawGoods = pickFirstArray<WbFbwSupplyGoodRaw>(data, ['goods', 'items']);
      allGoods.push(...rawGoods.map(normalizeFbwSupplyGood));

      if (rawGoods.length < limit) {
        break;
      }

      offset += limit;
    }

    return allGoods;
  },

  /**
   * Документы WB: список документов продавца.
   * GET /api/v1/documents/list
   */
  getDocumentsList: async (
    token: string,
    params: WbDocumentsListParams = {}
  ): Promise<WbDocumentListItem[]> => {
    const url = new URL(`${DOCUMENTS_API_URL}/list`);
    url.searchParams.set('locale', params.locale ?? 'ru');
    url.searchParams.set('limit', String(Math.min(Math.max(params.limit ?? 50, 1), 50)));
    url.searchParams.set('offset', String(Math.max(params.offset ?? 0, 0)));
    url.searchParams.set('sort', params.sort ?? 'date');
    url.searchParams.set('order', params.order ?? 'asc');

    if (params.beginTime && params.endTime) {
      url.searchParams.set('beginTime', params.beginTime);
      url.searchParams.set('endTime', params.endTime);
    }
    if (params.category) {
      url.searchParams.set('category', params.category);
    }
    if (params.serviceName) {
      url.searchParams.set('serviceName', params.serviceName);
    }

    const data = await requestJson<WbDocumentsListResponse>(
      'getDocumentsList',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      { data: { documents: [] } }
    );

    return data.data?.documents ?? [];
  },

  getAllDocumentsList: async (
    token: string,
    params: Omit<WbDocumentsListParams, 'offset' | 'limit'> = {}
  ): Promise<WbDocumentListItem[]> => {
    const allDocuments: WbDocumentListItem[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const page = await wbApi.getDocumentsList(token, { ...params, limit, offset });
      allDocuments.push(...page);

      if (page.length < limit) {
        break;
      }

      offset += limit;
      await wait(10_000);
    }

    return allDocuments;
  },

  /**
   * Документы WB: загрузка одного документа из списка.
   * GET /api/v1/documents/download
   */
  downloadDocument: async (
    token: string,
    serviceName: string,
    extension: string
  ): Promise<WbDownloadedDocument> => {
    const url = new URL(`${DOCUMENTS_API_URL}/download`);
    url.searchParams.set('serviceName', serviceName);
    url.searchParams.set('extension', extension);

    const data = await requestJson<WbDocumentDownloadResponse>(
      'downloadDocument',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      {}
    );

    if (!data.data?.document) {
      throw new WbApiError({
        message: `[WB API] downloadDocument returned empty document for ${serviceName}`,
        operation: 'downloadDocument',
        attempt: 1,
        retryable: false,
      });
    }

    return data.data;
  },

  /**
   * Документы WB: пакетная загрузка документов.
   * POST /api/v1/documents/download/all
   */
  downloadDocuments: async (
    token: string,
    params: Array<{ serviceName: string; extension: string }>
  ): Promise<WbDownloadedDocument> => {
    const data = await requestJson<WbDocumentDownloadResponse>(
      'downloadDocuments',
      `${DOCUMENTS_API_URL}/download/all`,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({ params: params.slice(0, 50) }),
      },
      {}
    );

    if (!data.data?.document) {
      throw new WbApiError({
        message: '[WB API] downloadDocuments returned empty archive',
        operation: 'downloadDocuments',
        attempt: 1,
        retryable: false,
      });
    }

    return data.data;
  },

  /**
   * Сбор Финансов: детализация отчётов реализации через актуальный Finance API.
   * POST /api/finance/v1/sales-reports/detailed
   */
  getRealizationReport: async (
    token: string,
    dateFrom: string,
    dateTo: string,
    rrdid: number = 0,
    limit: number = 100000,
    period: 'daily' | 'weekly' = 'weekly'
  ): Promise<WbRealizationReportItem[]> => {
    const data = await requestJson<unknown>(
      'getRealizationReport',
      FINANCE_DETAILED_SALES_REPORT_URL,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          dateFrom,
          dateTo,
          limit,
          rrdId: rrdid,
          period,
        }),
      },
      []
    );

    const parsed = WbFinanceDetailedSalesReportResponseSchema.parse(data);
    return (parsed ?? []).map(normalizeFinanceSalesReportItem);
  },

  getAllRealizationReports: async (
    token: string,
    dateFrom: string,
    dateTo: string,
    limit: number = 100000,
    period: 'daily' | 'weekly' = 'weekly'
  ): Promise<WbRealizationReportItem[]> => {
    const allReports: WbRealizationReportItem[] = [];
    let rrdid = 0;

    while (true) {
      const page = await wbApi.getRealizationReport(token, dateFrom, dateTo, rrdid, limit, period);
      if (page.length === 0) {
        break;
      }

      allReports.push(...page);

      const maxRrdId = Math.max(...page.map((item) => item.rrd_id));
      if (maxRrdId <= rrdid || page.length < limit) {
        break;
      }

      rrdid = maxRrdId;
    }

    return allReports;
  },

  /**
   * Оперативные заказы
   * GET /api/v1/supplier/orders
   */
  getOrders: async (
    token: string,
    dateFrom: string,
    dateTo: string
  ): Promise<WbOrderItem[]> => {
    void dateTo;
    const url = new URL(`${BASE_URL_V1}/supplier/orders`);
    url.searchParams.set('dateFrom', dateFrom);
    url.searchParams.set('flag', '0');

    const data = await requestJson<unknown>(
      'getOrders',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      []
    );

    return WbOrderResponseSchema.parse(data) || [];
  },

  /**
   * Рекламные расходы (Promotion)
   * GET /adv/v3/fullstats
   */
  getAdSpend: async (
    token: string,
    dateFrom: string,
    dateTo: string,
    options?: {
      signal?: AbortSignal;
      campaigns?: WbAdCampaign[];
      groupBy?: 'nm_date' | 'advert_nm_date';
    }
  ): Promise<WbAdSpendItem[]> => {
    const groupBy = options?.groupBy ?? 'nm_date';
    const campaigns = Array.isArray(options?.campaigns)
      ? options.campaigns
      : await wbApi.getAdCampaigns(token, options);
    const eligibleCampaignIds = campaigns
      .filter((campaign) => campaign.status !== undefined && AD_FULL_STATS_SUPPORTED_STATUSES.has(campaign.status))
      .map((campaign) => campaign.advertId);

    if (eligibleCampaignIds.length === 0) {
      return [];
    }

    const adSpendByNmAndDate = new Map<string, WbAdSpendItem>();
    const dateWindows = splitDateRangeByMaxDays(
      dateFrom,
      dateTo,
      AD_FULL_STATS_MAX_WINDOW_DAYS
    );
    let lastFullStatsRequestedAt = 0;

    for (const batch of chunkArray(eligibleCampaignIds, AD_CAMPAIGN_DETAILS_BATCH_SIZE)) {
      for (const dateWindow of dateWindows) {
        throwIfAborted(options?.signal);

        const url = new URL(AD_FULL_STATS_URL);
        url.searchParams.set('ids', batch.join(','));
        url.searchParams.set('beginDate', dateWindow.from);
        url.searchParams.set('endDate', dateWindow.to);
        lastFullStatsRequestedAt = await waitForMinInterval(
          lastFullStatsRequestedAt,
          AD_FULL_STATS_MIN_INTERVAL_MS,
          options?.signal
        );

        const response = await requestAdvertJson<WbFullStatsPayload>(
          'getAdSpend',
          url.toString(),
          {
            method: 'GET',
            headers: getHeaders(token),
          },
          null,
          {
            signal: options?.signal,
            timeoutMs: AD_API_TIMEOUT_MS,
          }
        );

        const normalizedResponse = normalizeFullStatsPayload(response);

        for (const campaign of normalizedResponse) {
          const advertId = asNumber(campaign.advertId);
          if (groupBy === 'advert_nm_date' && advertId === undefined) {
            continue;
          }

          const days = Array.isArray(campaign.days) ? campaign.days : [];
          for (const day of days) {
            const date = asString(day.date);
            const apps = Array.isArray(day.apps) ? day.apps : [];
            if (!date) {
              continue;
            }

            for (const app of apps) {
              const nms = Array.isArray(app.nms) ? app.nms : [];
              for (const nmStat of nms) {
                const nmId = asNumber(nmStat.nmId);
                if (nmId === undefined) {
                  continue;
                }

                const key = groupBy === 'advert_nm_date'
                  ? `${advertId}:${nmId}:${date}`
                  : `${nmId}:${date}`;
                const current = adSpendByNmAndDate.get(key) ?? {
                  ...(groupBy === 'advert_nm_date' ? { advertId } : {}),
                  nmId,
                  date,
                  sum: 0,
                  orderSum: 0,
                  orderCount: 0,
                  views: 0,
                  clicks: 0,
                  ctr: 0,
                  cpc: 0,
                };

                current.sum += asNumber(nmStat.sum) ?? 0;
                current.orderSum += asNumber(nmStat.sum_price) ?? 0;
                current.orderCount += Math.max(0, Math.round(asNumber(nmStat.orders) ?? 0));
                current.views += asNumber(nmStat.views) ?? 0;
                current.clicks += asNumber(nmStat.clicks) ?? 0;
                current.ctr = current.views > 0 ? (current.clicks / current.views) * 100 : 0;
                current.cpc = current.clicks > 0 ? current.sum / current.clicks : 0;

                adSpendByNmAndDate.set(key, current);
              }
            }
          }
        }
      }
    }

    return Array.from(adSpendByNmAndDate.values());
  },

  /**
   * Список рекламных кампаний
   * GET /adv/v1/promotion/count + GET /api/advert/v2/adverts
   */
  getAdCampaigns: async (
    token: string,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<WbAdCampaign[]> => {
    const summary = await requestAdvertJson<WbAdCampaignSummaryResponse>(
      'getAdCampaignSummaries',
      AD_PROMOTION_COUNT_URL,
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      { adverts: [] },
      {
        signal: options?.signal,
        timeoutMs: AD_API_TIMEOUT_MS,
      }
    );

    const campaignTypeById = getCampaignTypeById(summary);
    const advertIds = Array.from(campaignTypeById.keys());

    if (advertIds.length === 0) {
      return [];
    }

    return await loadAdCampaignsByAdvertIds(token, advertIds, options, campaignTypeById);
  },

  getAdCampaignsByAdvertIds: async (
    token: string,
    advertIds: number[],
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<WbAdCampaign[]> => {
    return await loadAdCampaignsByAdvertIds(token, advertIds, options);
  },

  getMinimumCampaignBids: async (
    token: string,
    params: {
      advertId: number;
      nmIds: number[];
      paymentType: 'cpm' | 'cpc';
      placementTypes: Array<'search' | 'recommendation' | 'combined'>;
    },
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<WbCampaignMinimumBid[]> => {
    const response = await requestAdvertJson<WbCampaignMinBidsResponse>(
      'getMinimumCampaignBids',
      AD_CAMPAIGN_MIN_BIDS_URL,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          advert_id: params.advertId,
          nm_ids: params.nmIds,
          payment_type: params.paymentType,
          placement_types: params.placementTypes,
        }),
      },
      { bids: [] },
      { signal: options?.signal, timeoutMs: AD_API_TIMEOUT_MS },
    );

    return (response.bids ?? []).flatMap((item) => {
      const nmId = asNumber(item.nm_id);
      if (nmId === undefined) {
        return [];
      }
      return (item.bids ?? [])
        .map((bid) => {
          const placement = asString(bid.type);
          const value = asNumber(bid.value);
          if (!placement || value === undefined) {
            return null;
          }
          return {
            nmId,
            placement,
            value,
            currency: asString(bid.currency) ?? null,
          } satisfies WbCampaignMinimumBid;
        })
        .filter((bid): bid is WbCampaignMinimumBid => bid !== null);
    });
  },

  setCampaignBids: async (
    token: string,
    bids: Array<{
      advertId: number;
      nmId: number;
      bidKopecks: number;
      placement: WbCampaignBidPlacement;
    }>,
    options?: {
      signal?: AbortSignal;
    },
  ): Promise<WbCampaignBidsResponse> => {
    const byAdvertId = new Map<number, WbCampaignBidUpdate>();
    for (const bid of bids) {
      const item = byAdvertId.get(bid.advertId) ?? { advert_id: bid.advertId, nm_bids: [] };
      item.nm_bids!.push({
        nm_id: bid.nmId,
        bid_kopecks: bid.bidKopecks,
        placement: bid.placement,
      });
      byAdvertId.set(bid.advertId, item);
    }

    return await requestAdvertJson<WbCampaignBidsResponse>(
      'setCampaignBids',
      AD_CAMPAIGN_BIDS_URL,
      {
        method: 'PATCH',
        headers: getHeaders(token),
        body: JSON.stringify({
          bids: [...byAdvertId.values()],
        }),
      },
      { bids: [] },
      { signal: options?.signal, timeoutMs: AD_API_TIMEOUT_MS },
    );
  },

  /**
   * Статистика по поисковым кластерам
   * POST /adv/v1/normquery/stats
   */
  getSearchClusterStats: async (
    token: string,
    dateFrom: string,
    dateTo: string,
    items: Array<{ advertId: number; nmId: number }>,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<WbSearchKeywordStat[]> => {
    if (items.length === 0) {
      return [];
    }

    const stats: WbSearchKeywordStat[] = [];
    const dateWindows = splitDateRangeByMaxDays(
      dateFrom,
      dateTo,
      AD_SEARCH_CLUSTER_MAX_WINDOW_DAYS
    );

    for (const dateWindow of dateWindows) {
      for (const batch of chunkArray(items, AD_SEARCH_STATS_BATCH_SIZE)) {
        throwIfAborted(options?.signal);
        await waitForSearchClusterStatsThrottle(options?.signal);

        const response = await requestAdvertJson<WbSearchClusterStatsResponse>(
          'getSearchClusterStats',
          AD_SEARCH_CLUSTER_STATS_URL,
          {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({
              from: dateWindow.from,
              to: dateWindow.to,
              items: batch,
            }),
          },
          { items: [] },
          { signal: options?.signal }
        );

        const responseItems = Array.isArray(response.items) ? response.items : [];
        for (const item of responseItems) {
          const advertId = asNumber(item.advertId);
          const nmId = asNumber(item.nmId);
          const dailyStats = Array.isArray(item.dailyStats) ? item.dailyStats : [];

          if (advertId === undefined || nmId === undefined) {
            continue;
          }

          for (const entry of dailyStats) {
            const stat = isObject(entry.stat) ? entry.stat : undefined;
            const keyword = asString(stat?.normQuery);
            const date = asString(entry.date);

            if (!keyword || !date) {
              continue;
            }

            stats.push({
              advertId,
              nmId,
              date,
              keyword,
              views: asNumber(stat?.views) ?? 0,
              clicks: asNumber(stat?.clicks) ?? 0,
              ctr: asNumber(stat?.ctr) ?? 0,
              sum: asNumber(stat?.spend) ?? 0,
              atbs: asNumber(stat?.atbs) ?? 0,
              orders: asNumber(stat?.orders) ?? 0,
              cpc: asNumber(stat?.cpc) ?? 0,
              cpm: asNumber(stat?.cpm) ?? 0,
              avgPos: asNumber(stat?.avgPos) ?? 0,
              shks: asNumber(stat?.shks) ?? 0,
            });
          }
        }
      }
    }

    return stats;
  },

  /**
   * Список ставок по поисковым кластерам
   * POST /adv/v0/normquery/get-bids
   */
  getSearchClusterBids: async (
    token: string,
    items: Array<{ advertId: number; nmId: number }>,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<WbSearchClusterBid[]> => {
    if (items.length === 0) {
      return [];
    }

    const response = await requestAdvertJson<WbSearchClusterBidsResponse>(
      'getSearchClusterBids',
      AD_SEARCH_CLUSTER_BIDS_URL,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          items: items.map((item) => ({
            advert_id: item.advertId,
            nm_id: item.nmId,
          })),
        }),
      },
      { bids: [] },
      { signal: options?.signal, timeoutMs: AD_API_TIMEOUT_MS }
    );

    const bids = Array.isArray(response.bids) ? response.bids : [];
    return bids
      .map((item) => {
        const advertId = asNumber(item.advert_id);
        const nmId = asNumber(item.nm_id);
        const keyword = asString(item.norm_query);
        const bid = asNumber(item.bid);

        if (advertId === undefined || nmId === undefined || !keyword || bid === undefined) {
          return null;
        }

        return {
          advertId,
          nmId,
          keyword,
          bid,
        } satisfies WbSearchClusterBid;
      })
      .filter((item): item is WbSearchClusterBid => item !== null);
  },

  /**
   * Установка ставок по поисковым кластерам
   * POST /adv/v0/normquery/bids
   */
  setSearchClusterBids: async (
    token: string,
    bids: Array<{ advertId: number; nmId: number; keyword: string; bid: number }>,
    options?: {
      signal?: AbortSignal;
      verify?: boolean;
    }
  ): Promise<void> => {
    if (bids.length === 0) {
      return;
    }

    const normalizedBids = bids.map((item) => ({
      advertId: item.advertId,
      nmId: item.nmId,
      keyword: item.keyword,
      bid: Math.max(0, Math.round(item.bid)),
    }));

    await requestAdvertJson<Record<string, unknown>>(
      'setSearchClusterBids',
      AD_SEARCH_CLUSTER_BIDS_SET_URL,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          bids: normalizedBids.map((item) => ({
            advert_id: item.advertId,
            nm_id: item.nmId,
            norm_query: item.keyword,
            bid: item.bid,
          })),
        }),
      },
      {},
      { signal: options?.signal, timeoutMs: AD_API_TIMEOUT_MS }
    );

    if (options?.verify === false) {
      return;
    }

    const lookupItems = Array.from(new Map(
      normalizedBids.map((item) => [
        `${item.advertId}:${item.nmId}`,
        { advertId: item.advertId, nmId: item.nmId },
      ] as const),
    ).values());
    const verifiedBids = await wbApi.getSearchClusterBids(token, lookupItems, {
      signal: options?.signal,
    });
    const verifiedByKey = new Map(
      verifiedBids.map((item) => [
        `${item.advertId}:${item.nmId}:${normalizeSearchClusterKey(item.keyword)}`,
        Math.round(item.bid),
      ]),
    );
    const mismatches = normalizedBids.filter((item) => (
      verifiedByKey.get(`${item.advertId}:${item.nmId}:${normalizeSearchClusterKey(item.keyword)}`) !== item.bid
    ));

    if (mismatches.length > 0) {
      throw new WbAdActionVerificationError(
        `WB API не подтвердил изменение ставок для ${mismatches.length} кластеров`,
        mismatches.map((item) => ({
          advertId: item.advertId,
          nmId: item.nmId,
          keyword: item.keyword,
          expectedBid: item.bid,
          actualBid: verifiedByKey.get(`${item.advertId}:${item.nmId}:${normalizeSearchClusterKey(item.keyword)}`) ?? null,
        })),
      );
    }
  },

  /**
   * Списки активных/исключенных поисковых кластеров
   * POST /adv/v0/normquery/list
   */
  getNormQueryList: async (
    token: string,
    items: Array<{ advertId: number; nmId: number }>,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<WbNormQueryListItem[]> => {
    if (items.length === 0) {
      return [];
    }

    const response = await requestAdvertJson<WbNormQueryListResponse>(
      'getNormQueryList',
      AD_SEARCH_CLUSTER_LIST_URL,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          items: items.map((item) => ({
            advertId: item.advertId,
            nmId: item.nmId,
          })),
        }),
      },
      { items: [] },
      { signal: options?.signal, timeoutMs: AD_API_TIMEOUT_MS }
    );

    const responseItems = Array.isArray(response.items) ? response.items : [];
    return responseItems
      .map((item) => {
        const advertId = asNumber(item.advertId);
        const nmId = asNumber(item.nmId);
        if (advertId === undefined || nmId === undefined) {
          return null;
        }

        const active = Array.isArray(item.normQueries?.active)
          ? item.normQueries.active.map((value) => String(value).trim()).filter((value) => value.length > 0)
          : [];
        const excluded = Array.isArray(item.normQueries?.excluded)
          ? item.normQueries.excluded.map((value) => String(value).trim()).filter((value) => value.length > 0)
          : [];

        return {
          advertId,
          nmId,
          active,
          excluded,
        } satisfies WbNormQueryListItem;
      })
      .filter((item): item is WbNormQueryListItem => item !== null);
  },

  /**
   * Получение минус-фраз кампаний
   * POST /adv/v0/normquery/get-minus
   */
  getCampaignMinusPhrases: async (
    token: string,
    items: Array<{ advertId: number; nmId: number }>,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<WbCampaignMinusPhraseItem[]> => {
    if (items.length === 0) {
      return [];
    }

    const response = await requestAdvertJson<WbCampaignMinusPhrasesResponse>(
      'getCampaignMinusPhrases',
      AD_SEARCH_CLUSTER_MINUS_GET_URL,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          items: items.map((item) => ({
            advert_id: item.advertId,
            nm_id: item.nmId,
          })),
        }),
      },
      { items: [] },
      { signal: options?.signal, timeoutMs: AD_API_TIMEOUT_MS }
    );

    const responseItems = Array.isArray(response.items) ? response.items : [];
    return responseItems
      .map((item) => {
        const advertId = asNumber(item.advert_id);
        const nmId = asNumber(item.nm_id);

        if (advertId === undefined || nmId === undefined) {
          return null;
        }

        return {
          advertId,
          nmId,
          normQueries: Array.isArray(item.norm_queries)
            ? item.norm_queries
              .map((value) => String(value).trim())
              .filter((value) => value.length > 0)
            : [],
        } satisfies WbCampaignMinusPhraseItem;
      })
      .filter((item): item is WbCampaignMinusPhraseItem => item !== null);
  },

  /**
   * Установка/удаление минус-фраз для кампании
   * POST /adv/v0/normquery/set-minus
   */
  setCampaignMinusPhrases: async (
    token: string,
    advertId: number,
    nmId: number,
    normQueries: string[],
    options?: {
      signal?: AbortSignal;
      verify?: boolean;
    }
  ): Promise<void> => {
    const normalizedExpected = Array.from(
      new Map(
        normQueries
          .map((phrase) => String(phrase).trim())
          .filter((phrase) => phrase.length > 0)
          .map((phrase) => [normalizeSearchClusterKey(phrase), phrase] as const),
      ).values(),
    );

    await requestAdvertJson<Record<string, unknown>>(
      'setCampaignMinusPhrases',
      AD_SEARCH_CLUSTER_MINUS_SET_URL,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          advert_id: advertId,
          nm_id: nmId,
          norm_queries: normalizedExpected,
        }),
      },
      {},
      { signal: options?.signal, timeoutMs: AD_API_TIMEOUT_MS }
    );

    if (options?.verify === false) {
      return;
    }

    const [verified] = await wbApi.getCampaignMinusPhrases(token, [{ advertId, nmId }], {
      signal: options?.signal,
    });
    const expectedSet = new Set(normalizedExpected.map((phrase) => normalizeSearchClusterKey(phrase)));
    const actualSet = new Set((verified?.normQueries ?? []).map((phrase) => normalizeSearchClusterKey(phrase)));
    const exactMatch = expectedSet.size === actualSet.size
      && [...expectedSet].every((phrase) => actualSet.has(phrase));

    if (!exactMatch) {
      throw new WbAdActionVerificationError(
        'WB API не подтвердил актуальный список минус-фраз после изменения',
        [{ advertId, nmId }],
      );
    }
  },

  /**
   * Рекомендуемые ставки по карточке и поисковым кластерам
   * GET /api/advert/v0/bids/recommendations
   */
  getBidsRecommendations: async (
    token: string,
    advertId: number,
    nmId: number,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<WbBidsRecommendation | null> => {
    const url = new URL(AD_BIDS_RECOMMENDATIONS_URL);
    url.searchParams.set('advertId', String(advertId));
    url.searchParams.set('nmId', String(nmId));

    const response = await requestAdvertJson<WbBidRecommendationsResponse>(
      'getBidsRecommendations',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      {},
      { signal: options?.signal, timeoutMs: AD_API_TIMEOUT_MS }
    );

    const responseAdvertId = asNumber(response.advertId);
    const responseNmId = asNumber(response.nmId);
    if (responseAdvertId === undefined || responseNmId === undefined) {
      return null;
    }

    const normQueriesRaw = Array.isArray(response.normQueries) ? response.normQueries : [];
    const normQueries = normQueriesRaw
      .map((item) => {
        const keyword = asString(item.normQuery);
        if (!keyword) {
          return null;
        }

        return {
          keyword,
          reachMinBidKopecks: asNumber(item.reachMin?.bidKopecks) ?? null,
          reachMediumBidKopecks: asNumber(item.reachMedium?.bidKopecks) ?? null,
          reachMaxBidKopecks: asNumber(item.reachMax?.bidKopecks) ?? null,
          reachMaxMinBidKopecks: asNumber(item.reachMax?.bidKopecksMin) ?? null,
        };
      })
      .filter((item): item is WbBidsRecommendation['normQueries'][number] => item !== null);

    return {
      advertId: responseAdvertId,
      nmId: responseNmId,
      base: {
        competitiveBidKopecks: asNumber(response.base?.competitiveBid?.bidKopecks) ?? null,
        leadersBidKopecks: asNumber(response.base?.leadersBid?.bidKopecks) ?? null,
        top2BidKopecks: asNumber(response.base?.top2?.bidKopecks) ?? null,
      },
      normQueries,
    };
  },

  getSearchStat: async (
    token: string,
    advertId: number,
    nmId: number,
    dateFrom: string,
    dateTo: string,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<WbSearchKeywordStat[]> => {
    return await wbApi.getSearchClusterStats(token, dateFrom, dateTo, [{ advertId, nmId }], options);
  },

  /**
   * Воронка продаж (Аналитика v3)
   * POST /api/analytics/v3/sales-funnel/products
   */
  getNomenclatureReport: async (
    token: string,
    dateFrom: string,
    dateTo: string
  ): Promise<WbFunnelItem[]> => {
    const selectedStart = getDateAtUtcStart(dateFrom);
    const selectedEnd = getDateAtUtcStart(dateTo);
    const selectedDays = getInclusiveUtcDaySpan(dateFrom, dateTo);
    const pastEnd = addUtcDays(selectedStart, -1);
    const pastStart = addUtcDays(selectedStart, -selectedDays);

    const items: WbFunnelItem[] = [];
    let offset = 0;

    while (true) {
      const data = await requestJson<WbFunnelProductsResponse>(
        'getNomenclatureReport',
        FUNNEL_PRODUCTS_URL,
        {
          method: 'POST',
          headers: getHeaders(token),
          body: JSON.stringify({
            selectedPeriod: {
              start: formatDateOnly(selectedStart.toISOString()),
              end: formatDateOnly(selectedEnd.toISOString()),
            },
            pastPeriod: {
              start: formatDateOnly(pastStart.toISOString()),
              end: formatDateOnly(pastEnd.toISOString()),
            },
            nmIds: [],
            skipDeletedNm: false,
            limit: FUNNEL_PAGE_SIZE,
            offset,
          })
        },
        { data: { products: [] } }
      );

      const products = Array.isArray(data.data?.products) ? data.data.products : [];
      if (products.length === 0) {
        break;
      }

      for (const item of products) {
        const nmId = asNumber(item.product?.nmId);
        const selected = item.statistic?.selected;

        if (nmId === undefined) {
          continue;
        }

        items.push({
          nmId,
          orderCount: asNumber(selected?.orderCount) ?? 0,
          orderSum: asNumber(selected?.orderSum) ?? 0,
          buyoutsCount: asNumber(selected?.buyoutCount) ?? 0,
          buyoutsSum: asNumber(selected?.buyoutSum) ?? 0,
          cancelCount: asNumber(selected?.cancelCount) ?? 0,
          cancelSum: asNumber(selected?.cancelSum) ?? 0,
          avgPrice: asNumber(selected?.avgPrice) ?? 0,
          addToCartCount: asNumber(selected?.cartCount) ?? 0,
          addToCartPercent: asNumber(selected?.conversions?.addToCartPercent) ?? 0,
          cartToOrderPercent: asNumber(selected?.conversions?.cartToOrderPercent) ?? 0,
          orderToBuyoutPercent: asNumber(selected?.conversions?.buyoutPercent) ?? 0,
          openCardCount: asNumber(selected?.openCount) ?? 0,
          localizationPercent: asNumber(selected?.localizationPercent) ?? 0,
        });
      }

      if (products.length < FUNNEL_PAGE_SIZE) {
        break;
      }

      offset += products.length;
    }

    return items;
  },

  getDailyNomenclatureReport: async (
    token: string,
    dateFrom: string,
    dateTo: string
  ): Promise<WbDailyFunnelWindow[]> => {
    try {
      const downloadId = await createDetailedHistoryReportDownload(token, dateFrom, dateTo);
      await waitForDetailedHistoryReportReady(token, downloadId);
      const archive = await downloadDetailedHistoryReport(token, downloadId);
      const reportRows = parseDetailedHistoryReportArchive(archive);

      if (reportRows.length > 0) {
        return reportRows;
      }
    } catch (error) {
      const wbError = error instanceof WbApiError ? error : null;
      if (
        isWbApiErrorWithDetails(error, 403, 'report not available')
        || wbError?.status === 404
      ) {
        logger.info(
          { status: wbError?.status },
          '[WB API] DETAIL_HISTORY_REPORT unavailable, falling back to daily products API'
        );
      } else {
        logger.warn({ err: error }, '[WB API] DETAIL_HISTORY_REPORT unavailable, falling back to daily products API');
      }
    }

    const dailyWindows = splitDateRangeByMaxDays(dateFrom, dateTo, 1);
    const dailyReports: WbDailyFunnelWindow[] = [];
    let lastRequestedAt = 0;

    for (const window of dailyWindows) {
      lastRequestedAt = await waitForMinInterval(lastRequestedAt, FUNNEL_DAILY_WINDOW_MIN_INTERVAL_MS);
      const periodStart = new Date(`${window.from}T00:00:00.000Z`).toISOString();
      const periodEnd = new Date(`${window.to}T00:00:00.000Z`).toISOString();
      const items = await wbApi.getNomenclatureReport(token, periodStart, periodEnd);

      dailyReports.push({
        periodStart,
        periodEnd,
        items,
      });
    }

    return dailyReports;
  },

  /**
   * Метрики остатков по регионам/складам (Seller Analytics v2)
   * POST /api/v2/stocks-report/offices
   */
  getStockOfficesMetrics: async (
    token: string,
    dateFrom: string,
    dateTo: string,
    options?: {
      signal?: AbortSignal;
      stockType?: WbStockType;
      nmIds?: number[];
    }
  ): Promise<WbStockOfficeMetricItem[]> => {
    const currentPeriod = {
      start: formatDateOnly(getDateAtUtcStart(dateFrom).toISOString()),
      end: formatDateOnly(getDateAtUtcStart(dateTo).toISOString()),
    };
    const stockType = options?.stockType ?? 'wb';
    const nmIds = Array.isArray(options?.nmIds)
      ? options.nmIds.filter((value): value is number => Number.isFinite(value) && value > 0)
      : [];

    const response = await requestJson<WbStocksOfficesResponse>(
      'getStockOfficesMetrics',
      STOCKS_OFFICES_URL,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          nmIDs: nmIds,
          currentPeriod,
          stockType,
          skipDeletedNm: false,
        }),
      },
      { data: { regions: [] } },
      {
        signal: options?.signal,
      }
    );

    const regions = Array.isArray(response.data?.regions) ? response.data.regions : [];
    const items: WbStockOfficeMetricItem[] = [];

    for (const region of regions) {
      const regionName = normalizeRegionName(region?.regionName);
      const offices = Array.isArray(region?.offices) ? region.offices : [];

      if (offices.length === 0) {
        items.push(buildOfficeMetricItem(
          stockType,
          undefined,
          regionName,
          DEFAULT_OFFICE_NAME,
          region?.metrics,
        ));
        continue;
      }

      for (const office of offices) {
        items.push(buildOfficeMetricItem(
          stockType,
          office,
          regionName,
          DEFAULT_OFFICE_NAME,
          region?.metrics,
        ));
      }
    }

    return items;
  },

  /**
   * Метрики остатков/спроса по размерам (Seller Analytics v2)
   * POST /api/v2/stocks-report/products/sizes
   */
  getStockSizesMetrics: async (
    token: string,
    config: {
      dateFrom: string;
      dateTo: string;
      nmIds: number[];
      stockType?: WbStockType;
      includeOffice?: boolean;
      signal?: AbortSignal;
    }
  ): Promise<WbStockSizeMetricItem[]> => {
    const currentPeriod = {
      start: formatDateOnly(getDateAtUtcStart(config.dateFrom).toISOString()),
      end: formatDateOnly(getDateAtUtcStart(config.dateTo).toISOString()),
    };
    const stockType = config.stockType ?? 'wb';
    const includeOffice = config.includeOffice ?? true;
    const nmIds = Array.from(new Set(
      config.nmIds.filter((value): value is number => Number.isFinite(value) && value > 0)
    ));
    if (nmIds.length === 0) {
      return [];
    }

    const rows: WbStockSizeMetricItem[] = [];
    let lastRequestedAt = 0;

    for (const nmId of nmIds) {
      throwIfAborted(config.signal);
      lastRequestedAt = await waitForMinInterval(lastRequestedAt, STOCKS_REPORT_MIN_INTERVAL_MS, config.signal);

      const response = await requestJson<WbStocksSizesResponse>(
        'getStockSizesMetrics',
        STOCKS_SIZES_URL,
        {
          method: 'POST',
          headers: getHeaders(token),
          body: JSON.stringify({
            nmID: nmId,
            currentPeriod,
            stockType,
            orderBy: {
              field: 'avgOrders',
              mode: 'desc',
            },
            includeOffice,
          }),
        },
        { data: { sizes: [] } },
        {
          signal: config.signal,
        }
      );

      const responseNmId = asNumber(response.data?.nmID)
        ?? asNumber((response.data as { nmId?: unknown } | undefined)?.nmId)
        ?? nmId;
      const sizes = Array.isArray(response.data?.sizes) ? response.data.sizes : [];

      for (const size of sizes) {
        const sizeName = normalizeOfficeName(
          size?.name ?? (size as { techSizeName?: unknown }).techSizeName,
          'Без размера'
        );
        const chrtId = asNumber(size?.chrtID)
          ?? asNumber((size as { chrtId?: unknown }).chrtId)
          ?? null;
        const offices = Array.isArray(size?.offices) ? size.offices : [];

        if (offices.length === 0) {
          const metric = buildOfficeMetricItem(
            stockType,
            undefined,
            DEFAULT_REGION_NAME,
            DEFAULT_OFFICE_NAME,
            size?.metrics,
          );
          rows.push({
            nmId: responseNmId,
            sizeName,
            chrtId,
            ...metric,
          });
          continue;
        }

        for (const office of offices) {
          const metric = buildOfficeMetricItem(
            stockType,
            office,
            normalizeRegionName(office?.regionName),
            DEFAULT_OFFICE_NAME,
            size?.metrics,
          );
          rows.push({
            nmId: responseNmId,
            sizeName,
            chrtId,
            ...metric,
          });
        }
      }

      if (sizes.length === 0) {
        const offices = Array.isArray(response.data?.offices) ? response.data.offices : [];
        for (const office of offices) {
          const metric = buildOfficeMetricItem(
            stockType,
            office,
            normalizeRegionName(office?.regionName),
          );
          rows.push({
            nmId: responseNmId,
            sizeName: 'Без размера',
            chrtId: null,
            ...metric,
          });
        }
      }
    }

    return rows;
  },

  /**
   * Замеры на складах WB (Retention Reports)
   * GET /api/analytics/v1/warehouse-measurements
   */
  getWarehouseMeasurements: async (
    token: string,
    options: {
      dateTo: string;
      dateFrom?: string;
      limit?: number;
      offset?: number;
      signal?: AbortSignal;
    }
  ): Promise<WbWarehouseMeasurementItem[]> => {
    const limit = Math.max(1, Math.min(1000, Math.round(options.limit ?? 1000)));
    const offset = Math.max(0, Math.round(options.offset ?? 0));
    const url = new URL(WAREHOUSE_MEASUREMENTS_URL);
    url.searchParams.set('dateTo', options.dateTo);
    url.searchParams.set('limit', String(limit));
    if (options.dateFrom) {
      url.searchParams.set('dateFrom', options.dateFrom);
    }
    if (offset > 0) {
      url.searchParams.set('offset', String(offset));
    }

    const response = await requestJson<WbDimensionsReportResponse>(
      'getWarehouseMeasurements',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      { data: { reports: [] } },
      {
        signal: options.signal,
      }
    );

    const reports = Array.isArray(response.data?.reports) ? response.data.reports : [];
    return reports
      .map((item) => {
        const nmId = asFiniteNumber(item.nmId) ?? asFiniteNumber(item.nmID);
        if (!nmId || nmId <= 0) {
          return null;
        }

        const photoUrls = Array.isArray(item.photoUrls)
          ? item.photoUrls
            .map((url) => asString(url)?.trim())
            .filter((url): url is string => Boolean(url))
          : [];

        return {
          nmId,
          subjectName: asString(item.subjectName) ?? null,
          dimId: asFiniteNumber(item.dimId) ?? null,
          volume: asFiniteNumber(item.volume) ?? null,
          width: asFiniteNumber(item.width) ?? null,
          length: asFiniteNumber(item.length) ?? null,
          height: asFiniteNumber(item.height) ?? null,
          photoUrls,
          measuredAt: asString(item.dt) ?? null,
        } satisfies WbWarehouseMeasurementItem;
      })
      .filter((item): item is WbWarehouseMeasurementItem => item !== null);
  },

  /**
   * Удержания за занижение габаритов упаковки (Retention Reports)
   * GET /api/analytics/v1/measurement-penalties
   */
  getMeasurementPenalties: async (
    token: string,
    options: {
      dateTo: string;
      dateFrom?: string;
      limit?: number;
      offset?: number;
      signal?: AbortSignal;
    }
  ): Promise<WbMeasurementPenaltyItem[]> => {
    const limit = Math.max(1, Math.min(1000, Math.round(options.limit ?? 1000)));
    const offset = Math.max(0, Math.round(options.offset ?? 0));
    const url = new URL(MEASUREMENT_PENALTIES_URL);
    url.searchParams.set('dateTo', options.dateTo);
    url.searchParams.set('limit', String(limit));
    if (options.dateFrom) {
      url.searchParams.set('dateFrom', options.dateFrom);
    }
    if (offset > 0) {
      url.searchParams.set('offset', String(offset));
    }

    const response = await requestJson<WbDimensionsReportResponse>(
      'getMeasurementPenalties',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      { data: { reports: [] } },
      {
        signal: options.signal,
      }
    );

    const reports = Array.isArray(response.data?.reports) ? response.data.reports : [];
    return reports
      .map((item) => {
        const nmId = asFiniteNumber(item.nmId) ?? asFiniteNumber(item.nmID);
        if (!nmId || nmId <= 0) {
          return null;
        }

        const photoUrls = Array.isArray(item.photoUrls)
          ? item.photoUrls
            .map((url) => asString(url)?.trim())
            .filter((url): url is string => Boolean(url))
          : [];

        return {
          nmId,
          subjectName: asString(item.subjectName) ?? null,
          dimId: asFiniteNumber(item.dimId) ?? null,
          volume: asFiniteNumber(item.volume) ?? null,
          width: asFiniteNumber(item.width) ?? null,
          length: asFiniteNumber(item.length) ?? null,
          height: asFiniteNumber(item.height) ?? null,
          volumeSup: asFiniteNumber(item.volumeSup) ?? null,
          widthSup: asFiniteNumber(item.widthSup) ?? null,
          lengthSup: asFiniteNumber(item.lengthSup) ?? null,
          heightSup: asFiniteNumber(item.heightSup) ?? null,
          dtBonus: asString(item.dtBonus) ?? null,
          isValid: asBoolean(item.isValid) ?? null,
          isValidDt: asString(item.isValidDt) ?? null,
          penaltyAmount: asFiniteNumber(item.penaltyAmount) ?? null,
          reversalAmount: asFiniteNumber(item.reversalAmount) ?? null,
          prcOver: asFiniteNumber(item.prcOver) ?? null,
          photoUrls,
          measuredAt: asString(item.isValidDt) ?? asString(item.dtBonus) ?? null,
        } satisfies WbMeasurementPenaltyItem;
      })
      .filter((item): item is WbMeasurementPenaltyItem => item !== null);
  },

  /**
   * Текущие остатки на складах (Статистика v1)
   * First tries Analytics v1 WB warehouses inventory to get `inWayToClient` / `inWayFromClient`.
   * Falls back to Analytics v2 products summary for base tokens, then to legacy Statistics v1 supplier stocks.
   */
  getStocks: async (token: string): Promise<WbStockItem[]> => {
    try {
      const limit = 250000;
      const items: WbStockItem[] = [];
      let offset = 0;

      while (true) {
        const response = await requestJson<WbStocksWbWarehousesResponse>(
          'getStocks.wbWarehouses',
          STOCKS_WB_WAREHOUSES_URL,
          {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({
              nmIds: [],
              chrtIds: [],
              limit,
              offset,
            }),
          },
          { data: { items: [] } }
        );

        const batch = Array.isArray(response.data?.items) ? response.data.items : [];
        for (const item of batch) {
          const nmId = asNumber(item.nmId);
          if (nmId === undefined) {
            continue;
          }

          items.push({
            nmId,
            warehouseName: asString(item.warehouseName) ?? 'Unknown',
            quantity: asNumber(item.quantity) ?? 0,
            inWayToClient: asNumber(item.inWayToClient) ?? 0,
            inWayFromClient: asNumber(item.inWayFromClient) ?? 0,
          });
        }

        if (batch.length < limit) {
          break;
        }

        offset += batch.length;
      }

      if (items.length > 0) {
        return items;
      }
    } catch (error) {
      const wbError = error instanceof WbApiError ? error : null;
      if (isWbApiErrorWithDetails(error, 403, 'base token is not allowed')) {
        logger.info(
          { status: wbError?.status },
          '[WB API] stocks-report/wb-warehouses unavailable for base token, falling back to products summary'
        );
      } else {
        logger.warn({ err: error }, '[WB API] stocks-report/wb-warehouses unavailable, falling back to products summary');
      }
    }

    try {
      const today = formatDateOnly(new Date().toISOString());
      const items: WbStockItem[] = [];
      let offset = 0;

      while (true) {
        const response = await requestJson<WbStocksProductsResponse>(
          'getStocks.productsSummary',
          STOCKS_PRODUCTS_URL,
          {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({
              currentPeriod: {
                start: today,
                end: today,
              },
              stockType: 'wb',
              skipDeletedNm: false,
              orderBy: {
                field: 'avgOrders',
                mode: 'asc',
              },
              availabilityFilters: STOCKS_PRODUCTS_AVAILABILITY_FILTERS,
              limit: STOCKS_PRODUCTS_PAGE_SIZE,
              offset,
            }),
          },
          { data: { items: [] } }
        );

        const batch = Array.isArray(response.data?.items) ? response.data.items : [];
        for (const item of batch) {
          const nmId = asNumber(item.nmID);
          if (nmId === undefined) {
            continue;
          }

          items.push({
            nmId,
            warehouseName: 'WB summary',
            quantity: asNumber(item.metrics?.stockCount) ?? 0,
            inWayToClient: asNumber(item.metrics?.toClientCount) ?? 0,
            inWayFromClient: asNumber(item.metrics?.fromClientCount) ?? 0,
          });
        }

        if (batch.length < STOCKS_PRODUCTS_PAGE_SIZE) {
          break;
        }

        offset += batch.length;
      }

      if (items.length > 0) {
        return items;
      }
    } catch (error) {
      logger.warn({ err: error }, '[WB API] stocks-report/products/products unavailable, falling back to supplier/stocks');
    }

    const url = new URL(`${BASE_URL_V1}/supplier/stocks`);
    url.searchParams.set('dateFrom', new Date(Date.now() - 86400000).toISOString());

    const legacyStocks = await requestJson<WbStockItem[]>(
      'getStocks',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      []
    );

    return legacyStocks.map((item) => ({
      ...item,
      inWayToClient: item.inWayToClient ?? 0,
      inWayFromClient: item.inWayFromClient ?? 0,
    }));
  },

  /**
   * Платное хранение (Reports task flow)
   * GET /api/v1/paid_storage + task status + download
   */
  getPaidStorage: async (
    token: string,
    dateFrom: string,
    dateTo: string,
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<WbPaidStorageItem[]> => {
    const normalizedStart = getDateAtUtcStart(dateFrom);
    const normalizedEnd = getDateAtUtcStart(dateTo);
    const rows: WbPaidStorageItem[] = [];
    let lastDownloadRequestedAt = 0;

    let cursor = normalizedStart;

    while (cursor.getTime() <= normalizedEnd.getTime()) {
      throwIfAborted(options?.signal);

      const windowEnd = new Date(Math.min(
        addUtcDays(cursor, PAID_STORAGE_MAX_WINDOW_DAYS - 1).getTime(),
        normalizedEnd.getTime()
      ));

      const taskId = await createReportTask(
        'getPaidStorage',
        token,
        PAID_STORAGE_REPORT_URL,
        {
          dateFrom: formatDateOnly(cursor.toISOString()),
          dateTo: formatDateOnly(windowEnd.toISOString()),
        },
        options?.signal
      );

      await waitForReportTaskReady('getPaidStorage', token, `${PAID_STORAGE_REPORT_URL}/tasks`, taskId, options?.signal);

      const elapsedSinceLastDownload = Date.now() - lastDownloadRequestedAt;
      if (lastDownloadRequestedAt > 0 && elapsedSinceLastDownload < PAID_STORAGE_DOWNLOAD_MIN_INTERVAL_MS) {
        await wait(PAID_STORAGE_DOWNLOAD_MIN_INTERVAL_MS - elapsedSinceLastDownload, options?.signal);
      }

      lastDownloadRequestedAt = Date.now();
      const reportRows = await downloadPaidStorageReport(token, taskId, options?.signal);

      for (const item of reportRows) {
        const nmId = asNumber(item.nmId);
        const date = asString(item.date);

        if (nmId === undefined || !date) {
          continue;
        }

        rows.push({
          nmId,
          warehouseName: asString(item.warehouse) ?? null,
          storageAmount: asNumber(item.warehousePrice) ?? 0,
          date,
        });
      }

      cursor = addUtcDays(windowEnd, 1);
    }

    return rows;
  },

  /**
   * Комиссии WB по предметным категориям
   * GET /api/v1/tariffs/commission
   */
  getCategoryCommissions: async (
    token: string,
    locale: 'ru' | 'en' | 'zh' = 'ru'
  ): Promise<WbCategoryCommissionItem[]> => {
    const url = new URL('https://common-api.wildberries.ru/api/v1/tariffs/commission');
    url.searchParams.set('locale', locale);

    const data = await requestJson<WbCategoryCommissionResponse>(
      'getCategoryCommissions',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      { report: [] }
    );

    const report = Array.isArray(data?.report) ? data.report : [];
    if (report.length === 0) {
      return [];
    }

    return report
      .map((item) => {
        const subjectName = asString(item.subjectName)?.trim();
        if (!subjectName) {
          return null;
        }

        const bookingCommissionRaw = parseCsvNumber(item.kgvpBooking);
        const marketplaceCommissionRaw = parseCsvNumber(item.kgvpMarketplace);
        const pickupCommissionRaw = parseCsvNumber(item.kgvpPickup);
        const supplierCommissionRaw = parseCsvNumber(item.kgvpSupplier);
        const supplierExpressCommissionRaw = parseCsvNumber(item.kgvpSupplierExpress);
        const paidStorageCommissionRaw = parseCsvNumber(item.paidStorageKgvp);
        return {
          subjectId: asNumber(item.subjectID) ?? null,
          subjectName,
          parentId: asNumber(item.parentID) ?? null,
          parentName: asString(item.parentName) ?? null,
          bookingCommission: Number.isFinite(bookingCommissionRaw) ? bookingCommissionRaw : null,
          marketplaceCommission: Number.isFinite(marketplaceCommissionRaw) ? marketplaceCommissionRaw : null,
          pickupCommission: Number.isFinite(pickupCommissionRaw) ? pickupCommissionRaw : null,
          supplierCommission: Number.isFinite(supplierCommissionRaw) ? supplierCommissionRaw : null,
          supplierExpressCommission: Number.isFinite(supplierExpressCommissionRaw) ? supplierExpressCommissionRaw : null,
          paidStorageCommission: Number.isFinite(paidStorageCommissionRaw) ? paidStorageCommissionRaw : null,
        } satisfies WbCategoryCommissionItem;
      })
      .filter((item): item is WbCategoryCommissionItem => item !== null);
  },

  /**
   * Коэффициенты тарифов поставки по складам на ближайшие 14 дней
   * GET /api/tariffs/v1/acceptance/coefficients
   */
  getAcceptanceTariffs: async (
    token: string,
    warehouseIds?: number[]
  ): Promise<WbAcceptanceTariffItem[]> => {
    const url = new URL('https://common-api.wildberries.ru/api/tariffs/v1/acceptance/coefficients');
    if (Array.isArray(warehouseIds) && warehouseIds.length > 0) {
      url.searchParams.set('warehouseIDs', warehouseIds.join(','));
    }

    const data = await requestJson<WbAcceptanceTariffRaw[]>(
      'getAcceptanceTariffs',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      []
    );

    if (!Array.isArray(data) || data.length === 0) {
      return [];
    }

    return data
      .map((item) => {
        const warehouseName = asString(item.warehouseName)?.trim();
        const date = asString(item.date)?.trim();
        if (!warehouseName || !date) {
          return null;
        }

        const coefficientRaw = parseCsvNumber(item.coefficient);
        const storageCoefRaw = parseCsvNumber(item.storageCoef);
        const deliveryCoefRaw = parseCsvNumber(item.deliveryCoef);
        const deliveryBaseLiterRaw = parseCsvNumber(item.deliveryBaseLiter);
        const deliveryAdditionalLiterRaw = parseCsvNumber(item.deliveryAdditionalLiter);
        const storageBaseLiterRaw = parseCsvNumber(item.storageBaseLiter);
        const storageAdditionalLiterRaw = parseCsvNumber(item.storageAdditionalLiter);

        return {
          date,
          coefficient: Number.isFinite(coefficientRaw) ? coefficientRaw : null,
          warehouseId: asNumber(item.warehouseID) ?? null,
          warehouseName,
          allowUnload: Boolean(item.allowUnload),
          boxTypeId: asNumber(item.boxTypeID) ?? null,
          storageCoef: Number.isFinite(storageCoefRaw) && storageCoefRaw > 0 ? storageCoefRaw : null,
          deliveryCoef: Number.isFinite(deliveryCoefRaw) && deliveryCoefRaw > 0 ? deliveryCoefRaw : null,
          deliveryBaseLiter: Number.isFinite(deliveryBaseLiterRaw) && deliveryBaseLiterRaw > 0 ? deliveryBaseLiterRaw : null,
          deliveryAdditionalLiter: Number.isFinite(deliveryAdditionalLiterRaw) && deliveryAdditionalLiterRaw > 0
            ? deliveryAdditionalLiterRaw
            : null,
          storageBaseLiter: Number.isFinite(storageBaseLiterRaw) && storageBaseLiterRaw > 0 ? storageBaseLiterRaw : null,
          storageAdditionalLiter: Number.isFinite(storageAdditionalLiterRaw) && storageAdditionalLiterRaw > 0
            ? storageAdditionalLiterRaw
            : null,
          isSortingCenter: Boolean(item.isSortingCenter),
        } satisfies WbAcceptanceTariffItem;
      })
      .filter((item): item is WbAcceptanceTariffItem => item !== null);
  },

  /**
   * Тарифы коробов по складам WB
   * GET /api/v1/tariffs/box
   */
  getBoxTariffs: async (
    token: string,
    date: string
  ): Promise<WbBoxTariffItem[]> => {
    const url = new URL(BOX_TARIFFS_URL);
    url.searchParams.set('date', date);

    const data = await requestJson<WbBoxTariffsResponse>(
      'getBoxTariffs',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      {}
    );

    const warehouseList = data.response?.data?.warehouseList;
    if (!Array.isArray(warehouseList) || warehouseList.length === 0) {
      return [];
    }

    return warehouseList
      .map((item) => {
        const warehouseName = asString(item.warehouseName)?.trim();
        if (!warehouseName) {
          return null;
        }

        return {
          warehouseName,
          geoName: asString(item.geoName)?.trim() || null,
          boxDeliveryBase: parseCsvNumber(item.boxDeliveryBase),
          boxDeliveryLiter: parseCsvNumber(item.boxDeliveryLiter),
          boxStorageBase: parseCsvNumber(item.boxStorageBase),
          boxStorageLiter: parseCsvNumber(item.boxStorageLiter),
          boxDeliveryCoefExpr: parseCsvNumber(item.boxDeliveryCoefExpr),
          boxStorageCoefExpr: parseCsvNumber(item.boxStorageCoefExpr),
          boxDeliveryMarketplaceBase: parseCsvNumber(item.boxDeliveryMarketplaceBase),
          boxDeliveryMarketplaceLiter: parseCsvNumber(item.boxDeliveryMarketplaceLiter),
          boxDeliveryMarketplaceCoefExpr: parseCsvNumber(item.boxDeliveryMarketplaceCoefExpr),
        } satisfies WbBoxTariffItem;
      })
      .filter((item): item is WbBoxTariffItem => item !== null);
  },

  /**
   * Тарифы возврата товара продавцу со склада WB
   * GET /api/v1/tariffs/return
   */
  getReturnTariffs: async (
    token: string,
    date: string
  ): Promise<WbReturnTariffItem[]> => {
    const url = new URL(RETURN_TARIFFS_URL);
    url.searchParams.set('date', date);

    const data = await requestJson<WbReturnTariffsResponse>(
      'getReturnTariffs',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      {}
    );

    const warehouseList = data.response?.data?.warehouseList;
    if (!Array.isArray(warehouseList) || warehouseList.length === 0) {
      return [];
    }

    return warehouseList
      .map((item) => {
        const warehouseName = asString(item.warehouseName)?.trim();
        if (!warehouseName) {
          return null;
        }

        return {
          warehouseName,
          geoName: asString(item.geoName)?.trim() || null,
          deliveryDumpKgtOfficeBase: parseCsvNumber(item.deliveryDumpKgtOfficeBase),
          deliveryDumpKgtOfficeLiter: parseCsvNumber(item.deliveryDumpKgtOfficeLiter),
          deliveryDumpKgtReturnExpr: parseCsvNumber(item.deliveryDumpKgtReturnExpr),
          deliveryDumpSrgOfficeBase: parseCsvNumber(item.deliveryDumpSrgOfficeBase),
          deliveryDumpSrgOfficeLiter: parseCsvNumber(item.deliveryDumpSrgOfficeLiter),
          deliveryDumpSrgReturnExpr: parseCsvNumber(item.deliveryDumpSrgReturnExpr),
          deliveryDumpSupOfficeBase: parseCsvNumber(item.deliveryDumpSupOfficeBase),
          deliveryDumpSupOfficeLiter: parseCsvNumber(item.deliveryDumpSupOfficeLiter),
          deliveryDumpSupReturnExpr: parseCsvNumber(item.deliveryDumpSupReturnExpr),
        } satisfies WbReturnTariffItem;
      })
      .filter((item): item is WbReturnTariffItem => item !== null);
  },

  /**
   * Оперативные Продажи (Статистика v1)
   * GET /api/v1/supplier/sales
   */
  getSalesV1: async (token: string, dateFrom: string): Promise<WbSaleItem[]> => {
    const url = new URL(`${BASE_URL_V1}/supplier/sales`);
    url.searchParams.set('dateFrom', dateFrom);

    return await requestJson<WbSaleItem[]>(
      'getSalesV1',
      url.toString(),
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      []
    );
  },

  /**
   * Список карточек товаров (Контент v2)
   * POST /content/v2/get/cards/list
   */
  getCardsListPage: async (
    token: string,
    options?: {
      limit?: number;
      updatedAt?: string;
      nmID?: number;
      ascending?: boolean;
      filter?: Record<string, unknown>;
      signal?: AbortSignal;
    }
  ): Promise<WbCardsListResponse> => {
    const limit = options?.limit ?? 100;

    return await requestJson<WbCardsListResponse>(
      'getCardsListPage',
      CONTENT_CARDS_LIST_URL,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify({
          settings: {
            sort: {
              ascending: options?.ascending ?? true,
            },
            cursor: options?.updatedAt
              ? {
                  limit,
                  updatedAt: options.updatedAt,
                  nmID: options.nmID,
                }
              : { limit },
            filter: options?.filter ?? { withRoot: true }
          }
        })
      },
      { cards: [] },
      { signal: options?.signal }
    );
  },

  getCardByNmId: async (
    token: string,
    nmId: number,
    options?: { signal?: AbortSignal },
  ): Promise<WbProductCard | null> => {
    const page = await wbApi.getCardsListPage(token, {
      limit: 100,
      ascending: false,
      filter: {
        textSearch: String(nmId),
        withPhoto: -1,
      },
      signal: options?.signal,
    });

    return (page.cards ?? []).find((card) => card.nmID === nmId) ?? null;
  },

  updateProductCards: async (
    token: string,
    cards: WbProductCardUpdatePayload[],
    options?: { signal?: AbortSignal },
  ): Promise<WbContentMutationResponse> => {
    const data = await requestJson<WbContentMutationResponse>(
      'updateProductCards',
      CONTENT_CARDS_UPDATE_URL,
      {
        method: 'POST',
        headers: getHeaders(token),
        body: JSON.stringify(cards),
      },
      { data: null, error: false, errorText: '', additionalErrors: null },
      { signal: options?.signal },
    );

    if (data.error) {
      throw new WbApiError({
        message: `[WB API] updateProductCards failed: ${data.errorText || 'unknown WB error'}`,
        operation: 'updateProductCards',
        attempt: 1,
        retryable: false,
        details: JSON.stringify(data.additionalErrors ?? data.errorText ?? ''),
      });
    }

    return data;
  },

  getAllCardsList: async (
    token: string,
    limit: number = 100,
    options?: {
      filter?: Record<string, unknown>;
      signal?: AbortSignal;
    }
  ): Promise<WbProductCard[]> => {
    const cardsByNmId = new Map<number, WbProductCard>();
    let cursor: WbCardsListCursor | null = null;

    while (true) {
      const page = await wbApi.getCardsListPage(token, {
        limit,
        updatedAt: cursor?.updatedAt,
        nmID: cursor?.nmID,
        ascending: true,
        filter: options?.filter,
        signal: options?.signal,
      });

      const cards = Array.isArray(page.cards) ? page.cards : [];
      for (const card of cards) {
        if (typeof card.nmID === 'number' && Number.isFinite(card.nmID) && card.nmID > 0) {
          cardsByNmId.set(card.nmID, card);
        }
      }

      if (cards.length === 0 || cards.length < limit) {
        break;
      }

      const nextCursor = page.cursor;
      if (!nextCursor?.updatedAt || !Number.isFinite(nextCursor.nmID)) {
        break;
      }

      cursor = nextCursor;
    }

    return Array.from(cardsByNmId.values());
  },

  /**
   * Список цен и скидок (Цены v2)
   * GET /api/v2/list/goods/filter
   */
  getPrices: async (token: string, limit: number = 1000): Promise<WbPriceItem[]> => {
    const url = 'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=' + limit;

    const data = await requestJson<WbPricesResponse>(
      'getPrices',
      url,
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      { data: { listGoods: [] } }
    );

    return (data.data?.listGoods || []).map((item) => {
      const sizes = Array.isArray(item.sizes) ? item.sizes : [];
      const pricedSize = sizes.find((size) => typeof size.price === 'number' && Number.isFinite(size.price))
        ?? sizes.find((size) => typeof size.discountedPrice === 'number' && Number.isFinite(size.discountedPrice))
        ?? null;

      return {
        ...item,
        price: pricedSize?.price ?? item.price ?? 0,
        discount: item.discount ?? 0,
        spp: item.clubDiscount ?? item.spp ?? 0,
      };
    });
  },

  /**
   * Public WB card price snapshot. Used only as a control point for current customer price / implied SPP.
   * Amounts in the public payload are returned in kopecks.
   */
  getPublicCardPrices: async (
    nmIds: number[],
    options?: { dest?: string; spp?: number; chunkSize?: number }
  ): Promise<Map<number, WbPublicCardPriceItem>> => {
    const uniqueNmIds = Array.from(new Set(nmIds.filter((nmId) => Number.isFinite(nmId) && nmId > 0)));
    const result = new Map<number, WbPublicCardPriceItem>();
    const dest = options?.dest ?? '-1257786';
    const spp = options?.spp ?? 30;
    const chunkSize = Math.max(1, Math.min(options?.chunkSize ?? 80, 100));

    for (const chunk of chunkArray(uniqueNmIds, chunkSize)) {
      const url = `https://card.wb.ru/cards/v4/detail?appType=1&curr=rub&dest=${encodeURIComponent(dest)}&spp=${spp}&nm=${chunk.join(';')}`;
      const referer = `https://www.wildberries.ru/catalog/${chunk[0]}/detail.aspx`;
      let data: WbPublicCardPriceResponse;

      try {
        data = await requestJson<WbPublicCardPriceResponse>(
          'getPublicCardPrices',
          url,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json,text/plain,*/*',
              Referer: referer,
              'User-Agent': WB_PUBLIC_CARD_USER_AGENT,
            },
          },
          { products: [] },
          { timeoutMs: 30_000 },
        );
      } catch (error) {
        if (error instanceof WbApiError && (error.status === 403 || error.status === 498)) {
          data = await requestPublicCardJsonWithCurl<WbPublicCardPriceResponse>(url, referer);
        } else {
          throw error;
        }
      }

      for (const product of data.products ?? []) {
        const nmID = product.id;
        const price = product.sizes?.find((size) => (
          Number.isFinite(size.price?.product) || Number.isFinite(size.price?.basic)
        ))?.price;

        if (!nmID || !price) {
          continue;
        }

        const basic = Number(price.basic ?? 0);
        const customer = Number(price.product ?? 0);
        result.set(nmID, {
          nmID,
          basicPrice: Number.isFinite(basic) ? basic / 100 : 0,
          customerPrice: Number.isFinite(customer) ? customer / 100 : 0,
        });
      }
    }

    return result;
  },

  /**
   * GET /api/v1/analytics/region-sale — Sales by region (federal district).
   * Shows WHERE customers order FROM (demand by region), not where stock is.
   * Max period: 31 days. Rate limit: 1 req / 10 sec.
   */
  async getRegionSales(token: string, dateFrom: string, dateTo: string): Promise<Array<{
    nmId: number;
    foName: string;
    regionName: string;
    cityName: string;
    countryName: string;
    saleItemInvoiceQty: number;
    saleInvoiceCostPrice: number;
    saleInvoiceCostPricePerc: number;
    sa: string;
  }>> {
    const url = `${REGION_SALE_URL}?dateFrom=${dateFrom}&dateTo=${dateTo}`;
    const body = await requestJson<{ report?: unknown[] } | null>(
      'getRegionSales',
      url,
      {
        method: 'GET',
        headers: getHeaders(token),
      },
      { report: [] },
    );
    const report = Array.isArray(body?.report) ? body.report : [];

    return report.map((rawItem: unknown) => {
      const item = rawItem as Record<string, unknown>;
      return {
      nmId: Number(item.nmID ?? item.nmId ?? 0),
      foName: typeof item.foName === 'string' ? item.foName.trim() : '',
      regionName: typeof item.regionName === 'string' ? item.regionName.trim() : '',
      cityName: typeof item.cityName === 'string' ? item.cityName.trim() : '',
      countryName: typeof item.countryName === 'string' ? item.countryName.trim() : '',
      saleItemInvoiceQty: Number(item.saleItemInvoiceQty ?? 0),
      saleInvoiceCostPrice: Number(item.saleInvoiceCostPrice ?? 0),
      saleInvoiceCostPricePerc: Number(item.saleInvoiceCostPricePerc ?? 0),
      sa: typeof item.sa === 'string' ? item.sa : '',
    };
    });
  },

  /**
   * Pause advertising campaign
   * GET /adv/v0/pause?id={campaignId}
   */
  pauseAdvert: async (
    token: string,
    campaignId: number,
    options?: {
      signal?: AbortSignal;
      verify?: boolean;
    },
  ): Promise<void> => {
    await requestAdvertJson<Record<string, unknown>>(
      'pauseAdvert',
      `https://advert-api.wildberries.ru/adv/v0/pause?id=${campaignId}`,
      { method: 'GET', headers: getHeaders(token) },
      {},
      { signal: options?.signal, timeoutMs: AD_API_TIMEOUT_MS },
    );

    if (options?.verify !== false) {
      await verifyAdvertStatus(token, campaignId, AD_STATUS_PAUSED, 'pauseAdvert', {
        signal: options?.signal,
      });
    }
  },

  /**
   * Resume (start) advertising campaign
   * GET /adv/v0/start?id={campaignId}
   */
  resumeAdvert: async (
    token: string,
    campaignId: number,
    options?: {
      signal?: AbortSignal;
      verify?: boolean;
    },
  ): Promise<void> => {
    await requestAdvertJson<Record<string, unknown>>(
      'resumeAdvert',
      `https://advert-api.wildberries.ru/adv/v0/start?id=${campaignId}`,
      { method: 'GET', headers: getHeaders(token) },
      {},
      { signal: options?.signal, timeoutMs: AD_API_TIMEOUT_MS },
    );

    if (options?.verify !== false) {
      await verifyAdvertStatus(token, campaignId, AD_STATUS_ACTIVE, 'resumeAdvert', {
        signal: options?.signal,
      });
    }
  },

  /**
   * Async report «Остатки на складах» — same dataset that the cabinet's
   * "Аналитика → Отчёт по остаткам" Excel export shows.
   *
   * Pipeline:
   *  - GET .../warehouse_remains?groupByNm=true → { taskId }
   *  - poll GET .../warehouse_remains/tasks/{taskId}/status until status='done'
   *  - GET .../warehouse_remains/tasks/{taskId}/download → array of items
   *
   * Each item carries `nmId`, `volume` (litres — same number as «Объём, л» in
   * the xlsx), and a `warehouses[]` array with per-warehouse quantities (the
   * physical WB warehouse names like «Коледино», «Электросталь», plus
   * pseudo-rows like «В пути до получателей», «Всего находится на складах»).
   *
   * Rate limit: 1 task per minute per token. Polling timeout: ~60 s.
   */
  getWarehouseRemains: async (
    token: string,
    options: { groupByNm?: boolean; groupBySize?: boolean } = {},
  ): Promise<Array<{
    nmId: number;
    volume: number | null;
    warehouses: Array<{ warehouseName: string; quantity: number }>;
  }>> => {
    const groupByNm = options.groupByNm ?? true;
    const groupBySize = options.groupBySize ?? false;
    const headers = getHeaders(token);

    const createUrl = `${WAREHOUSE_REMAINS_BASE_URL}?groupByNm=${groupByNm}&groupBySize=${groupBySize}`;
    const created = await requestJson<{ data?: { taskId?: string } } | null>(
      'getWarehouseRemains.create',
      createUrl,
      { method: 'GET', headers },
      { data: { taskId: '' } },
    );
    const taskId = created?.data?.taskId;
    if (!taskId) {
      throw new Error('[WB API] warehouse_remains: no taskId returned');
    }

    const POLL_INTERVAL_MS = 4_000;
    const MAX_ATTEMPTS = 30; // 30 × 4s = 2 min ceiling
    let status = '';
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      const statusUrl = `${WAREHOUSE_REMAINS_BASE_URL}/tasks/${taskId}/status`;
      const statusRes = await requestJson<{ data?: { status?: string } } | null>(
        'getWarehouseRemains.status',
        statusUrl,
        { method: 'GET', headers },
        { data: { status: '' } },
      );
      status = statusRes?.data?.status ?? '';
      if (status === 'done') break;
      if (status === 'canceled' || status === 'purged') {
        throw new Error(`[WB API] warehouse_remains task ${taskId} ${status}`);
      }
    }
    if (status !== 'done') {
      throw new Error(`[WB API] warehouse_remains task ${taskId} not ready after ${MAX_ATTEMPTS} attempts`);
    }

    const downloadUrl = `${WAREHOUSE_REMAINS_BASE_URL}/tasks/${taskId}/download`;
    const rows = await requestJson<unknown[] | null>(
      'getWarehouseRemains.download',
      downloadUrl,
      { method: 'GET', headers },
      [],
    );
    if (!Array.isArray(rows)) return [];

    return rows
      .map((rawRow) => {
        const row = rawRow as Record<string, unknown>;
        const nmId = asNumber(row.nmId);
        if (nmId === undefined) return null;
        const volumeRaw = asFiniteNumber(row.volume);
        const warehousesRaw = Array.isArray(row.warehouses) ? row.warehouses : [];
        const warehouses = warehousesRaw
          .map((w) => {
            const obj = w as Record<string, unknown>;
            const warehouseName = asString(obj.warehouseName);
            const quantity = asNumber(obj.quantity) ?? 0;
            if (!warehouseName) return null;
            return { warehouseName, quantity };
          })
          .filter((item): item is { warehouseName: string; quantity: number } => item !== null);
        return { nmId, volume: volumeRaw ?? null, warehouses };
      })
      .filter((item): item is {
        nmId: number;
        volume: number | null;
        warehouses: Array<{ warehouseName: string; quantity: number }>;
      } => item !== null);
  },
};
