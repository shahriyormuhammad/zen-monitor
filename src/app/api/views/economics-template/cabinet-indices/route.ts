import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

import { apiRoute } from '@/lib/api-response';
import { AppError, requireActiveTenant } from '@/lib/auth/tenant-access';
import {
  getMoscowWeekStartDate,
  saveCabinetIndices,
  type CabinetEconomicsIndices,
} from '@/server/economics/cabinet-indices';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parsePositiveNumber(value: unknown, field: string): number {
  const normalized = typeof value === 'string' ? value.replace(',', '.') : value;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(`${field} должен быть положительным числом`, 400);
  }
  return parsed;
}

function parseNonNegativeNumber(value: unknown, field: string): number {
  const normalized = typeof value === 'string' ? value.replace(',', '.') : value;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new AppError(`${field} должен быть числом не меньше 0`, 400);
  }
  return parsed;
}

export const POST = apiRoute(async (request: Request) => {
  const { tenantId } = await requireActiveTenant(request, ['owner', 'admin', 'manager']);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new AppError('Некорректный запрос на ручные ИЛ/ИРП', 400);
  }

  const payload = body as { localityIndex?: unknown; irpPercent?: unknown };
  const indices: CabinetEconomicsIndices = {
    localityIndex: Math.round(parsePositiveNumber(payload.localityIndex, 'ИЛ') * 10_000) / 10_000,
    irpPercent: Math.round(parseNonNegativeNumber(payload.irpPercent, 'ИРП') * 10_000) / 10_000,
    source: 'manual',
    effectiveWeek: getMoscowWeekStartDate(),
    fetchedAt: new Date().toISOString(),
  };

  await saveCabinetIndices(tenantId, indices);

  revalidatePath('/economics-v2');
  revalidatePath('/economics');
  revalidatePath('/costs');

  return NextResponse.json({ success: true, cabinetIndices: indices });
});
