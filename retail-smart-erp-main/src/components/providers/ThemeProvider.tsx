'use client'

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'

export type Theme = 'light' | 'dark' | 'system'
export type ThemePalette = 'default' | 'midnight' | 'emerald' | 'charcoal' | 'amber' | 'violet' | 'crimson'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  palette: ThemePalette
  setPalette: (palette: ThemePalette) => void
  resolvedTheme: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeContextType | null>(null)

const STORAGE_KEY = 'theme'
const PALETTE_KEY = 'theme_palette'

function getInitialTheme(defaultTheme: Theme): Theme {
  if (typeof window === 'undefined') return defaultTheme
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null
    return stored && ['light', 'dark', 'system'].includes(stored) ? stored : defaultTheme
  } catch {
    return defaultTheme
  }
}

function getInitialPalette(defaultPalette: ThemePalette): ThemePalette {
  if (typeof window === 'undefined') return defaultPalette
  try {
    const stored = localStorage.getItem(PALETTE_KEY) as ThemePalette | null
    return stored && ['default', 'midnight', 'emerald', 'charcoal', 'amber', 'violet', 'crimson'].includes(stored) ? stored : defaultPalette
  } catch {
    return defaultPalette
  }
}

function applyTheme(theme: Theme, palette: ThemePalette, systemDark: boolean) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const resolvedMode = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  root.classList.remove('light', 'dark')
  root.classList.add(resolvedMode)
  root.setAttribute('data-theme', palette)
}

interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: Theme
  defaultPalette?: ThemePalette
}

export function ThemeProvider({ children, defaultTheme = 'system', defaultPalette = 'default' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme(defaultTheme))
  const [palette, setPaletteState] = useState<ThemePalette>(() => getInitialPalette(defaultPalette))
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  // Apply theme & palette whenever either changes
  useEffect(() => {
    applyTheme(theme, palette, systemDark)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
      localStorage.setItem(PALETTE_KEY, palette)
    } catch {
      // ignore
    }
  }, [theme, palette, systemDark])

  // Listen for system preference changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
  }, [])

  const setPalette = useCallback((newPalette: ThemePalette) => {
    setPaletteState(newPalette)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, palette, setPalette, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

