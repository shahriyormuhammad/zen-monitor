import { and, eq, inArray } from 'drizzle-orm';

import { normalizeLocalityIndexMultiplier } from '@/components/economics/constants';
import { parseManualFieldsFromUnknown } from '@/components/economics/manual-fields-io';
import type { ManualFields } from '@/components/economics/types';
import type {
  AgentApiClient,
  ProcifryConfidence,
  ProcifryWorkerId,
} from '@/lib/agent-api';
import { db, type DrizzleTransaction, withTenantContext } from '@/lib/db';
import {
  procifryAgentAuditLog,
  products,
  unitEconomicsManualInputs,
} from '@/lib/db/schema';
import { AppError } from '@/lib/errors';
import { createProcifryRecord } from '@/server/agent/procifry';

import { formatManualDecimal } from './procifry-approval-cost';

export const PROCIFRY_UNIT_ECONOMICS_INDICES_ACTION_TYPES = [
  'unit_economics_indices_update',
] as const;

export type ProcifryUnitEconomicsIndicesActionType = (typeof PROCIFRY_UNIT_ECONOMICS_INDICES_ACTION_TYPES)[number];

export type UnitEconomicsIndicesUpdateItem = {
  nmId: number;
  localityIndexPercent: number | null;
  irpPercent: number | null;
};

type ParsedIndicesPayload =
  | {
      mode: 'items';
      items: UnitEconomicsIndicesUpdateItem[];
    }
  | {
      mode: 'all_active_skus';
      values: {
        localityIndexPercent: number | null;
        irpPercent: number | null;
      };
    };

export type ProcifryUnitEconomicsIndicesActionRequest = {
  workerId: ProcifryWorkerId;
  tenantId: string;
  tenantIds: string[];
  cabinetOid: string;
  multiTenant: boolean;
  periodFrom: Date;
  periodTo: Date;
  source: string;
  sourceUpdatedAt: Date;
  confidence: ProcifryConfidence;
  actionType: ProcifryUnitEconomicsIndicesActionType;
  payload: Record<string, unknown>;
};

const LOCALITY_KEYS = [
  'localityIndexPercent',
  'locality_index_percent',
  'localizationIndexPercent',
  'localization_index_percent',
  'localizationIndex',
  'localization_index',
  'localityIndex',
  'locality_index',
  'il',
  'IL',
  'ил',
  'ИЛ',
] as const;

const IRP_KEYS = [
  'irpPercent',
  'irp_percent',
  'salesDistributionIndex',
  'sales_distribution_index',
  'salesDistributionIndexPercent',
  'sales_distribution_index_percent',
  'irp',
  'IRP',
  'ирп',
  'ИРП',
] as const;

const MAX_BATCH_ITEMS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function pick(source: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null && source[key] !== '') {
      return source[key];
    }
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s+/g, '').replace(',', '.');
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

function parsePercent(
  value: unknown,
  field: string,
): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = toNumber(value);
  if (parsed === null) {
    throw new AppError(`${field} must be a valid number`, 400);
  }
  if (parsed < 0 || parsed > 100) {
    throw new AppError(`${field} must be between 0 and 100`, 400);
  }
  return roundPercent(parsed);
}

function parseLocalityIndex(
  value: unknown,
  field: string,
): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = toNumber(value);
  if (parsed === null) {
    throw new AppError(`${field} must be a valid number`, 400);
  }
  if (parsed <= 0 || parsed > 100) {
    throw new AppError(`${field} must be between 0.5 and 2.0, or a legacy percent delta up to 100`, 400);
  }
  return roundPercent(normalizeLocalityIndexMultiplier(parsed));
}

function parseNmId(raw: Record<string, unknown>, index: number): number {
  const nmId = toNumber(
    raw.nmId
    ?? raw.nm_id
    ?? raw.nmid
    ?? raw.sku
    ?? raw.article
    ?? raw.articleId,
  );
  if (nmId === null || !Number.isInteger(nmId) || nmId <= 0) {
    throw new AppError(`items[${index}].nmId must be a positive integer`, 400);
  }
  return nmId;
}

function parseValues(raw: Record<string, unknown>, fieldPrefix: string) {
  const localityIndexPercent = parseLocalityIndex(
    pick(raw, LOCALITY_KEYS),
    `${fieldPrefix}.localityIndexPercent`,
  );
  const irpPercent = parsePercent(
    pick(raw, IRP_KEYS),
    `${fieldPrefix}.irpPercent`,
  );

  if (localityIndexPercent === null && irpPercent === null) {
    throw new AppError(`${fieldPrefix} must include localityIndexPercent and/or irpPercent`, 400);
  }

  return { localityIndexPercent, irpPercent };
}

