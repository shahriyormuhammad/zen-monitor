import type {
  listOwnStock,
  listSkusForBatchForm,
} from '../actions';

type SkuOption = Awaited<ReturnType<typeof listSkusForBatchForm>>[number];
type OwnStockItem = Awaited<ReturnType<typeof listOwnStock>>[number];

export type ParsedManualReceiptLine = {
  nmId: number;
  quantity: number;
  purchaseCostPerUnit: number | null;
  fulfillmentDeliveryPerUnit: number | null;
  notes: string | null;
};

export type WbShipmentExportRow = {
  nmId: number;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  availableQty: number;
  shipQty: number | null;
  boxLabel: string | null;
  unitsPerBox: number | null;
  boxCount: number | null;
  notes: string | null;
};

type WorkbookLike = {
  addWorksheet: (name: string) => WorksheetLike;
  addImage: (image: { base64: string; extension: 'jpeg' | 'png' }) => number;
  xlsx: { writeBuffer: () => Promise<unknown> };
  creator: string;
  created: Date;
};

type WorksheetLike = {
  columns: Array<{ header: string; key: string; width: number }>;
  views?: Array<{ state: 'frozen'; ySplit: number }>;
  autoFilter?: string;
  getRow: (row: number) => RowLike;
  getColumn: (key: string) => { numFmt?: string; alignment?: Record<string, unknown> };
  addRow: (values: Record<string, unknown> | unknown[]) => RowLike;
  eachRow: (callback: (row: RowLike, rowNumber: number) => void) => void;
  addImage: (imageId: number, range: { tl: { col: number; row: number }; ext: { width: number; height: number } }) => void;
};

type RowLike = {
  number: number;
  height?: number;
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
};

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const IMAGE_COLUMN = 4;

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

function styleHeader(sheet: WorksheetLike) {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF14532D' },
  };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
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

function cellNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = cellText(value)
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHeader(value: unknown): string {
  return cellText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, '');
}

function getHeaderMap(sheet: WorksheetLike): Map<string, number> {
  const result = new Map<string, number>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const normalized = normalizeHeader(cell.value);
    if (normalized) result.set(normalized, colNumber);
  });
  return result;
}

