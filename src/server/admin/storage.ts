import { sql } from 'drizzle-orm';

import { requirePlatformAdmin } from '@/lib/auth/platform-admin';
import { db, withAdminContext, type DrizzleTransaction } from '@/lib/db';

type StorageSource = {
  key: string;
  table: string;
  label: string;
  comment: string;
  firstDateSql: string;
  lastDateSql: string;
  growthDateSql: string;
};

const STORAGE_SOURCES: StorageSource[] = [
  {
    key: 'realization_reports',
    table: 'raw_api_realization_reports',
    label: 'Финансовые отчеты',
    comment: 'Самый тяжелый источник при длинной истории продаж.',
    firstDateSql: 'date_from',
    lastDateSql: 'COALESCE(sale_dt, date_to)',
    growthDateSql: 'created_at',
  },
  { key: 'orders', table: 'raw_api_orders', label: 'Заказы', comment: 'Заказы WB по датам.', firstDateSql: 'date', lastDateSql: 'date', growthDateSql: 'created_at' },
  { key: 'sales', table: 'raw_api_sales', label: 'Продажи', comment: 'Продажи и возвраты WB.', firstDateSql: 'date', lastDateSql: 'date', growthDateSql: 'created_at' },
  { key: 'ad_costs', table: 'raw_api_ad_costs', label: 'Расходы рекламы', comment: 'Дневные расходы рекламы.', firstDateSql: 'date', lastDateSql: 'date', growthDateSql: 'created_at' },
  { key: 'ad_clusters', table: 'raw_api_ad_clusters', label: 'Кластеры рекламы', comment: 'Кластерная статистика рекламы.', firstDateSql: 'date', lastDateSql: 'date', growthDateSql: 'created_at' },
  { key: 'advertising_hourly_stats', table: 'advertising_hourly_stats', label: 'Почасовая реклама', comment: 'Может быстро расти на активной рекламе.', firstDateSql: 'stat_hour', lastDateSql: 'stat_hour', growthDateSql: 'created_at' },
  { key: 'paid_storage', table: 'raw_api_paid_storage', label: 'Платное хранение', comment: 'Начисления WB за хранение.', firstDateSql: 'date', lastDateSql: 'date', growthDateSql: 'created_at' },
  { key: 'funnel_stats', table: 'raw_api_funnel_stats', label: 'Воронка', comment: 'Воронка карточек и заказов.', firstDateSql: 'period_start', lastDateSql: 'period_end', growthDateSql: 'created_at' },
  { key: 'stocks', table: 'raw_api_stocks', label: 'Остатки', comment: 'Текущие остатки по складам.', firstDateSql: 'date', lastDateSql: 'date', growthDateSql: 'created_at' },
  { key: 'stock_offices', table: 'raw_api_stock_offices', label: 'Складская аналитика по офисам', comment: 'Регионально-офисные срезы складов.', firstDateSql: 'snapshot_date', lastDateSql: 'snapshot_date', growthDateSql: 'created_at' },
  { key: 'stock_sizes', table: 'raw_api_stock_sizes', label: 'Складская аналитика по размерам', comment: 'Размерные срезы складов.', firstDateSql: 'snapshot_date', lastDateSql: 'snapshot_date', growthDateSql: 'created_at' },
  { key: 'region_sales', table: 'raw_api_region_sales', label: 'Регионы', comment: 'Продажи по регионам.', firstDateSql: 'period_from', lastDateSql: 'period_to', growthDateSql: 'created_at' },
  { key: 'prices', table: 'raw_api_prices', label: 'Цены', comment: 'Текущие цены по товарам.', firstDateSql: 'created_at', lastDateSql: 'updated_at', growthDateSql: 'created_at' },
  { key: 'price_snapshots', table: 'raw_api_price_snapshots', label: 'SPP/снимки цен', comment: 'Исторические снимки цен и SPP.', firstDateSql: 'snapshot_at', lastDateSql: 'snapshot_at', growthDateSql: 'created_at' },
  { key: 'products', table: 'products', label: 'Товары', comment: 'Каталог товаров клиента.', firstDateSql: 'created_at', lastDateSql: 'created_at', growthDateSql: 'created_at' },
  { key: 'product_metadata', table: 'raw_api_product_metadata', label: 'Метаданные товаров', comment: 'Описание, фото и характеристики.', firstDateSql: 'updated_at', lastDateSql: 'updated_at', growthDateSql: 'updated_at' },
  { key: 'sync_runs', table: 'sync_runs', label: 'Синхронизации', comment: 'История запусков sync.', firstDateSql: 'requested_at', lastDateSql: 'COALESCE(finished_at, started_at, requested_at)', growthDateSql: 'requested_at' },
];

