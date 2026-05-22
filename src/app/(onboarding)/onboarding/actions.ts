'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';

import { addCabinet } from '@/app/(dashboard)/settings/actions';
import { requireAuthenticatedUser } from '@/lib/auth/tenant-access';
import { markLeadSelectedPlan } from '@/lib/leads';

const onboardingSchema = z.object({
  planCode: z.string().trim().min(1, 'Выберите пакет'),
  shopName: z.string().trim().min(2, 'Введите название магазина'),
  wbToken: z.string().trim().min(10, 'Вставьте WB API-ключ'),
});

function redirectWithMessage(message: string, planCode?: string): never {
  const params = new URLSearchParams({
    messageType: 'error',
    message,
  });

  if (planCode) {
    params.set('planCode', planCode);
  }

  redirect(`/onboarding?${params.toString()}`);
}

export async function completeOnboarding(formData: FormData) {
  const parsed = onboardingSchema.safeParse({
    planCode: formData.get('planCode'),
    shopName: formData.get('shopName'),
    wbToken: formData.get('wbToken'),
  });

  if (!parsed.success) {
    redirectWithMessage(parsed.error.issues[0]?.message ?? 'Проверьте данные');
  }
  if (!parsed.data) {
    redirectWithMessage('Проверьте данные');
  }

  const { planCode, shopName, wbToken } = parsed.data;

  try {
    const result = await addCabinet(shopName, wbToken, false, planCode);

    if (!result.created) {
      redirectWithMessage(result.message || 'Не удалось подключить кабинет. Проверьте WB-ключ.', planCode);
    }

    redirect('/onboarding?connected=1&sync=started');
  } catch (error) {
    redirectWithMessage(error instanceof Error ? error.message : 'Не удалось завершить настройку.', planCode);
  }
}

export async function selectOnboardingPlan(planCode: string) {
  const parsed = z.string().trim().min(1).max(50).safeParse(planCode);
  if (!parsed.success) {
    return { ok: false };
  }

  const user = await requireAuthenticatedUser();
  await markLeadSelectedPlan(user.email, parsed.data);

  return { ok: true };
}
