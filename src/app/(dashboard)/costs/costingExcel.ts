import { normalizeDecimalInput, toNumber } from '@/components/economics/helpers';
import type { ManualFields, UnitTemplateRow } from '@/components/economics/types';
import { computeCostTotal, computeDeliveryToWb, resolvePurchaseCost } from './costing-helpers';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const EXCEL_DELIVERY_TO_WB_WAREHOUSE_ID = 'excel_delivery_to_wb';
const EXCEL_DELIVERY_TO_WB_WAREHOUSE_LABEL = 'Excel: доставка до ВБ';

type WorkbookLike = {
  addWorksheet: (name: string) => WorksheetLike;
  getWorksheet?: (name: string) => WorksheetLike | undefined;
  worksheets?: WorksheetLike[];
  xlsx: { writeBuffer: () => Promise<unknown>; load: (buffer: ArrayBuffer) => Promise<unknown> };
  creator: string;
  created: Date;
};

type WorksheetLike = {
  columns: Array<{ header: string; key: string; width: number }>;
  views?: Array<{ state: 'frozen'; ySplit: number }>;
  autoFilter?: string;
  rowCount: number;
  getRow: (row: number) => RowLike;
  getColumn: (key: string) => { numFmt?: string; alignment?: Record<string, unknown> };
  addRow: (values: Record<string, unknown> | unknown[]) => RowLike;
};

type RowLike = {
  number: number;
  height?: number;
  hidden?: boolean;
  font?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  getCell: (key: string | number) => CellLike;
  eachCell: (options: { includeEmpty: boolean }, callback: (cell: CellLike, colNumber: number) => void) => void;
};

type CellLike = {
  value: unknown;
  fill?: Record<string, unknown>;
  numFmt?: string;
  alignment?: Record<string, unknown>;
  font?: Record<string, unknown>;
  border?: Record<string, unknown>;
  protection?: Record<string, unknown>;
};

type CostingColumnId =
  | 'nmId'
  | 'vendorCode'
  | 'brand'
  | 'category'
  | 'costPrice'
  | 'deliveryToFf'
  | 'packagingMaterial'
  | 'fulfillment'
  | 'deliveryToWb'
  | 'fullCost'
  | 'soldQuantity'
  | 'grossRevenue';

type CostingColumn = {
  id: CostingColumnId;
  label: string;
  width: number;
  editable?: boolean;
};

type CostingImportField = 'costPrice' | 'deliveryToFf' | 'packagingMaterial' | 'fulfillment' | 'deliveryToWb';

export type CostingExcelMode = 'template' | 'filled';

export type CostingExcelRow = {
  row: UnitTemplateRow;
  manualFields: ManualFields;
};

export type ParsedCostingExcelRow = {
  nmId: number;
  patch: Partial<ManualFields>;
};

export type ParsedCostingExcel = {
  rows: ParsedCostingExcelRow[];
  skippedRows: number;
};

const COSTING_COLUMNS: CostingColumn[] = [
  { id: 'nmId', label: 'Артикул WB', width: 14 },
  { id: 'vendorCode', label: 'Артикул продавца', width: 28 },
  { id: 'brand', label: 'Бренд', width: 18 },
  { id: 'category', label: 'Категория', width: 24 },
  { id: 'costPrice', label: 'Товар закупка', width: 15, editable: true },
  { id: 'deliveryToFf', label: 'Доставка до ФФ', width: 16, editable: true },
  { id: 'packagingMaterial', label: 'Упаковка', width: 14, editable: true },
  { id: 'fulfillment', label: 'Фулфилмент', width: 14, editable: true },
  { id: 'deliveryToWb', label: 'Доставка до ВБ', width: 16, editable: true },
  { id: 'fullCost', label: 'Себес полный', width: 16 },
  { id: 'soldQuantity', label: 'Продажи, шт', width: 12 },
  { id: 'grossRevenue', label: 'Выручка', width: 14 },
];

const COLUMN_IDS = new Set(COSTING_COLUMNS.map((column) => column.id));

const IMPORT_FIELD_BY_COLUMN: Partial<Record<CostingColumnId, CostingImportField>> = {
  costPrice: 'costPrice',
  deliveryToFf: 'deliveryToFf',
  packagingMaterial: 'packagingMaterial',
  fulfillment: 'fulfillment',
  deliveryToWb: 'deliveryToWb',
};