type SourceMetricRow = {
  tenantRows: string | number;
  totalRowsEstimate: string | number | null;
  tableSizeBytes: string | number;
  firstDate: Date | string | null;
  lastDate: Date | string | null;
};

type SourceTenantMetricRow = SourceMetricRow & {
  tenantId: string;
  recentRows7d: string | number;
};

type TableMetricRow = {
  tableSizeBytes: string | number;
  totalRowsEstimate: string | number | null;
};

type StaleSyncRow = {
  tenantId: string;
  name: string;
  shopName: string | null;
  latestSyncAt: Date | string | null;
  latestSyncStatus: string | null;
};

export type AdminStorageStatus = 'normal' | 'medium' | 'heavy';

export type AdminTenantStorageMetric = {
  key: string;
  table: string;
  label: string;
  tenantRows: number;
  totalRowsEstimate: number;
  tableSizeBytes: number;
  approxTenantSizeBytes: number;
  firstDate: Date | null;
  lastDate: Date | null;
  status: AdminStorageStatus;
  comment: string;
};

export type AdminStorageOps = {
  tableLeaders: Array<{
    table: string;
    label: string;
    tableSizeBytes: number;
    totalRowsEstimate: number;
  }>;
  tenantSizeLeaders: Array<{
    tenantId: string;
    tenantName: string;
    shopName: string | null;
    approxTenantSizeBytes: number;
    rows: number;
  }>;
  tenantRowLeaders: Array<{
    tenantId: string;
    tenantName: string;
    shopName: string | null;
    rows: number;
    approxTenantSizeBytes: number;
  }>;
  staleSyncTenants: Array<{
    tenantId: string;
    tenantName: string;
    shopName: string | null;
    latestSyncAt: Date | null;
    latestSyncStatus: string | null;
  }>;
  growingTenants: Array<{
    tenantId: string;
    tenantName: string;
    shopName: string | null;
    recentRows7d: number;
    rows: number;
  }>;
};

function assertSafeSqlFragment(value: string) {
  if (!/^[a-z0-9_(),. ]+$/i.test(value)) {
    throw new Error(`Unsafe SQL fragment: ${value}`);
  }
  return value;
}

function tableSql(table: string) {
  if (!/^[a-z0-9_]+$/i.test(table)) {
    throw new Error(`Unsafe table name: ${table}`);
  }
  return `"${table}"`;
}

