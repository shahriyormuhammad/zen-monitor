/**
 * Barrel export for the modular Unit Economics table building blocks.
 *
 * Import from here rather than from individual files so refactoring
 * internal paths doesn't break consumers.
 */

export { EconomicsTable } from './EconomicsTable';
export { NumberInput } from './NumberInput';
export { HiddenProductsPanel } from './HiddenProductsPanel';
export { TableHeader } from './TableHeader';
export { SkuMetaBlock } from './SkuMetaBlock';
export { WarehousesPanel } from './WarehousesPanel';
export { ScenarioRow } from './ScenarioRow';
export { VariantPickerModal } from './VariantPickerModal';
export { exportEconomicsExcel, getExportCellValue } from './excelExport';
export { resolveCellText, INTERACTIVE_COLUMN } from './cellValue';
export {
  COLUMNS,
  STRONG_GROUP_SEPARATOR_COLUMNS,
  COLUMN_FORMULA_HINTS,
  resolveStrictWidthClasses,
  normalizeColumnLabel,
  type TemplateColumn,
} from './columns';
export {
  buildVariantFamilyKey,
  compareBySellerArticle,
  createEconomicsExportFileName,
  resolveWbVolumeLiters,
} from './utils';
