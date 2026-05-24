'use client';

/**
 * Tab: «Накладная» — placeholder.
 *
 * Полная вёрстка (вбивание пар «артикул → коробок», поиск ростовки,
 * умножение на коробки) приедет в следующем деплое — нужен сначала
 * раздел Ростовки (size profiles), а он на потом по ТЗ пользователя.
 */

import { FileText } from 'lucide-react';

export function InvoiceTab({ tenantId: _tenantId }: { tenantId: string }) {
  return (
    <div className="dashboard-card p-8">
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
        <FileText className="h-12 w-12 text-rose-500/70" />
        <h3 className="text-[15px] font-extrabold">Накладная</h3>
        <p className="text-[12px] text-muted-foreground">
          Раздел построится после загрузки <strong>Ростовок</strong>. Нужен реестр размер × штук
          в коробке по каждому артикулу — он добавится в Настройках в следующем этапе.
        </p>
        <p className="text-[11px] text-muted-foreground">
          Пока используй «План поставки» — он работает без ростовок.
        </p>
      </div>
    </div>
  );
}
