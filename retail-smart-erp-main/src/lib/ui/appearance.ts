/**
 * Shop appearance (Settings → Appearance): colour palette, UI style, sidebar mode, light / dark, and custom brand studio.
 * Saved per business in tenants.settings.appearance (the owner's choice for every screen and PC);
 * applied on <html> as data-theme / data-ui / data-sidebar (CSS: globals.css "APPEARANCE ENGINE").
 * A user can still change palette / mode on their own PC until the owner applies a new look.
 * Pure module.
 */
import { z } from 'zod'

export const THEME_PALETTES = [
  // Default baseline (Current standard look - 100% preserved)
  'default',
  // Featured 2025/2026 SaaS Themes
  'pastel-hr',
  'corporate-blue',
  'modern-dark',
  'emerald-analytics',
  'warm-amber',
  'minimal-neutral',
  'high-contrast',
  'custom-brand',
  // Legacy & specific palettes (fully backward compatible)
  'midnight',
  'emerald',
  'charcoal',
  'amber',
  'violet',
  'crimson',
  'teal',
  'rose',
  'ocean',
] as const

export type ThemePaletteId = (typeof THEME_PALETTES)[number]

export interface ThemeMeta {
  label: string
  description: string
  color: string
  secondary: string
  accent: string
  category: 'featured' | 'classic'
  badge?: string
}

export const PALETTE_INFO: Record<ThemePaletteId, ThemeMeta> = {
  // Baseline default
  default: {
    label: 'Classic Default',
    description: 'The familiar standard blue ERP look with clean slate borders and neutral cards.',
    color: '#0d6efd',
    secondary: '#6c757d',
    accent: '#0dcaf0',
    category: 'classic',
    badge: 'Default',
  },
  // Featured modern themes
  'pastel-hr': {
    label: 'Soft Pastel HR',
    description: 'Lavender primary with soft pastel cards, rounded elevation, and friendly humanized warmth (Smart HRMS style).',
    color: '#7c3aed',
    secondary: '#a78bfa',
    accent: '#ec4899',
    category: 'featured',
    badge: 'HRMS Style',
  },
  'corporate-blue': {
    label: 'Clean Corporate Blue',
    description: 'Modern enterprise trust blue with high-legibility slate cards and executive clarity.',
    color: '#2563eb',
    secondary: '#64748b',
    accent: '#0284c7',
    category: 'featured',
    badge: 'Corporate',
  },
  'modern-dark': {
    label: 'Modern Altura Dark',
    description: 'Deep midnight obsidian surfaces with glowing indigo-cyan accents and crisp neon highlights (Bento Analytics).',
    color: '#6366f1',
    secondary: '#38bdf8',
    accent: '#a855f7',
    category: 'featured',
    badge: 'True Dark',
  },
  'emerald-analytics': {
    label: 'Emerald Analytics',
    description: 'Botanical mint and forest green with soft pistachio cards, ideal for fresh retail, health, and growth.',
    color: '#059669',
    secondary: '#10b981',
    accent: '#14b8a6',
    category: 'featured',
    badge: 'Analytics',
  },
  'warm-amber': {
    label: 'Warm Amber / Sunset',
    description: 'Cozy terracotta and honey amber with soft cream surfaces for bakeries, bistros, and boutique retail.',
    color: '#ea580c',
    secondary: '#f59e0b',
    accent: '#d97706',
    category: 'featured',
    badge: 'Bistro',
  },
  'minimal-neutral': {
    label: 'Minimal Slate',
    description: 'Architectural monochrome gray and deep charcoal with ultra-clean borders and distraction-free focus.',
    color: '#334155',
    secondary: '#64748b',
    accent: '#0f172a',
    category: 'featured',
    badge: 'Minimal',
  },
  'high-contrast': {
    label: 'High-Contrast Pro',
    description: 'Pure black & white surfaces with vivid cyan accents. AAA accessibility certified for zero-glare work.',
    color: '#0284c7',
    secondary: '#000000',
    accent: '#38bdf8',
    category: 'featured',
    badge: 'OLED / AAA',
  },
  'custom-brand': {
    label: 'Custom Brand Studio',
    description: 'Custom company primary, secondary, and accent colors with custom font and border radius.',
    color: '#4f46e5',
    secondary: '#06b6d4',
    accent: '#f43f5e',
    category: 'featured',
    badge: 'Custom Studio',
  },
  // Legacy / classic presets
  midnight: { label: 'Midnight Navy', description: 'Deep ocean navy tones with vibrant royal blue accents.', color: '#2563eb', secondary: '#1e293b', accent: '#38bdf8', category: 'classic' },
  emerald: { label: 'Emerald Green', description: 'Classic green supermarket tones.', color: '#059669', secondary: '#047857', accent: '#34d399', category: 'classic' },
  charcoal: { label: 'Carbon OLED', description: 'Deep dark surfaces with cyan accents.', color: '#0284c7', secondary: '#111111', accent: '#38bdf8', category: 'classic' },
  amber: { label: 'Warm Amber', description: 'Golden amber tones for retail.', color: '#d97706', secondary: '#b45309', accent: '#fbbf24', category: 'classic' },
  violet: { label: 'Cyber Violet', description: 'Vibrant electric violet.', color: '#7c3aed', secondary: '#6d28d9', accent: '#c084fc', category: 'classic' },
  crimson: { label: 'Ruby Crimson', description: 'Bold ruby red accents.', color: '#dc2626', secondary: '#b91c1c', accent: '#f87171', category: 'classic' },
  teal: { label: 'Teal Lagoon', description: 'Cool refreshing teal palette.', color: '#0d9488', secondary: '#0f766e', accent: '#2dd4bf', category: 'classic' },
  rose: { label: 'Blush Rose', description: 'Soft pink and magenta accents.', color: '#db2777', secondary: '#be185d', accent: '#f472b6', category: 'classic' },
  ocean: { label: 'Ocean Depths', description: 'Deep water cyan and sapphire.', color: '#0369a1', secondary: '#075985', accent: '#38bdf8', category: 'classic' },
}

