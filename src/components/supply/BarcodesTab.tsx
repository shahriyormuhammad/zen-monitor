'use client';

/**
 * Tab: «ШК коробов» — генератор последовательных ШК для коробов WB и
 * экспорт в XLSX. Зависит от данных «Накладной» (что в каждой коробке),
 * поэтому приедет после неё.
 */

import { QrCode } from 'lucide-react';

export function BarcodesTab({ tenantId: _tenantId }: { tenantId: string }) {
  return (
    <div className="dashboard-card p-8">
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
        <QrCode className="h-12 w-12 text-rose-500/70" />
        <h3 className="text-[15px] font-extrabold">ШК коробов</h3>
        <p className="text-[12px] text-muted-foreground">
          Сюда копируется первый ШК короба из кабинета WB → система сгенерирует последовательные ШК
          и привяжет содержимое каждого по данным из «Накладной» → XLSX-экспорт.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Раздел станет активным после раздела «Накладная».
        </p>
      </div>
    </div>
  );
}
