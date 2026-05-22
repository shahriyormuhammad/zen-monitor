'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { deleteAdminCustomerAccount } from '@/server/admin/backoffice';
import { getErrorMessage } from '@/lib/errors';

function redirectToCustomers(messageType: 'success' | 'error', message: string): never {
  const params = new URLSearchParams({
    messageType,
    message,
  });
  redirect(`/admin/customers?${params.toString()}`);
}

export async function deleteCustomerAccountAction(formData: FormData) {
  const tenantId = formData.get('tenantId')?.toString() ?? '';
  let successMessage = '';

  try {
    const result = await deleteAdminCustomerAccount({
      tenantId,
      confirmation: formData.get('confirmation')?.toString() ?? '',
    });

    const suffix = result.authDeleteErrors.length > 0
      ? ` Данные удалены, но Auth cleanup требует проверки: ${result.authDeleteErrors.length}.`
      : '';
    successMessage = `Аккаунт ${result.tenantName} удалён.${suffix}`;
  } catch (error) {
    redirectToCustomers('error', getErrorMessage(error));
  }

  revalidatePath('/admin');
  revalidatePath('/admin/customers');
  revalidatePath('/admin/leads');
  revalidatePath('/admin/subscriptions');
  revalidatePath('/admin/ops/storage');
  redirectToCustomers('success', successMessage);
}
