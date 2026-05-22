'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/store/useStore';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { Calendar, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const PRESETS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: '7d', label: '7 дней' },
  { key: '14d', label: '14 дней' },
  { key: '30d', label: '30 дней' },
  { key: 'thisMonth', label: 'Этот месяц' },
  { key: 'prevMonth', label: 'Прошлый месяц' },
] as const;

type PresetKey = (typeof PRESETS)[number]['key'];

function dayOnly(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayKey(date: Date) {
  return format(dayOnly(date), 'yyyy-MM-dd');
}

function getPresetRange(preset: PresetKey) {
  const now = dayOnly(new Date());
  let from = now;
  let to = now;

  switch (preset) {
    case 'today':
      break;
    case 'yesterday':
      from = subDays(now, 1);
      to = from;
      break;
    case '7d':
      from = subDays(now, 6);
      break;
    case '14d':
      from = subDays(now, 13);
      break;
    case '30d':
      from = subDays(now, 29);
      break;
    case 'thisMonth':
      from = startOfMonth(now);
      break;
    case 'prevMonth':
      from = startOfMonth(subMonths(now, 1));
      to = endOfMonth(from);
      break;
  }

  return { from, to };
}

function getMonthDays(month: Date) {
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });
}

function getOrderedRange(from: Date | null, to: Date | null) {
  if (!from) return null;
  const safeTo = to ?? from;
  return isAfter(from, safeTo) ? { from: safeTo, to: from } : { from, to: safeTo };
}

