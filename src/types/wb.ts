import { z } from 'zod';

// Внутренний нормализованный формат детализации реализации.
// Старый WB v5 отдавал snake_case, новый Finance API отдаёт camelCase.
export const WbRealizationReportItemSchema = z.object({
  rrd_id: z.number().int(),
  realizationreport_id: z.number().int(),
  date_from: z.string(), // ISO date
  date_to: z.string(), // ISO date
  sale_dt: z.string().nullable().optional(), // actual sale date inside weekly report
  srid: z.string().optional().default(''),
  nm_id: z.number().int(),
  brand_name: z.string().optional().default('No Brand'),
  sa_name: z.string().optional().default(''), // Артикул поставщика
  doc_type_name: z.string().optional().default(''),
  supplier_oper_name: z.string().optional().default(''),
  bonus_type_name: z.string().optional().default(''),
  rebill_logistic_org: z.string().optional().default(''),
  office_name: z.string().nullable().optional().default(null),
  quantity: z.number().int().default(0),
  retail_amount: z.number().default(0),
  commission_amount: z.number().default(0),
  ppvz_sales_commission: z.number().optional().default(0),
  commission_percent: z.number().optional().default(0),
  delivery_rub: z.number().default(0),
  rebill_logistic_cost: z.number().optional().default(0),
  // Логистика по габаритам
  boxDeliveryMarketplaceBase: z.number().optional().default(0),
  boxDeliveryMarketplaceLiter: z.number().optional().default(0),
  storage_fee_rub: z.number().optional().default(0),
  storage_fee: z.number().optional().default(0),
  penalty_rub: z.number().optional().default(0),
  penalty: z.number().optional().default(0),
  spp_rub: z.number().optional().default(0),
  payment_schedule_rub: z.number().optional().default(0),
  payment_schedule: z.number().optional().default(0),
  ppvz_for_pay: z.number().optional().default(0),
  deduction: z.number().optional().default(0),
  additional_payment: z.number().optional().default(0),
  acquiring_fee: z.number().optional().default(0),
  return_amount: z.number().optional().default(0),
  retail_price_withdisc_rub: z.number().optional().default(0),
  acceptance: z.number().optional().default(0),
  cashback_amount: z.number().optional().default(0),
  ppvz_spp_prc: z.number().optional().default(0),
  ppvz_kvw_prc_base: z.number().optional().default(0),
  ppvz_kvw_prc: z.number().optional().default(0),
  box_delivery_base: z.number().optional().default(0),
  box_delivery_liter: z.number().optional().default(0),
  box_storage_base: z.number().optional().default(0),
  box_storage_liter: z.number().optional().default(0),
  fixation_start_date: z.string().nullable().optional().default(null),
  fixation_end_date: z.string().nullable().optional().default(null),
  is_paid_delivery_service: z.boolean().nullable().optional().default(null),
  fixed_warehouse_coefficient: z.number().nullable().optional().default(null),
}).passthrough(); // Разрешаем дополнительные поля

export const WbRealizationReportResponseSchema = z.array(WbRealizationReportItemSchema).nullable();

const numberLike = z.union([z.number(), z.string()]).optional();
const booleanLike = z.union([z.boolean(), z.number(), z.string()]).optional();

// Сырой формат нового POST /api/finance/v1/sales-reports/detailed.
export const WbFinanceDetailedSalesReportItemSchema = z.object({
  reportId: z.number().int(),
  dateFrom: z.string(),
  dateTo: z.string(),
  rrdId: z.number().int(),
  nmId: z.number().int(),
  brandName: z.string().optional(),
  vendorCode: z.string().optional(),
  docTypeName: z.string().optional(),
  quantity: z.number().int().optional().default(0),
  retailAmount: numberLike,
  commissionPercent: numberLike,
  sellerOperName: z.string().optional(),
  bonusTypeName: z.string().optional(),
  saleDt: z.string().nullable().optional(),
  srid: z.string().optional(),
  officeName: z.string().nullable().optional(),
  retailPriceWithDisc: numberLike,
  deliveryAmount: numberLike,
  returnAmount: numberLike,
  deliveryService: numberLike,
  spp: numberLike,
  kvwBase: numberLike,
  kvw: numberLike,
  ppvzSalesCommission: numberLike,
  forPay: numberLike,
  acquiringFee: numberLike,
  penalty: numberLike,
  additionalPayment: numberLike,
  rebillLogisticCost: numberLike,
  rebillLogisticOrg: z.string().optional(),
  paidStorage: numberLike,
  deduction: numberLike,
  paidAcceptance: numberLike,
  cashbackAmount: numberLike,
  cashbackDiscount: numberLike,
  paymentSchedule: numberLike,
  fixTariffDateFrom: z.string().nullable().optional(),
  fixTariffDateTo: z.string().nullable().optional(),
  dlvPrc: numberLike,
  isPaidDeliveryService: booleanLike,
}).passthrough();

