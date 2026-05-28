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
  const aoa: Array<Array<string | number>> = [['Баркод товара', 'Кол-во товаров']];
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
  const ws = wb.addWorksheet(sheetName);

  // Wide-ish columns; both export sheets stay around 4 columns max.
  ws.columns = aoa[0]!.map((header) => ({
    header: String(header),
    width: typeof header === 'string' && header.includes('Кол-во') ? 14 : 22,
  }));

  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i]!;
    const xlRow = ws.addRow(row);
    // Force the barcode column to be text — Excel would otherwise mangle
    // long digit strings into scientific notation.
    const bcCell = xlRow.getCell(1);
    bcCell.numFmt = '@';
    bcCell.value = String(row[0] ?? '');
    // Optional 3rd column (ШК короба) — same text treatment.
    if (row.length >= 3) {
      const shkCell = xlRow.getCell(3);
      shkCell.numFmt = '@';
      shkCell.value = String(row[2] ?? '');
    }
  }

  ws.getRow(1).font = { bold: true };

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
