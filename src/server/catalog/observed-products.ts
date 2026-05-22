import { sql } from 'drizzle-orm';

import { db, withTenantContext } from '@/lib/db';
import { products } from '@/lib/db/schema';
import { getWbPhotoUrl } from '@/lib/wb-api/wb-photos';

type ObservedCatalogRow = {
  nmId: number;
  vendorCode: string | null;
  photoUrl: string | null;
  title: string | null;
  photosCount: number | string | null;
  hasVideo: boolean | null;
  currentPrice: number | string | null;
  currentDiscount: number | string | null;
  currentSpp: number | string | null;
  currentStock: number | string | null;
  activeWarehouses: number | string | null;
  inWayToClient: number | string | null;
  inWayFromClient: number | string | null;
  costPrice: number | string | null;
  costPriceUpdatedAt: Date | string | null;
  isArchived: boolean;
  isHidden: boolean;
  isObservedOnly: boolean;
};

export type ProductOptionRow = {
  nmId: number;
  vendorCode: string;
  photoUrl: string | null;
  title: string | null;
  photosCount: number | null;
  hasVideo: boolean | null;
  currentPrice: number | null;
  currentDiscount: number | null;
  currentSpp: number | null;
  currentStock: number | null;
  activeWarehouses: number | null;
  currentInWayToClient: number | null;
  currentInWayFromClient: number | null;
  costPrice: number | null;
  costPriceUpdatedAt: string | null;
  isArchived: boolean;
  isObservedOnly: boolean;
};

function normalizePhotoUrl(photoUrl: string | null | undefined) {
  const trimmed = photoUrl?.trim();
  return trimmed ? trimmed : null;
}

function normalizeNumericValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTimestampValue(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const observedCatalogQuery = (tenantId: string) => sql<ObservedCatalogRow>`
  WITH observed_raw AS (
    SELECT nm_id FROM raw_api_funnel_stats WHERE tenant_id = ${tenantId}
    UNION
    SELECT nm_id FROM raw_api_orders WHERE tenant_id = ${tenantId}
    UNION
    SELECT nm_id FROM raw_api_sales WHERE tenant_id = ${tenantId}
    UNION
    SELECT nm_id FROM raw_api_realization_reports WHERE tenant_id = ${tenantId}
    UNION
    SELECT nm_id FROM raw_api_ad_costs WHERE tenant_id = ${tenantId}
    UNION
    SELECT nm_id FROM raw_api_product_metadata WHERE tenant_id = ${tenantId}
  ),
  catalog_nm AS (
    SELECT nm_id FROM products WHERE tenant_id = ${tenantId}
    UNION
    SELECT nm_id FROM observed_raw
  ),
  latest_prices AS (
    SELECT DISTINCT ON (tenant_id, nm_id)
      tenant_id,
      nm_id,
      price,
      discount,
      spp,
      updated_at
    FROM raw_api_prices
    WHERE tenant_id = ${tenantId}
    ORDER BY tenant_id, nm_id, updated_at DESC
  ),
  stock_totals AS (
    SELECT
      tenant_id,
      nm_id,
      SUM(amount)::numeric AS current_stock,
      COUNT(*) FILTER (WHERE amount > 0)::numeric AS active_warehouses,
      SUM(in_way_to_client)::numeric AS in_way_to_client,
      SUM(in_way_from_client)::numeric AS in_way_from_client
    FROM raw_api_stocks
    WHERE tenant_id = ${tenantId}
    GROUP BY tenant_id, nm_id
  ),
  latest_costs AS (
    SELECT DISTINCT ON (tenant_id, nm_id)
      tenant_id,
      nm_id,
      cost_price,
      effective_from
    FROM unit_economics_configs
    WHERE tenant_id = ${tenantId}
    ORDER BY tenant_id, nm_id, effective_from DESC
  )
  SELECT
    catalog_nm.nm_id AS "nmId",
    p.vendor_code AS "vendorCode",
    p.photo_url AS "photoUrl",
    m.title AS "title",
    m.photos_count AS "photosCount",
    m.has_video AS "hasVideo",
    lp.price AS "currentPrice",
    lp.discount AS "currentDiscount",
    lp.spp AS "currentSpp",
    st.current_stock AS "currentStock",
    st.active_warehouses AS "activeWarehouses",
    st.in_way_to_client AS "inWayToClient",
    st.in_way_from_client AS "inWayFromClient",
    lc.cost_price AS "costPrice",
    lc.effective_from AS "costPriceUpdatedAt",
    COALESCE(p.is_archived, TRUE) AS "isArchived",
    COALESCE(p.is_hidden, FALSE) AS "isHidden",
    (p.nm_id IS NULL) AS "isObservedOnly"
  FROM catalog_nm
  LEFT JOIN products p
    ON p.tenant_id = ${tenantId}
   AND p.nm_id = catalog_nm.nm_id
  LEFT JOIN raw_api_product_metadata m
    ON m.tenant_id = ${tenantId}
   AND m.nm_id = catalog_nm.nm_id
  LEFT JOIN latest_prices lp
    ON lp.tenant_id = ${tenantId}
   AND lp.nm_id = catalog_nm.nm_id
  LEFT JOIN stock_totals st
    ON st.tenant_id = ${tenantId}
   AND st.nm_id = catalog_nm.nm_id
  LEFT JOIN latest_costs lc
    ON lc.tenant_id = ${tenantId}
   AND lc.nm_id = catalog_nm.nm_id
  WHERE catalog_nm.nm_id > 0
`;

export async function listObservedProductOptions(tenantId: string): Promise<ProductOptionRow[]> {
  const rows = await withTenantContext(db, tenantId, (tx) =>
    tx.execute(observedCatalogQuery(tenantId)),
  );
  const catalogRows = rows as unknown as ObservedCatalogRow[];

  return catalogRows
    .filter((row) => !row.isHidden)
    .map((row) => {
      const nmId = Number(row.nmId);
      const title = row.title?.trim() || null;
      const vendorCode = row.vendorCode?.trim() || title || `WB ${nmId}`;

      return {
        nmId,
        vendorCode,
        photoUrl: normalizePhotoUrl(row.photoUrl) ?? getWbPhotoUrl(nmId),
        title,
        photosCount: normalizeNumericValue(row.photosCount),
        hasVideo: row.hasVideo === null ? null : Boolean(row.hasVideo),
        currentPrice: normalizeNumericValue(row.currentPrice),
        currentDiscount: normalizeNumericValue(row.currentDiscount),
        currentSpp: normalizeNumericValue(row.currentSpp),
        currentStock: normalizeNumericValue(row.currentStock),
        activeWarehouses: normalizeNumericValue(row.activeWarehouses),
        currentInWayToClient: normalizeNumericValue(row.inWayToClient),
        currentInWayFromClient: normalizeNumericValue(row.inWayFromClient),
        costPrice: normalizeNumericValue(row.costPrice),
        costPriceUpdatedAt: normalizeTimestampValue(row.costPriceUpdatedAt),
        isArchived: Boolean(row.isArchived),
        isObservedOnly: Boolean(row.isObservedOnly),
      };
    })
    .sort((left, right) => {
      if (left.isArchived !== right.isArchived) {
        return left.isArchived ? 1 : -1;
      }

      if (left.isObservedOnly !== right.isObservedOnly) {
        return left.isObservedOnly ? 1 : -1;
      }

      return left.vendorCode.localeCompare(right.vendorCode, 'ru', { sensitivity: 'base' })
        || left.nmId - right.nmId;
    });
}

export async function reconcileObservedProducts(tenantId: string): Promise<number> {
  return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx.execute(sql<{ nmId: number }>`
      WITH observed_raw AS (
        SELECT nm_id FROM raw_api_funnel_stats WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_orders WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_sales WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_realization_reports WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_ad_costs WHERE tenant_id = ${tenantId}
        UNION
        SELECT nm_id FROM raw_api_product_metadata WHERE tenant_id = ${tenantId}
      )
      SELECT observed_raw.nm_id AS "nmId"
      FROM observed_raw
      LEFT JOIN products p
        ON p.tenant_id = ${tenantId}
       AND p.nm_id = observed_raw.nm_id
      WHERE observed_raw.nm_id > 0
        AND p.nm_id IS NULL
    `);
    const missingRows = rows as unknown as Array<{ nmId: number }>;

    const missing = missingRows.map((row) => Number(row.nmId)).filter((nmId) => Number.isFinite(nmId) && nmId > 0);
    if (missing.length === 0) {
      return 0;
    }

    await tx.insert(products).values(
      missing.map((nmId) => ({
        tenantId,
        nmId,
        vendorCode: `WB ${nmId}`,
        brand: null,
        category: null,
        photoUrl: getWbPhotoUrl(nmId),
        isArchived: true,
      }))
    ).onConflictDoNothing();

    return missing.length;
  });
}
