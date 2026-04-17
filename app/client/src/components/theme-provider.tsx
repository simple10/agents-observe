import { createContext, useContext, useEffect, useState } from 'react'

type ThemeMode = 'light' | 'dark' | 'system'

const ThemeContext = createContext<{
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  // Resolved theme for components that need to know the actual value
  resolved: 'light' | 'dark'
}>({ mode: 'dark', setMode: () => {}, resolved: 'dark' })

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem('app-theme')
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
    return 'dark'
  })

  const resolved = mode === 'system' ? getSystemTheme() : mode

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    localStorage.setItem('app-theme', mode)
  }, [mode, resolved])

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      document.documentElement.classList.toggle('dark', mq.matches)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [mode])

  const setMode = (m: ThemeMode) => setModeState(m)

  // Backwards compat: expose toggleTheme for sidebar button
  const toggleTheme = () => setModeState((t) => (t === 'dark' || t === 'system' ? 'light' : 'dark'))

  return (
    <ThemeContext.Provider value={{ mode, setMode, resolved }}>{children}</ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  // Backwards compat: expose theme and toggleTheme
  return {
    theme: ctx.resolved,
    mode: ctx.mode,
    setMode: ctx.setMode,
    toggleTheme: () => ctx.setMode(ctx.resolved === 'dark' ? 'light' : 'dark'),
  }
}
