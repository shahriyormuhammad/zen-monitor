import { eq, sql } from 'drizzle-orm';

import { toNumber } from '@/components/economics/helpers';
import { db, withTenantContext } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { decrypt } from '@/lib/encryption';
import {
  createWbLkReadSessionFromStorageState,
  fetchWbLkReadOnlyJson,
} from '@/server/wb/lk-refresh-flow';

const WB_CABINET_WEEKLY_RATING_URL = 'https://seller.wildberries.ru/ns/categories-info/suppliers-portal-analytics/api/v1/weekly-rating';

export type CabinetEconomicsIndices = {
  localityIndex: number;
  irpPercent: number;
  source: 'wb_tariffs' | 'manual' | 'calculated_fallback' | 'none';
  effectiveWeek: string | null;
  fetchedAt: string | null;
};

type StoredIndexRow = {
  localityIndex: unknown;
  irpPercent: unknown;
  source: unknown;
  effectiveWeek: unknown;
  fetchedAt: unknown;
};

type WbCabinetWeeklyRatingResponse = {
  data?: {
    localization?: {
      percent?: unknown;
      index?: unknown;
      pricePercent?: unknown;
    };
  };
  error?: boolean;
  errorText?: string;
};

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function getMoscowWeekStartDate(value = new Date()): string {
  const moscowDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  const cursor = new Date(`${moscowDate}T00:00:00.000Z`);
  const day = cursor.getUTCDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  cursor.setUTCDate(cursor.getUTCDate() - diffToMonday);
  return dateOnly(cursor);
}

async function getStoredCabinetIndices(
  tenantId: string,
  asOfDate: Date,
): Promise<CabinetEconomicsIndices | null> {
  const asOf = dateOnly(asOfDate);
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT
      locality_index AS "localityIndex",
      irp_percent AS "irpPercent",
      source,
      effective_week::text AS "effectiveWeek",
      fetched_at::text AS "fetchedAt"
    FROM tenant_unit_economics_indices
    WHERE tenant_id = ${tenantId}::uuid
      AND effective_week <= ${asOf}::date
      AND source IN ('wb_tariffs', 'manual')
    ORDER BY effective_week DESC, fetched_at DESC
    LIMIT 1
  `)) as StoredIndexRow[];

  const row = rows[0];
  if (!row) return null;

  return {
    localityIndex: toNumber(row.localityIndex) > 0 ? toNumber(row.localityIndex) : 1,
    irpPercent: Math.max(0, toNumber(row.irpPercent)),
    source: row.source === 'wb_tariffs' || row.source === 'manual'
      ? row.source
      : 'manual',
    effectiveWeek: typeof row.effectiveWeek === 'string' ? row.effectiveWeek : null,
    fetchedAt: typeof row.fetchedAt === 'string' ? row.fetchedAt : null,
  };
}

export async function fetchCabinetIndicesFromWbTariffs(
  tenantId: string,
  asOfDate = new Date(),
): Promise<CabinetEconomicsIndices> {
  const [tenant] = await db
    .select({ storage: tenants.wbLkStorageState })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant?.storage) {
    throw new Error('WB ЛК storageState не сохранён для тенанта');
  }

  const session = await createWbLkReadSessionFromStorageState(decrypt(tenant.storage));
  const response = await fetchWbLkReadOnlyJson<WbCabinetWeeklyRatingResponse>(
    session,
    WB_CABINET_WEEKLY_RATING_URL,
    { method: 'GET', timeoutMs: 30_000 },
  );

  if (response.error) {
    throw new Error(`WB cabinet weekly-rating error: ${response.errorText ?? 'unknown'}`);
  }

  const localization = response.data?.localization;
  const localityIndex = toNumber(localization?.percent);
  const irpPercent = toNumber(localization?.pricePercent);
  if (!Number.isFinite(localityIndex) || localityIndex <= 0 || !Number.isFinite(irpPercent) || irpPercent < 0) {
    throw new Error('WB cabinet weekly-rating не вернул точные ИЛ/ИРП кабинета');
  }

  return {
    localityIndex: Math.round(localityIndex * 10_000) / 10_000,
    irpPercent: Math.round(irpPercent * 10_000) / 10_000,
    source: 'wb_tariffs',
    effectiveWeek: getMoscowWeekStartDate(asOfDate),
    fetchedAt: new Date().toISOString(),
  };
}

export async function saveCabinetIndices(
  tenantId: string,
  indices: CabinetEconomicsIndices,
): Promise<void> {
  const effectiveWeek = indices.effectiveWeek ?? getMoscowWeekStartDate();
  await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    INSERT INTO tenant_unit_economics_indices (
      tenant_id,
      effective_week,
      locality_index,
      irp_percent,
      source,
      raw_data,
      fetched_at
    ) VALUES (
      ${tenantId}::uuid,
      ${effectiveWeek}::date,
      ${indices.localityIndex},
      ${indices.irpPercent},
      ${indices.source},
      ${JSON.stringify(indices)}::jsonb,
      NOW()
    )
    ON CONFLICT (tenant_id, effective_week) DO UPDATE SET
      locality_index = EXCLUDED.locality_index,
      irp_percent = EXCLUDED.irp_percent,
      source = EXCLUDED.source,
      raw_data = EXCLUDED.raw_data,
      fetched_at = NOW()
  `));
}

export async function resolveCabinetEconomicsIndices(
  tenantId: string,
  asOfDate = new Date(),
): Promise<CabinetEconomicsIndices> {
  const stored = await getStoredCabinetIndices(tenantId, asOfDate);
  if (stored) return stored;

  return {
    localityIndex: 1,
    irpPercent: 0,
    source: 'none',
    effectiveWeek: null,
    fetchedAt: null,
  };
}

export async function refreshCabinetIndicesFromWbTariffsForTenant(
  tenantId: string,
  asOfDate = new Date(),
): Promise<CabinetEconomicsIndices> {
  const indices = await fetchCabinetIndicesFromWbTariffs(tenantId, asOfDate);
  await saveCabinetIndices(tenantId, indices);
  return indices;
}