function parseItemsMode(payload: Record<string, unknown>): ParsedIndicesPayload {
  const rawItems = Array.isArray(payload.items)
    ? payload.items
    : [payload];
  if (rawItems.length === 0) {
    throw new AppError('unit_economics_indices_update payload has no items', 400);
  }

  const defaultsSource = isRecord(payload.values) ? payload.values : payload;
  const defaultLocality = parsePercent(
    pick(defaultsSource, LOCALITY_KEYS),
    'values.localityIndexPercent',
  );
  const defaultIrp = parsePercent(
    pick(defaultsSource, IRP_KEYS),
    'values.irpPercent',
  );

  const items = rawItems.map((rawItem, index) => {
    if (!isRecord(rawItem)) {
      throw new AppError(`items[${index}] must be an object`, 400);
    }
    const nmId = parseNmId(rawItem, index);
    const itemLocality = parsePercent(
      pick(rawItem, LOCALITY_KEYS),
      `items[${index}].localityIndexPercent`,
    );
    const itemIrp = parsePercent(
      pick(rawItem, IRP_KEYS),
      `items[${index}].irpPercent`,
    );
    const values = {
      localityIndexPercent: itemLocality ?? defaultLocality,
      irpPercent: itemIrp ?? defaultIrp,
    };
    if (values.localityIndexPercent === null && values.irpPercent === null) {
      throw new AppError(`items[${index}] must include localityIndexPercent and/or irpPercent`, 400);
    }
    return {
      nmId,
      localityIndexPercent: values.localityIndexPercent,
      irpPercent: values.irpPercent,
    };
  });

  return {
    mode: 'items',
    items,
  };
}

export function parseUnitEconomicsIndicesUpdatePayload(payload: unknown): ParsedIndicesPayload {
  if (!isRecord(payload)) {
    throw new AppError('unit_economics_indices_update payload must be an object', 400);
  }

  const scope = toText(payload.scope)?.toLowerCase();
  if (scope === 'all_active_skus') {
    if (Array.isArray(payload.items) && payload.items.length > 0) {
      return parseItemsMode(payload);
    }
    const valuesSource = isRecord(payload.values) ? payload.values : payload;
    const values = parseValues(valuesSource, 'values');
    return {
      mode: 'all_active_skus',
      values,
    };
  }

  return parseItemsMode(payload);
}

function dedupeItemsByNmId(items: UnitEconomicsIndicesUpdateItem[]) {
  const byNmId = new Map<number, UnitEconomicsIndicesUpdateItem>();
  for (const item of items) {
    byNmId.set(item.nmId, item);
  }
  return [...byNmId.values()];
}

async function loadActiveNmIds(
  tx: DrizzleTransaction,
  tenantId: string,
) {
  const rows = await tx
    .select({
      nmId: products.nmId,
    })
    .from(products)
    .where(and(
      eq(products.tenantId, tenantId),
      eq(products.isArchived, false),
    ));

  return rows
    .map((row) => Number(row.nmId))
    .filter((value) => Number.isInteger(value) && value > 0);
}

async function resolveUpdateItems(
  tx: DrizzleTransaction,
  tenantId: string,
  parsed: ParsedIndicesPayload,
) {
  const items = parsed.mode === 'items'
    ? dedupeItemsByNmId(parsed.items)
    : (await loadActiveNmIds(tx, tenantId)).map((nmId) => ({
        nmId,
        localityIndexPercent: parsed.values.localityIndexPercent,
        irpPercent: parsed.values.irpPercent,
      }));

  if (items.length === 0) {
    throw new AppError('No SKU rows matched for unit_economics_indices_update', 400);
  }
  if (items.length > MAX_BATCH_ITEMS) {
    throw new AppError(`Too many SKU rows: ${items.length}. Max ${MAX_BATCH_ITEMS}`, 400);
  }

  return items;
}

function cloneManualFields(manualFields: ManualFields): ManualFields {
  return {
    ...manualFields,
    selectedWarehouses: [...manualFields.selectedWarehouses],
    warehouseCosts: { ...manualFields.warehouseCosts },
    customWarehouses: manualFields.customWarehouses.map((warehouse) => ({ ...warehouse })),
    priceScenarios: {
      excellent: { ...manualFields.priceScenarios.excellent },
      good: { ...manualFields.priceScenarios.good },
      average: { ...manualFields.priceScenarios.average },
      poor: { ...manualFields.priceScenarios.poor },
    },
  };
}

export function applyUnitEconomicsIndicesUpdateToManualFields(
  manualPayload: unknown,
  item: UnitEconomicsIndicesUpdateItem,
) {
  const next = cloneManualFields(parseManualFieldsFromUnknown(manualPayload));
  const current = {
    localityIndexPercent: toNumber(next.localityIndexPercent),
    irpPercent: toNumber(next.irpPercent),
  };

  if (item.localityIndexPercent !== null) {
    next.localityIndexPercent = formatManualDecimal(item.localityIndexPercent);
  }
  if (item.irpPercent !== null) {
    next.irpPercent = formatManualDecimal(item.irpPercent);
  }

  return {
    manualFields: next,
    changed: {
      current,
      proposed: {
        localityIndexPercent: item.localityIndexPercent ?? current.localityIndexPercent,
        irpPercent: item.irpPercent ?? current.irpPercent,
      },
    },
  };
}

