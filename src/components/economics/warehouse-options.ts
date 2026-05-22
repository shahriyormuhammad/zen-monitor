import { DEFAULT_WAREHOUSES } from './constants';
import { normalizeWarehouseKey } from './helpers';
import type { ManualFields } from './types';

export type WarehouseOptionSource = 'wb' | 'fallback' | 'saved';

export type WarehouseOption = {
  id: string;
  label: string;
  source: WarehouseOptionSource;
};

const defaultWarehousesByNormalizedLabel = new Map(
  DEFAULT_WAREHOUSES.map((warehouse) => [normalizeWarehouseKey(warehouse.label), warehouse] as const),
);

const defaultWarehouseIds = new Set(DEFAULT_WAREHOUSES.map((warehouse) => warehouse.id));

function hashWarehouseLabel(label: string): string {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = ((hash << 5) - hash + label.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function isDefaultWarehouseId(warehouseId: string): boolean {
  return defaultWarehouseIds.has(warehouseId);
}

export function resolveWarehouseOptionId(label: string): string {
  const normalized = normalizeWarehouseKey(label);
  const defaultWarehouse = defaultWarehousesByNormalizedLabel.get(normalized);
  if (defaultWarehouse) {
    return defaultWarehouse.id;
  }
  return `wb-${normalized || hashWarehouseLabel(label)}`;
}

export function buildWarehouseOptions(
  wbWarehouseNames: string[],
  savedWarehouses: ManualFields['customWarehouses'],
): WarehouseOption[] {
  const byId = new Map<string, WarehouseOption>();
  const addOption = (option: WarehouseOption) => {
    const label = option.label.trim();
    if (!label) {
      return;
    }
    if (!byId.has(option.id)) {
      byId.set(option.id, { ...option, label });
    }
  };

  const wbNames = wbWarehouseNames
    .map((name) => name.trim())
    .filter((name, index, array) => name.length > 0 && array.indexOf(name) === index);

  if (wbNames.length > 0) {
    for (const label of wbNames) {
      addOption({
        id: resolveWarehouseOptionId(label),
        label,
        source: 'wb',
      });
    }
  } else {
    for (const warehouse of DEFAULT_WAREHOUSES) {
      addOption({
        ...warehouse,
        source: 'fallback',
      });
    }
  }

  for (const warehouse of savedWarehouses) {
    addOption({
      id: warehouse.id,
      label: warehouse.label,
      source: 'saved',
    });
  }

  return Array.from(byId.values());
}