export function DateRangePresetBar() {
  const { dateFrom, dateTo, setDateRange } = useStore();

  const activePreset = useMemo(() => {
    const currentFrom = dayKey(dateFrom);
    const currentTo = dayKey(dateTo);

    return PRESETS.find((preset) => {
      const range = getPresetRange(preset.key);
      return dayKey(range.from) === currentFrom && dayKey(range.to) === currentTo;
    })?.key ?? null;
  }, [dateFrom, dateTo]);

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 rounded-2xl border border-slate-200 bg-white/75 p-1.5 shadow-[0_10px_26px_-24px_rgba(15,23,42,0.45)] dark:border-slate-700 dark:bg-slate-950/35">
      {PRESETS.map((preset) => {
        const isActive = activePreset === preset.key;

        return (
          <button
            key={preset.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              const range = getPresetRange(preset.key);
              setDateRange(range.from, range.to);
            }}
            className={`h-9 rounded-xl border px-3 text-xs font-black transition-all ${
              isActive
                ? 'border-slate-700 bg-slate-800 text-white shadow-[0_10px_24px_-16px_rgba(15,23,42,0.65)]'
                : 'border-slate-200 bg-slate-50 text-slate-600 shadow-[var(--shadow-xs)] hover:border-slate-300 hover:bg-slate-100 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}

export function DateRangePicker() {
  const { dateFrom, dateTo, setDateRange } = useStore();
  const [isOpen, setIsOpen] = useState(false);
  const [monthCursor, setMonthCursor] = useState(startOfMonth(dateFrom || new Date()));
  const [draftFrom, setDraftFrom] = useState<Date | null>(dayOnly(dateFrom || new Date()));
  const [draftTo, setDraftTo] = useState<Date | null>(dayOnly(dateTo || new Date()));
  const dropdownRef = useRef<HTMLDivElement>(null);

  const orderedDraftRange = getOrderedRange(draftFrom, draftTo);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function syncDraftRange() {
    const nextFrom = dayOnly(dateFrom || new Date());
    const nextTo = dayOnly(dateTo || nextFrom);
    setDraftFrom(nextFrom);
    setDraftTo(nextTo);
    setMonthCursor(startOfMonth(nextFrom));
  }

  function handleDayClick(day: Date) {
    const selectedDay = dayOnly(day);

    if (!draftFrom || draftTo) {
      setDraftFrom(selectedDay);
      setDraftTo(null);
      return;
    }

    if (isSameDay(selectedDay, draftFrom)) {
      setDraftTo(selectedDay);
      setDateRange(selectedDay, selectedDay);
      setIsOpen(false);
      return;
    }

    if (isBefore(selectedDay, draftFrom)) {
      setDraftFrom(selectedDay);
      setDraftTo(draftFrom);
      return;
    }

    setDraftTo(selectedDay);
  }

  function applyDraftRange() {
    if (!orderedDraftRange) return;
    setDateRange(orderedDraftRange.from, orderedDraftRange.to);
    setIsOpen(false);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => {
          if (!isOpen) {
            syncDraftRange();
          }
          setIsOpen(!isOpen);
        }}
        className="flex h-10 min-w-[220px] items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-900 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.45)] transition-all hover:border-slate-400 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900/80 dark:text-slate-100 dark:hover:bg-slate-800"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Calendar className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-300" />
          <span className="truncate">
            {format(dateFrom, 'd MMM', { locale: ru })} — {format(dateTo, 'd MMM', { locale: ru })}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform dark:text-slate-300 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen ? (
        <div className="absolute right-0 top-full z-[300] mt-3 w-[min(430px,calc(100vw-2rem))] overflow-hidden rounded-[1.35rem] border border-slate-200 bg-popover text-popover-foreground shadow-[0_22px_70px_rgba(15,23,42,0.16)] ring-1 ring-slate-100 animate-in fade-in slide-in-from-top-2 zoom-in-95 duration-200 dark:border-slate-700 dark:ring-slate-800 dark:shadow-[0_22px_70px_rgba(0,0,0,0.42)]">
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setMonthCursor((current) => subMonths(current, 1))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Предыдущий месяц"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="text-center">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-muted-foreground">Период</p>
                <p className="mt-0.5 text-sm font-bold text-foreground">
                  {orderedDraftRange
                    ? `${format(orderedDraftRange.from, 'd MMM', { locale: ru })} — ${format(orderedDraftRange.to, 'd MMM yyyy', { locale: ru })}`
                    : 'Выберите даты'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMonthCursor((current) => addMonths(current, 1))}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Следующий месяц"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <MonthCalendar
              month={monthCursor}
              range={orderedDraftRange}
              draftFrom={draftFrom}
              onSelectDay={handleDayClick}
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-bold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={applyDraftRange}
                disabled={!orderedDraftRange}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white shadow-lg shadow-violet-600/20 transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                Применить
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MonthCalendar({
  month,
  range,
  draftFrom,
  onSelectDay,
}: {
  month: Date;
  range: { from: Date; to: Date } | null;
  draftFrom: Date | null;
  onSelectDay: (day: Date) => void;
}) {
  const days = getMonthDays(month);
  const today = dayOnly(new Date());

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/35">
      <div className="mb-3 text-center text-sm font-black capitalize text-foreground">
        {format(month, 'LLLL yyyy', { locale: ru })}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((day) => (
          <div key={day} className="py-1 text-[10px] font-black uppercase text-muted-foreground">
            {day}
          </div>
        ))}
        {days.map((day) => {
          const isOutside = !isSameMonth(day, month);
          const isToday = isSameDay(day, today);
          const isStart = Boolean(range && isSameDay(day, range.from));
          const isEnd = Boolean(range && isSameDay(day, range.to));
          const isInRange = Boolean(
            range
              && !isStart
              && !isEnd
              && isAfter(day, range.from)
              && isBefore(day, range.to),
          );
          const isDraftStart = Boolean(draftFrom && isSameDay(day, draftFrom) && !range?.to);

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDay(day)}
              className={`h-9 rounded-xl text-xs font-bold transition-all ${
                isOutside ? 'text-muted-foreground/35' : 'text-foreground'
              } ${
                isInRange ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100' : ''
              } ${
                isStart || isEnd || isDraftStart
                  ? 'bg-slate-800 text-white shadow-[0_10px_24px_-16px_rgba(15,23,42,0.7)] dark:bg-slate-100 dark:text-slate-950'
                  : 'hover:bg-accent hover:text-foreground'
              } ${
                isToday && !isStart && !isEnd && !isDraftStart
                  ? 'ring-1 ring-slate-300 dark:ring-slate-500'
                  : ''
              }`}
            >
              {format(day, 'd')}
            </button>
          );
        })}
      </div>
    </div>
  );
}
