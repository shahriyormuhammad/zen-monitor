import { NextResponse } from 'next/server';

import { apiRoute } from '@/lib/api-response';
import { requireActiveTenant } from '@/lib/auth/tenant-access';
import {
  getAusnMonthlyReconciliation,
  normalizeAusnMonth,
  normalizeAusnTaxObject,
  saveAusnMonthlyInput,
  type AusnReconciliation,
} from '@/server/analytics/services/ausn';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function toNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  if (text.includes(';') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(report: AusnReconciliation) {
  const lines: string[] = [];
  lines.push('АУСН взаимозачет по документам WB');
  lines.push(`Месяц;${csvCell(report.period.month)}`);
  lines.push(`Период;${csvCell(report.period.from)};${csvCell(report.period.to)}`);
  lines.push(`Объект;${csvCell(report.input.taxObject === 'income_expenses' ? 'Доходы-Расходы' : 'Доходы')}`);
  lines.push('');
  lines.push('Банк / уже учтено ФНС');
  lines.push('Показатель;Сумма');
  lines.push(`Приход банка;${csvCell(report.input.bankIncome)}`);
  lines.push(`Возврат прихода банка;${csvCell(report.input.bankIncomeReturn)}`);
  lines.push(`Расход банка;${csvCell(report.input.bankExpense)}`);
  lines.push(`Возврат расхода банка;${csvCell(report.input.bankExpenseReturn)}`);
  lines.push(`Прочие расходы к налоговой оценке;${csvCell(report.input.otherExpenses)}`);
  lines.push('');
  lines.push('Итоги документов');
  lines.push('Показатель;Сумма');
  lines.push(`Уведомления о выкупе - доход;${csvCell(report.documentTotals.buyout_income)}`);
  lines.push(`Детализация - доход;${csvCell(report.documentTotals.detail_income)}`);
  lines.push(`Детализация - возврат дохода;${csvCell(report.documentTotals.detail_income_return)}`);
  lines.push(`Еженедельные отчеты - удержания;${csvCell(report.documentTotals.weekly_withholding)}`);
  lines.push(`Еженедельные отчеты - возврат удержаний;${csvCell(report.documentTotals.weekly_withholding_return)}`);
  lines.push(`УПД - расход;${csvCell(report.documentTotals.upd_expense)}`);
  lines.push(`УКД - возврат расхода;${csvCell(report.documentTotals.ukd_expense_return)}`);
  lines.push(`Прочий приход вручную;${csvCell(report.documentTotals.manual_income)}`);
  lines.push(`Прочий возврат прихода вручную;${csvCell(report.documentTotals.manual_income_return)}`);
  lines.push(`Прочий расход вручную;${csvCell(report.documentTotals.manual_expense)}`);
  lines.push(`Прочий возврат расхода вручную;${csvCell(report.documentTotals.manual_expense_return)}`);
  lines.push('');
  lines.push('Строки для ЛК АУСН');
  lines.push('Тип;Название;Сумма;Для объекта;Комментарий');
  report.manualEntries.forEach((entry) => {
    lines.push([
      entry.kind,
      entry.title,
      entry.amount,
      entry.requiredFor,
      entry.details,
    ].map(csvCell).join(';'));
  });
  lines.push('');
  lines.push('Документные строки');
  lines.push('Тип;Дата;Название;Сумма;Источник');
  report.documentRows.forEach((row) => {
    lines.push([
      row.documentType,
      row.documentDate ?? '',
      row.title ?? '',
      row.amount,
      row.source ?? '',
    ].map(csvCell).join(';'));
  });
  lines.push('');
  lines.push('Расчет налога');
  lines.push(`База доходов;${csvCell(report.taxEstimate.incomeBase)}`);
  lines.push(`База расходов;${csvCell(report.taxEstimate.expenseBase)}`);
  lines.push(`База прибыли;${csvCell(report.taxEstimate.profitBase)}`);
  lines.push(`Обычный налог;${csvCell(report.taxEstimate.regularTax)}`);
  lines.push(`Минимальный налог;${csvCell(report.taxEstimate.minimumTax)}`);
  lines.push(`Оценка к уплате;${csvCell(report.taxEstimate.taxToPay)}`);
  return lines.join('\n');
}

export const GET = apiRoute(async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const month = normalizeAusnMonth(searchParams.get('month'));
  const format = searchParams.get('format');
  const { tenantId } = await requireActiveTenant(request);
  const report = await getAusnMonthlyReconciliation(tenantId, month);

  if (format === 'csv') {
    return new Response(toCsv(report), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="aosn_${month}.csv"`,
        'Cache-Control': 'no-store',
      },
    }) as unknown as NextResponse;
  }

  return NextResponse.json(report);
});

export const POST = apiRoute(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const month = normalizeAusnMonth(typeof body.month === 'string' ? body.month : null);
  const taxObject = normalizeAusnTaxObject(body.taxObject);
  const bankIncome = Math.max(0, toNumber(body.bankIncome));
  const bankIncomeReturn = Math.max(0, toNumber(body.bankIncomeReturn));
  const bankExpense = Math.max(0, toNumber(body.bankExpense));
  const bankExpenseReturn = Math.max(0, toNumber(body.bankExpenseReturn));
  const otherExpenses = Math.max(0, toNumber(body.otherExpenses));
  const notes = typeof body.notes === 'string' ? body.notes : null;
  const documentRows = Array.isArray(body.documentRows) ? body.documentRows : undefined;

  const { tenantId } = await requireActiveTenant(request, ['owner', 'admin']);
  const report = await saveAusnMonthlyInput(tenantId, {
    month,
    taxObject,
    bankIncome,
    bankIncomeReturn,
    bankExpense,
    bankExpenseReturn,
    otherExpenses,
    notes,
    documentRows,
  });

  return NextResponse.json(report);
});