async function loadManualRows(
  tx: DrizzleTransaction,
  tenantId: string,
  nmIds: number[],
) {
  const rows = await tx
    .select({
      nmId: unitEconomicsManualInputs.nmId,
      manualFields: unitEconomicsManualInputs.manualFields,
    })
    .from(unitEconomicsManualInputs)
    .where(and(
      eq(unitEconomicsManualInputs.tenantId, tenantId),
      inArray(unitEconomicsManualInputs.nmId, nmIds),
    ));

  return new Map(rows.map((row) => [Number(row.nmId), row]));
}

export async function createUnitEconomicsIndicesApprovalRequest(
  client: AgentApiClient,
  request: ProcifryUnitEconomicsIndicesActionRequest,
) {
  const parsed = parseUnitEconomicsIndicesUpdatePayload(request.payload);
  const items = await withTenantContext(db, request.tenantId, (tx) =>
    resolveUpdateItems(tx, request.tenantId, parsed),
  );

  const title = items.length === 1
    ? `Обновить ИЛ/ИРП для ${items[0]?.nmId ?? 'SKU'}`
    : `Обновить ИЛ/ИРП для ${items.length} SKU`;

  const result = await createProcifryRecord(client, {
    workerId: request.workerId,
    tenantId: request.tenantId,
    tenantIds: request.tenantIds,
    cabinetOid: request.cabinetOid,
    multiTenant: request.multiTenant,
    periodFrom: request.periodFrom,
    periodTo: request.periodTo,
    source: request.source,
    sourceUpdatedAt: request.sourceUpdatedAt,
    confidence: request.confidence,
    accessMode: 'approval_required',
    resourceType: 'approval_request',
    actionType: request.actionType,
    title,
    body: 'Update unit-economics IL/IRP manual indices.',
    payload: {
      tenantId: request.tenantId,
      cabinetOid: request.cabinetOid,
      actionType: request.actionType,
      scope: parsed.mode === 'all_active_skus' ? 'all_active_skus' : 'items',
      items,
    },
    tags: ['economics-v2', 'il-irp', 'approval-required'],
    approvalId: null,
  });

  return {
    ok: true,
    actionType: request.actionType,
    approvalRequired: true,
    approvalRequestId: result.approvalRequestId,
    status: result.approvalStatus ?? 'requested',
    itemCount: items.length,
    scope: parsed.mode === 'all_active_skus' ? 'all_active_skus' : 'items',
  };
}

export async function executeUnitEconomicsIndicesUpdate(
  tx: DrizzleTransaction,
  tenantId: string,
  payload: unknown,
) {
  const parsed = parseUnitEconomicsIndicesUpdatePayload(payload);
  const items = await resolveUpdateItems(tx, tenantId, parsed);
  const nmIds = [...new Set(items.map((item) => item.nmId))];
  const manualByNmId = await loadManualRows(tx, tenantId, nmIds);
  const now = new Date();
  const appliedItems = [];

  for (const item of items) {
    const currentManual = manualByNmId.get(item.nmId)?.manualFields ?? {};
    const applied = applyUnitEconomicsIndicesUpdateToManualFields(currentManual, item);

    await tx
      .insert(unitEconomicsManualInputs)
      .values({
        tenantId,
        nmId: item.nmId,
        manualFields: applied.manualFields,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [unitEconomicsManualInputs.tenantId, unitEconomicsManualInputs.nmId],
        set: {
          manualFields: applied.manualFields,
          updatedAt: now,
        },
      });

    appliedItems.push({
      nmId: item.nmId,
      changed: applied.changed,
    });
  }

  return {
    actionType: 'unit_economics_indices_update' as const,
    itemCount: appliedItems.length,
    items: appliedItems,
    single: appliedItems.length === 1 ? appliedItems[0] : null,
  };
}

export async function writeUnitEconomicsIndicesExecutionAudit(args: {
  tx: DrizzleTransaction;
  tenantId: string;
  approvalId: string;
  cabinetOid: string;
  periodFrom: Date;
  periodTo: Date;
  confidence: string;
  decidedBy: string;
  originalWorkerId: string;
  originalClientId: string;
  responsePayload: Record<string, unknown>;
}) {
  const now = new Date();
  const [audit] = await args.tx
    .insert(procifryAgentAuditLog)
    .values({
      tenantId: args.tenantId,
      tenantIds: [args.tenantId],
      multiTenant: false,
      workerId: 'procifry-action-executor',
      clientId: 'procifry-action-executor',
      cabinetOid: args.cabinetOid,
      periodFrom: args.periodFrom,
      periodTo: args.periodTo,
      source: 'procifry_approval_executor',
      sourceUpdatedAt: now,
      confidence: args.confidence,
      accessMode: 'executed',
      resourceType: 'external_action',
      actionType: 'unit_economics_indices_update',
      outcome: 'accepted',
      approvalRequestId: args.approvalId,
      requestPayload: {
        approvalId: args.approvalId,
        decidedBy: args.decidedBy,
        originalWorkerId: args.originalWorkerId,
        originalClientId: args.originalClientId,
      },
      responsePayload: args.responsePayload,
    })
    .returning({ id: procifryAgentAuditLog.id });

  return audit?.id ?? null;
}
