/**
 * XLSX exports for the Поставка section.
 *
 *   buildSupplyAoa(items)   → AOA [['Баркод товара','Кол-во товаров'], …]
 *                              used by Шаг 1 export
 *   buildShkAoa(items, ...) → AOA for Шаг 3 with [Баркод, Кол-во, ШК короба,
 *                              Срок годности]
 *   toXlsxBuffer(aoa, sheet) → Buffer ready to send to the client
 *
 * Both exports keep barcodes as text (с/ведущими нулями), which Excel
 * otherwise mangles into scientific notation.
 */

import ExcelJS from 'exceljs';

import type { SupplyItem } from './service';

export type SupplyAoaResult = {
  aoa: Array<Array<string | number>>;
  barcodesCount: number;
  rowsCount: number;
  missingCount: number;
};

/** Шаг 1 (Постал supExportCsv/Xlsx). Aggregate per-barcode quantities. */
export function buildSupplyAoa(items: SupplyItem[]): SupplyAoaResult {
  // Aggregate: same barcode across items → sum the quantities.
  const byBarcode = new Map<string, number>();
  let rowsCount = 0;
  let missingCount = 0;
  for (const item of items) {
    for (const row of item.rows) {
      if (row.total <= 0) continue;
      rowsCount += 1;
      if (!row.barcode) {
        missingCount += 1;
        continue;
      }
      const prev = byBarcode.get(row.barcode) ?? 0;
      byBarcode.set(row.barcode, prev + row.total);
    }
  }
  // ВАЖНО: заголовки и имя листа должны быть РОВНО как в шаблоне WB
  // (лист "Sheet1", колонки "Баркод" и "Количество") — иначе кабинет
  // отклоняет файл при загрузке товаров в поставку.
  const aoa: Array<Array<string | number>> = [['Баркод', 'Количество']];
  for (const [barcode, qty] of byBarcode.entries()) {
    aoa.push([barcode, qty]);
  }
  return {
    aoa,
    barcodesCount: byBarcode.size,
    rowsCount,
    missingCount,
  };
}

export type ShkBox = {
  shkCode: string;
  items: { barcode: string; qty: number }[];
  articleVc: string;
  articleNm: number | null;
  profileName: string | null;
  contentDetail: { size: string; barcode: string; qty: number }[];
  sumPerBox: number;
};

export type ShkAoaResult = {
  aoa: Array<Array<string | number>>;
  boxes: ShkBox[];
};

/**
 * Шаг 3: generate sequential box barcodes (`firstShk + i`) and pair each
 * with the article's per-box barcode list. Returns both the flat XLSX
 * representation and the structured boxes for the UI preview.
 */
export function buildShkAoa(
  items: SupplyItem[],
  firstShk: string,
  boxCount: number,
): ShkAoaResult {
  const match = firstShk.trim().match(/^WB_(\d+)$/);
  if (!match) {
    throw new Error('Формат ШК короба: «WB_» + цифры. Пример: WB_1572120887');
  }
  const startNum = BigInt(match[1]!);
  if (boxCount < 1) {
    throw new Error('Количество коробов должно быть >= 1');
  }

  const boxes: ShkBox[] = [];
  let shkIdx = 0;
  for (const item of items) {
    const content: { barcode: string; qty: number }[] = [];
    const contentDetail: { size: string; barcode: string; qty: number }[] = [];
    for (const row of item.rows) {
      if (row.perBox > 0 && row.barcode) {
        content.push({ barcode: row.barcode, qty: row.perBox });
        contentDetail.push({ size: row.size, barcode: row.barcode, qty: row.perBox });
      }
    }
    for (let b = 0; b < item.boxes; b++) {
      if (shkIdx >= boxCount) break;
      const code = 'WB_' + String(startNum + BigInt(shkIdx));
      boxes.push({
        shkCode: code,
        items: content.slice(),
        articleVc: item.vendorCode,
        articleNm: item.nmId,
        profileName: item.profileName,
        contentDetail: contentDetail.slice(),
        sumPerBox: item.sumPerBox,
      });
      shkIdx += 1;
    }
    if (shkIdx >= boxCount) break;
  }

  const aoa: Array<Array<string | number>> = [
    ['Баркод товара', 'Кол-во товаров', 'ШК короба', 'Срок годности'],
  ];
  for (const box of boxes) {
    for (const entry of box.items) {
      aoa.push([entry.barcode, entry.qty, box.shkCode, '']);
    }
  }
  return { aoa, boxes };
}

/** Convert an AOA to an XLSX Buffer with barcodes typed as text strings. */
export async function toXlsxBuffer(
  aoa: Array<Array<string | number>>,
  sheetName: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, aoa, sheetName);
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/** Sanitise a string into a valid (<=31 char, no []/*?:\/) Excel sheet name. */
function sheetSafe(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Лист';
}

function addAoaSheet(wb: ExcelJS.Workbook, aoa: Array<Array<string | number>>, sheetName: string): void {
  const ws = wb.addWorksheet(sheetSafe(sheetName));
  ws.columns = aoa[0]!.map((header) => ({
    header: String(header),
    width: typeof header === 'string' && header.includes('Кол-во') ? 14 : 22,
  }));
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i]!;
    const xlRow = ws.addRow(row);
    const bcCell = xlRow.getCell(1);
    bcCell.numFmt = '@';
    bcCell.value = String(row[0] ?? '');
    if (row.length >= 3) {
      const shkCell = xlRow.getCell(3);
      shkCell.numFmt = '@';
      shkCell.value = String(row[2] ?? '');
    }
  }
  ws.getRow(1).font = { bold: true };
}

/**
 * Multi-sheet supply workbook: one sheet per warehouse (named by the
 * warehouse) plus an "Все склады" summary sheet. Used when supply_items
 * carry a `warehouse` (assembled from План поставки). Each sheet is the
 * WB-ready [Баркод, Кол-во].
 */
export async function buildSupplyWorkbookByWarehouse(items: SupplyItem[]): Promise<{
  buffer: Buffer;
  sheets: { warehouse: string; barcodes: number; units: number }[];
}> {
  const byWarehouse = new Map<string, SupplyItem[]>();
  for (const item of items) {
    const wh = item.warehouse?.trim() || 'Без склада';
    const list = byWarehouse.get(wh) ?? [];
    list.push(item);
    byWarehouse.set(wh, list);
  }

  const wb = new ExcelJS.Workbook();
  // Summary first.
  const allAoa = buildSupplyAoa(items).aoa;
  addAoaSheet(wb, allAoa, 'Все склады');

  const sheets: { warehouse: string; barcodes: number; units: number }[] = [];
  // Stable order: biggest warehouses first.
  const ordered = Array.from(byWarehouse.entries()).sort(
    (a, b) => b[1].reduce((s, i) => s + i.totalPieces, 0) - a[1].reduce((s, i) => s + i.totalPieces, 0),
  );
  for (const [warehouse, whItems] of ordered) {
    const res = buildSupplyAoa(whItems);
    addAoaSheet(wb, res.aoa, warehouse);
    sheets.push({
      warehouse,
      barcodes: res.barcodesCount,
      units: whItems.reduce((s, i) => s + i.totalPieces, 0),
    });
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return { buffer: Buffer.from(arrayBuffer), sheets };
}
