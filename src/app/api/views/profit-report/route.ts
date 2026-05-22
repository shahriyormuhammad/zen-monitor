import { NextResponse } from 'next/server';
import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant, requireGroupAccess } from '@/lib/auth/tenant-access';
import { parseApiDateParam } from '@/lib/date-range';
import { getTaxRegimeDefinition, getVatModeDefinition, normalizeTaxType, normalizeVatMode } from '@/lib/tax/regimes';
import { getFastNetProfitBreakdown } from '@/server/analytics/services/finance-breakdown-fast';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  if (text.includes(';') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const format = searchParams.get('format');
  const nmIdParam = searchParams.get('nmId');
  const rawGroupId = searchParams.get('groupId');
  const groupId = rawGroupId && rawGroupId.trim().length > 0 ? rawGroupId.trim() : null;

  if (!from || !to) {
    return NextResponse.json({ error: 'Нужны параметры from и to' }, { status: 400 });
  }

  const parsedDateFrom = parseApiDateParam(from);
  const parsedDateTo = parseApiDateParam(to);
  if (!parsedDateFrom || !parsedDateTo) {
    return NextResponse.json({ error: 'Неверные параметры даты' }, { status: 400 });
  }

  const normalizedNmId = nmIdParam ? Number(nmIdParam) : null;
  const nmId = normalizedNmId && Number.isFinite(normalizedNmId) && normalizedNmId > 0
    ? Math.trunc(normalizedNmId)
    : null;

  const { tenantId } = await requireActiveTenant(request);
  const groupAccess = groupId ? await requireGroupAccess(groupId) : null;
  if (groupAccess && groupAccess.tenantId !== tenantId) {
    return NextResponse.json({ error: 'Склейка не относится к активному кабинету' }, { status: 403 });
  }

  const breakdown = await getFastNetProfitBreakdown(
    tenantId,
    parsedDateFrom,
    parsedDateTo,
    nmId,
    { calculationMode: 'FACT_WB', groupId, costingScope: 'costed' },
  );

  const taxType = normalizeTaxType(breakdown.taxType);
  const regime = getTaxRegimeDefinition(taxType);
  const vatMode = normalizeVatMode(breakdown.vatMode);
  const vat = getVatModeDefinition(vatMode);

  const report = {
    период: {
      с: from,
      по: to,
      sku: nmId,
      склейка: groupAccess?.group.name ?? null,
    },
    налоговый_режим: {
      код: taxType,
      название: regime.label,
      описание: regime.description,
      ставка_процентов: formatMoney(toNumber(breakdown.taxRatePercent)),
      ндс_код: vatMode,
      ндс: vat.label,
      ндс_ставка_процентов: formatMoney(toNumber(breakdown.vatRatePercent)),
    },
    формула: 'Управленческий PnL WB считается по дате выкупа/реализации: deliveryService по Srid переносится на дату реализации, без выкупа остается на дате WB. Чистая прибыль = payout_before_cost − себестоимость − реклама − НДС − налог УСН/прибыли. Оценочный хвост после последнего weekly помечен отдельно.',
    итоги: {
      выручка: formatMoney(breakdown.totals.grossRevenue),
      комиссия_wb: formatMoney(breakdown.totals.commission),
      логистика: formatMoney(breakdown.totals.logistics),
      хранение_wb_из_weekly: formatMoney(breakdown.totals.wbStorageFee),
      штрафы_wb: formatMoney(breakdown.totals.wbPenalty),
      платное_перечисление_wb: formatMoney(breakdown.totals.wbPaymentSchedule),
      удержания_wb: formatMoney(breakdown.totals.wbDeduction),
      удержания_wb_проценты_по_кредиту: formatMoney(toNumber((breakdown.totals as Record<string, unknown>).wbDeductionCreditInterest)),
      удержания_wb_тело_кредита_вне_pnl: formatMoney(toNumber((breakdown.totals as Record<string, unknown>).wbDeductionCreditPrincipal)),
      эквайринг_wb: formatMoney(breakdown.totals.wbAcquiringFee),
      доплаты_wb: formatMoney(breakdown.totals.wbAdditionalPayment),
      оценочные_удержания_после_последнего_weekly: formatMoney(breakdown.totals.provisionalOtherFees),
      себестоимость: formatMoney(breakdown.totals.costTotal),
      хранение_paid_storage: formatMoney(breakdown.totals.storageCost),
      реклама: formatMoney(breakdown.totals.adSpend),
      прибыль_до_налога: formatMoney(breakdown.totals.profitBeforeTax),
      налог: formatMoney(breakdown.totals.taxAmount),
      чистая_прибыль: formatMoney(breakdown.totals.netProfit),
    },
    удержания_wb_расшифровка: (breakdown.deductionDetails ?? []).map((detail) => {
      const excludedFromPnl = detail.creditKind === 'credit_principal' || detail.creditKind === 'wb_promotion';
      return {
        дата: detail.date,
        отчет_wb: detail.reportId,
        операция: detail.operation,
        тип_документа: detail.docType,
        причина: detail.reason,
        тип_удержания: detail.creditKind,
        в_расходах_pnl: excludedFromPnl ? 'нет' : 'да',
        nmId: detail.nmId,
        артикул_продавца: detail.vendorCode,
        строк: detail.rowCount,
        первая_строка_rrd: detail.firstRrdId,
        сумма: formatMoney(detail.amount),
        сумма_в_расходах: formatMoney(toNumber((detail as Record<string, unknown>).amountExpense)),
        сумма_тело_кредита: formatMoney(toNumber((detail as Record<string, unknown>).amountCreditPrincipal)),
        сумма_проценты_кредита: formatMoney(toNumber((detail as Record<string, unknown>).amountCreditInterest)),
      };
    }),
    sku: breakdown.items.map((item) => ({
      nmId: item.nmId,
      бренд: item.brand,
      артикул_продавца: item.vendorCode,
      фото_url: item.photoUrl,
      баркод: item.barcode,
      категория: item.category,
      выручка: formatMoney(item.grossRevenue),
      комиссия_wb: formatMoney(item.commission),
      логистика: formatMoney(item.logistics),
      хранение_wb_из_weekly: formatMoney(item.wbStorageFee),
      штрафы_wb: formatMoney(item.wbPenalty),
      платное_перечисление_wb: formatMoney(item.wbPaymentSchedule),
      удержания_wb: formatMoney(item.wbDeduction),
      удержания_wb_проценты_по_кредиту: formatMoney(toNumber((item as Record<string, unknown>).wbDeductionCreditInterest)),
      удержания_wb_тело_кредита_вне_pnl: formatMoney(toNumber((item as Record<string, unknown>).wbDeductionCreditPrincipal)),
      эквайринг_wb: formatMoney(item.wbAcquiringFee),
      доплаты_wb: formatMoney(item.wbAdditionalPayment),
      оценочные_удержания_после_последнего_weekly: formatMoney(item.provisionalOtherFees),
      себестоимость: formatMoney(item.costTotal),
      хранение_paid_storage: formatMoney(item.storageCost),
      реклама: formatMoney(item.adSpend),
      прибыль_до_налога: formatMoney(item.profitBeforeTax),
      налог: formatMoney(item.taxAmount),
      чистая_прибыль: formatMoney(item.netProfit),
    })),
  };

  if (format === 'csv') {
    const lines: string[] = [];
    lines.push('Отчет по чистой прибыли');
    lines.push(`Период;${csvCell(from)};${csvCell(to)}`);
    lines.push(`Режим;${csvCell(report.налоговый_режим.название)}`);
    lines.push(`Ставка (%);${csvCell(report.налоговый_режим.ставка_процентов)}`);
    lines.push('');
    lines.push('Итоги');
    lines.push('Показатель;Сумма');
    Object.entries(report.итоги).forEach(([key, value]) => {
      lines.push(`${csvCell(key)};${csvCell(value)}`);
    });
    if (report.удержания_wb_расшифровка.length > 0) {
      lines.push('');
      lines.push('Расшифровка удержаний WB');
      lines.push([
        'Дата',
        'Отчет WB',
        'Операция',
        'Тип документа',
        'Причина / куда списано',
        'Тип удержания',
        'В расходах PnL',
        'nmId',
        'Артикул продавца',
        'Строк',
        'Первая строка rrd',
        'Сумма',
        'Сумма в расходах',
        'Сумма тело кредита',
        'Сумма проценты кредита',
      ].join(';'));
      report.удержания_wb_расшифровка.forEach((row) => {
        lines.push([
          row.дата ?? '',
          row.отчет_wb,
          row.операция ?? '',
          row.тип_документа ?? '',
          row.причина ?? '',
          row.тип_удержания ?? '',
          row.в_расходах_pnl ?? '',
          row.nmId || '',
          row.артикул_продавца ?? '',
          row.строк,
          row.первая_строка_rrd ?? '',
          row.сумма,
          row.сумма_в_расходах ?? '',
          row.сумма_тело_кредита ?? '',
          row.сумма_проценты_кредита ?? '',
        ].map(csvCell).join(';'));
      });
    }
    lines.push('');
    lines.push('SKU детализация');
    lines.push([
      'nmId',
      'Бренд',
      'Артикул продавца',
      'Баркод',
      'Категория',
      'Выручка',
      'Комиссия WB',
      'Логистика',
      'Хранение WB из weekly',
      'Штрафы WB',
      'Платное перечисление WB',
      'Удержания WB',
      'Удержания WB (проценты по кредиту)',
      'Удержания WB (тело кредита вне PnL)',
      'Эквайринг WB',
      'Доплаты WB',
      'Оценочные удержания после последнего weekly',
      'Себестоимость',
      'Хранение paid_storage',
      'Реклама',
      'Прибыль до налога',
      'Налог',
      'Чистая прибыль',
    ].join(';'));
    report.sku.forEach((row) => {
      lines.push([
        row.nmId,
        row.бренд ?? '',
        row.артикул_продавца ?? '',
        row.баркод ?? '',
        row.категория ?? '',
        row.выручка,
        row.комиссия_wb,
        row.логистика,
        row.хранение_wb_из_weekly,
        row.штрафы_wb,
        row.платное_перечисление_wb,
        row.удержания_wb,
        row.удержания_wb_проценты_по_кредиту ?? '',
        row.удержания_wb_тело_кредита_вне_pnl ?? '',
        row.эквайринг_wb,
        row.доплаты_wb,
        row.оценочные_удержания_после_последнего_weekly,
        row.себестоимость,
        row.хранение_paid_storage,
        row.реклама,
        row.прибыль_до_налога,
        row.налог,
        row.чистая_прибыль,
      ].map(csvCell).join(';'));
    });

    const fileName = `profit-report_${from}_${to}${nmId ? `_nm${nmId}` : ''}${groupId ? `_group` : ''}.csv`;
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
      },
    }) as unknown as NextResponse;
  }

  return NextResponse.json(report);
});