export const UI_STYLES = ['classic', 'modern', 'compact', 'touch', 'flat'] as const
export type UiStyle = (typeof UI_STYLES)[number]

export const UI_STYLE_INFO: Record<UiStyle, { label: string; description: string }> = {
  classic: { label: 'Classic', description: 'The standard look: clear cards, normal spacing.' },
  modern: { label: 'Modern Bento', description: 'Smooth rounded corners, soft pastel cards, airy spacing, and light icons.' },
  compact: { label: 'Compact Table', description: 'More on one screen: dense spacing and square corners for intense data entry.' },
  touch: { label: 'Big & Easy', description: 'Large touch targets, big buttons, and bold icons. Best for cashiers and tablets.' },
  flat: { label: 'Flat Outline', description: 'Clean and calm: no shadows or gradients, pure outlined cards.' },
}

export const SIDEBAR_MODES = ['hidden', 'icons', 'open'] as const
export type SidebarMode = (typeof SIDEBAR_MODES)[number]

export const SIDEBAR_MODE_INFO: Record<SidebarMode, { label: string; description: string }> = {
  hidden: { label: 'Hidden (Drawer)', description: 'Full width for work; open the menu with ☰ when you need it.' },
  icons: { label: 'Icons only (Rail)', description: 'A thin bar of page icons; hover to see the names.' },
  open: { label: 'Always open (Docked)', description: 'Icons and page names always visible side-by-side.' },
}

export const COLOR_MODES = ['light', 'dark', 'system'] as const
export type ColorMode = (typeof COLOR_MODES)[number]

export const customBrandConfigSchema = z.object({
  primaryColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default('#7c3aed'),
  secondaryColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
  accentColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
  borderRadius: z.enum(['none', 'sm', 'md', 'lg', 'xl']).default('md'),
  fontFamily: z.enum(['inter', 'plus-jakarta', 'outfit', 'system']).default('inter'),
  logoUrl: z.string().optional(),
})

export type CustomBrandConfig = z.infer<typeof customBrandConfigSchema>

export const appearanceSchema = z.object({
  palette: z.enum(THEME_PALETTES),
  uiStyle: z.enum(UI_STYLES),
  sidebar: z.enum(SIDEBAR_MODES),
  /** null = each user keeps their own light / dark choice */
  mode: z.enum(COLOR_MODES).nullable(),
  customBrand: customBrandConfigSchema.optional(),
})

export type Appearance = z.infer<typeof appearanceSchema>
export interface StoredAppearance extends Appearance {
  updatedAt: string | null
}

export const DEFAULT_APPEARANCE: StoredAppearance = {
  palette: 'default',
  uiStyle: 'classic',
  sidebar: 'hidden',
  mode: null,
  customBrand: undefined,
  updatedAt: null,
}

/** Lenient read of the stored JSON (unknown values fall back to the defaults). */
export function sanitizeAppearance(raw: unknown): StoredAppearance {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const pick = <T extends string>(list: readonly T[], v: unknown, d: T): T => (list.includes(v as T) ? (v as T) : d)

  let customBrand: CustomBrandConfig | undefined = undefined
  if (r.customBrand && typeof r.customBrand === 'object') {
    const parsed = customBrandConfigSchema.safeParse(r.customBrand)
    if (parsed.success) {
      customBrand = parsed.data
    }
  }

  return {
    palette: pick(THEME_PALETTES, r.palette, DEFAULT_APPEARANCE.palette),
    uiStyle: pick(UI_STYLES, r.uiStyle, DEFAULT_APPEARANCE.uiStyle),
    sidebar: pick(SIDEBAR_MODES, r.sidebar, DEFAULT_APPEARANCE.sidebar),
    mode: COLOR_MODES.includes(r.mode as ColorMode) ? (r.mode as ColorMode) : null,
    customBrand,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
  }
}
