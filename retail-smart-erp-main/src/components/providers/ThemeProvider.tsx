'use client'

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import {
  DEFAULT_APPEARANCE,
  SIDEBAR_MODES,
  THEME_PALETTES,
  UI_STYLES,
  type SidebarMode,
  type StoredAppearance,
  type ThemePaletteId,
  type UiStyle,
} from '@/lib/ui/appearance'

export type Theme = 'light' | 'dark' | 'system'
export type ThemePalette = ThemePaletteId

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  palette: ThemePalette
  setPalette: (palette: ThemePalette) => void
  uiStyle: UiStyle
  setUiStyle: (style: UiStyle) => void
  sidebarMode: SidebarMode
  setSidebarMode: (mode: SidebarMode) => void
  resolvedTheme: 'light' | 'dark'
  /** Apply the business's saved look when it is newer than what this PC last applied. */
  syncShopAppearance: (a: StoredAppearance, opts?: { force?: boolean }) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

const STORAGE_KEY = 'theme'
const PALETTE_KEY = 'theme_palette'
const UI_KEY = 'ui_style'
const SIDEBAR_KEY = 'ui_sidebar'
/** updatedAt of the shop look this PC applied last (a newer one from the owner replaces local picks) */
const SHOP_APPLIED_KEY = 'ui_shop_applied_at'

function read<T extends string>(key: string, list: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const v = localStorage.getItem(key) as T | null
    return v && list.includes(v) ? v : fallback
  } catch {
    return fallback
  }
}

function applyTheme(theme: Theme, palette: ThemePalette, uiStyle: UiStyle, sidebar: SidebarMode, systemDark: boolean) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const resolvedMode = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  root.classList.remove('light', 'dark')
  root.classList.add(resolvedMode)
  root.setAttribute('data-theme', palette)
  root.setAttribute('data-ui', uiStyle)
  root.setAttribute('data-sidebar', sidebar)
}

interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: Theme
  defaultPalette?: ThemePalette
}

export function ThemeProvider({ children, defaultTheme = 'system', defaultPalette = 'default' }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => read(STORAGE_KEY, ['light', 'dark', 'system'] as const, defaultTheme))
  const [palette, setPaletteState] = useState<ThemePalette>(() => read(PALETTE_KEY, THEME_PALETTES, defaultPalette))
  const [uiStyle, setUiStyleState] = useState<UiStyle>(() => read(UI_KEY, UI_STYLES, DEFAULT_APPEARANCE.uiStyle))
  const [sidebarMode, setSidebarModeState] = useState<SidebarMode>(() => read(SIDEBAR_KEY, SIDEBAR_MODES, DEFAULT_APPEARANCE.sidebar))
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    applyTheme(theme, palette, uiStyle, sidebarMode, systemDark)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
      localStorage.setItem(PALETTE_KEY, palette)
      localStorage.setItem(UI_KEY, uiStyle)
      localStorage.setItem(SIDEBAR_KEY, sidebarMode)
    } catch {
      // ignore
    }
  }, [theme, palette, uiStyle, sidebarMode, systemDark])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const setTheme = useCallback((t: Theme) => setThemeState(t), [])
  const setPalette = useCallback((p: ThemePalette) => setPaletteState(p), [])
  const setUiStyle = useCallback((s: UiStyle) => setUiStyleState(s), [])
  const setSidebarMode = useCallback((m: SidebarMode) => setSidebarModeState(m), [])

  const syncShopAppearance = useCallback((a: StoredAppearance, opts: { force?: boolean } = {}) => {
    let applied: string | null = null
    try {
      applied = localStorage.getItem(SHOP_APPLIED_KEY)
    } catch {
      /* ignore */
    }
    if (!opts.force && (!a.updatedAt || (applied && applied >= a.updatedAt))) return
    setPaletteState(a.palette)
    setUiStyleState(a.uiStyle)
    setSidebarModeState(a.sidebar)
    if (a.mode) setThemeState(a.mode)
    try {
      if (a.updatedAt) localStorage.setItem(SHOP_APPLIED_KEY, a.updatedAt)
    } catch {
      /* ignore */
    }
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, palette, setPalette, uiStyle, setUiStyle, sidebarMode, setSidebarMode, resolvedTheme, syncShopAppearance }}>
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
