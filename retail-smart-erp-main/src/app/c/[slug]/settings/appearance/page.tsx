'use client'

/**
 * Settings → Appearance (Theme Marketplace & Studio):
 * Pick a curated 2025/2026 SaaS theme or customize brand colors, UI style, sidebar mode and light / dark,
 * see the whole app in a live preview, try it instantly, and apply it for the entire business.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import {
  Check,
  Eye,
  Loader2,
  Menu,
  Moon,
  Monitor,
  Palette,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Save,
  Sun,
  Users,
  LayoutDashboard,
  ShoppingCart,
  Package,
  Receipt,
  BarChart3,
  Settings,
  TrendingUp,
  Wallet,
  Banknote,
  CreditCard,
  Search,
  Sparkles,
  Sliders,
  Layout,
  Layers,
  ArrowUpRight,
} from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { useTheme } from '@/components/providers/ThemeProvider'
import { hasPermission } from '@/lib/auth/roles'
import {
  PALETTE_INFO,
  SIDEBAR_MODE_INFO,
  THEME_PALETTES,
  UI_STYLES,
  UI_STYLE_INFO,
  SIDEBAR_MODES,
  type Appearance,
  type ColorMode,
  type CustomBrandConfig,
  type StoredAppearance,
} from '@/lib/ui/appearance'

const MODE_OPTIONS: Array<{ value: ColorMode | null; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto (System)', icon: Monitor },
  { value: null, label: 'Each user chooses', icon: Users },
]

const FONT_OPTIONS: Array<{ value: NonNullable<CustomBrandConfig['fontFamily']>; label: string }> = [
  { value: 'inter', label: 'Inter (Clean & Professional)' },
  { value: 'plus-jakarta', label: 'Plus Jakarta Sans (Modern SaaS)' },
  { value: 'outfit', label: 'Outfit (Friendly & Airy)' },
  { value: 'system', label: 'System Default' },
]

const RADIUS_OPTIONS: Array<{ value: NonNullable<CustomBrandConfig['borderRadius']>; label: string; desc: string }> = [
  { value: 'none', label: 'Sharp', desc: '0px — strict industrial' },
  { value: 'sm', label: 'Subtle', desc: '6px — compact classic' },
  { value: 'md', label: 'Modern', desc: '12px — balanced standard' },
  { value: 'lg', label: 'Curved', desc: '16px — soft pastel HR' },
  { value: 'xl', label: 'Airy', desc: '20px — spacious bento' },
]

/** Interactive live representation of the ERP interface in the selected theme */
function UiPreview({
  look,
  dark,
  size = 'large',
}: {
  look: Appearance
  dark: boolean
  size?: 'large' | 'thumb'
}) {
  const thumb = size === 'thumb'
  const nav = [
    { icon: LayoutDashboard, label: 'Dashboard', active: true },
    { icon: ShoppingCart, label: 'Point of Sale' },
    { icon: Package, label: 'Items & Stock' },
    { icon: Receipt, label: 'Sales Invoices' },
    { icon: BarChart3, label: 'Reports' },
    { icon: Settings, label: 'Settings' },
  ]
  const bars = [40, 65, 52, 80, 70, 95, 60]

  return (
    <div
      data-ui={look.uiStyle}
      data-theme={look.palette}
      className={`${dark ? 'dark' : ''} overflow-hidden border border-slate-200 dark:border-slate-800 rounded-2xl select-none shadow-md transition-colors`}
      style={{
        background: 'var(--page-bg)',
        fontSize: thumb ? '7px' : 'calc(13px * var(--ui-style-scale, 1))',
        pointerEvents: thumb ? 'none' : undefined,
      }}
      aria-hidden={thumb}
    >
      {/* Top bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-black/10 dark:border-white/10"
        style={{ background: 'var(--navbar-bg)', color: '#fff' }}
      >
        {look.sidebar === 'hidden' && <Menu size={thumb ? 8 : 16} />}
        <span className="font-extrabold tracking-tight" style={{ fontSize: '1.15em' }}>
          skyERPOS
        </span>
        <span className="ml-auto opacity-80 text-xs">Alisha Store · POS #1</span>
      </div>

      <div className="flex" style={{ minHeight: thumb ? 120 : 420 }}>
        {/* Sidebar */}
        {look.sidebar !== 'hidden' && (
          <div
            className="shrink-0 py-3 space-y-1"
            style={{
              width: look.sidebar === 'icons' ? (thumb ? 18 : 52) : thumb ? 70 : 180,
              background: 'var(--sidebar-bg)',
              borderRight: '1px solid var(--sidebar-border)',
            }}
          >
            {nav.map((n) => (
              <div
                key={n.label}
                className="flex items-center gap-2.5 mx-2 px-2.5 py-1.5 rounded-xl transition-all"
                style={
                  n.active
                    ? {
                        background: 'var(--sidebar-active-bg)',
                        color: 'var(--sidebar-text-active)',
                        fontWeight: 700,
                      }
                    : { color: 'var(--sidebar-text, #495057)' }
                }
              >
                <n.icon size={thumb ? 8 : 16} />
                {look.sidebar === 'open' && <span className="truncate">{n.label}</span>}
              </div>
            ))}
          </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 min-w-0 p-4 space-y-4" style={{ color: 'var(--text-primary)' }}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-black tracking-tight" style={{ fontSize: '1.35em' }}>
                Executive Overview
              </div>
              <p className="text-xs opacity-70">Live metrics &amp; store activity</p>
            </div>
            {!thumb && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 border rounded-xl bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-xs text-slate-500 shadow-sm">
                <Search size={13} /> Quick Search (⌘K)…
              </div>
            )}
          </div>

          {/* Metric KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[
              { label: "Today's Revenue", value: 'Rs 84,500', trend: '+14.2%', icon: TrendingUp },
              { label: 'Completed Bills', value: '126', trend: '+8.0%', icon: Receipt },
              { label: 'Low Stock Alerts', value: '7', trend: 'action', icon: Package },
              { label: 'Receivable Due', value: 'Rs 12,300', trend: '-2.1%', icon: Wallet },
            ].map((c) => (
              <div
                key={c.label}
                className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">
                    {c.label}
                  </span>
                  <div className="w-6 h-6 rounded-lg theme-icon-container flex items-center justify-center shrink-0">
                    <c.icon size={thumb ? 8 : 13} />
                  </div>
                </div>
                <div className="font-extrabold truncate" style={{ fontSize: '1.25em' }}>
                  {c.value}
                </div>
                <div className="flex items-center gap-1 text-[10px] font-semibold">
                  <span className="px-1.5 py-0.2 rounded-full theme-kpi-up inline-flex items-center gap-0.5">
                    <ArrowUpRight size={10} /> {c.trend}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Chart Area */}
            <div
              className="lg:col-span-2 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm p-4 space-y-3"
              style={{ background: 'var(--content-bg)' }}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm">Revenue Flow (Last 7 Days)</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full theme-badge-primary">
                  Weekly
                </span>
              </div>
              <div className="flex items-end gap-2 pt-2" style={{ height: thumb ? 35 : 120 }}>
                {bars.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-lg transition-all"
                    style={{
                      height: `${h}%`,
                      background: `linear-gradient(to top, var(--primary), color-mix(in srgb, var(--primary) 65%, white))`,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Cashier Payment Card */}
            {!thumb && (
              <div
                className="rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col justify-between"
                style={{ background: 'var(--content-bg)' }}
              >
                <div
                  className="px-4 py-2.5 text-white font-bold text-sm"
                  style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))' }}
                >
                  POS Settlement
                </div>
                <div className="p-3.5 space-y-2.5 text-xs">
                  <div className="flex justify-between font-medium">
                    <span className="text-slate-500">Bill Total</span>
                    <b className="text-base font-extrabold">Rs 4,050.00</b>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border-2 theme-border-primary theme-bg-subtle px-3 py-2 font-medium">
                    <Banknote size={16} className="theme-text-primary" /> Cash <b className="ml-auto">2,000.00</b>
                  </div>
                  <div className="flex items-center gap-2 rounded-xl border-2 border-slate-200 dark:border-slate-700 px-3 py-2 text-slate-500">
                    <CreditCard size={16} /> Card <b className="ml-auto">2,050.00</b>
                  </div>
                  <button type="button" className="w-full py-2.5 rounded-xl font-bold theme-btn-primary shadow-md">
                    Complete Checkout
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Table */}
          {!thumb && (
            <div
              className="rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden"
              style={{ background: 'var(--content-bg)' }}
            >
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 dark:border-slate-800">
                <span className="font-bold text-xs uppercase tracking-wider text-slate-500">Recent Transactions</span>
                <span className="inline-flex gap-2">
                  <span className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold cursor-pointer">
                    Export
                  </span>
                  <span className="px-3 py-1 rounded-lg theme-btn-primary text-xs font-bold cursor-pointer">
                    + New Sale
                  </span>
                </span>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {[
                    ['INV-000126', 'Nimal Perera', 'Paid', 'Rs 3,400.00'],
                    ['INV-000125', 'Walk-in Customer', 'Paid', 'Rs 750.00'],
                    ['INV-000124', 'Kamala Stores', 'Credit', 'Rs 12,300.00'],
                  ].map((r) => (
                    <tr key={r[0]} className="border-b last:border-0 border-slate-100 dark:border-slate-800/80">
                      <td className="px-4 py-2.5 font-bold theme-text-primary">{r[0]}</td>
                      <td className="px-4 py-2.5 font-medium">{r[1]}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                            r[2] === 'Paid' ? 'theme-kpi-up' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}
                        >
                          {r[2]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-black">{r[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AppearancePage() {
  const { data: session } = useSession()
  const canApply = hasPermission(session?.user?.role || '', 'manageSettings')
  const theme = useTheme()

  const [activeTab, setActiveTab] = useState<'marketplace' | 'custom' | 'layout'>('marketplace')
  const [saved, setSaved] = useState<StoredAppearance | null>(null)
  const [draft, setDraft] = useState<Appearance>({
    palette: theme.palette,
    uiStyle: theme.uiStyle,
    sidebar: theme.sidebarMode,
    mode: null,
    customBrand: theme.customBrand,
  })
  const [saving, setSaving] = useState(false)
  const [trying, setTrying] = useState(false)
  const [previewDark, setPreviewDark] = useState(theme.resolvedTheme === 'dark')

  useEffect(() => {
    let cancelled = false
    fetch('/api/tenant/appearance')
      .then((r) => (r.ok ? r.json() : null))
      .then((a: StoredAppearance | null) => {
        if (cancelled || !a) return
        setSaved(a)
        if (a.updatedAt) {
          setDraft({
            palette: a.palette,
            uiStyle: a.uiStyle,
            sidebar: a.sidebar,
            mode: a.mode,
            customBrand: a.customBrand,
          })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const setField = <K extends keyof Appearance>(k: K, v: Appearance[K]) => {
    setDraft((d) => ({ ...d, [k]: v }))
    if (k === 'mode' && v) {
      setPreviewDark(v === 'dark' || (v === 'system' && theme.resolvedTheme === 'dark'))
    }
  }

  const setCustomField = <K extends keyof CustomBrandConfig>(k: K, v: CustomBrandConfig[K]) => {
    setDraft((d) => {
      const current = d.customBrand || {
        primaryColor: '#7c3aed',
        borderRadius: 'md',
        fontFamily: 'inter',
      }
      return {
        ...d,
        palette: 'custom-brand',
        customBrand: { ...current, [k]: v },
      }
    })
  }

  const dirty = useMemo(() => {
    if (!saved) return false
    return (
      saved.palette !== draft.palette ||
      saved.uiStyle !== draft.uiStyle ||
      saved.sidebar !== draft.sidebar ||
      saved.mode !== draft.mode ||
      JSON.stringify(saved.customBrand) !== JSON.stringify(draft.customBrand)
    )
  }, [saved, draft])

  function tryIt() {
    theme.setPalette(draft.palette)
    theme.setUiStyle(draft.uiStyle)
    theme.setSidebarMode(draft.sidebar)
    if (draft.customBrand) theme.setCustomBrand(draft.customBrand)
    if (draft.mode) theme.setTheme(draft.mode)
    setTrying(true)
    toast.success(
      canApply
        ? 'Theme applied on this screen. Click "Apply for Everyone" to save it for all staff.'
        : 'Theme applied on this browser.'
    )
  }

  function undoTry() {
    if (saved) theme.syncShopAppearance(saved, { force: true })
    setTrying(false)
    toast.info('Reverted back to the business saved theme.')
  }

  async function apply() {
    setSaving(true)
    try {
      const res = await fetch('/api/tenant/appearance', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to save theme')
      setSaved(body)
      theme.syncShopAppearance(body, { force: true })
      setTrying(false)
      toast.success('New theme applied successfully! All company screens and terminals are now synced.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save theme')
    } finally {
      setSaving(false)
    }
  }

  const featuredThemes = useMemo(
    () => THEME_PALETTES.filter((p) => PALETTE_INFO[p].category === 'featured'),
    []
  )

  const classicThemes = useMemo(
    () => THEME_PALETTES.filter((p) => PALETTE_INFO[p].category === 'classic'),
    []
  )

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl theme-btn-primary flex items-center justify-center shadow-md">
              <Palette size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                Theme Marketplace &amp; Appearance Studio
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Pick from curated 2025/2026 SaaS themes or design your custom brand. Applies across all buttons, cards, menus, and cashier screens instantly.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {trying && (
            <button
              type="button"
              onClick={undoTry}
              className="px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-xs font-semibold flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <RotateCcw size={14} /> Revert
            </button>
          )}
          <button
            type="button"
            onClick={tryIt}
            className="px-4 py-2 rounded-xl border-2 theme-border-primary theme-text-primary bg-white dark:bg-slate-900 text-xs font-bold flex items-center gap-1.5 shadow-sm hover:shadow transition-all"
          >
            <Eye size={15} /> {canApply ? 'Try on My Screen' : 'Use on this Device'}
          </button>
          {canApply && (
            <button
              type="button"
              onClick={apply}
              disabled={saving || !dirty}
              className="px-5 py-2 rounded-xl theme-btn-primary text-white text-xs font-bold flex items-center gap-2 shadow-md disabled:opacity-50 transition-all"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Apply for Everyone
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-6">
        <button
          type="button"
          onClick={() => setActiveTab('marketplace')}
          className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'marketplace'
              ? 'theme-border-primary theme-text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Sparkles size={16} /> Theme Marketplace
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('custom')}
          className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'custom'
              ? 'theme-border-primary theme-text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Sliders size={16} /> Custom Brand Studio
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('layout')}
          className={`pb-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${
            activeTab === 'layout'
              ? 'theme-border-primary theme-text-primary'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Layout size={16} /> Layout &amp; Navigation
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[460px_minmax(0,1fr)] gap-6 items-start">
        {/* Controls Column */}
        <div className="space-y-6">
          {activeTab === 'marketplace' && (
            <div className="space-y-6">
              {/* Featured 2025/2026 SaaS Themes */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                    Featured SaaS Themes
                  </h2>
                  <span className="text-xs text-slate-400">8 Curated Archetypes</span>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {featuredThemes.map((p) => {
                    const info = PALETTE_INFO[p]
                    const isSelected = draft.palette === p
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setField('palette', p)}
                        className={`w-full p-3.5 rounded-2xl border-2 text-left transition-all flex items-start gap-3.5 ${
                          isSelected
                            ? 'theme-border-primary bg-slate-50 dark:bg-slate-900 shadow-sm'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <span
                          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-inner mt-0.5"
                          style={{ background: info.color }}
                        >
                          {isSelected ? (
                            <Check size={20} className="text-white" strokeWidth={3} />
                          ) : (
                            <span className="w-3.5 h-3.5 rounded-full bg-white/40" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                              {info.label}
                            </span>
                            {info.badge && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {info.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                            {info.description}
                          </p>
                          <div className="flex items-center gap-1.5 mt-2">
                            <span className="w-3.5 h-3.5 rounded-full" style={{ background: info.color }} />
                            <span className="w-3.5 h-3.5 rounded-full" style={{ background: info.secondary }} />
                            <span className="w-3.5 h-3.5 rounded-full" style={{ background: info.accent }} />
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* Classic Presets */}
              <section className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Classic Baseline Palettes
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {classicThemes.map((p) => {
                    const info = PALETTE_INFO[p]
                    const isSelected = draft.palette === p
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setField('palette', p)}
                        className={`p-2.5 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                          isSelected
                            ? 'theme-border-primary bg-slate-50 dark:bg-slate-800/80 font-bold'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                        }`}
                      >
                        <span className="w-5 h-5 rounded-full shrink-0 shadow-inner" style={{ background: info.color }} />
                        <span className="text-xs truncate">{info.label}</span>
                        {isSelected && <Check size={14} className="ml-auto theme-text-primary" />}
                      </button>
                    )
                  })}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'custom' && (
            <div className="space-y-5 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <div>
                <h3 className="font-extrabold text-base text-slate-900 dark:text-white">Custom Brand Studio</h3>
                <p className="text-xs text-slate-500">Design your unique corporate look with custom hex colors, geometry, and fonts.</p>
              </div>

              {/* Color Pickers */}
              <div className="space-y-3">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Primary Brand Color
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={draft.customBrand?.primaryColor || '#7c3aed'}
                    onChange={(e) => setCustomField('primaryColor', e.target.value)}
                    className="w-12 h-10 rounded-xl cursor-pointer border-0 bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={draft.customBrand?.primaryColor || '#7c3aed'}
                    onChange={(e) => setCustomField('primaryColor', e.target.value)}
                    className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-mono text-xs w-32 uppercase"
                  />
                  <span className="text-xs text-slate-400">Buttons, Active Nav, Highlights</span>
                </div>
              </div>

              {/* Corner Radius */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Card &amp; Component Corner Radius
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {RADIUS_OPTIONS.map((r) => {
                    const active = (draft.customBrand?.borderRadius || 'md') === r.value
                    return (
                      <button
                        key={r.value}
                        type="button"
                        onClick={() => setCustomField('borderRadius', r.value)}
                        className={`p-2.5 rounded-xl border text-left text-xs transition-all ${
                          active
                            ? 'theme-border-primary bg-slate-50 dark:bg-slate-800 font-bold'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <span className="block font-semibold">{r.label}</span>
                        <span className="text-[10px] text-slate-400">{r.desc}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Typography */}
              <div className="space-y-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Application Typography
                </label>
                <div className="grid grid-cols-1 gap-1.5">
                  {FONT_OPTIONS.map((f) => {
                    const active = (draft.customBrand?.fontFamily || 'inter') === f.value
                    return (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setCustomField('fontFamily', f.value)}
                        className={`px-3 py-2 rounded-xl border text-left text-xs transition-all flex items-center justify-between ${
                          active
                            ? 'theme-border-primary bg-slate-50 dark:bg-slate-800 font-bold'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <span>{f.label}</span>
                        {active && <Check size={14} className="theme-text-primary" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'layout' && (
            <div className="space-y-6">
              {/* UI Style */}
              <section className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  1. Component Geometry &amp; Style
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {UI_STYLES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setField('uiStyle', s)}
                      className={`text-left rounded-xl border-2 p-3 transition-all flex items-center justify-between ${
                        draft.uiStyle === s
                          ? 'theme-border-primary bg-slate-50 dark:bg-slate-800/80 shadow-sm'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                          {draft.uiStyle === s && <Check size={15} className="theme-text-primary" />}
                          {UI_STYLE_INFO[s].label}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{UI_STYLE_INFO[s].description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              {/* Side menu mode */}
              <section className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  2. Sidebar Navigation Layout
                </h3>
                <div className="grid grid-cols-1 gap-2">
                  {SIDEBAR_MODES.map((m) => {
                    const Icon = m === 'hidden' ? PanelLeftClose : m === 'icons' ? PanelLeft : PanelLeftOpen
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setField('sidebar', m)}
                        className={`w-full flex items-start gap-3 text-left rounded-xl border-2 p-3 transition-all ${
                          draft.sidebar === m
                            ? 'theme-border-primary bg-slate-50 dark:bg-slate-800/80'
                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <Icon size={18} className={draft.sidebar === m ? 'theme-text-primary mt-0.5' : 'text-slate-400 mt-0.5'} />
                        <div>
                          <span className="block text-xs font-bold text-slate-900 dark:text-white">{SIDEBAR_MODE_INFO[m].label}</span>
                          <span className="block text-[11px] text-slate-500">{SIDEBAR_MODE_INFO[m].description}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* Mode light / dark */}
              <section className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white">
                  3. Color Mode Default
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {MODE_OPTIONS.map((o) => (
                    <button
                      key={String(o.value)}
                      type="button"
                      onClick={() => setField('mode', o.value)}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs font-semibold ${
                        draft.mode === o.value
                          ? 'theme-border-primary theme-text-primary bg-slate-50 dark:bg-slate-800'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <o.icon size={15} /> {o.label}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Live Preview Column */}
        <div className="space-y-3 xl:sticky xl:top-20">
          <div className="flex items-center justify-between">
            <h2 className="font-extrabold text-sm text-slate-900 dark:text-white flex items-center gap-2">
              <Layers size={16} /> Live Application Preview
            </h2>
            <button
              type="button"
              onClick={() => setPreviewDark((d) => !d)}
              className="px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {previewDark ? <Sun size={14} /> : <Moon size={14} />} Preview {previewDark ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>

          <UiPreview look={draft} dark={previewDark} />

          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-500 flex items-center justify-between">
            <span>
              Active Draft: <b>{PALETTE_INFO[draft.palette]?.label || draft.palette}</b> ({UI_STYLE_INFO[draft.uiStyle].label})
            </span>
            {dirty && <span className="font-bold theme-text-primary">● Unsaved Changes</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
