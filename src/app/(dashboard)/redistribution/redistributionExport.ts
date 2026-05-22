/**
 * Excel-export плана перераспределения.
 *
 * Колонки соответствуют тому, что нужно ввести в кабинете WB:
 * Артикул, Размер, Откуда (склад), Куда (склад), Количество — этого
 * достаточно чтобы продавец вручную завёл заявки в WB по списку.
 *
 * Дополнительно — выгода ₽/мес, прирост локализации, приоритет —
 * чтобы можно было обрезать список по бюджету (вывезти не всё, а
 * самые выгодные позиции).
 *
 * Динамический импорт ExcelJS — чтобы не раздувать main JS bundle.
 */

import type {
  RedistributionPlan,
  RedistributionTransferRecommendation,
} from '@/server/analytics/redistribution';

function formatYyyymmddHhmm(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}${m}${d}_${hh}${mm}`;
}

export async function exportRedistributionXlsx(plan: RedistributionPlan): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'enterprise-wb-analytics';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Перевезти');
  sheet.columns = [
    { header: '#', key: 'rank', width: 4 },
    { header: 'Артикул WB', key: 'nmId', width: 14 },
    { header: 'Артикул продавца', key: 'vendorCode', width: 28 },
    { header: 'Бренд', key: 'brand', width: 16 },
    { header: 'Размер', key: 'size', width: 10 },
    { header: 'Откуда (склад)', key: 'fromWarehouse', width: 24 },
    { header: 'Регион (откуда)', key: 'fromRegion', width: 22 },
    { header: 'Куда (склад)', key: 'toWarehouse', width: 24 },
    { header: 'Регион (куда)', key: 'toRegion', width: 22 },
    { header: 'Шт', key: 'units', width: 8 },
    { header: 'Сэкономит, ₽/мес', key: 'savings', width: 16 },
    { header: 'Локализация SKU', key: 'localShare', width: 16 },
    { header: 'Доплата WB', key: 'krp', width: 14 },
    { header: 'Покрытие, дн (откуда)', key: 'fromCoverage', width: 22 },
    { header: 'Покрытие, дн (куда)', key: 'toCoverage', width: 22 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 22;

  // Сортируем рекомендации по приоритету (выгоднее — выше).
  const sorted: RedistributionTransferRecommendation[] = [...plan.recommendations].sort(
    (a, b) => b.priorityScore - a.priorityScore,
  );

  sorted.forEach((rec, idx) => {
    sheet.addRow({
      rank: idx + 1,
      nmId: rec.nmId,
      vendorCode: rec.vendorCode ?? '',
      brand: rec.brand ?? '',
      size: rec.sizeName,
      fromWarehouse: rec.fromWarehouse,
      fromRegion: rec.fromRegionName,
      toWarehouse: rec.toWarehouse,
      toRegion: rec.toRegionName,
      units: rec.transferUnits,
      savings: rec.estimatedSavingsRub,
      localShare: `${rec.currentLocalSharePct.toFixed(1)} → ${rec.simulatedLocalSharePct.toFixed(1)}%`,
      krp: `${rec.currentKrpPct.toFixed(2)} → ${rec.simulatedKrpPct.toFixed(2)}%`,
      fromCoverage: rec.fromCoverageDaysBefore != null ? rec.fromCoverageDaysBefore.toFixed(1) : '—',
      toCoverage: rec.toCoverageDaysBefore != null ? rec.toCoverageDaysBefore.toFixed(1) : '—',
    });
  });

  // Числовые форматы.
  sheet.getColumn('savings').numFmt = '#,##0 ₽';
  sheet.getColumn('units').numFmt = '#,##0';

  // Итоговая строка.
  const totalUnits = sorted.reduce((s, r) => s + r.transferUnits, 0);
  const totalSavings = sorted.reduce((s, r) => s + r.estimatedSavingsRub, 0);
  const summaryRow = sheet.addRow({
    rank: '',
    nmId: '',
    vendorCode: 'ИТОГО',
    brand: '',
    size: '',
    fromWarehouse: '',
    fromRegion: '',
    toWarehouse: '',
    toRegion: '',
    units: totalUnits,
    savings: totalSavings,
    localShare: '',
    krp: '',
    fromCoverage: '',
    toCoverage: '',
  });
  summaryRow.font = { bold: true };
  summaryRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE6F4EA' },
  };

  // Лист «Как пользоваться» — короткая инструкция.
  const help = workbook.addWorksheet('Как пользоваться');
  help.columns = [{ header: '', key: 'text', width: 100 }];
  const lines = [
    'Что куда везти — план перемещений между складами WB',
    '',
    `План построен ${new Date(plan.generatedAt).toLocaleString('ru-RU')}.`,
    `Метод: ${plan.assumptions.methodology}`,
    `Целевое покрытие: ${plan.assumptions.targetCoverageDays} дней.`,
    `Горизонт прогноза: ${plan.assumptions.forecastHorizonDays} дней.`,
    '',
    'Как воспользоваться этим Excel:',
    '1. Откройте кабинет WB Партнёры.',
    '2. «Конструктор тарифов» → включите «Перераспределение остатков» (если ещё не включено). Комиссия за услугу — +0.5% от продаж.',
    '3. «Отчёт по остаткам на складе» → кнопка «Перераспределить остатки».',
    '4. По строкам из этого файла заводите заявки: артикул → размер → откуда → куда → количество.',
    '5. Лучшее время для свободных слотов: 09:00 / 12:00 / 16:00 МСК (московское). Слоты разбираются за минуту.',
    '',
    'Что важно знать:',
    '• Артикул на 72 часа скрывается из продаж после оформления заявки.',
    '• Доставка между складами WB: 4-7 дней.',
    '• Программа уже учла страховой запас 30% на исходном складе — не вывозим всё.',
    '• «Выгода ₽/мес» — оценка экономии на доплате WB за дальность после перемещения.',
    '',
    'Если перемещений много — отсортируйте по «Сэкономит ₽/мес» по убыванию и заводите топ.',
  ];
  for (const line of lines) {
    help.addRow({ text: line });
  }
  help.getRow(1).font = { bold: true, size: 14 };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);

  const filename = `redistribution_${formatYyyymmddHhmm(new Date())}.xlsx`;
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
