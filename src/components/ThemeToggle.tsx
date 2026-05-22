"use client"

import * as React from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { flushSync } from "react-dom"

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => {
    ready: Promise<void>
  }
}

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const buttonRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => setMounted(true), [])

  React.useEffect(() => {
    if (!menuOpen) return
    function onDocClick(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    function onEsc(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    document.addEventListener("keydown", onEsc)
    return () => {
      document.removeEventListener("mousedown", onDocClick)
      document.removeEventListener("keydown", onEsc)
    }
  }, [menuOpen])

  if (!mounted) {
    return <div className="h-8 w-8" aria-hidden />
  }

  const isDark = resolvedTheme === "dark"
  const switchTheme = (nextTheme: string) => {
    const doc = document as ViewTransitionDocument
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (!doc.startViewTransition || prefersReducedMotion) {
      setTheme(nextTheme)
      return
    }

    const rect = buttonRef.current?.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth - 40
    const y = rect ? rect.top + rect.height / 2 : 40
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    )

    const transition = doc.startViewTransition(() => {
      flushSync(() => setTheme(nextTheme))
    })

    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 520,
            easing: "cubic-bezier(0.22, 1, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        )
      })
      .catch(() => undefined)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => switchTheme(isDark ? "light" : "dark")}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuOpen((prev) => !prev)
        }}
        className="group relative inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-xs transition-[background-color,border-color,color,box-shadow] hover:border-border-strong hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
        title={`Тема: ${theme === "system" ? "системная" : isDark ? "тёмная" : "светлая"} · ПКМ — режим`}
      >
        <Sun
          className={`absolute h-4 w-4 transition-all duration-300 ease-out ${
            isDark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
          }`}
        />
        <Moon
          className={`absolute h-4 w-4 transition-all duration-300 ease-out ${
            isDark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"
          }`}
        />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setMenuOpen((prev) => !prev)
        }}
        className="absolute -bottom-0.5 -right-0.5 z-10 h-3.5 w-3.5 rounded-full border border-border bg-card text-[8px] leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Открыть меню темы"
      >
        ⌄
      </button>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-10 z-30 w-44 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg"
        >
          <MenuItem
            icon={<Sun className="h-4 w-4" />}
            label="Светлая"
            active={theme === "light"}
            onSelect={() => {
              switchTheme("light")
              setMenuOpen(false)
            }}
          />
          <MenuItem
            icon={<Moon className="h-4 w-4" />}
            label="Тёмная"
            active={theme === "dark"}
            onSelect={() => {
              switchTheme("dark")
              setMenuOpen(false)
            }}
          />
          <MenuItem
            icon={<Monitor className="h-4 w-4" />}
            label="Системная"
            active={theme === "system"}
            onSelect={() => {
              switchTheme("system")
              setMenuOpen(false)
            }}
          />
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({
  icon,
  label,
  active,
  onSelect,
}: {
  icon: React.ReactNode
  label: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <span className="flex h-5 w-5 items-center justify-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {active ? <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden /> : null}
    </button>
  )
}