export const WbFinanceDetailedSalesReportResponseSchema = z.array(WbFinanceDetailedSalesReportItemSchema).nullable();

// Схема для ответов /api/v1/supplier/orders
export const WbOrderItemSchema = z.object({
  srid: z.string(),
  nmId: z.number().int(),
  date: z.string(), // ISO date
  totalPrice: z.number().default(0),
  isCancel: z.boolean().default(false),
  warehouseName: z.string().optional(),
  warehouseType: z.string().optional(),
  countryName: z.string().optional(),
  oblastOkrugName: z.string().optional(),
  regionName: z.string().optional(),
  supplierArticle: z.string().optional(),
  barcode: z.string().optional(),
  category: z.string().optional(),
  subject: z.string().optional(),
  brand: z.string().optional(),
  techSize: z.string().optional(),
  incomeID: z.number().int().optional(),
  spp: z.number().optional(),
  finishedPrice: z.number().optional(),
  priceWithDisc: z.number().optional(),
}).passthrough();

export const WbOrderResponseSchema = z.array(WbOrderItemSchema).nullable();

// Экспорт TypeScript типов
// Схема для ответов /adv/v2/full/stat (Рекламные расходы)
export const WbAdSpendItemSchema = z.object({
  advertId: z.number().int().optional(),
  nmId: z.number().int(),
  date: z.string(),
  sum: z.number().default(0),
  orderSum: z.number().default(0),
  orderCount: z.number().int().default(0),
  views: z.number().int().default(0),
  clicks: z.number().int().default(0),
  ctr: z.number().default(0),
  cpc: z.number().default(0),
}).passthrough();

// Схема для ответов /adv/v1/normquery/stats (Кластеры)
export const WbAdClusterStatSchema = z.object({
  cluster: z.string(),
  views: z.number().int().default(0),
  clicks: z.number().int().default(0),
  ctr: z.number().default(0),
  sum: z.number().default(0),
  orders: z.number().int().default(0),
}).passthrough();

// Схема для ответов /api/analytics/v3/sales-funnel/products (Воронка)
export const WbFunnelItemSchema = z.object({
  nmId: z.number().int(),
  orderCount: z.number().int().default(0),
  orderSum: z.number().default(0),
  buyoutsCount: z.number().int().default(0),
  buyoutsSum: z.number().default(0),
  cancelCount: z.number().int().default(0),
  cancelSum: z.number().default(0),
  avgPrice: z.number().default(0),
  addToCartCount: z.number().int().default(0),
  addToCartPercent: z.number().default(0),
  cartToOrderPercent: z.number().default(0),
  orderToBuyoutPercent: z.number().default(0),
  openCardCount: z.number().int().default(0),
  // Доля локальных заказов от WB (statistic.selected.localizationPercent),
  // 0..100. Используется для авторасчёта ИРП по официальной сетке.
  localizationPercent: z.number().default(0),
}).passthrough();

export type WbAdSpendItem = z.infer<typeof WbAdSpendItemSchema>;
export type WbAdClusterStat = z.infer<typeof WbAdClusterStatSchema>;
export type WbFunnelItem = z.infer<typeof WbFunnelItemSchema>;
export type WbRealizationReportItem = z.infer<typeof WbRealizationReportItemSchema>;
export type WbFinanceDetailedSalesReportItem = z.infer<typeof WbFinanceDetailedSalesReportItemSchema>;
export type WbOrderItem = z.infer<typeof WbOrderItemSchema>;
