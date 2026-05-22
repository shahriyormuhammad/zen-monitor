'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { syncActiveTenantForUser } from '@/lib/auth/user-bootstrap'
import { clearActiveTenantCookie, setActiveTenantCookie } from '@/lib/auth/tenant-access'
import { recordSignupLead } from '@/lib/leads'

const loginSchema = z.object({
  email: z.email('Введите корректный email'),
  password: z.string().min(8, 'Пароль должен быть не менее 8 символов'),
})

const signupSchema = loginSchema.extend({
  name: z.string().trim().min(2, 'Введите имя'),
  phone: z.string().trim().min(5, 'Введите телефон'),
  confirmPassword: z.string().min(8, 'Подтверждение пароля должно быть не менее 8 символов'),
  termsAccepted: z.literal('on', {
    error: 'Нужно принять условия обработки данных',
  }),
}).refine((value) => value.password === value.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Пароли не совпадают',
})

const forgotSchema = z.object({
  email: z.email('Введите корректный email'),
})

const signupAttributionFields = [
  'source',
  'ref',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

function readFormText(formData: FormData, key: string) {
  const value = formData.get(key);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 180) : null;
}

function readSignupAttribution(formData: FormData) {
  const attribution: Record<string, string> = {};

  for (const field of signupAttributionFields) {
    const value = readFormText(formData, field);
    if (value) attribution[field] = value;
  }

  if (!attribution.source) {
    attribution.source = 'сайт';
  }

  return attribution;
}

// Whitelist of hosts allowed to appear in password reset redirect links.
// Source: ALLOWED_HOSTS (comma-separated) + APP_BASE_URL. Anything else → APP_BASE_URL.
function parseAllowedHosts(): string[] {
  const fromEnv = (process.env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  try {
    if (process.env.APP_BASE_URL) {
      fromEnv.push(new URL(process.env.APP_BASE_URL).host.toLowerCase())
    }
  } catch {
    // ignore malformed APP_BASE_URL
  }
  // Always trust loopback for local dev.
  fromEnv.push('localhost', '127.0.0.1')
  return Array.from(new Set(fromEnv))
}

function isAllowedHost(host: string, allowed: string[]): boolean {
  const lower = host.toLowerCase().split(':')[0] ?? ''
  return allowed.some((a) => {
    const aHost = a.split(':')[0] ?? ''
    return aHost === lower
  })
}

async function resolvePublicBaseUrl() {
  const headerStore = await headers()
  const forwardedProto = headerStore.get('x-forwarded-proto')
  const forwardedHost = headerStore.get('x-forwarded-host')
  const host = forwardedHost ?? headerStore.get('host')

  const allowed = parseAllowedHosts()

  if (host && isAllowedHost(host, allowed)) {
    const isLocalHost = host.startsWith('localhost') || host.startsWith('127.0.0.1')
    const protocol = forwardedProto ?? (isLocalHost ? 'http' : 'https')
    return `${protocol}://${host}`.replace(/\/$/, '')
  }

  if (process.env.APP_BASE_URL) {
    return process.env.APP_BASE_URL.replace(/\/$/, '')
  }

  return 'http://localhost:3000'
}

function isExistingUserSignupError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { code?: unknown; status?: unknown; message?: unknown }
  const code = typeof maybeError.code === 'string' ? maybeError.code : ''
  const message = typeof maybeError.message === 'string' ? maybeError.message : ''
  return code === 'user_already_exists'
    || (maybeError.status === 422 && /already registered|already exists/i.test(message))
}

export async function login(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: readFormText(formData, 'email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? 'Неверные данные'
    redirect('/login?messageType=error&message=' + encodeURIComponent(firstError))
  }

  const supabase = await createClient()
  const { data: authData, error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    redirect('/login?messageType=error&message=' + encodeURIComponent('Неверный email или пароль'))
  }

  const bootstrapState = authData.user
    ? await syncActiveTenantForUser(authData.user.id, authData.user.email ?? null)
    : null

  if (bootstrapState?.tenantId) {
    await setActiveTenantCookie(bootstrapState.tenantId)
  } else {
    await clearActiveTenantCookie()
  }

  revalidatePath('/', 'layout')
  redirect(bootstrapState?.tenantId ? '/overview' : '/onboarding')
}

export async function signup(formData: FormData) {
  const parsed = signupSchema.safeParse({
    name: readFormText(formData, 'name'),
    email: readFormText(formData, 'email'),
    phone: readFormText(formData, 'phone'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
    termsAccepted: formData.get('termsAccepted'),
  })

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? 'Неверные данные'
    redirect('/signup?messageType=error&message=' + encodeURIComponent(firstError))
  }

  const supabase = await createClient()
  const attribution = readSignupAttribution(formData)
  const { data: authData, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.name,
        phone: parsed.data.phone,
        signup_source: attribution.source,
        signup_attribution: attribution,
      },
    },
  })

  if (error) {
    if (isExistingUserSignupError(error)) {
      redirect('/login?messageType=error&message=' + encodeURIComponent('Аккаунт с такой почтой уже есть. Войдите или восстановите пароль.'))
    }

    redirect('/signup?messageType=error&message=' + encodeURIComponent('Не удалось создать аккаунт. Проверьте данные и попробуйте снова.'))
  }

  const bootstrapState = authData.user
    ? await syncActiveTenantForUser(authData.user.id, authData.user.email ?? null)
    : null

  await recordSignupLead({
    email: authData.user?.email ?? parsed.data.email,
    name: parsed.data.name,
    phone: parsed.data.phone,
    userId: authData.user?.id ?? null,
    source: attribution.source,
    attribution,
  })

  if (!authData.session || !authData.user) {
    redirect('/login?messageType=success&message=' + encodeURIComponent('Аккаунт создан. Войдите в кабинет, чтобы продолжить настройку.'))
  }

  if (bootstrapState?.tenantId) {
    await setActiveTenantCookie(bootstrapState.tenantId)
  } else {
    await clearActiveTenantCookie()
  }

  revalidatePath('/', 'layout')
  redirect('/onboarding')
}

export async function requestPasswordReset(formData: FormData) {
  const parsed = forgotSchema.safeParse({
    email: (formData.get('email') as string | null)?.trim(),
  })

  if (!parsed.success) {
    redirect('/login?mode=forgot&messageType=error&message=' + encodeURIComponent('Укажите корректный email для восстановления пароля.'))
  }

  const supabase = await createClient()
  const baseUrl = await resolvePublicBaseUrl()
  const redirectTo = `${baseUrl}/reset-password`

  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo })

  // Always show success — do not reveal whether the email exists
  redirect('/login?mode=forgot&messageType=success&message=' + encodeURIComponent('Если аккаунт с таким email существует, ссылка для восстановления отправлена. Проверьте почту.'))
}