const MACHINE_COLUMN_ALIASES: Record<string, CostingColumnId> = {
  article: 'nmId',
  nm_id: 'nmId',
  nmId: 'nmId',
  nmid: 'nmId',
  seller_article: 'vendorCode',
  vendor_code: 'vendorCode',
  vendorCode: 'vendorCode',
  cost_price_1: 'costPrice',
  cost_price_2: 'costPrice',
  cost_price: 'costPrice',
  purchase_price: 'costPrice',
  delivery_to_ff_1: 'deliveryToFf',
  delivery_to_ff_2: 'deliveryToFf',
  delivery_to_ff: 'deliveryToFf',
  packaging_1: 'packagingMaterial',
  packaging_2: 'packagingMaterial',
  packaging: 'packagingMaterial',
  packaging_material: 'packagingMaterial',
  fulfillment_1: 'fulfillment',
  fulfillment_2: 'fulfillment',
  delivery_to_mp_1: 'deliveryToWb',
  delivery_to_mp_2: 'deliveryToWb',
  delivery_to_mp: 'deliveryToWb',
  delivery_to_wb: 'deliveryToWb',
  full_cost: 'fullCost',
  sold_quantity: 'soldQuantity',
  gross_revenue: 'grossRevenue',
};

const LABEL_COLUMN_ALIASES: Record<string, CostingColumnId> = {
  артикулwb: 'nmId',
  артикулвб: 'nmId',
  nmid: 'nmId',
  nm: 'nmId',
  артикулпродавца: 'vendorCode',
  артикулпоставщика: 'vendorCode',
  бренд: 'brand',
  марка: 'brand',
  категория: 'category',
  предмет: 'category',
  товарзакупка: 'costPrice',
  закупка: 'costPrice',
  закупкашт: 'costPrice',
  закупкаршт: 'costPrice',
  закупочнаяцена: 'costPrice',
  себестоимостьтовара: 'costPrice',
  доставкадофф: 'deliveryToFf',
  доставкавфф: 'deliveryToFf',
  доставкакфф: 'deliveryToFf',
  доставкадофулфилмента: 'deliveryToFf',
  доставкадофулфилментцентра: 'deliveryToFf',
  упаковка: 'packagingMaterial',
  упаковкашт: 'packagingMaterial',
  фулфилмент: 'fulfillment',
  фулфилментшт: 'fulfillment',
  доставкадовб: 'deliveryToWb',
  доставкаввб: 'deliveryToWb',
  доставкаквб: 'deliveryToWb',
  доставкадомп: 'deliveryToWb',
  доставкадомаркетплейса: 'deliveryToWb',
  себесполный: 'fullCost',
  себесполныйсотгрузкой: 'fullCost',
  полнаясебестоимость: 'fullCost',
  продажишт: 'soldQuantity',
  проданошт: 'soldQuantity',
  выручка: 'grossRevenue',
};

function formatYyyymmddHhmm(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

function downloadWorkbook(workbook: WorkbookLike, filename: string): Promise<void> {
  return workbook.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer as BlobPart], { type: MIME_XLSX });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}

function normalizeHeader(value: unknown): string {
  return cellText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, '');
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const objectValue = value as {
      text?: unknown;
      result?: unknown;
      formula?: unknown;
      richText?: Array<{ text?: unknown }>;
    };
    if (objectValue.text !== undefined) return cellText(objectValue.text);
    if (objectValue.result !== undefined) return cellText(objectValue.result);
    if (objectValue.richText) {
      return objectValue.richText.map((part) => cellText(part.text)).join('').trim();
    }
    if (objectValue.formula !== undefined) return cellText(objectValue.formula);
  }
  return String(value).trim();
}

function cellDecimal(value: unknown): string | null {
  const text = cellText(value);
  if (!text) return null;
  const normalized = normalizeDecimalInput(text);
  return normalized.trim().length > 0 ? normalized : null;
}

function parseNmId(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  const text = cellText(value).replace(/\s+/g, '');
  if (!text) return 0;

  const direct = Number(text);
  if (Number.isFinite(direct) && direct > 0) {
    return Math.trunc(direct);
  }

  const match = text.match(/\d{5,}/);
  if (!match) return 0;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function numberOrBlank(value: number): number | '' {
  return value > 0 ? value : '';
}

function manualNumberOrBlank(value: string): number | '' {
  const numeric = toNumber(value);
  return value.trim().length > 0 ? numeric : '';
}

function styleSheet(sheet: WorksheetLike) {
  const idRow = sheet.getRow(1);
  idRow.hidden = true;

  const labelRow = sheet.getRow(2);
  labelRow.height = 28;
  labelRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  labelRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  labelRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF14532D' },
  };

  for (const column of COSTING_COLUMNS) {
    const excelColumn = sheet.getColumn(column.id);
    excelColumn.alignment = { vertical: 'middle', wrapText: true };
    if (column.editable || column.id === 'fullCost' || column.id === 'grossRevenue') {
      excelColumn.numFmt = '#,##0.00';
    }
    if (column.id === 'soldQuantity') {
      excelColumn.numFmt = '#,##0';
    }
  }

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const column = COSTING_COLUMNS[colNumber - 1];
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      };
      if (rowNumber > 2 && column?.editable) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
      }
    });
  }

  sheet.views = [{ state: 'frozen', ySplit: 2 }];
  sheet.autoFilter = 'A2:L2';
}

