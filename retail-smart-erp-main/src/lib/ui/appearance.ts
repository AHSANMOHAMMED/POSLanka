/**
 * Shop appearance (Settings → Appearance): colour palette, UI style, sidebar mode and light / dark.
 * Saved per business in tenants.settings.appearance (the owner's choice for every screen and PC);
 * applied on <html> as data-theme / data-ui / data-sidebar (CSS: globals.css "APPEARANCE ENGINE").
 * A user can still change palette / mode on their own PC until the owner applies a new look.
 * Pure module.
 */
import { z } from 'zod'

export const THEME_PALETTES = ['default', 'midnight', 'emerald', 'charcoal', 'amber', 'violet', 'crimson', 'teal', 'rose', 'ocean'] as const
export type ThemePaletteId = (typeof THEME_PALETTES)[number]

export const PALETTE_INFO: Record<ThemePaletteId, { label: string; color: string }> = {
  default: { label: 'Classic Blue', color: '#0d6efd' },
  midnight: { label: 'Midnight Navy', color: '#2563eb' },
  emerald: { label: 'Emerald Green', color: '#059669' },
  charcoal: { label: 'Carbon', color: '#0284c7' },
  amber: { label: 'Warm Amber', color: '#d97706' },
  violet: { label: 'Cyber Violet', color: '#7c3aed' },
  crimson: { label: 'Ruby Crimson', color: '#dc2626' },
  teal: { label: 'Teal', color: '#0d9488' },
  rose: { label: 'Rose', color: '#db2777' },
  ocean: { label: 'Ocean', color: '#0369a1' },
}

export const UI_STYLES = ['classic', 'modern', 'compact', 'touch', 'flat'] as const
export type UiStyle = (typeof UI_STYLES)[number]

export const UI_STYLE_INFO: Record<UiStyle, { label: string; description: string }> = {
  classic: { label: 'Classic', description: 'The standard look: clear cards, normal spacing.' },
  modern: { label: 'Modern', description: 'Big rounded corners, soft shadows, airy spacing, light icons.' },
  compact: { label: 'Compact', description: 'More on one screen: tight spacing and small corners for back-office work.' },
  touch: { label: 'Big & Easy', description: 'Large text, big buttons and bold icons. Best for cashiers, touch screens and new staff.' },
  flat: { label: 'Flat', description: 'Clean and calm: no shadows or gradients, outlined cards.' },
}

export const SIDEBAR_MODES = ['hidden', 'icons', 'open'] as const
export type SidebarMode = (typeof SIDEBAR_MODES)[number]

export const SIDEBAR_MODE_INFO: Record<SidebarMode, { label: string; description: string }> = {
  hidden: { label: 'Hidden', description: 'Full width for work; open the menu with ☰ when you need it.' },
  icons: { label: 'Icons only', description: 'A thin bar of page icons; hover to see the names.' },
  open: { label: 'Always open', description: 'Icons and page names always visible.' },
}

export const COLOR_MODES = ['light', 'dark', 'system'] as const
export type ColorMode = (typeof COLOR_MODES)[number]

export const appearanceSchema = z.object({
  palette: z.enum(THEME_PALETTES),
  uiStyle: z.enum(UI_STYLES),
  sidebar: z.enum(SIDEBAR_MODES),
  /** null = each user keeps their own light / dark choice */
  mode: z.enum(COLOR_MODES).nullable(),
})
export type Appearance = z.infer<typeof appearanceSchema>
export interface StoredAppearance extends Appearance { updatedAt: string | null }

export const DEFAULT_APPEARANCE: StoredAppearance = { palette: 'default', uiStyle: 'classic', sidebar: 'hidden', mode: null, updatedAt: null }

/** Lenient read of the stored JSON (unknown values fall back to the defaults). */
export function sanitizeAppearance(raw: unknown): StoredAppearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list.includes(v as T) ? (v as T) : d)
  return {
    palette: pick(THEME_PALETTES, r.palette, DEFAULT_APPEARANCE.palette),
    uiStyle: pick(UI_STYLES, r.uiStyle, DEFAULT_APPEARANCE.uiStyle),
    sidebar: pick(SIDEBAR_MODES, r.sidebar, DEFAULT_APPEARANCE.sidebar),
    mode: COLOR_MODES.includes(r.mode as ColorMode) ? (r.mode as ColorMode) : null,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
  }
}
