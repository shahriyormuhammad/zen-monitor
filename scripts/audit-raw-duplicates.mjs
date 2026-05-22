#!/usr/bin/env node
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[audit:raw-duplicates] DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });

const checks = [
  {
    key: "raw_api_ad_clusters",
    label: "raw_api_ad_clusters (tenant,nm,date,cluster)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, nm_id, date, cluster, COUNT(*) AS cnt
        FROM raw_api_ad_clusters
        GROUP BY 1,2,3,4
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_ad_costs",
    label: "raw_api_ad_costs (tenant,nm,date,coalesce(placement))",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, nm_id, date, COALESCE(placement, '__NULL__') AS placement_key, COUNT(*) AS cnt
        FROM raw_api_ad_costs
        GROUP BY 1,2,3,4
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_funnel_stats",
    label: "raw_api_funnel_stats (tenant,nm,period_start,period_end)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, nm_id, period_start, period_end, COUNT(*) AS cnt
        FROM raw_api_funnel_stats
        GROUP BY 1,2,3,4
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_orders",
    label: "raw_api_orders (srid)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT srid, COUNT(*) AS cnt
        FROM raw_api_orders
        GROUP BY 1
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_paid_storage",
    label: "raw_api_paid_storage (tenant,nm,date,coalesce(warehouse))",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, nm_id, date, COALESCE(warehouse_name, '__NULL__') AS warehouse_key, COUNT(*) AS cnt
        FROM raw_api_paid_storage
        GROUP BY 1,2,3,4
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_price_snapshots",
    label: "raw_api_price_snapshots (tenant,nm,snapshot_date,snapshot_slot)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, nm_id, snapshot_date, snapshot_slot, COUNT(*) AS cnt
        FROM raw_api_price_snapshots
        GROUP BY 1,2,3,4
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_prices",
    label: "raw_api_prices (tenant,nm)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, nm_id, COUNT(*) AS cnt
        FROM raw_api_prices
        GROUP BY 1,2
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_product_metadata",
    label: "raw_api_product_metadata (tenant,nm)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, nm_id, COUNT(*) AS cnt
        FROM raw_api_product_metadata
        GROUP BY 1,2
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_realization_reports",
    label: "raw_api_realization_reports (rrd_id)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT rrd_id, COUNT(*) AS cnt
        FROM raw_api_realization_reports
        GROUP BY 1
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_region_sales",
    label: "raw_api_region_sales (id)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT id, COUNT(*) AS cnt
        FROM raw_api_region_sales
        GROUP BY 1
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_sales",
    label: "raw_api_sales (tenant,sale_id,nm)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, sale_id, nm_id, COUNT(*) AS cnt
        FROM raw_api_sales
        GROUP BY 1,2,3
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_stock_offices",
    label: "raw_api_stock_offices (tenant,snapshot,stock_type,region,coalesce(office_id),office_name)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, snapshot_date, stock_type, region_name, COALESCE(office_id, -1) AS office_id_key, office_name, COUNT(*) AS cnt
        FROM raw_api_stock_offices
        GROUP BY 1,2,3,4,5,6
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_stock_sizes",
    label: "raw_api_stock_sizes (tenant,snapshot,stock_type,nm,size,coalesce(chrt),region,coalesce(office),office_name)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, snapshot_date, stock_type, nm_id, size_name, COALESCE(chrt_id, -1) AS chrt_key, region_name, COALESCE(office_id, -1) AS office_key, office_name, COUNT(*) AS cnt
        FROM raw_api_stock_sizes
        GROUP BY 1,2,3,4,5,6,7,8,9
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_stocks",
    label: "raw_api_stocks (tenant,nm,warehouse)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, nm_id, warehouse_name, COUNT(*) AS cnt
        FROM raw_api_stocks
        GROUP BY 1,2,3
        HAVING COUNT(*) > 1
      ) t
    `,
  },
  {
    key: "raw_api_ad_costs_layer_overlap",
    label: "raw_api_ad_costs semantic overlap (tenant,nm,day has >1 type layer)",
    query: `
      SELECT COUNT(*)::bigint AS groups, COALESCE(SUM(type_cnt - 1), 0)::bigint AS extra_rows
      FROM (
        SELECT tenant_id, nm_id, date::date AS day_key, COUNT(DISTINCT type) AS type_cnt
        FROM raw_api_ad_costs
        GROUP BY 1,2,3
        HAVING COUNT(DISTINCT type) > 1
      ) t
    `,
  },
];

const run = async () => {
  try {
    const rows = [];
    for (const check of checks) {
      const [result] = await sql.unsafe(check.query);
      rows.push({
        table: check.key,
        label: check.label,
        groups: Number(result?.groups ?? 0),
        extraRows: Number(result?.extra_rows ?? 0),
      });
    }

    const withDuplicates = rows.filter((row) => row.extraRows > 0);
    for (const row of rows) {
      console.log(
        `[audit:raw-duplicates] ${row.table}: groups=${row.groups} extraRows=${row.extraRows} (${row.label})`,
      );
    }

    if (withDuplicates.length > 0) {
      console.error(
        `[audit:raw-duplicates] FAILED: duplicate groups found in ${withDuplicates.length} table(s)`,
      );
      process.exit(2);
    }

    console.log("[audit:raw-duplicates] OK: no duplicate groups across RAW business keys");
  } finally {
    await sql.end({ timeout: 5 });
  }
};

run().catch((error) => {
  console.error("[audit:raw-duplicates] fatal:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
