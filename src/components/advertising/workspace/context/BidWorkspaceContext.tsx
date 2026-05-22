'use client';

import { createContext, useContext } from 'react';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { BidWorkspaceResponse } from '../tabs/BidsTab';
import type { ClusterMapResponse, MapActionMessage } from '../tabs/MapTab';
import type {
  StrategiesResponse,
  StrategyRecord,
  StrategyClusterRow,
  StrategyTodaySummary,
  StrategyAutopilotInsights,
} from '../tabs/StrategiesTab';

export type WorkspaceClusterRow = {
  nmId: number;
  cluster: string;
  vendorCode: string | null;
  brand: string | null;
  photoUrl: string | null;
  adSpend: number;
  clicks: number;
  orders: number;
  riskLevel: 'high' | 'medium' | 'low' | 'none';
  riskReason: string | null;
};

export type ClusterToggleArgs = {
  advertId: number;
  nmId: number;
  cluster: string;
  mode: 'exclude' | 'include';
};

export type ClusterToggleResult = {
  ok: true;
  changed: boolean;
  mode: 'exclude' | 'include';
  advertId: number;
  nmId: number;
  cluster: string;
  minusPhrasesCount: number;
};

export type AvailableCampaign = {
  advertId: number;
  paymentType: 'cpm' | 'cpc' | null;
  actionable: boolean;
};

export type BidWorkspaceContextValue = {
  tenantId: string;
  fromParam: string;
  toParam: string;
  selectedCluster: WorkspaceClusterRow | null;
  effectiveAdvertId: number | null;
  availableCampaigns: AvailableCampaign[];

  guardrailAcos: number;
  setGuardrailAcos: (v: number) => void;
  guardrailCpo: number;
  setGuardrailCpo: (v: number) => void;
  guardrailClicks: number;
  setGuardrailClicks: (v: number) => void;
  enableGuardrail: boolean;
  setEnableGuardrail: (v: boolean) => void;

  bidsQuery: UseQueryResult<BidWorkspaceResponse | null, Error>;
  clusterMapQuery: UseQueryResult<ClusterMapResponse | null, Error>;
  strategiesQuery: UseQueryResult<StrategiesResponse | null, Error>;

  strategyById: Map<string, StrategyRecord>;
  strategyByCampaignKey: Map<string, StrategyRecord>;
  latestRunByStrategyId: Map<string, StrategiesResponse['runs'][number]>;
  strategyClusterRows: StrategyClusterRow[];
  strategyTodayKey: string;
  strategyTodaySummary: StrategyTodaySummary;
  strategyAutopilotInsights: StrategyAutopilotInsights;
  ads2ChangedClusterSet: Set<string>;

  clusterToggleMutation: UseMutationResult<ClusterToggleResult, Error, ClusterToggleArgs>;
  mapActionMessage: MapActionMessage | null;
  setMapActionMessage: (msg: MapActionMessage | null) => void;
};

export const BidWorkspaceContext = createContext<BidWorkspaceContextValue | null>(null);

export function useBidWorkspace(): BidWorkspaceContextValue {
  const ctx = useContext(BidWorkspaceContext);
  if (!ctx) {
    throw new Error('useBidWorkspace must be used inside BidWorkspaceContext.Provider');
  }
  return ctx;
}
