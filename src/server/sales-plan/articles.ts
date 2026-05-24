/**
 * Article catalogue for the Sales Plan page.
 *
 * Returns the tenant's active products (not hidden / not archived) with
 * a quick aggregate of recent orders and current stock so the picker can
 * show photo + KPI per article without extra round-trips.
 */

import { sql } from 'drizzle-orm';
import { db, withTenantContext } from '@/lib/db';

export type SalesPlanArticle = {
  nmId: number;
  vendorCode: string;
  brand: string | null;
  category: string | null;
  photoUrl: string | null;
  /** Total qty in WB stock (sum across warehouses, snapshot). */
  stockQty: number;
  /** Orders count over the last 28 days. */
  orders28d: number;
  /** Revenue over the last 28 days, RUB (rough). */
  revenue28d: number;
};

export async function listSalesPlanArticles(tenantId: string): Promise<SalesPlanArticle[]> {
  return withTenantContext(db, tenantId, async (tx) => {
    // Single CTE: products LEFT JOIN aggregated stocks + LEFT JOIN aggregated orders.
    // We tolerate the absence of raw_api_* data — values just come back as zero.
    const result = await tx.execute(sql`
      WITH stock_agg AS (
        SELECT nm_id, COALESCE(SUM(quantity), 0)::numeric AS qty
        FROM raw_api_stocks
        WHERE tenant_id = ${tenantId}
          AND last_change_date >= NOW() - INTERVAL '7 days'
        GROUP BY nm_id
      ),
      order_agg AS (
        SELECT nm_id,
               COUNT(*)::numeric                          AS cnt,
               COALESCE(SUM(price_with_disc), 0)::numeric AS rev
        FROM raw_api_orders
        WHERE tenant_id = ${tenantId}
          AND date >= NOW() - INTERVAL '28 days'
          AND is_cancel = false
        GROUP BY nm_id
      )
      SELECT
        p.nm_id::text                        AS nm_id,
        p.vendor_code                        AS vendor_code,
        p.brand                              AS brand,
        p.category                           AS category,
        p.photo_url                          AS photo_url,
        COALESCE(s.qty, 0)::text             AS stock_qty,
        COALESCE(o.cnt, 0)::text             AS orders_28d,
        COALESCE(o.rev, 0)::text             AS revenue_28d
      FROM products p
      LEFT JOIN stock_agg s ON s.nm_id = p.nm_id
      LEFT JOIN order_agg o ON o.nm_id = p.nm_id
      WHERE p.tenant_id = ${tenantId}
        AND p.is_hidden = false
        AND p.is_archived = false
      ORDER BY COALESCE(o.cnt, 0) DESC, p.vendor_code ASC
      LIMIT 500
    `);

    const rows = result as unknown as Array<{
      nm_id: string;
      vendor_code: string;
      brand: string | null;
      category: string | null;
      photo_url: string | null;
      stock_qty: string;
      orders_28d: string;
      revenue_28d: string;
    }>;
    return rows.map((r) => ({
      nmId: Number(r.nm_id),
      vendorCode: r.vendor_code,
      brand: r.brand,
      category: r.category,
      photoUrl: r.photo_url,
      stockQty: Number(r.stock_qty),
      orders28d: Number(r.orders_28d),
      revenue28d: Number(r.revenue_28d),
    }));
  });
}
