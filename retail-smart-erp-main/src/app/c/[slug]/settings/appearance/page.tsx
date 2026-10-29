'use client'

/**
 * Settings → Appearance (UI designer): pick a UI style, colour palette, sidebar mode and light / dark,
 * see the whole app (menu, dashboard cards, chart, table, buttons, cashier payment) in a live preview,
 * try it on this screen, then apply it for everyone in the business (owners / admins).
 */
import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Check, Eye, Loader2, Menu, Moon, Monitor, Palette, PanelLeft, PanelLeftClose, PanelLeftOpen, RotateCcw, Save, Sun, Users,
  LayoutDashboard, ShoppingCart, Package, Receipt, BarChart3, Settings, TrendingUp, Wallet, Banknote, CreditCard, Search } from 'lucide-react'
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
  type StoredAppearance,
} from '@/lib/ui/appearance'

const MODE_OPTIONS: Array<{ value: ColorMode | null; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto', icon: Monitor },
  { value: null, label: 'Each user', icon: Users },
]

/** A small but complete picture of the app in the chosen look (scoped data-ui / data-theme / dark). */
function UiPreview({ look, dark, size = 'large' }: { look: Appearance; dark: boolean; size?: 'large' | 'thumb' }) {
  const thumb = size === 'thumb'
  const nav = [
    { icon: LayoutDashboard, label: 'Dashboard', active: true },
    { icon: ShoppingCart, label: 'Point of Sale' },
    { icon: Package, label: 'Items' },
    { icon: Receipt, label: 'Sales Invoices' },
    { icon: BarChart3, label: 'Reports' },
    { icon: Settings, label: 'Settings' },
  ]
  const bars = [40, 65, 52, 80, 70, 95, 60]
  return (
    <div
      data-ui={look.uiStyle}
      data-theme={look.palette}
      className={`${dark ? 'dark' : ''} overflow-hidden border border-gray-200 dark:border-gray-700 rounded-xl select-none`}
      style={{ background: 'var(--page-bg)', fontSize: thumb ? '7px' : 'calc(13px * var(--ui-style-scale, 1))', pointerEvents: thumb ? 'none' : undefined }}
      aria-hidden={thumb}
    >
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: 'var(--navbar-bg)', color: '#fff' }}>
        {look.sidebar === 'hidden' && <Menu size={thumb ? 8 : 16} />}
        <span className="font-bold" style={{ fontSize: '1.1em' }}>skyERPOS</span>
        <span className="ml-auto opacity-70">Alisha Fashion</span>
      </div>
      <div className="flex" style={{ minHeight: thumb ? 120 : 380 }}>
        {/* Sidebar */}
        {look.sidebar !== 'hidden' && (
          <div className="shrink-0 py-2" style={{ width: look.sidebar === 'icons' ? (thumb ? 18 : 48) : thumb ? 70 : 170, background: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)' }}>
            {nav.map((n) => (
              <div key={n.label} className="flex items-center gap-2 mx-1 px-2 py-1.5 rounded-md"
                style={n.active ? { background: 'var(--sidebar-active-bg)', color: 'var(--sidebar-text-active)', fontWeight: 600 } : { color: 'var(--sidebar-text, #495057)' }}>
                <n.icon size={thumb ? 8 : 16} />
                {look.sidebar === 'open' && <span className="truncate">{n.label}</span>}
              </div>
            ))}
          </div>
        )}
        {/* Page */}
        <div className="flex-1 min-w-0 p-3 space-y-3" style={{ color: 'var(--text-primary)' }}>
          <div className="flex items-center justify-between gap-2">
            <div className="font-bold" style={{ fontSize: '1.3em' }}>Dashboard</div>
            {!thumb && (
              <div className="flex items-center gap-1.5 px-2 py-1 border rounded-md bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500">
                <Search size={14} /> Search…
              </div>
            )}
          </div>
          {/* Stat cards (same classes as the dashboard number cards) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {[
              { label: "Today's sales", value: 'Rs 84,500', icon: TrendingUp, bg: 'bg-gradient-to-br from-blue-500 to-blue-600' },
              { label: 'Bills', value: '126', icon: Receipt, bg: 'bg-gradient-to-br from-emerald-500 to-emerald-600' },
              { label: 'Low stock', value: '7', icon: Package, bg: 'bg-gradient-to-br from-amber-500 to-amber-600' },
              { label: 'Credit due', value: 'Rs 12,300', icon: Wallet, bg: 'bg-gradient-to-br from-violet-500 to-violet-600' },
            ].map((c) => (
              <div key={c.label} className={`ui-stat-card flex items-center gap-2 px-3 py-2 rounded-md text-white shadow-sm ${c.bg}`}>
                <div className="ui-stat-icon w-7 h-7 rounded bg-white/20 flex items-center justify-center shrink-0"><c.icon size={thumb ? 8 : 15} /></div>
                <div className="min-w-0">
                  <div className="font-bold truncate" style={{ fontSize: '1.15em' }}>{c.value}</div>
                  <div className="opacity-80 truncate" style={{ fontSize: '0.85em' }}>{c.label}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            {/* Chart */}
            <div className="lg:col-span-2 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm p-3" style={{ background: 'var(--content-bg)' }}>
              <div className="font-semibold mb-2">Sales, last 7 days</div>
              <div className="flex items-end gap-2" style={{ height: thumb ? 30 : 110 }}>
                {bars.map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-blue-600 to-blue-400" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
            {/* Cashier payment */}
            {!thumb && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden" style={{ background: 'var(--content-bg)' }}>
                <div className="px-3 py-2 text-white font-semibold" style={{ background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))' }}>Payment</div>
                <div className="p-3 space-y-2">
                  <div className="flex justify-between"><span className="text-gray-500">Total</span><b>Rs 4,050.00</b></div>
                  <div className="flex items-center gap-2 rounded-md border-2 theme-border-primary theme-bg-subtle px-2 py-1.5"><Banknote size={16} className="theme-text-primary" /> Cash <b className="ml-auto">2,000.00</b></div>
                  <div className="flex items-center gap-2 rounded-md border-2 border-gray-200 dark:border-gray-700 px-2 py-1.5"><CreditCard size={16} className="text-gray-400" /> Card <b className="ml-auto">2,050.00</b></div>
                  <button type="button" className="w-full py-2 rounded-md font-bold theme-btn-primary">Complete Sale</button>
                </div>
              </div>
            )}
          </div>
          {/* Table + buttons */}
          {!thumb && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden" style={{ background: 'var(--content-bg)' }}>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                <span className="font-semibold">Recent bills</span>
                <span className="ml-auto inline-flex gap-1.5">
                  <button type="button" className="px-3 py-1 rounded-md border border-gray-300 dark:border-gray-600">Export</button>
                  <button type="button" className="px-3 py-1 rounded-md bg-blue-600 text-white font-semibold shadow-sm">New sale</button>
                </span>
              </div>
              <table className="w-full">
                <tbody>
                  {[['INV-000126', 'Nimal Perera', 'Paid', 'Rs 3,400.00'], ['INV-000125', 'Walk-in', 'Paid', 'Rs 750.00'], ['INV-000124', 'Kamala Stores', 'Credit', 'Rs 12,300.00']].map((r) => (
                    <tr key={r[0]} className="border-b last:border-0 border-gray-100 dark:border-gray-800">
                      <td className="px-3 py-1.5 text-blue-600 font-medium">{r[0]}</td>
                      <td className="px-3 py-1.5">{r[1]}</td>
                      <td className="px-3 py-1.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${r[2] === 'Paid' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{r[2]}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-semibold">{r[3]}</td>
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
  const [saved, setSaved] = useState<StoredAppearance | null>(null)
  const [draft, setDraft] = useState<Appearance>({ palette: theme.palette, uiStyle: theme.uiStyle, sidebar: theme.sidebarMode, mode: null })
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
        if (a.updatedAt) setDraft({ palette: a.palette, uiStyle: a.uiStyle, sidebar: a.sidebar, mode: a.mode })
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const set = <K extends keyof Appearance>(k: K, v: Appearance[K]) => {
    setDraft((d) => ({ ...d, [k]: v }))
    if (k === 'mode' && v) setPreviewDark(v === 'dark' || (v === 'system' && theme.resolvedTheme === 'dark'))
  }
  const dirty = useMemo(() => !saved || saved.palette !== draft.palette || saved.uiStyle !== draft.uiStyle || saved.sidebar !== draft.sidebar || saved.mode !== draft.mode, [saved, draft])

  // Try on this screen (not saved)
  function tryIt() {
    theme.setPalette(draft.palette)
    theme.setUiStyle(draft.uiStyle)
    theme.setSidebarMode(draft.sidebar)
    if (draft.mode) theme.setTheme(draft.mode)
    setTrying(true)
    toast.success(canApply ? 'Showing the new look on this screen. Click "Apply for everyone" to keep it for all staff.' : 'Using this look on this PC.')
  }
  function undoTry() {
    if (saved) theme.syncShopAppearance(saved, { force: true })
    setTrying(false)
  }

  async function apply() {
    setSaving(true)
    try {
      const res = await fetch('/api/tenant/appearance', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(draft) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not save')
      setSaved(body)
      theme.syncShopAppearance(body, { force: true })
      setTrying(false)
      toast.success('New look applied for everyone. Other screens switch on their next page load.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold flex items-center gap-2"><Palette size={20} className="text-blue-600" /> Appearance — UI designer</h1>
          <p className="text-sm text-gray-500">Choose how every screen looks — dashboard, menus, buttons, charts and the cashier screen. Preview it before you apply.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {trying && (
            <button type="button" onClick={undoTry} className="px-3 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-medium flex items-center gap-1.5">
              <RotateCcw size={15} /> Undo try
            </button>
          )}
          <button type="button" onClick={tryIt} className="px-3 py-2 rounded-md border border-blue-300 text-blue-700 bg-blue-50 text-sm font-semibold flex items-center gap-1.5">
            <Eye size={15} /> {canApply ? 'Try on my screen' : 'Use on this PC'}
          </button>
          {canApply && (
            <button type="button" onClick={apply} disabled={saving || !dirty} className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Apply for everyone
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] gap-4 items-start">
        {/* Controls */}
        <div className="space-y-4">
          <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3" style={{ background: 'var(--content-bg)' }}>
            <h2 className="font-semibold">1. UI style</h2>
            <div className="grid grid-cols-2 gap-2">
              {UI_STYLES.map((s) => (
                <button key={s} type="button" onClick={() => set('uiStyle', s)} aria-pressed={draft.uiStyle === s}
                  className={`text-left rounded-lg border-2 p-1.5 transition-colors ${draft.uiStyle === s ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                  <UiPreview look={{ ...draft, uiStyle: s }} dark={previewDark} size="thumb" />
                  <div className="mt-1.5 px-0.5 flex items-center gap-1 font-semibold text-sm">
                    {draft.uiStyle === s && <Check size={14} className="text-blue-600" />}{UI_STYLE_INFO[s].label}
                  </div>
                  <div className="px-0.5 text-[11px] text-gray-500 leading-snug">{UI_STYLE_INFO[s].description}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3" style={{ background: 'var(--content-bg)' }}>
            <h2 className="font-semibold">2. Colours</h2>
            <div className="grid grid-cols-5 gap-2">
              {THEME_PALETTES.map((p) => (
                <button key={p} type="button" onClick={() => set('palette', p)} title={PALETTE_INFO[p].label} aria-pressed={draft.palette === p}
                  className={`flex flex-col items-center gap-1 rounded-lg p-1.5 border-2 ${draft.palette === p ? 'border-gray-900 dark:border-white' : 'border-transparent hover:border-gray-300'}`}>
                  <span className="w-9 h-9 rounded-full flex items-center justify-center shadow-inner" style={{ background: PALETTE_INFO[p].color }}>
                    {draft.palette === p && <Check size={18} className="text-white" />}
                  </span>
                  <span className="text-[10px] leading-tight text-center text-gray-600 dark:text-gray-300">{PALETTE_INFO[p].label}</span>
                </button>
              ))}
            </div>
            <div>
              <p className="text-sm font-medium mb-1.5">Light / dark</p>
              <div className="grid grid-cols-4 gap-1.5">
                {MODE_OPTIONS.map((o) => (
                  <button key={String(o.value)} type="button" onClick={() => set('mode', o.value)} aria-pressed={draft.mode === o.value}
                    className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-xs font-medium ${draft.mode === o.value ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700'}`}>
                    <o.icon size={16} /> {o.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-gray-500">&quot;Each user&quot; keeps everyone&apos;s own light / dark choice.</p>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2" style={{ background: 'var(--content-bg)' }}>
            <h2 className="font-semibold">3. Side menu</h2>
            {SIDEBAR_MODES.map((m) => {
              const Icon = m === 'hidden' ? PanelLeftClose : m === 'icons' ? PanelLeft : PanelLeftOpen
              return (
                <button key={m} type="button" onClick={() => set('sidebar', m)} aria-pressed={draft.sidebar === m}
                  className={`w-full flex items-start gap-3 text-left rounded-lg border-2 px-3 py-2 ${draft.sidebar === m ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}>
                  <Icon size={20} className={draft.sidebar === m ? 'text-blue-600 mt-0.5' : 'text-gray-400 mt-0.5'} />
                  <span>
                    <span className="block text-sm font-semibold">{SIDEBAR_MODE_INFO[m].label}</span>
                    <span className="block text-xs text-gray-500">{SIDEBAR_MODE_INFO[m].description}</span>
                  </span>
                </button>
              )
            })}
          </section>
          {!canApply && <p className="text-xs text-gray-500">Only the owner or an admin can change the look for everyone; you can use a look on this PC.</p>}
        </div>

        {/* Live preview */}
        <div className="space-y-2 xl:sticky xl:top-16">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Live preview</h2>
            <span className="text-xs text-gray-500">{UI_STYLE_INFO[draft.uiStyle].label} · {PALETTE_INFO[draft.palette].label} · menu {SIDEBAR_MODE_INFO[draft.sidebar].label.toLowerCase()}</span>
            <button type="button" onClick={() => setPreviewDark((d) => !d)} className="ml-auto px-2.5 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-medium flex items-center gap-1">
              {previewDark ? <Sun size={13} /> : <Moon size={13} />} Preview {previewDark ? 'light' : 'dark'}
            </button>
          </div>
          <UiPreview look={draft} dark={previewDark} />
          {saved?.updatedAt && (
            <p className="text-xs text-gray-500">
              Saved look: {UI_STYLE_INFO[saved.uiStyle].label} · {PALETTE_INFO[saved.palette].label} · menu {SIDEBAR_MODE_INFO[saved.sidebar].label.toLowerCase()}
              {dirty ? ' — the preview shows unsaved changes.' : '.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
