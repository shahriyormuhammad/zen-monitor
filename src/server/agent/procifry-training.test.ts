import { describe, expect, it } from 'vitest';

import {
  AGENT_REPORTS,
  PROCIFRY_WORKERS,
  assertAgentWorkerReportAccess,
  type AgentApiClient,
  type AgentReportId,
  type ProcifryWorkerId,
} from '@/lib/agent-api';
import {
  PROCIFRY_CORE_CONTEXT_REPORTS,
  PROCIFRY_DATA_STATE_TEMPLATES,
  PROCIFRY_EVAL_CASES,
  PROCIFRY_TASK_REPORT_MAP,
  PROCIFRY_WORKER_CHEATSHEETS,
  type ProcifryTrainingReportRef,
} from '@/server/agent/procifry-training';

const reportIds = new Set<string>(AGENT_REPORTS);
const workerIds = new Set<string>(PROCIFRY_WORKERS);

function isAgentReport(report: ProcifryTrainingReportRef): report is AgentReportId {
  return report !== 'catalog';
}

function assertKnownReports(reports: readonly ProcifryTrainingReportRef[]) {
  for (const report of reports) {
    if (report === 'catalog') {
      continue;
    }
    expect(reportIds.has(report), `${report} is not in AGENT_REPORTS`).toBe(true);
  }
}

function clientForWorker(workerId: ProcifryWorkerId): AgentApiClient {
  return {
    id: `test-${workerId}`,
    key: 'very-secret-agent-key',
    reports: null,
    tenantIds: null,
    cabinetOids: null,
    workerId,
    roles: ['read_all_wb_digitization'],
  };
}

describe('Procifry worker training spec', () => {
  it('has a cheatsheet for every Procifry worker', () => {
    expect(Object.keys(PROCIFRY_WORKER_CHEATSHEETS).sort()).toEqual([...PROCIFRY_WORKERS].sort());
  });

  it('references only known reports in core context, task map and evals', () => {
    assertKnownReports(PROCIFRY_CORE_CONTEXT_REPORTS);
    for (const mapping of PROCIFRY_TASK_REPORT_MAP) {
      assertKnownReports(mapping.reports);
    }
    for (const evalCase of PROCIFRY_EVAL_CASES) {
      assertKnownReports(evalCase.expectedReports);
    }
  });

  it('keeps worker cheatsheets aligned with RBAC report scopes', () => {
    for (const [workerId, cheatsheet] of Object.entries(PROCIFRY_WORKER_CHEATSHEETS) as Array<[ProcifryWorkerId, typeof PROCIFRY_WORKER_CHEATSHEETS[ProcifryWorkerId]]>) {
      if (cheatsheet.reports === '*') {
        continue;
      }
      for (const report of cheatsheet.reports) {
        expect(() => assertAgentWorkerReportAccess(clientForWorker(workerId), report)).not.toThrow();
      }
    }
  });

  it('keeps task map workers and report scopes valid', () => {
    for (const mapping of PROCIFRY_TASK_REPORT_MAP) {
      expect(workerIds.has(mapping.workerId), `${mapping.task} has unknown worker`).toBe(true);
      const client = clientForWorker(mapping.workerId);
      for (const reportRef of mapping.reports) {
        if (!isAgentReport(reportRef)) {
          continue;
        }
        const report = reportRef;
        expect(() => assertAgentWorkerReportAccess(client, report)).not.toThrow();
      }
    }
  });

  it('covers the mandatory hallucination eval scenarios', () => {
    expect(PROCIFRY_EVAL_CASES.map((item) => item.id)).toEqual(expect.arrayContaining([
      'yesterday_multi_tenant_summary',
      'why_zeroes',
      'partial_unit_economics_coverage',
      'available_report_empty_items',
      'report_not_assigned_to_worker',
      'source_not_connected_external_reports',
    ]));
    expect(Object.keys(PROCIFRY_DATA_STATE_TEMPLATES)).toEqual(expect.arrayContaining([
      'ok',
      'no_access',
      'report_not_assigned',
      'source_not_connected',
      'no_data_for_period',
      'stale',
      'missing',
    ]));
  });

  it('forces every eval to start from catalog before domain reports', () => {
    for (const evalCase of PROCIFRY_EVAL_CASES) {
      expect(evalCase.expectedReports[0]).toBe('catalog');
      expect(evalCase.expectedChecks.length).toBeGreaterThan(0);
      expect(PROCIFRY_DATA_STATE_TEMPLATES[evalCase.expectedDataState]).toBeTruthy();
    }
  });
});