function resolveColumn(headers: Map<string, number>, aliases: string[]): number | null {
  for (const alias of aliases) {
    const column = headers.get(normalizeHeader(alias));
    if (column) return column;
  }
  return null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function tryAddPhoto(workbook: WorkbookLike, sheet: WorksheetLike, rowNumber: number, photoUrl: string | null | undefined) {
  if (!photoUrl) return false;

  const photoCell = sheet.getRow(rowNumber).getCell('photo');
  photoCell.value = { text: 'фото', hyperlink: photoUrl };
  photoCell.font = { color: { argb: 'FF2563EB' }, underline: true };

  try {
    const response = await fetch(photoUrl, { cache: 'force-cache' });
    if (!response.ok) return false;
    const blob = await response.blob();
    const contentType = blob.type || response.headers.get('content-type') || '';
    const extension = contentType.includes('png') ? 'png' : 'jpeg';
    const dataUrl = await blobToDataUrl(blob);
    const imageId = workbook.addImage({ base64: dataUrl, extension });
    sheet.addImage(imageId, {
      tl: { col: IMAGE_COLUMN - 1 + 0.12, row: rowNumber - 1 + 0.12 },
      ext: { width: 44, height: 44 },
    });
    photoCell.value = '';
    return true;
  } catch {
    return false;
  }
}

export async function exportManualReceiptTemplateXlsx(skus: SkuOption[]): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook() as unknown as WorkbookLike;
  workbook.creator = 'enterprise-wb-analytics';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Ручной приход');
  sheet.columns = [
    { header: 'Артикул WB', key: 'nmId', width: 14 },
    { header: 'Артикул продавца', key: 'vendorCode', width: 28 },
    { header: 'Бренд', key: 'brand', width: 18 },
    { header: 'Фото', key: 'photo', width: 10 },
    { header: 'Количество', key: 'quantity', width: 12 },
    { header: 'Закупка товара, ₽/шт', key: 'purchaseCostPerUnit', width: 22 },
    { header: 'Доставка до фулфилмента, ₽/шт', key: 'fulfillmentDeliveryPerUnit', width: 28 },
    { header: 'Заметки', key: 'notes', width: 34 },
    { header: 'Фото URL', key: 'photoUrl', width: 42 },
  ];
  styleHeader(sheet);
  sheet.autoFilter = 'A1:I1';
  sheet.getColumn('quantity').numFmt = '#,##0';
  sheet.getColumn('purchaseCostPerUnit').numFmt = '#,##0.00';
  sheet.getColumn('fulfillmentDeliveryPerUnit').numFmt = '#,##0.00';

  const sorted = [...skus].sort((a, b) => {
    const av = a.vendorCode ?? `nm ${a.nmId}`;
    const bv = b.vendorCode ?? `nm ${b.nmId}`;
    return av.localeCompare(bv, 'ru');
  });

  for (const sku of sorted) {
    const row = sheet.addRow({
      nmId: Number(sku.nmId),
      vendorCode: sku.vendorCode ?? '',
      brand: sku.brand ?? '',
      quantity: '',
      purchaseCostPerUnit: sku.purchaseCostPerUnit ?? '',
      fulfillmentDeliveryPerUnit: sku.fulfillmentDeliveryPerUnit ?? '',
      notes: '',
      photoUrl: sku.photoUrl ?? '',
    });
    row.height = 38;
    row.getCell('quantity').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
    row.getCell('purchaseCostPerUnit').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
    row.getCell('fulfillmentDeliveryPerUnit').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
    await tryAddPhoto(workbook, sheet, row.number, sku.photoUrl);
  }

  const help = workbook.addWorksheet('Как заполнять');
  help.columns = [
    { header: 'Правило', key: 'rule', width: 36 },
    { header: 'Что делать', key: 'value', width: 80 },
  ];
  styleHeader(help);
  help.addRow({ rule: 'Количество', value: 'Заполняйте только строки, которые реально пришли на свой склад. Пустые строки при импорте игнорируются.' });
  help.addRow({ rule: 'Закупка товара', value: 'Цена закупки одной единицы товара.' });
  help.addRow({ rule: 'Доставка до фулфилмента', value: 'Доставка одной единицы до фулфилмента. В складскую стоимость уйдет сумма: закупка + доставка.' });

  await downloadWorkbook(workbook, `own-stock-receipt-template_${formatYyyymmddHhmm(new Date())}.xlsx`);
}

export async function parseManualReceiptXlsx(file: File, skus: SkuOption[]): Promise<ParsedManualReceiptLine[]> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  const buffer = await file.arrayBuffer();
  await workbook.xlsx.load(buffer);

  const sheet = (workbook.getWorksheet('Ручной приход') ?? workbook.worksheets[0]) as WorksheetLike | undefined;
  if (!sheet) {
    throw new Error('В файле не найден лист с ручным приходом.');
  }

  const headers = getHeaderMap(sheet);
  const nmIdCol = resolveColumn(headers, ['Артикул WB', 'nmId', 'Номенклатура WB']);
  const vendorCodeCol = resolveColumn(headers, ['Артикул продавца', 'SKU', 'vendorCode']);
  const quantityCol = resolveColumn(headers, ['Количество', 'Кол-во', 'qty']);
  const purchaseCol = resolveColumn(headers, ['Закупка товара, ₽/шт', 'Закупка товара', 'Закупка']);
  const deliveryCol = resolveColumn(headers, ['Доставка до фулфилмента, ₽/шт', 'Доставка до фулфилмента', 'Доставка до ФФ']);
  const notesCol = resolveColumn(headers, ['Заметки', 'Комментарий', 'notes']);

  if (!quantityCol) {
    throw new Error('В Excel не найден столбец "Количество".');
  }
  if (!nmIdCol && !vendorCodeCol) {
    throw new Error('В Excel нужен столбец "Артикул WB" или "Артикул продавца".');
  }

  const skuByVendor = new Map(
    skus
      .filter((sku) => sku.vendorCode)
      .map((sku) => [String(sku.vendorCode).trim().toLowerCase(), Number(sku.nmId)]),
  );
  const knownNmIds = new Set(skus.map((sku) => Number(sku.nmId)));
  const parsed: ParsedManualReceiptLine[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const quantity = cellNumber(row.getCell(quantityCol).value);
    if (quantity === null || quantity <= 0) return;

    const nmIdFromCell = nmIdCol ? cellNumber(row.getCell(nmIdCol).value) : null;
    const vendorCode = vendorCodeCol ? cellText(row.getCell(vendorCodeCol).value).toLowerCase() : '';
    const nmId = nmIdFromCell && nmIdFromCell > 0
      ? Math.round(nmIdFromCell)
      : skuByVendor.get(vendorCode);

    if (!nmId || !knownNmIds.has(nmId)) return;

    const purchaseCostPerUnit = purchaseCol ? cellNumber(row.getCell(purchaseCol).value) : null;
    const fulfillmentDeliveryPerUnit = deliveryCol ? cellNumber(row.getCell(deliveryCol).value) : null;
    const notes = notesCol ? cellText(row.getCell(notesCol).value) : '';

    parsed.push({
      nmId,
      quantity: Math.round(quantity),
      purchaseCostPerUnit,
      fulfillmentDeliveryPerUnit,
      notes: notes || null,
    });
  });

  return parsed;
}

