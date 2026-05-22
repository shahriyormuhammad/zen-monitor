'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { deleteAdminLeadRegistration } from '@/server/admin/backoffice';
import { getErrorMessage } from '@/lib/errors';

function redirectToLeads(messageType: 'success' | 'error', message: string): never {
  const params = new URLSearchParams({
    messageType,
    message,
  });
  redirect(`/admin/leads?${params.toString()}`);
}

export async function deleteLeadRegistrationAction(formData: FormData) {
  let deletedEmail = '';

  try {
    const deleted = await deleteAdminLeadRegistration({
      id: formData.get('id')?.toString() ?? null,
      userId: formData.get('userId')?.toString() ?? null,
      email: formData.get('email')?.toString() ?? null,
    });
    deletedEmail = deleted.email;
  } catch (error) {
    redirectToLeads('error', getErrorMessage(error));
  }

  revalidatePath('/admin');
  revalidatePath('/admin/leads');
  redirectToLeads('success', `Регистрация ${deletedEmail} удалена.`);
}
