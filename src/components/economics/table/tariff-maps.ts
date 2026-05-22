import { normalizeWarehouseKey, toNumber } from '../helpers';
import {
  shouldReplaceAcceptanceTariff,
  type AcceptanceTariffCandidate,
  type ReturnTariffCandidate,
} from '../tariff-helpers';
import type { WarehouseBoxTariff, WarehouseReturnTariff, WarehouseTariff } from '../types';

export function buildAcceptanceTariffMap(
  tariffs: WarehouseTariff[],
): Map<string, AcceptanceTariffCandidate> {
  const map = new Map<string, AcceptanceTariffCandidate>();
  for (const tariff of tariffs) {
    const warehouseName = typeof tariff?.warehouseName === 'string' ? tariff.warehouseName.trim() : '';
    if (!warehouseName) continue;
    const key = normalizeWarehouseKey(warehouseName);
    const payload: AcceptanceTariffCandidate = {
      warehouseName,
      boxTypeId: toNumber(tariff.boxTypeId) || null,
      allowUnload: Boolean(tariff.allowUnload),
      deliveryCoef: toNumber(tariff.deliveryCoef),
      storageCoef: toNumber(tariff.storageCoef),
      deliveryBaseLiter: toNumber(tariff.deliveryBaseLiter),
      deliveryAdditionalLiter: toNumber(tariff.deliveryAdditionalLiter),
      storageBaseLiter: toNumber(tariff.storageBaseLiter),
      storageAdditionalLiter: toNumber(tariff.storageAdditionalLiter),
      reverseBaseLiter: toNumber(tariff.reverseBaseLiter),
      reverseAdditionalLiter: toNumber(tariff.reverseAdditionalLiter),
      reverseCoef: toNumber(tariff.reverseCoef),
      coefficient: toNumber(tariff.coefficient),
      date: typeof tariff.date === 'string' ? tariff.date : null,
    };
    const existing = map.get(key);
    if (!existing || shouldReplaceAcceptanceTariff(existing, payload)) {
      map.set(key, payload);
    }
  }
  return map;
}

/**
 * `tariffs/box` is the preferred source for warehouse logistics/storage rates.
 * Map box-prefixed fields onto the common acceptance candidate shape so the
 * economics calculations can use one lookup path.
 */
export function buildAcceptanceTariffMapFromBox(
  tariffs: WarehouseBoxTariff[],
): Map<string, AcceptanceTariffCandidate> {
  const map = new Map<string, AcceptanceTariffCandidate>();
  for (const tariff of tariffs) {
    const warehouseName = typeof tariff?.warehouseName === 'string' ? tariff.warehouseName.trim() : '';
    if (!warehouseName) continue;
    const geoName = typeof tariff?.geoName === 'string' ? tariff.geoName.trim() : '';
    const payload: AcceptanceTariffCandidate = {
      warehouseName,
      boxTypeId: 2,
      allowUnload: true,
      deliveryCoef: toNumber(tariff.boxDeliveryCoefExpr),
      storageCoef: toNumber(tariff.boxStorageCoefExpr),
      deliveryBaseLiter: toNumber(tariff.boxDeliveryBase),
      deliveryAdditionalLiter: toNumber(tariff.boxDeliveryLiter),
      storageBaseLiter: toNumber(tariff.boxStorageBase),
      storageAdditionalLiter: toNumber(tariff.boxStorageLiter),
      reverseBaseLiter: toNumber(tariff.boxDeliveryMarketplaceBase),
      reverseAdditionalLiter: toNumber(tariff.boxDeliveryMarketplaceLiter),
      reverseCoef: toNumber(tariff.boxDeliveryMarketplaceCoefExpr),
      coefficient: 0,
      date: null,
    };
    const primaryKey = normalizeWarehouseKey(warehouseName);
    if (primaryKey && !map.has(primaryKey)) {
      map.set(primaryKey, payload);
    }
    if (geoName) {
      const geoKey = normalizeWarehouseKey(geoName);
      if (geoKey && !map.has(geoKey)) {
        map.set(geoKey, payload);
      }
    }
  }
  return map;
}

export function buildReturnTariffMap(
  tariffs: WarehouseReturnTariff[],
): Map<string, ReturnTariffCandidate> {
  const map = new Map<string, ReturnTariffCandidate>();
  for (const tariff of tariffs) {
    const warehouseName = typeof tariff?.warehouseName === 'string' ? tariff.warehouseName.trim() : '';
    if (!warehouseName) continue;
    const normalizedName = normalizeWarehouseKey(warehouseName);
    const geoName = typeof tariff?.geoName === 'string' ? tariff.geoName.trim() : null;
    const candidate: ReturnTariffCandidate = {
      warehouseName,
      geoName,
      deliveryDumpKgtOfficeBase: toNumber(tariff.deliveryDumpKgtOfficeBase),
      deliveryDumpKgtOfficeLiter: toNumber(tariff.deliveryDumpKgtOfficeLiter),
      deliveryDumpKgtReturnExpr: toNumber(tariff.deliveryDumpKgtReturnExpr),
      deliveryDumpSrgOfficeBase: toNumber(tariff.deliveryDumpSrgOfficeBase),
      deliveryDumpSrgOfficeLiter: toNumber(tariff.deliveryDumpSrgOfficeLiter),
      deliveryDumpSrgReturnExpr: toNumber(tariff.deliveryDumpSrgReturnExpr),
      deliveryDumpSupOfficeBase: toNumber(tariff.deliveryDumpSupOfficeBase),
      deliveryDumpSupOfficeLiter: toNumber(tariff.deliveryDumpSupOfficeLiter),
      deliveryDumpSupReturnExpr: toNumber(tariff.deliveryDumpSupReturnExpr),
    };
    if (!map.has(normalizedName)) {
      map.set(normalizedName, candidate);
    }
    if (geoName) {
      const normalizedGeo = normalizeWarehouseKey(geoName);
      if (!map.has(normalizedGeo)) {
        map.set(normalizedGeo, candidate);
      }
    }
  }
  return map;
}
