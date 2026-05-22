'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LockKeyhole, Receipt } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'

const MIN_PASSWORD_LENGTH = 8

type RecoveryState = 'checking' | 'ready' | 'invalid'

function getRecoveryTokensFromHash() {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash
  const params = new URLSearchParams(hash)

  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  const type = params.get('type')

  if (type !== 'recovery' || !accessToken || !refreshToken) {
    return null
  }

  return { accessToken, refreshToken }
}

function getRecoveryTokenHashFromQuery() {
  const params = new URLSearchParams(window.location.search)
  const tokenHash = params.get('token_hash')
  const type = params.get('type')

  if (type !== 'recovery' || !tokenHash) {
    return null
  }

  return tokenHash
}

function getRecoveryCodeFromQuery() {
  const params = new URLSearchParams(window.location.search)
  return params.get('code')
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const [recoveryState, setRecoveryState] = useState<RecoveryState>('checking')
  const [statusMessage, setStatusMessage] = useState<string>('Проверяем ссылку восстановления...')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let mounted = true
    const supabase = createClient()

    async function bootstrapRecoverySession() {
      try {
        const recoveryTokens = getRecoveryTokensFromHash()
        if (recoveryTokens) {
          const { error } = await supabase.auth.setSession({
            access_token: recoveryTokens.accessToken,
            refresh_token: recoveryTokens.refreshToken,
          })

          if (error) {
            throw error
          }

          window.history.replaceState({}, document.title, window.location.pathname)
          if (!mounted) return
          setRecoveryState('ready')
          setStatusMessage('')
          return
        }

        const tokenHash = getRecoveryTokenHashFromQuery()
        if (tokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            type: 'recovery',
            token_hash: tokenHash,
          })

          if (error) {
            throw error
          }

          window.history.replaceState({}, document.title, window.location.pathname)
          if (!mounted) return
          setRecoveryState('ready')
          setStatusMessage('')
          return
        }

        const recoveryCode = getRecoveryCodeFromQuery()
        if (recoveryCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(recoveryCode)

          if (error) {
            throw error
          }

          window.history.replaceState({}, document.title, window.location.pathname)
          if (!mounted) return
          setRecoveryState('ready')
          setStatusMessage('')
          return
        }

        const { data } = await supabase.auth.getSession()
        if (data.session) {
          if (!mounted) return
          setRecoveryState('ready')
          setStatusMessage('')
          return
        }

        if (!mounted) return
        setRecoveryState('invalid')
        setStatusMessage('Ссылка восстановления недействительна или истекла. Запросите новую ссылку.')
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : 'Не удалось обработать ссылку восстановления.'

        if (!mounted) return
        setRecoveryState('invalid')
        setStatusMessage(message)
      }
    }

    bootstrapRecoverySession()

    return () => {
      mounted = false
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (password.length < MIN_PASSWORD_LENGTH) {
      setStatusMessage(`Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов.`)
      return
    }

    if (password !== confirmPassword) {
      setStatusMessage('Пароли не совпадают.')
      return
    }

    try {
      setIsSubmitting(true)
      setStatusMessage('')
      const supabase = createClient()

      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        throw error
      }

      await supabase.auth.signOut()
      router.replace('/login?message=' + encodeURIComponent('Пароль обновлён. Войдите с новым паролем.'))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось обновить пароль.'
      setStatusMessage(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-slate-50 dark:bg-slate-900">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl bg-white dark:bg-slate-800 p-8 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border border-slate-200/60 dark:border-slate-700">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 bg-emerald-50 rounded-xl">
            <Receipt className="w-6 h-6 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Новый пароль</h1>
        </div>

        {recoveryState === 'checking' && (
          <p className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-center text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
            {statusMessage}
          </p>
        )}

        {recoveryState === 'invalid' && (
          <div className="flex w-full flex-col gap-3">
            <p className="w-full rounded-lg border border-rose-100 bg-rose-50 p-3 text-center text-sm text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300">
              {statusMessage}
            </p>
            <a
              href="/login?mode=forgot"
              className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-center text-slate-700 font-medium hover:bg-slate-100 transition-colors dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Запросить новую ссылку
            </a>
          </div>
        )}

        {recoveryState === 'ready' && (
          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
            <div className="flex flex-col gap-1.5 text-sm">
              <label className="font-medium text-slate-700" htmlFor="new-password">Новый пароль</label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="new-password"
                  name="new-password"
                  type="password"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 pl-10 focus:outline-emerald-500 focus:border-emerald-500 transition-colors"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Минимум 8 символов"
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 text-sm">
              <label className="font-medium text-slate-700" htmlFor="confirm-password">Подтвердите пароль</label>
              <input
                id="confirm-password"
                name="confirm-password"
                type="password"
                className="rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 px-4 py-3 focus:outline-emerald-500 focus:border-emerald-500 transition-colors"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Повторите новый пароль"
                required
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-emerald-600 px-4 py-3 text-white font-semibold shadow-sm hover:bg-emerald-700 hover:shadow transition-all disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Сохраняем...' : 'Сохранить новый пароль'}
            </button>

            {statusMessage && (
              <p className="mt-1 rounded-lg border border-rose-100 bg-rose-50 p-3 text-center text-sm text-rose-700 dark:border-rose-800/40 dark:bg-rose-900/20 dark:text-rose-300">
                {statusMessage}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  )
}