function toNumber(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function estimateTenantSizeBytes(row: SourceMetricRow) {
  const tenantRows = toNumber(row.tenantRows);
  const tableSizeBytes = toNumber(row.tableSizeBytes);
  const totalRowsEstimate = Math.max(toNumber(row.totalRowsEstimate), tenantRows);
  const approxTenantSizeBytes = totalRowsEstimate > 0
    ? Math.round(tableSizeBytes * (tenantRows / totalRowsEstimate))
    : 0;

  return {
    tenantRows,
    tableSizeBytes,
    totalRowsEstimate,
    approxTenantSizeBytes,
  };
}

function classifyStorage(tenantRows: number, approxTenantSizeBytes: number): AdminStorageStatus {
  if (tenantRows >= 1_000_000 || approxTenantSizeBytes >= 1024 ** 3) return 'heavy';
  if (tenantRows >= 100_000 || approxTenantSizeBytes >= 100 * 1024 ** 2) return 'medium';
  return 'normal';
}

function mapTenantMetric(source: StorageSource, row: SourceMetricRow): AdminTenantStorageMetric {
  const estimated = estimateTenantSizeBytes(row);
  return {
    key: source.key,
    table: source.table,
    label: source.label,
    tenantRows: estimated.tenantRows,
    totalRowsEstimate: estimated.totalRowsEstimate,
    tableSizeBytes: estimated.tableSizeBytes,
    approxTenantSizeBytes: estimated.approxTenantSizeBytes,
    firstDate: toDate(row.firstDate),
    lastDate: toDate(row.lastDate),
    status: classifyStorage(estimated.tenantRows, estimated.approxTenantSizeBytes),
    comment: source.comment,
  };
}

async function loadTenantSourceMetric(tx: DrizzleTransaction, tenantId: string, source: StorageSource) {
  const table = tableSql(source.table);
  const firstDateSql = assertSafeSqlFragment(source.firstDateSql);
  const lastDateSql = assertSafeSqlFragment(source.lastDateSql);

  const rows = await tx.execute(sql<SourceMetricRow>`
    SELECT
      (SELECT COUNT(*)::bigint FROM ${sql.raw(table)} WHERE tenant_id = ${tenantId}) AS "tenantRows",
      (
        SELECT GREATEST(COALESCE(c.reltuples, 0), 0)::numeric
        FROM pg_class c
        WHERE c.oid = ${source.table}::regclass
      ) AS "totalRowsEstimate",
      pg_total_relation_size(${source.table}::regclass)::bigint AS "tableSizeBytes",
      (SELECT MIN(${sql.raw(firstDateSql)}) FROM ${sql.raw(table)} WHERE tenant_id = ${tenantId}) AS "firstDate",
      (SELECT MAX(${sql.raw(lastDateSql)}) FROM ${sql.raw(table)} WHERE tenant_id = ${tenantId}) AS "lastDate"
  `);

  const row = (rows as unknown as SourceMetricRow[])[0];
  return mapTenantMetric(source, row ?? {
    tenantRows: 0,
    totalRowsEstimate: 0,
    tableSizeBytes: 0,
    firstDate: null,
    lastDate: null,
  });
}

async function loadTenantSourceMetrics(tx: DrizzleTransaction, source: StorageSource) {
  const table = tableSql(source.table);
  const firstDateSql = assertSafeSqlFragment(source.firstDateSql);
  const lastDateSql = assertSafeSqlFragment(source.lastDateSql);
  const growthDateSql = assertSafeSqlFragment(source.growthDateSql);

  const rows = await tx.execute(sql<SourceTenantMetricRow>`
    SELECT
      tenant_id::text AS "tenantId",
      COUNT(*)::bigint AS "tenantRows",
      (
        SELECT GREATEST(COALESCE(c.reltuples, 0), 0)::numeric
        FROM pg_class c
        WHERE c.oid = ${source.table}::regclass
      ) AS "totalRowsEstimate",
      pg_total_relation_size(${source.table}::regclass)::bigint AS "tableSizeBytes",
      MIN(${sql.raw(firstDateSql)}) AS "firstDate",
      MAX(${sql.raw(lastDateSql)}) AS "lastDate",
      COUNT(*) FILTER (WHERE ${sql.raw(growthDateSql)} >= now() - interval '7 days')::bigint AS "recentRows7d"
    FROM ${sql.raw(table)}
    GROUP BY tenant_id
  `);

  return (rows as unknown as SourceTenantMetricRow[]).map((row) => ({
    ...mapTenantMetric(source, row),
    tenantId: row.tenantId,
    recentRows7d: toNumber(row.recentRows7d),
  }));
}

async function loadTableMetric(tx: DrizzleTransaction, source: StorageSource) {
  const rows = await tx.execute(sql<TableMetricRow>`
    SELECT
      pg_total_relation_size(${source.table}::regclass)::bigint AS "tableSizeBytes",
      (
        SELECT GREATEST(COALESCE(c.reltuples, 0), 0)::numeric
        FROM pg_class c
        WHERE c.oid = ${source.table}::regclass
      ) AS "totalRowsEstimate"
  `);

  const row = (rows as unknown as TableMetricRow[])[0];
  return {
    table: source.table,
    label: source.label,
    tableSizeBytes: toNumber(row?.tableSizeBytes),
    totalRowsEstimate: toNumber(row?.totalRowsEstimate),
  };
}

export async function getAdminTenantStorageMetrics(tenantId: string) {
  await requirePlatformAdmin();

  return withAdminContext(db, async (tx) => {
    const metrics: AdminTenantStorageMetric[] = [];
    for (const source of STORAGE_SOURCES) {
      metrics.push(await loadTenantSourceMetric(tx, tenantId, source));
    }
    return metrics;
  });
}

export async function getAdminStorageOps(): Promise<AdminStorageOps> {
  await requirePlatformAdmin(['owner', 'ops', 'support', 'readonly']);

  return withAdminContext(db, async (tx) => {
    const allMetrics = [];
    for (const source of STORAGE_SOURCES) {
      allMetrics.push(...await loadTenantSourceMetrics(tx, source));
    }

    const tableMetrics = [];
    for (const source of STORAGE_SOURCES) {
      tableMetrics.push(await loadTableMetric(tx, source));
    }

    const tenantRows = await tx.execute(sql<{
      tenantId: string;
      tenantName: string;
      shopName: string | null;
    }>`
      SELECT id::text AS "tenantId", name AS "tenantName", shop_name AS "shopName"
      FROM tenants
    `);

    const tenantNames = new Map((tenantRows as unknown as Array<{
      tenantId: string;
      tenantName: string;
      shopName: string | null;
    }>).map((tenant) => [tenant.tenantId, tenant]));

    const tenantTotals = new Map<string, {
      tenantId: string;
      tenantName: string;
      shopName: string | null;
      rows: number;
      approxTenantSizeBytes: number;
      recentRows7d: number;
    }>();

    for (const metric of allMetrics) {
      const tenant = tenantNames.get(metric.tenantId) ?? {
        tenantId: metric.tenantId,
        tenantName: metric.tenantId,
        shopName: null,
      };
      const current = tenantTotals.get(metric.tenantId) ?? {
        tenantId: metric.tenantId,
        tenantName: tenant.tenantName,
        shopName: tenant.shopName,
        rows: 0,
        approxTenantSizeBytes: 0,
        recentRows7d: 0,
      };

      current.rows += metric.tenantRows;
      current.approxTenantSizeBytes += metric.approxTenantSizeBytes;
      current.recentRows7d += metric.recentRows7d;
      tenantTotals.set(metric.tenantId, current);
    }

    const tableLeaders = tableMetrics
      .sort((a, b) => b.tableSizeBytes - a.tableSizeBytes)
      .slice(0, 20);

    const totals = [...tenantTotals.values()];
    const staleSyncRows = await tx.execute(sql<StaleSyncRow>`
      WITH latest_sync AS (
        SELECT DISTINCT ON (sr.tenant_id)
          sr.tenant_id,
          sr.status,
          COALESCE(sr.finished_at, sr.started_at, sr.requested_at) AS latest_sync_at
        FROM sync_runs sr
        ORDER BY sr.tenant_id, sr.requested_at DESC
      )
      SELECT
        t.id::text AS "tenantId",
        t.name,
        t.shop_name AS "shopName",
        ls.latest_sync_at AS "latestSyncAt",
        ls.status AS "latestSyncStatus"
      FROM tenants t
      LEFT JOIN latest_sync ls ON ls.tenant_id = t.id
      WHERE ls.latest_sync_at IS NULL OR ls.latest_sync_at < now() - interval '24 hours'
      ORDER BY ls.latest_sync_at ASC NULLS FIRST, t.created_at DESC
      LIMIT 30
    `);

    return {
      tableLeaders,
      tenantSizeLeaders: totals
        .sort((a, b) => b.approxTenantSizeBytes - a.approxTenantSizeBytes)
        .slice(0, 20)
        .map(({ recentRows7d: _recentRows7d, ...tenant }) => tenant),
      tenantRowLeaders: [...totals]
        .sort((a, b) => b.rows - a.rows)
        .slice(0, 20)
        .map(({ recentRows7d: _recentRows7d, ...tenant }) => tenant),
      staleSyncTenants: (staleSyncRows as unknown as StaleSyncRow[]).map((row) => ({
        tenantId: row.tenantId,
        tenantName: row.name,
        shopName: row.shopName,
        latestSyncAt: toDate(row.latestSyncAt),
        latestSyncStatus: row.latestSyncStatus,
      })),
      growingTenants: [...totals]
        .sort((a, b) => b.recentRows7d - a.recentRows7d)
        .slice(0, 20)
        .map(({ approxTenantSizeBytes: _approxTenantSizeBytes, ...tenant }) => tenant),
    };
  });
}
