'use client';

import { useMemo } from 'react';

import {
  SELF_LEARNING_POSITION_ARMS,
  learningArmKey,
  type StrategyBanditState,
} from '@/lib/advertising/self-learning';
import {
  betaPosteriorMean,
  normalPosterior,
  probabilityArmIsBest,
  type BetaBernoulliArm,
  type NormalArm,
} from '@/lib/advertising/bandits/thompson';
import { sampleBeta, sampleNormal } from '@/lib/advertising/bandits/prng';
import { LINUCB_MIN_OBSERVATIONS } from '@/lib/advertising/bandits/linucb';
import { panelClass } from '../_shared/ui';

const MONTE_CARLO_ITERATIONS = 2000;
/** Фиксированный seed только для отображения (не влияет на реальный выбор). */
const DISPLAY_SEED = 0x1b4d1702;

type ArmRow = {
  key: string;
  label: string;
  posteriorMean: number;
  obsCount: number;
  probability: number;
};

function buildBetaRows(state: Extract<StrategyBanditState, { policy: 'thompson_beta' }>): ArmRow[] {
  const arms: Array<BetaBernoulliArm & { key: string; label: string }> =
    SELF_LEARNING_POSITION_ARMS.map(arm => {
      const key = learningArmKey(arm.from, arm.to);
      const p = state.arms[key] ?? { successes: 0, failures: 0 };
      return { id: key, key, label: `${arm.from}–${arm.to}`, successes: p.successes, failures: p.failures };
    });

  const probs = probabilityArmIsBest(
    arms,
    (arm, prng) => sampleBeta(prng, arm.successes + 1, arm.failures + 1),
    DISPLAY_SEED,
    MONTE_CARLO_ITERATIONS,
  );

  return arms.map(arm => ({
    key: arm.key,
    label: arm.label,
    posteriorMean: betaPosteriorMean(arm),
    obsCount: arm.successes + arm.failures,
    probability: probs.get(arm.id) ?? 0,
  }));
}

function buildNormalRows(state: Extract<StrategyBanditState, { policy: 'thompson_normal' }>): ArmRow[] {
  const arms: Array<NormalArm & { key: string; label: string }> =
    SELF_LEARNING_POSITION_ARMS.map(arm => {
      const key = learningArmKey(arm.from, arm.to);
      const p = state.arms[key] ?? { count: 0, mean: 0, m2: 0 };
      return { id: key, key, label: `${arm.from}–${arm.to}`, count: p.count, mean: p.mean, m2: p.m2 };
    });

  const probs = probabilityArmIsBest(
    arms,
    (arm, prng) => {
      const { mean, variance } = normalPosterior(arm);
      return sampleNormal(prng, mean, Math.sqrt(Math.max(variance, 1e-4)));
    },
    DISPLAY_SEED,
    MONTE_CARLO_ITERATIONS,
  );

  return arms.map(arm => {
    const { mean } = normalPosterior(arm);
    return {
      key: arm.key,
      label: arm.label,
      posteriorMean: mean,
      obsCount: arm.count,
      probability: probs.get(arm.id) ?? 0,
    };
  });
}

export function BanditInsights({
  banditState,
  totalObservations,
}: {
  banditState: StrategyBanditState | undefined;
  totalObservations: number;
}) {
  const rows = useMemo<ArmRow[]>(() => {
    if (!banditState) return [];
    if (banditState.policy === 'thompson_beta') return buildBetaRows(banditState);
    return buildNormalRows(banditState);
  }, [banditState]);

  if (!banditState || rows.length === 0) return null;

  const { shadowDelta, policy, rewardKind, updatedAt } = banditState;
  const matchRate =
    shadowDelta.total > 0 ? Math.round((shadowDelta.matches / shadowDelta.total) * 100) : null;

  const sortedRows = [...rows].sort((a, b) => b.probability - a.probability);
  const bestKey = sortedRows[0]?.key;

  const policyLabel = policy === 'thompson_beta' ? 'Beta' : 'Normal';
  const rewardLabel = rewardKind === 'position_hit' ? 'position' : 'economic';

  return (
    <div className={`${panelClass} mt-3`}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Bandit Insights
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">
          {policyLabel} · {rewardLabel}
        </span>
        {totalObservations >= LINUCB_MIN_OBSERVATIONS && (
          <span className="text-xs px-2 py-0.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            LinUCB доступен
          </span>
        )}
      </div>

      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-slate-500 dark:text-slate-400 text-left">
            <th className="pb-1.5 font-medium pr-3">Позиция</th>
            <th className="pb-1.5 font-medium text-right pr-3">E[reward]</th>
            <th className="pb-1.5 font-medium text-right pr-3">P(best)</th>
            <th className="pb-1.5 font-medium text-right">Набл.</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map(row => (
            <tr
              key={row.key}
              className={
                row.key === bestKey
                  ? 'text-violet-700 dark:text-violet-300 font-semibold'
                  : 'text-slate-700 dark:text-slate-300'
              }
            >
              <td className="py-0.5 pr-3">{row.label}</td>
              <td className="text-right pr-3">
                {(row.posteriorMean * 100).toFixed(1)}%
              </td>
              <td className="text-right pr-3">
                <span
                  className={
                    row.key === bestKey
                      ? 'font-bold text-violet-700 dark:text-violet-300'
                      : ''
                  }
                >
                  {(row.probability * 100).toFixed(1)}%
                </span>
              </td>
              <td className="text-right">{row.obsCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {shadowDelta.total > 0 && (
          <span>
            Shadow:{' '}
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {matchRate}% совпадений
            </span>{' '}
            ({shadowDelta.total} запусков)
          </span>
        )}
        {updatedAt && (
          <span>
            Обновлено:{' '}
            {new Date(updatedAt).toLocaleDateString('ru-RU', {
              day: '2-digit',
              month: '2-digit',
              year: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  );
}
