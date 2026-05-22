import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiRoute } from '@/lib/api-response';
import {
  AGENT_REPORTS,
  assertAgentClientAccess,
  assertAgentWorkerReportAccess,
  requireAgentApiClient,
} from '@/lib/agent-api';
import { parseRequestBody } from '@/lib/api-parse';
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';
import { buildAgentReport } from '@/server/agent/reports';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const bodySchema = z.object({
  tenantId: z.string().uuid().optional().nullable(),
  report: z.enum(AGENT_REPORTS),
  params: z.object({
    from: z.string().trim().optional().nullable(),
    to: z.string().trim().optional().nullable(),
    dateFrom: z.string().trim().optional().nullable(),
    dateTo: z.string().trim().optional().nullable(),
    days: z.number().int().min(1).max(365).optional(),
    keyword: z.string().trim().min(1).max(255).optional().nullable(),
    keywords: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
    testId: z.string().trim().min(1).max(120).optional().nullable(),
    competitorNmId: z.number().int().positive().optional().nullable(),
    nmId: z.number().int().positive().optional().nullable(),
    nmIds: z.array(z.number().int().positive()).max(500).optional(),
    limit: z.number().int().min(1).max(5000).optional(),
    offset: z.number().int().min(0).max(100_000).optional(),
    skip: z.number().int().min(0).max(100_000).optional(),
    cursor: z.union([z.string().trim().min(1).max(32), z.number().int().min(0).max(100_000)]).optional().nullable(),
    page: z.number().int().min(1).max(10_000).optional(),
    afterId: z.string().trim().min(1).max(160).optional().nullable(),
    answerStatus: z.enum(['answered', 'not_answered', 'all']).optional(),
    tenantIds: z.array(z.string().uuid()).min(1).max(20).optional(),
    multiTenant: z.boolean().optional(),
    multi_tenant: z.boolean().optional(),
    includeZeroSales: z.boolean().optional(),
    includeInactive: z.boolean().optional(),
    groupBy: z.enum(['product']).optional(),
  }).optional(),
}).superRefine((payload, ctx) => {
  const tenantId = payload.tenantId ?? null;
  const tenantIds = payload.params?.tenantIds ?? [];
  const explicitMultiTenant = payload.params?.multiTenant === true || payload.params?.multi_tenant === true;
  const supportsTenantIds = payload.report === 'dashboard_summary'
    || payload.report === 'cost_snapshot'
    || payload.report === 'cost_breakdown_detail';
  const hasExplicitRange = Boolean(
    payload.params?.dateFrom?.trim()
    || payload.params?.dateTo?.trim()
    || payload.params?.from?.trim()
    || payload.params?.to?.trim(),
  );

  if (payload.report === 'cost_snapshot' || payload.report === 'cost_breakdown_detail') {
    if (!tenantId && tenantIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `tenantId or params.tenantIds is required for ${payload.report}`,
        path: ['tenantId'],
      });
    }

    if (tenantIds.length > 1 && !explicitMultiTenant) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'params.multi_tenant=true is required when requesting multiple tenantIds',
        path: ['params', 'multi_tenant'],
      });
    }

    if (payload.report === 'cost_breakdown_detail' && !hasExplicitRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'params.dateFrom and params.dateTo are required for cost_breakdown_detail',
        path: ['params', 'dateFrom'],
      });
    }

    return;
  }

  if (payload.report === 'dashboard_summary') {
    if (!tenantId && tenantIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tenantId or params.tenantIds is required for dashboard_summary',
        path: ['tenantId'],
      });
    }

    if (tenantIds.length > 1 && !explicitMultiTenant) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'params.multi_tenant=true is required when requesting multiple tenantIds',
        path: ['params', 'multi_tenant'],
      });
    }
  }

  if ((payload.report === 'sales_funnel_summary' || payload.report === 'advertising_by_nm_summary') && !hasExplicitRange) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `params.dateFrom and params.dateTo are required for ${payload.report}`,
      path: ['params', 'dateFrom'],
    });
  }

  if (!tenantId && tenantIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'tenantId is required',
      path: ['tenantId'],
    });
  }

  if (tenantIds.length > 0 && !supportsTenantIds) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'params.tenantIds is only supported for dashboard_summary, cost_snapshot and cost_breakdown_detail',
      path: ['params', 'tenantIds'],
    });
  }
});

export const POST = withRateLimit(apiRoute(async (request: Request) => {
  const client = requireAgentApiClient(request);
  const payload = await parseRequestBody(request, bodySchema);

  const requestedTenantIds = payload.report === 'dashboard_summary'
    || payload.report === 'cost_snapshot'
    || payload.report === 'cost_breakdown_detail'
    ? payload.params?.tenantIds?.length
      ? payload.params.tenantIds
      : payload.tenantId
        ? [payload.tenantId]
        : []
    : payload.tenantId
      ? [payload.tenantId]
      : [];

  assertAgentClientAccess(client, payload.report, requestedTenantIds);
  assertAgentWorkerReportAccess(client, payload.report);

  logger.info({
    clientId: client.id,
    tenantId: payload.tenantId,
    tenantIds: requestedTenantIds,
    report: payload.report,
  }, '[agent-api] report requested');

  const report = await buildAgentReport(payload);

  return NextResponse.json({
    ok: true,
    clientId: client.id,
    ...report,
  });
}), { per: 'ip', limit: 120, window: 60 });
