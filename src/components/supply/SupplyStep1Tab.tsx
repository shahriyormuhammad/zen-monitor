'use client';

/**
 * Шаг 1: «Создать поставку» — порт Постал panel-plan / step-supply.
 *
 *   1. Форма: vendorCode/nmId (autocomplete) + кол-во коробок + селект профиля
 *      ростовки (показывается только если у nmId несколько профилей).
 *   2. После добавления — строка в supplyList: фото + ростовка таблицей.
 *   3. Кнопки «Экспорт CSV / XLSX» — формат WB: [Баркод товара, Кол-во товаров].
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, ExternalLink, FileSpreadsheet, Loader2, Plus, Send, Star, Trash2, X,
} from 'lucide-react';

import {
  addSupplyItemAction, clearSupplyItemsAction, listProfilesForArticleAction,
  listSupplyArticlesAction, listSupplyItemsAction, removeSupplyItemAction,
  buildSupplyXlsxAction, createWbSupplyAction, listWbWarehousesAction,
} from '@/app/(dashboard)/supply/actions';
import type { ProfileForDropdown, SupplyItem } from '@/server/supply-builder/service';
import { ArticleAutocomplete } from './ArticleAutocomplete';

type Article = Awaited<ReturnType<typeof listSupplyArticlesAction>>[number];

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}
function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function SupplyStep1Tab({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();

  const articlesQuery = useQuery({
    queryKey: ['supply-articles', tenantId],
    queryFn: () => listSupplyArticlesAction(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });
  const articles = articlesQuery.data ?? [];

  const itemsQuery = useQuery({
    queryKey: ['supply-items', tenantId],
    queryFn: () => listSupplyItemsAction(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 5_000,
  });
  const items = itemsQuery.data ?? [];

  const [vc, setVc] = useState('');
  const [nm, setNm] = useState('');
  const [boxes, setBoxes] = useState('1');
  const [profileId, setProfileId] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  const matched: Article | undefined = useMemo(() => {
    if (nm) return articles.find((a) => String(a.nmId) === nm.trim());
    if (vc) return articles.find((a) => a.vendorCode.toLowerCase() === vc.trim().toLowerCase());
    return undefined;
  }, [articles, vc, nm]);

  // Заполнить nmId при точном совпадении (но НЕ перезаписывать vendorCode —
  // иначе ввод «снапается» и его нельзя стереть, баг п.1). Выбор из подсказки
  // проставляет оба поля через onPick.
  useEffect(() => {
    if (matched && String(matched.nmId) !== nm) setNm(String(matched.nmId));
  }, [matched]); // eslint-disable-line react-hooks/exhaustive-deps

  const profilesQuery = useQuery({
    queryKey: ['profiles-for-article', tenantId, matched?.nmId, matched?.vendorCode ?? ''],
    queryFn: () => listProfilesForArticleAction(tenantId, matched?.nmId ?? null, matched?.vendorCode ?? ''),
    enabled: Boolean(tenantId && matched),
    staleTime: 30_000,
  });
  const profiles = profilesQuery.data ?? [];

  useEffect(() => {
    if (profiles.length === 0) { setProfileId(''); return; }
    if (!profileId || !profiles.find((p) => p.id === profileId)) {
      const def = profiles.find((p) => p.isDefault) ?? profiles[0]!;
      setProfileId(def.id);
    }
  }, [profiles]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedProfile: ProfileForDropdown | undefined = profiles.find((p) => p.id === profileId);
  const boxesNum = Math.max(1, Number(boxes) || 0);
  const previewTotal = selectedProfile ? selectedProfile.totalPerBox * boxesNum : 0;

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!matched) throw new Error('Артикул не найден в кабинете');
      if (!selectedProfile) throw new Error('Нет ростовки — создай в Настройках → Ростовки');
      return addSupplyItemAction(tenantId, {
        vendorCode: matched.vendorCode,
        nmId: matched.nmId,
        profileId: selectedProfile.id,
        profileName: selectedProfile.name,
        boxes: boxesNum,
        rows: selectedProfile.rows,
        source: 'manual',
      });
    },
    onSuccess: () => {
      setFormError(null);
      setVc(''); setNm(''); setBoxes('1'); setProfileId('');
      queryClient.invalidateQueries({ queryKey: ['supply-items', tenantId] });
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeSupplyItemAction(tenantId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supply-items', tenantId] }),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearSupplyItemsAction(tenantId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['supply-items', tenantId] }),
  });

  const [exportMessage, setExportMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const exportMutation = useMutation({
    mutationFn: () => buildSupplyXlsxAction(tenantId),
    onSuccess: (result) => {
      // Trigger client download from base64.
      const bin = atob(result.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportMessage({
        tone: 'ok',
        text: `Скачано: ${result.filename} · ${result.summary.barcodesCount} уник. баркодов · ${result.summary.rowsCount} строк`,
      });
    },
    onError: (e) => setExportMessage({ tone: 'err', text: e instanceof Error ? e.message : String(e) }),
  });

  // Warehouse override (Шаг 1): pick a real WB warehouse for the whole supply.
  const [overrideWarehouseId, setOverrideWarehouseId] = useState<number | null>(null);
  const [whInput, setWhInput] = useState('');
  const [whEnabled, setWhEnabled] = useState(false);
  const warehousesQuery = useQuery({
    queryKey: ['wb-warehouses', tenantId],
    queryFn: () => listWbWarehousesAction(tenantId),
    enabled: Boolean(tenantId) && whEnabled,
    staleTime: 6 * 60 * 60 * 1000,
  });
  const overrideWh = (warehousesQuery.data ?? []).find((w) => w.warehouseId === overrideWarehouseId) ?? null;
  const onWhInput = (val: string) => {
    setWhInput(val);
    const found = (warehousesQuery.data ?? []).find((w) => w.warehouseName.toLowerCase() === val.trim().toLowerCase());
    setOverrideWarehouseId(found ? found.warehouseId : null);
  };

  const [wbResult, setWbResult] = useState<Awaited<ReturnType<typeof createWbSupplyAction>> | null>(null);
  const [wbError, setWbError] = useState<string | null>(null);
  const createWbMutation = useMutation({
    mutationFn: () => createWbSupplyAction(tenantId, overrideWarehouseId),
    onMutate: () => { setWbError(null); setWbResult(null); },
    onSuccess: (res) => setWbResult(res),
    onError: (e) => setWbError(e instanceof Error ? e.message : String(e)),
  });
  const warehouseCount = useMemo(
    () => new Set(items.map((i) => i.warehouse?.trim() || '—')).size,
    [items],
  );

  const totalBoxes = items.reduce((s, i) => s + i.boxes, 0);
  const totalPieces = items.reduce((s, i) => s + i.totalPieces, 0);
  const hasMissingBc = items.some((i) => i.missingBc > 0);

  if (articlesQuery.isLoading) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-rose-500" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* ─ Add form ─ */}
      <div className="dashboard-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-extrabold">Создать поставку</h3>
            <p className="mt-0.5 max-w-xl text-[12px] text-muted-foreground">
              Выбери артикул, профиль ростовки и количество коробок. Размеры × штрихкоды подтянутся из профиля.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_0.7fr]">
          <Field label="Артикул продавца">
            <ArticleAutocomplete
              value={vc}
              onChange={(v) => { setVc(v); setNm(''); }}
              onPick={(a) => { setVc(a.vendorCode); setNm(String(a.nmId)); }}
              articles={articles}
              placeholder="напр. A519-2 ТН-10"
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-[12px] outline-none focus:border-rose-400"
            />
          </Field>
          <Field label="Артикул WB (nmId)">
            <input
              value={nm}
              onChange={(e) => { setNm(e.target.value.replace(/\D/g, '')); setVc(''); }}
              placeholder="123456789"
              inputMode="numeric"
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-[12px] outline-none focus:border-rose-400"
            />
          </Field>
          <Field label="Профиль ростовки">
            {profilesQuery.isFetching ? (
              <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-subtle px-3 text-[12px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> загрузка…
              </div>
            ) : profiles.length === 0 ? (
              <div className="flex h-9 items-center rounded-lg border border-amber-400/60 bg-amber-50 px-3 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                Нет ростовки — создай в Настройках
              </div>
            ) : (
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2 text-[12px] outline-none focus:border-rose-400"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.totalPerBox} пар {p.isDefault ? '(по умолч.)' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Коробок">
            <input
              type="number"
              min={1}
              value={boxes}
              onChange={(e) => setBoxes(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-right font-mono text-[12px] outline-none focus:border-rose-400"
            />
          </Field>
        </div>

        {selectedProfile ? (
          <div className="mt-3 rounded-xl border border-border bg-subtle/50 p-3">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">Раздача профиля</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] font-bold">
              {selectedProfile.rows.map((row) => (
                <span key={row.size} className="inline-flex items-center gap-1 rounded-md bg-card px-2 py-0.5 font-mono">
                  {row.size} <span className="text-rose-600">×{row.perBox}</span>
                </span>
              ))}
              <span className="ml-2 rounded-md bg-rose-100 px-2 py-0.5 font-mono text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                = {selectedProfile.totalPerBox} пар/кор × {boxesNum} = <strong>{fmtNum(previewTotal)} шт</strong>
              </span>
            </div>
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => addMutation.mutate()}
            disabled={addMutation.isPending || !matched || !selectedProfile}
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-[12px] font-bold text-card hover:bg-foreground/90 disabled:opacity-40"
          >
            {addMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-4 w-4" />}
            Добавить в поставку
          </button>
          {formError ? (
            <span className="rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-[11px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {formError}
            </span>
          ) : null}
        </div>
      </div>

      {/* ─ Supply list ─ */}
      {items.length > 0 ? (
        <div className="dashboard-card overflow-hidden">
          <header className="flex flex-wrap items-end justify-between gap-3 border-b border-border bg-subtle/30 px-5 py-3">
            <div>
              <h3 className="text-[14px] font-extrabold">
                Список поставки <span className="ml-2 text-[12px] font-medium text-muted-foreground">{items.length} {plural(items.length, 'артикул', 'артикула', 'артикулов')} · {totalBoxes} {plural(totalBoxes, 'коробка', 'коробки', 'коробок')} · {fmtNum(totalPieces)} шт</span>
              </h3>
              {hasMissingBc ? (
                <p className="mt-1 text-[11px] text-rose-600">⚠ Есть строки без штрихкодов — сначала синхронизируй размеры из WB в Настройках.</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                list="wb-wh-datalist"
                value={whInput}
                onFocus={() => { if (!whEnabled) setWhEnabled(true); }}
                onChange={(e) => onWhInput(e.target.value)}
                placeholder={whEnabled && warehousesQuery.isFetching ? 'загрузка складов…' : 'Склад: Авто (по Плану)'}
                title="Печатай склад (напр. «Тула») и выбери из списка. Пусто = Авто по Плану."
                className={`h-9 w-[210px] rounded-lg border bg-card px-2 text-[11px] font-medium text-foreground outline-none focus:border-violet-400 ${overrideWh ? 'border-violet-400' : 'border-border'}`}
              />
              <datalist id="wb-wh-datalist">
                {(warehousesQuery.data ?? []).map((w) => (
                  <option key={w.warehouseId} value={w.warehouseName}>{w.okrug ?? ''}</option>
                ))}
              </datalist>
              <button
                type="button"
                onClick={() => {
                  const whMsg = overrideWarehouseId
                    ? `Вся поставка (${fmtNum(totalPieces)} шт) уйдёт на склад «${overrideWh?.warehouseName ?? 'выбранный'}» одной поставкой.`
                    : warehouseCount > 1
                      ? `Позиции разложены по ${warehouseCount} склад(ам) из Плана — создам по поставке на каждый.`
                      : `Заполню товары (${fmtNum(totalPieces)} шт) в поставку.`;
                  if (window.confirm(
                    `Создать поставку(и) прямо в кабинете WB?\n\n${whMsg}\n` +
                    `Дату поставки выберешь сам в WB — это финансовый шаг с капчей, его не автоматизирую.`,
                  )) createWbMutation.mutate();
                }}
                disabled={createWbMutation.isPending || hasMissingBc}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-[11px] font-bold text-violet-800 hover:bg-violet-100 disabled:opacity-40 dark:border-violet-700/40 dark:bg-violet-950/30 dark:text-violet-200"
                title="Автозаполнить товары в поставку в кабинете WB"
              >
                {createWbMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Создать в WB
              </button>
              <button
                type="button"
                onClick={() => exportMutation.mutate()}
                disabled={exportMutation.isPending || hasMissingBc}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 disabled:opacity-40 dark:border-emerald-700/40 dark:bg-emerald-950/30 dark:text-emerald-200"
              >
                {exportMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                Экспорт XLSX
              </button>
              <button
                type="button"
                onClick={() => { if (window.confirm('Очистить весь список поставки?')) clearMutation.mutate(); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-bold text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" /> Очистить
              </button>
            </div>
          </header>

          {exportMessage ? (
            <div className={`border-b border-border px-5 py-2 text-[12px] ${
              exportMessage.tone === 'ok' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
            }`}>{exportMessage.text}</div>
          ) : null}

          {wbError ? (
            <div className="flex items-start gap-2 border-b border-border bg-rose-50 px-5 py-2.5 text-[12px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{wbError}</span>
            </div>
          ) : null}

          {wbResult ? (
            <div className="border-b border-border bg-violet-50 px-5 py-3 dark:bg-violet-950/30">
              <div className="flex items-center gap-2 text-[12.5px] font-bold text-violet-900 dark:text-violet-200">
                <CheckCircle2 className="h-4 w-4 text-violet-600" />
                Готово в WB · {wbResult.filter((g) => g.preorderID).length} поставка(и) + {wbResult.filter((g) => !g.preorderID).length} черновик(ов)
              </div>
              <div className="mt-2 space-y-2">
                {wbResult.map((g, gi) => (
                  <div key={gi} className="rounded-lg border border-violet-200 bg-card p-2.5 dark:border-violet-800/40">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[12px] font-bold text-foreground">
                        {g.preorderID ? '📦 Поставка' : '📝 Черновик'}
                        {g.wbWarehouseName ? (
                          <span className="ml-1.5 font-normal text-muted-foreground">
                            → {g.wbWarehouseName}{g.warehouseName && g.warehouseName !== g.wbWarehouseName ? ` (план: ${g.warehouseName})` : ''}
                          </span>
                        ) : g.warehouseName ? (
                          <span className="ml-1.5 font-normal text-amber-700 dark:text-amber-300">— склад «{g.warehouseName}» выбери вручную</span>
                        ) : (
                          <span className="ml-1.5 font-normal text-muted-foreground">— без склада</span>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground">{g.goodsBarcodes} баркод{plural(g.goodsBarcodes, '', 'а', 'ов')} · {fmtNum(g.goodsUnits)} шт</span>
                    </div>
                    <a
                      href={g.deepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1.5 text-[11.5px] font-bold text-white hover:bg-violet-700"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> {g.preorderID ? 'Открыть в WB → выбрать дату' : 'Открыть в WB → склад и дату'}
                    </a>
                    {g.availableDates && g.availableDates.length > 0 ? (
                      <div className="mt-1.5 text-[10.5px] text-violet-700 dark:text-violet-300">
                        <span className="font-bold">📅 Даты приёмки:</span>{' '}
                        {g.availableDates.slice(0, 7).map((d, di) => {
                          const lbl = new Date(d.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
                          return (
                            <span key={di} className={d.coefficient === 0 ? 'font-bold text-emerald-700 dark:text-emerald-300' : ''}>
                              {di > 0 ? ', ' : ''}{lbl}{d.coefficient === 0 ? ' (беспл.)' : ` (×${d.coefficient})`}
                            </span>
                          );
                        })}
                        {g.availableDates.length > 7 ? ' …' : ''}
                      </div>
                    ) : null}
                    {g.rejected.length > 0 ? (
                      <div className="mt-2 rounded-md border border-amber-300/70 bg-amber-50 px-2.5 py-1.5 text-[10.5px] text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-200">
                        <span className="font-bold">WB не принял {g.rejected.length}:</span>{' '}
                        <span className="font-mono">{g.rejected.slice(0, 6).map((r) => r.barcode).join(', ')}{g.rejected.length > 6 ? ` …+${g.rejected.length - 6}` : ''}</span>
                      </div>
                    ) : null}
                    {g.warnings.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-[10.5px] text-violet-700 dark:text-violet-300">
                        {g.warnings.map((w, wi) => <li key={wi}>• {w}</li>)}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[11px] text-violet-700 dark:text-violet-300">
                Дату поставки выбери в кабинете — финансовый шаг с капчей мы не трогаем.
              </div>
            </div>
          ) : null}

          <div className="divide-y divide-border">
            {items.map((item, idx) => (
              <SupplyItemRow key={item.id} item={item} idx={idx + 1} onRemove={() => removeMutation.mutate(item.id)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="dashboard-card p-8 text-center text-[12px] text-muted-foreground">
          Список поставки пуст. Добавь первый артикул через форму выше.
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SupplyItemRow({ item, idx, onRemove }: { item: SupplyItem; idx: number; onRemove: () => void }) {
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-[40px_minmax(0,1fr)_auto]">
      <div className="text-[11px] font-bold text-muted-foreground">#{idx}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-2">
          <strong className="text-[13px] text-foreground">{item.vendorCode}</strong>
          <span className="text-[11px] text-muted-foreground">{item.nmId ?? '—'}</span>
          {item.profileName ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-bold text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300">
              <Star className="h-3 w-3" /> {item.profileName}
            </span>
          ) : null}
          {item.source === 'invoice' ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">из накладной</span>
          ) : null}
          {item.source === 'plan' ? (
            <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-800 dark:bg-teal-950 dark:text-teal-300">из плана</span>
          ) : null}
          {item.warehouse ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
              🏭 {item.warehouse}
            </span>
          ) : null}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {item.boxes} {plural(item.boxes, 'коробка', 'коробки', 'коробок')} · {item.sumPerBox} пар/кор · <strong>{fmtNum(item.totalPieces)} шт</strong>
          {item.missingBc > 0 ? <span className="ml-2 text-rose-600">⚠ нет {item.missingBc} штрихкод{plural(item.missingBc, '', 'а', 'ов')}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-1 text-[10.5px] font-mono">
          {item.rows.map((r) => (
            <span key={r.size} className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 ${r.barcode ? 'bg-subtle text-foreground' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'}`}>
              {r.size}×{r.perBox}={r.total}
            </span>
          ))}
        </div>
      </div>
      <div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-md border border-border p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
          title="Удалить из списка"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
