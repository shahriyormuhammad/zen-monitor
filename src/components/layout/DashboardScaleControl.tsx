'use client';

import { Maximize2, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';

const SCALE_STORAGE_KEY = 'dashboard-content-scale:v1';
const FIT_STORAGE_KEY = 'dashboard-content-fit:v1';
const MIN_SCALE = 80;
const MAX_SCALE = 120;
const FIT_MIN_SCALE = 70;
const FIT_MAX_SCALE = 100;
const FIT_REFERENCE_WIDTH = 1780;
const DEFAULT_SCALE = 100;

function clampScale(value: number, min = MIN_SCALE, max = MAX_SCALE) {
  if (!Number.isFinite(value)) return DEFAULT_SCALE;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function applyDashboardScale(value: number) {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--dashboard-scale', String(value / 100));
}

function applyDashboardFit(enabled: boolean) {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-dashboard-fit', enabled);
}

function computeFitScale() {
  if (typeof document === 'undefined') return DEFAULT_SCALE;

  const scrollArea = document.querySelector<HTMLElement>('.dashboard-scroll');
  const availableWidth = scrollArea?.clientWidth ?? window.innerWidth;
  const contentWidth = Math.max(320, availableWidth - 48);
  const scale = (contentWidth / FIT_REFERENCE_WIDTH) * 100;

  return clampScale(scale, FIT_MIN_SCALE, FIT_MAX_SCALE);
}

export function DashboardScaleControl() {
  const [manualScale, setManualScale] = useState(DEFAULT_SCALE);
  const [fitScale, setFitScale] = useState(DEFAULT_SCALE);
  const [fitMode, setFitMode] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      const stored = Number(window.localStorage.getItem(SCALE_STORAGE_KEY));
      const nextManualScale = clampScale(stored || DEFAULT_SCALE);
      const nextFitMode = window.localStorage.getItem(FIT_STORAGE_KEY) === '1';

      setManualScale(nextManualScale);
      setFitMode(nextFitMode);

      if (nextFitMode) {
        applyDashboardFit(true);
        const nextFitScale = computeFitScale();
        setFitScale(nextFitScale);
        applyDashboardScale(nextFitScale);
      } else {
        applyDashboardFit(false);
        applyDashboardScale(nextManualScale);
      }
    });
  }, []);

  useEffect(() => {
    if (!fitMode) {
      applyDashboardFit(false);
      applyDashboardScale(manualScale);
      return;
    }

    applyDashboardFit(true);

    function updateFitScale() {
      const nextScale = computeFitScale();
      setFitScale(nextScale);
      applyDashboardScale(nextScale);
    }

    queueMicrotask(updateFitScale);
    window.addEventListener('resize', updateFitScale);

    const scrollArea = document.querySelector<HTMLElement>('.dashboard-scroll');
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateFitScale);
    if (scrollArea && resizeObserver) resizeObserver.observe(scrollArea);

    return () => {
      window.removeEventListener('resize', updateFitScale);
      resizeObserver?.disconnect();
    };
  }, [fitMode, manualScale]);

  function updateScale(value: number) {
    const nextScale = clampScale(value);
    setFitMode(false);
    setManualScale(nextScale);
    window.localStorage.setItem(SCALE_STORAGE_KEY, String(nextScale));
    window.localStorage.setItem(FIT_STORAGE_KEY, '0');
    applyDashboardFit(false);
    applyDashboardScale(nextScale);
  }

  function toggleFitMode() {
    const nextFitMode = !fitMode;
    setFitMode(nextFitMode);
    window.localStorage.setItem(FIT_STORAGE_KEY, nextFitMode ? '1' : '0');

    if (!nextFitMode) {
      applyDashboardFit(false);
      applyDashboardScale(manualScale);
    } else {
      const nextFitScale = computeFitScale();
      setFitScale(nextFitScale);
      applyDashboardFit(true);
      applyDashboardScale(nextFitScale);
    }
  }

  return (
    <div className="hidden shrink-0 items-center gap-1.5 xl:flex">
      <div className="flex h-8 w-[178px] items-center gap-1.5 rounded-xl border border-border bg-card/92 px-2 shadow-[var(--shadow-sm)] backdrop-blur-xl">
        <span className="shrink-0 text-[9px] font-black uppercase tracking-[0.16em] text-muted-foreground">
          Масштаб
        </span>
        <input
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={5}
          value={manualScale}
          onChange={(event) => updateScale(Number(event.target.value))}
          aria-label="Ручной масштаб dashboard"
          className="dashboard-scale-slider h-1.5 min-w-0 flex-1 cursor-pointer"
        />
        <button
          type="button"
          onClick={() => updateScale(DEFAULT_SCALE)}
          className="inline-flex h-6 min-w-10 shrink-0 items-center justify-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-1.5 text-[10px] font-black text-slate-900 shadow-xs transition-colors hover:border-sky-300 hover:bg-sky-100 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-slate-100"
          title="Вернуть ручной масштаб 100%"
        >
          <RotateCcw className="h-2.5 w-2.5 text-slate-500" />
          {manualScale}%
        </button>
      </div>

      <button
        type="button"
        onClick={toggleFitMode}
        className={`inline-flex h-8 w-[108px] shrink-0 items-center justify-center gap-1 rounded-xl border px-2 text-[10px] font-black shadow-[var(--shadow-sm)] backdrop-blur-xl transition-colors ${
          fitMode
            ? 'border-violet-300 bg-violet-100 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/20 dark:text-violet-200'
            : 'border-border bg-card/92 text-muted-foreground hover:border-border-strong hover:bg-accent hover:text-foreground'
        }`}
        title={fitMode ? 'Выключить подгонку рабочей области под экран' : 'Подогнать рабочую область под экран'}
        aria-pressed={fitMode}
        aria-label="Подгонка рабочей области под экран"
      >
        <Maximize2 className="h-3 w-3 shrink-0" />
        <span className="shrink-0">Под экран</span>
        <span className="shrink-0 text-[9px] opacity-80">{fitScale}%</span>
      </button>
    </div>
  );
}