function createRowValues({ row, manualFields }: CostingExcelRow, mode: CostingExcelMode): Record<CostingColumnId, unknown> {
  const purchaseCost = resolvePurchaseCost(row, manualFields);
  const deliveryToWb = computeDeliveryToWb(manualFields);
  const total = computeCostTotal(row, manualFields);
  const useComputedFallback = mode === 'filled';

  return {
    nmId: toNumber(row.nmId),
    vendorCode: row.vendorCode ?? '',
    brand: row.brand ?? '',
    category: row.category ?? '',
    costPrice: manualFields.costPrice.trim().length > 0
      ? manualNumberOrBlank(manualFields.costPrice)
      : useComputedFallback
        ? numberOrBlank(purchaseCost)
        : '',
    deliveryToFf: manualNumberOrBlank(manualFields.deliveryToFf),
    packagingMaterial: manualNumberOrBlank(manualFields.packagingMaterial),
    fulfillment: manualNumberOrBlank(manualFields.fulfillment),
    deliveryToWb: numberOrBlank(deliveryToWb),
    fullCost: numberOrBlank(total),
    soldQuantity: numberOrBlank(toNumber(row.soldQuantity)),
    grossRevenue: numberOrBlank(toNumber(row.grossRevenue)),
  };
}

function createDeliveryToWbPatch(value: string): Pick<ManualFields, 'selectedWarehouses' | 'warehouseCosts' | 'customWarehouses'> {
  return {
    selectedWarehouses: [EXCEL_DELIVERY_TO_WB_WAREHOUSE_ID],
    warehouseCosts: { [EXCEL_DELIVERY_TO_WB_WAREHOUSE_ID]: value },
    customWarehouses: [{ id: EXCEL_DELIVERY_TO_WB_WAREHOUSE_ID, label: EXCEL_DELIVERY_TO_WB_WAREHOUSE_LABEL }],
  };
}

function resolveFullCostFallback(fullCost: string | null, patch: Partial<ManualFields>): string | null {
  if (fullCost === null || patch.costPrice) return null;

  const directCostsTotal =
    toNumber(patch.deliveryToFf)
    + toNumber(patch.packagingMaterial)
    + toNumber(patch.fulfillment)
    + toNumber(patch.warehouseCosts?.[EXCEL_DELIVERY_TO_WB_WAREHOUSE_ID]);
  const purchaseCost = toNumber(fullCost) - directCostsTotal;

  if (purchaseCost <= 0) return null;
  return String(Math.round((purchaseCost + Number.EPSILON) * 100) / 100);
}

function resolveMachineColumnId(value: unknown): CostingColumnId | null {
  const text = cellText(value);
  if (COLUMN_IDS.has(text as CostingColumnId)) return text as CostingColumnId;
  return MACHINE_COLUMN_ALIASES[text] ?? null;
}

function rowLooksLikeLabelRow(sheet: WorksheetLike, rowNumber: number, colIdxToId: Map<number, CostingColumnId>): boolean {
  if (rowNumber > sheet.rowCount) return false;

  let matches = 0;
  let hasArticleLabel = false;
  const row = sheet.getRow(rowNumber);
  for (const [colNumber, columnId] of colIdxToId.entries()) {
    const labelId = LABEL_COLUMN_ALIASES[normalizeHeader(row.getCell(colNumber).value)];
    if (!labelId) continue;
    matches += 1;
    if (labelId === 'nmId' && columnId === 'nmId') {
      hasArticleLabel = true;
    }
  }

  return hasArticleLabel || matches >= 2;
}

function readColumnIds(sheet: WorksheetLike): { colIdxToId: Map<number, CostingColumnId>; dataStartRow: number } {
  const maxHeaderRow = Math.min(sheet.rowCount, 12);

  for (let candidateRow = 1; candidateRow <= maxHeaderRow; candidateRow += 1) {
    const map = new Map<number, CostingColumnId>();
    sheet.getRow(candidateRow).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const id = resolveMachineColumnId(cell.value);
      if (id) map.set(colNumber, id);
    });
    if ([...map.values()].includes('nmId')) {
      const dataStartRow = rowLooksLikeLabelRow(sheet, candidateRow + 1, map)
        ? candidateRow + 2
        : candidateRow + 1;
      return { colIdxToId: map, dataStartRow };
    }
  }

  for (let candidateRow = 1; candidateRow <= maxHeaderRow; candidateRow += 1) {
    const map = new Map<number, CostingColumnId>();
    sheet.getRow(candidateRow).eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const id = LABEL_COLUMN_ALIASES[normalizeHeader(cell.value)];
      if (id) map.set(colNumber, id);
    });
    if ([...map.values()].includes('nmId')) {
      return { colIdxToId: map, dataStartRow: candidateRow + 1 };
    }
  }

  return { colIdxToId: new Map(), dataStartRow: 1 };
}

