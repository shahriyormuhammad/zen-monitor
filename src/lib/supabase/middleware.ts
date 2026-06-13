import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  const supabaseUrl = process.env.SUPABASE_URL_INTERNAL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY_INTERNAL ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are not configured.')
  }

  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const publicRoutes = new Set([
    '/',
    '/lab',
    '/pricing',
    '/results',
    '/contact',
    '/about',
    '/blog',
    '/signals-wildberries',
    '/unit-economics-wildberries',
    '/reklama-wildberries',
    '/stocks-wildberries',
    '/seo-wildberries',
    '/reviews-wildberries',
    '/seo-otzyvy-wildberries',
  ])
  const isPublicRoute =
    publicRoutes.has(pathname)

  const isResetPasswordRoute = request.nextUrl.pathname.startsWith('/reset-password')
  const isAuthRoute =
    pathname.startsWith('/login')
    || pathname.startsWith('/signup')
    || pathname.startsWith('/auth')
    || isResetPasswordRoute

  if (!user && !isAuthRoute && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isAuthRoute && !isResetPasswordRoute) {
     const url = request.nextUrl.clone()
     url.pathname = request.cookies.get('active_tenant_id')?.value ? '/overview' : '/onboarding'
     return NextResponse.redirect(url)
  }

  return supabaseResponse
}
