import { describe, expect, it } from 'vitest';
import { parseCostingExcel } from './costingExcel';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function workbookToFile(workbook: { xlsx: { writeBuffer: () => Promise<unknown> } }) {
  const buffer = await workbook.xlsx.writeBuffer();
  return new File([buffer as BlobPart], 'costs.xlsx', { type: MIME_XLSX });
}

describe('parseCostingExcel', () => {
  it('imports costs from the costing template with formatted WB articles', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Себестоимость');
    sheet.columns = [
      { header: 'nmId', key: 'nmId', width: 14 },
      { header: 'costPrice', key: 'costPrice', width: 15 },
      { header: 'deliveryToWb', key: 'deliveryToWb', width: 16 },
    ];
    sheet.addRow(['Артикул WB', 'Товар закупка', 'Доставка до ВБ']);
    sheet.addRow({ nmId: 'WB 222 594 171', costPrice: '1', deliveryToWb: '2' });

    const parsed = await parseCostingExcel(await workbookToFile(workbook));

    expect(parsed.rows).toHaveLength(1);
    const importedRow = parsed.rows[0]!;
    expect(importedRow.nmId).toBe(222594171);
    expect(importedRow.patch.costPrice).toBe('1');
    expect(importedRow.patch.warehouseCosts).toEqual({ excel_delivery_to_wb: '2' });
  });

  it('imports costs from a plain Russian-header Excel sheet', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Лист1');
    sheet.addRow(['Артикул WB', 'Товар закупка', 'Доставка до ФФ', 'Упаковка', 'Фулфилмент']);
    sheet.addRow(['210 419 039', 100, 10, 5, 7]);

    const parsed = await parseCostingExcel(await workbookToFile(workbook));

    expect(parsed.rows).toEqual([
      {
        nmId: 210419039,
        patch: {
          costPrice: '100',
          deliveryToFf: '10',
          packagingMaterial: '5',
          fulfillment: '7',
        },
      },
    ]);
  });

  it('imports legacy unit-economics cost columns from the data sheet', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const inputSheet = workbook.addWorksheet('Данные для ввода');
    inputSheet.columns = [
      { header: 'article', key: 'article', width: 14 },
      { header: 'price_average', key: 'price_average', width: 14 },
    ];
    inputSheet.addRow(['Артикул WB', 'Цена']);
    inputSheet.addRow({ article: 811384998, price_average: 999 });

    const dataSheet = workbook.addWorksheet('Данные');
    dataSheet.columns = [
      { header: 'article', key: 'article', width: 14 },
      { header: 'cost_price_1', key: 'cost_price_1', width: 15 },
      { header: 'delivery_to_mp_1', key: 'delivery_to_mp_1', width: 16 },
    ];
    dataSheet.addRow(['Артикул WB', 'Товар закупка', 'Доставка до ВБ']);
    dataSheet.addRow({ article: 811384998, cost_price_1: 900, delivery_to_mp_1: 30 });

    const parsed = await parseCostingExcel(await workbookToFile(workbook));

    expect(parsed.rows).toHaveLength(1);
    const importedRow = parsed.rows[0]!;
    expect(importedRow.nmId).toBe(811384998);
    expect(importedRow.patch.costPrice).toBe('900');
    expect(importedRow.patch.warehouseCosts).toEqual({ excel_delivery_to_wb: '30' });
  });

  it('uses full cost as purchase cost when editable cost columns are empty', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Себестоимость');
    sheet.columns = [
      { header: 'nmId', key: 'nmId', width: 14 },
      { header: 'costPrice', key: 'costPrice', width: 15 },
      { header: 'deliveryToFf', key: 'deliveryToFf', width: 16 },
      { header: 'fullCost', key: 'fullCost', width: 16 },
    ];
    sheet.addRow(['Артикул WB', 'Товар закупка', 'Доставка до ФФ', 'Себес полный']);
    sheet.addRow({ nmId: 872551607, fullCost: 1440 });
    sheet.addRow({ nmId: 811222928, deliveryToFf: 40, fullCost: 1500 });

    const parsed = await parseCostingExcel(await workbookToFile(workbook));

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]!.patch.costPrice).toBe('1440');
    expect(parsed.rows[1]!.patch.deliveryToFf).toBe('40');
    expect(parsed.rows[1]!.patch.costPrice).toBe('1460');
  });
});
