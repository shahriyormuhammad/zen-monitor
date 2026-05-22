'use server';

import { redirect } from 'next/navigation';

import {
  beginPlatformImpersonation,
  endPlatformImpersonation,
  normalizeImpersonationNote,
  normalizeImpersonationReason,
} from '@/lib/auth/platform-impersonation-admin';

export async function startPlatformImpersonation(
  tenantId: string,
  reasonOrFormData: string | FormData,
  note?: string | null,
) {
  const reason = reasonOrFormData instanceof FormData
    ? normalizeImpersonationReason(reasonOrFormData.get('reason'))
    : normalizeImpersonationReason(reasonOrFormData);
  const normalizedNote = reasonOrFormData instanceof FormData
    ? normalizeImpersonationNote(reasonOrFormData.get('note'))
    : normalizeImpersonationNote(note);

  await beginPlatformImpersonation({
    tenantId,
    reason,
    note: normalizedNote,
  });

  redirect('/overview');
}

export async function stopPlatformImpersonation() {
  const session = await endPlatformImpersonation();
  redirect(session ? `/admin/customers/${session.tenantId}` : '/admin');
}
