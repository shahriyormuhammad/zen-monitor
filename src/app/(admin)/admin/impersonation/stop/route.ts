import { NextResponse, type NextRequest } from 'next/server';

import { getActivePlatformImpersonationSessionForUser } from '@/lib/auth/platform-impersonation-session';
import { endPlatformImpersonation } from '@/lib/auth/platform-impersonation-admin';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const session = user ? await getActivePlatformImpersonationSessionForUser(user.id) : null;
  const url = request.nextUrl.clone();
  url.pathname = session ? `/admin/customers/${session.tenantId}` : '/admin';
  url.search = '';
  return NextResponse.redirect(url);
}

export async function POST(request: NextRequest) {
  const session = await endPlatformImpersonation();
  const url = request.nextUrl.clone();
  url.pathname = session ? `/admin/customers/${session.tenantId}` : '/admin';
  url.search = '';
  return NextResponse.redirect(url);
}