function hasImportColumns(colIdxToId: Map<number, CostingColumnId>): boolean {
  return [...colIdxToId.values()].some((columnId) => IMPORT_FIELD_BY_COLUMN[columnId]);
}

function resolveImportSheet(workbook: WorkbookLike): { sheet: WorksheetLike; colIdxToId: Map<number, CostingColumnId>; dataStartRow: number } | null {
  const namedSheets = [
    workbook.getWorksheet?.('Себестоимость'),
    workbook.getWorksheet?.('Данные'),
    workbook.getWorksheet?.('Данные для ввода'),
    workbook.getWorksheet?.('✏️ Данные для ввода'),
  ].filter((sheet): sheet is WorksheetLike => Boolean(sheet));
  const candidateSheets = Array.from(new Set([...namedSheets, ...(workbook.worksheets ?? [])]));

  let fallback: { sheet: WorksheetLike; colIdxToId: Map<number, CostingColumnId>; dataStartRow: number } | null = null;
  for (const sheet of candidateSheets) {
    const { colIdxToId, dataStartRow } = readColumnIds(sheet);
    if (![...colIdxToId.values()].includes('nmId')) continue;

    const candidate = { sheet, colIdxToId, dataStartRow };
    if (hasImportColumns(colIdxToId)) {
      return candidate;
    }
    fallback ??= candidate;
  }

  return fallback;
}

export async function exportCostingExcel(rows: CostingExcelRow[], mode: CostingExcelMode): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook() as unknown as WorkbookLike;
  workbook.creator = 'enterprise-wb-analytics';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Себестоимость');
  sheet.columns = COSTING_COLUMNS.map((column) => ({
    header: column.id,
    key: column.id,
    width: column.width,
  }));
  sheet.addRow(COSTING_COLUMNS.map((column) => column.label));

  for (const item of rows) {
    const row = sheet.addRow(createRowValues(item, mode));
    row.height = 24;
  }

  styleSheet(sheet);

  const prefix = mode === 'template' ? 'шаблон-себестоимости' : 'себестоимость';
  await downloadWorkbook(workbook, `${prefix}_${formatYyyymmddHhmm(new Date())}.xlsx`);
}

export async function parseCostingExcel(file: File): Promise<ParsedCostingExcel> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook() as unknown as WorkbookLike;
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const importSheet = resolveImportSheet(workbook);
  if (!importSheet) {
    throw new Error('В Excel-файле не найден лист с себестоимостью');
  }

  const { sheet: targetSheet, colIdxToId, dataStartRow } = importSheet;
  const articleColIdx = [...colIdxToId.entries()].find(([, id]) => id === 'nmId')?.[0];
  if (!articleColIdx) {
    throw new Error('В Excel-файле не найден столбец "Артикул WB"');
  }

  const rows: ParsedCostingExcelRow[] = [];
  let skippedRows = 0;

  for (let rowNumber = dataStartRow; rowNumber <= targetSheet.rowCount; rowNumber += 1) {
    const row = targetSheet.getRow(rowNumber);
    const nmId = parseNmId(row.getCell(articleColIdx).value);
    if (nmId <= 0) {
      skippedRows += 1;
      continue;
    }

    const patch: Partial<ManualFields> = {};
    let fullCostFallback: string | null = null;
    for (const [colIdx, columnId] of colIdxToId.entries()) {
      if (columnId === 'fullCost') {
        fullCostFallback = cellDecimal(row.getCell(colIdx).value);
        continue;
      }

      const field = IMPORT_FIELD_BY_COLUMN[columnId];
      if (!field) continue;

      const value = cellDecimal(row.getCell(colIdx).value);
      if (value === null) continue;

      if (field === 'deliveryToWb') {
        Object.assign(patch, createDeliveryToWbPatch(value));
      } else if (field === 'costPrice') {
        patch.costPrice = value;
      } else if (field === 'deliveryToFf') {
        patch.deliveryToFf = value;
      } else if (field === 'packagingMaterial') {
        patch.packagingMaterial = value;
      } else if (field === 'fulfillment') {
        patch.fulfillment = value;
      }
    }

    const fallbackCostPrice = resolveFullCostFallback(fullCostFallback, patch);
    if (fallbackCostPrice !== null) {
      patch.costPrice = fallbackCostPrice;
    }

    if (Object.keys(patch).length === 0) {
      skippedRows += 1;
      continue;
    }

    rows.push({ nmId, patch });
  }

  return { rows, skippedRows };
}