export async function exportWbShipmentXlsx(items: OwnStockItem[]): Promise<void> {
  return exportWbShipmentRowsXlsx(itemsToShipmentRows(items), 'wb-shipment-for-fulfillment');
}

export async function exportSelectedWbShipmentXlsx(rows: WbShipmentExportRow[]): Promise<void> {
  return exportWbShipmentRowsXlsx(rows, 'wb-shipment-selected-for-fulfillment');
}

function itemsToShipmentRows(items: OwnStockItem[]): WbShipmentExportRow[] {
  return items
    .filter((item) => item.totalRemaining > 0)
    .map((item) => ({
      nmId: item.nmId,
      vendorCode: item.sku?.vendorCode ?? null,
      brand: item.sku?.brand ?? null,
      photoUrl: item.sku?.photoUrl ?? null,
      availableQty: item.totalRemaining,
      shipQty: null,
      boxLabel: null,
      unitsPerBox: null,
      boxCount: null,
      notes: null,
    }));
}

async function exportWbShipmentRowsXlsx(
  rows: WbShipmentExportRow[],
  filenamePrefix: string,
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook() as unknown as WorkbookLike;
  workbook.creator = 'enterprise-wb-analytics';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Отгрузка на WB');
  sheet.columns = [
    { header: 'Артикул WB', key: 'nmId', width: 14 },
    { header: 'Артикул продавца', key: 'vendorCode', width: 28 },
    { header: 'Бренд', key: 'brand', width: 18 },
    { header: 'Фото', key: 'photo', width: 10 },
    { header: 'Доступно на своем складе', key: 'availableQty', width: 22 },
    { header: 'Отгрузить на WB, шт', key: 'shipQty', width: 18 },
    { header: 'Короб', key: 'boxLabel', width: 16 },
    { header: 'Шт/короб', key: 'unitsPerBox', width: 12 },
    { header: 'Коробов', key: 'boxCount', width: 12 },
    { header: 'Комментарий для фулфилмента', key: 'notes', width: 36 },
    { header: 'Фото URL', key: 'photoUrl', width: 42 },
  ];
  styleHeader(sheet);
  sheet.autoFilter = 'A1:K1';
  sheet.getColumn('availableQty').numFmt = '#,##0';
  sheet.getColumn('shipQty').numFmt = '#,##0';
  sheet.getColumn('unitsPerBox').numFmt = '#,##0';
  sheet.getColumn('boxCount').numFmt = '#,##0';

  const sorted = [...rows].sort((a, b) => {
    const av = a.vendorCode ?? `nm ${a.nmId}`;
    const bv = b.vendorCode ?? `nm ${b.nmId}`;
    return av.localeCompare(bv, 'ru');
  });

  for (const item of sorted) {
    const row = sheet.addRow({
      nmId: item.nmId,
      vendorCode: item.vendorCode ?? '',
      brand: item.brand ?? '',
      availableQty: item.availableQty,
      shipQty: item.shipQty ?? '',
      boxLabel: item.boxLabel ?? '',
      unitsPerBox: item.unitsPerBox ?? '',
      boxCount: item.boxCount ?? '',
      notes: item.notes ?? '',
      photoUrl: item.photoUrl ?? '',
    });
    row.height = 38;
    row.getCell('shipQty').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
    row.getCell('unitsPerBox').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
    await tryAddPhoto(workbook, sheet, row.number, item.photoUrl);
  }

  await downloadWorkbook(workbook, `${filenamePrefix}_${formatYyyymmddHhmm(new Date())}.xlsx`);
}
