/**
 * Excel-export of the purchase list (top critical SKUs from /stocks-v2).
 *
 * Динамический импорт ExcelJS — чтобы не раздувать main JS bundle (он
 * нужен только когда юзер жмёт «Скачать»).
 */

import type { StockSkuRow, StocksV2Payload } from '@/server/analytics/stocks-v2/types';

export async function exportPurchaseListXlsx(payload: StocksV2Payload): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'enterprise-wb-analytics';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Лист закупки');
  sheet.columns = [
    { header: 'Артикул WB', key: 'nmId', width: 14 },
    { header: 'Артикул продавца', key: 'vendorCode', width: 28 },
    { header: 'Бренд', key: 'brand', width: 16 },
    { header: 'Статус', key: 'status', width: 12 },
    { header: 'WB остаток', key: 'wbStock', width: 12 },
    { header: 'Свой склад', key: 'ownStock', width: 12 },
    { header: 'Склад Китай', key: 'chinaStock', width: 12 },
    { header: 'В пути', key: 'inTransit', width: 10 },
    { header: 'В производстве', key: 'inProduction', width: 14 },
    { header: 'Всего есть', key: 'totalAvailable', width: 12 },
    { header: 'Спрос/день', key: 'avgDailyDemand', width: 12 },
    { header: 'Дней хватит', key: 'daysLeft', width: 12 },
    { header: 'Купить, шт', key: 'recommendQty', width: 14 },
    { header: 'Полная себестоимость, ₽/шт', key: 'costPerUnit', width: 24 },
    { header: 'Полная стоимость партии, ₽', key: 'recommendCost', width: 24 },
    { header: 'ABC', key: 'abcBucket', width: 6 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE5E7EB' },
  };

  // Sort: critical first (by smallest daysLeft), then warning, then ok, overstock last.
  const order = { critical: 0, warning: 1, ok: 2, overstock: 3 } as const;
  const sorted = [...payload.items].sort((a, b) => {
    const cmp = order[a.status] - order[b.status];
    if (cmp !== 0) return cmp;
    return a.daysLeft - b.daysLeft;
  });

  const STATUS_LABEL: Record<StockSkuRow['status'], string> = {
    critical: '🔴 Срочно',
    warning: '🟠 Скоро',
    ok: '🟢 Норма',
    overstock: '🔵 Перетарка',
  };

  for (const item of sorted) {
    sheet.addRow({
      nmId: item.nmId,
      vendorCode: item.vendorCode ?? '',
      brand: item.brand ?? '',
      status: STATUS_LABEL[item.status],
      wbStock: item.wbStock,
      ownStock: item.ownStock,
      chinaStock: item.chinaStock,
      inTransit: item.inTransit,
      inProduction: item.inProduction,
      totalAvailable: item.totalAvailable,
      avgDailyDemand: item.avgDailyDemand,
      daysLeft: Number.isFinite(item.daysLeft) ? Math.round(item.daysLeft * 10) / 10 : '∞',
      recommendQty: item.recommendQty,
      costPerUnit: item.costPerUnit ?? '',
      recommendCost: item.recommendCost ?? '',
      abcBucket: item.abcBucket,
    });
  }

  // Money columns formatting
  const moneyColumns = ['costPerUnit', 'recommendCost'];
  for (const key of moneyColumns) {
    const col = sheet.getColumn(key);
    col.numFmt = '#,##0.00 ₽';
  }
  sheet.getColumn('avgDailyDemand').numFmt = '0.00';
  sheet.getColumn('daysLeft').numFmt = '0.0';

  // Highlight critical rows
  sheet.eachRow((row, idx) => {
    if (idx === 1) return;
    const status = String(row.getCell('status').value ?? '');
    if (status.includes('Срочно')) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    } else if (status.includes('Скоро')) {
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    }
  });

  // Totals row
  const criticalItems = sorted.filter((it) => it.status === 'critical' && it.recommendQty > 0);
  if (criticalItems.length > 0) {
    sheet.addRow([]);
    const totalQty = criticalItems.reduce((s, it) => s + it.recommendQty, 0);
    const totalCost = criticalItems.reduce((s, it) => s + (it.recommendCost ?? 0), 0);
    const totalsRow = sheet.addRow({
      vendorCode: 'ИТОГО ПО СРОЧНЫМ:',
      recommendQty: totalQty,
      recommendCost: totalCost,
    });
    totalsRow.font = { bold: true };
    totalsRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    totalsRow.getCell('recommendCost').numFmt = '#,##0.00 ₽';
  }

  // Generate filename
  const now = new Date();
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hm = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const filename = `purchase-list_${ymd}_${hm}.xlsx`;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
