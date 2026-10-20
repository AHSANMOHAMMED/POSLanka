'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { usePermission } from '@/hooks/usePermission'
import {
  ALERT_TYPES, ALERT_TYPE_INFO, DEFAULT_ALERT_PREFERENCES, DEFAULT_ALERT_SETTINGS,
  type AlertGroup, type AlertPreferences, type AlertType, type TenantAlertSettings,
} from '@/lib/notifications/alert-types'

const GROUPS: AlertGroup[] = ['Stock', 'Sales', 'Approvals', 'System']
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const inputCls = 'w-full rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm'

function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 py-2 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">{label}</span>
        {description && <span className="block text-xs text-gray-500">{description}</span>}
      </span>
    </label>
  )
}

const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v))

export default function AlertSettingsPage() {
  const router = useRouter()
  const canManage = usePermission('manageSettings')
  const [settings, setSettings] = useState<TenantAlertSettings>(DEFAULT_ALERT_SETTINGS)
  const [prefs, setPrefs] = useState<AlertPreferences>(DEFAULT_ALERT_PREFERENCES)
  const [tenantTz, setTenantTz] = useState('Asia/Colombo')
  const [loading, setLoading] = useState(true)
  const [savingCompany, setSavingCompany] = useState(false)
  const [savingMine, setSavingMine] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, p] = await Promise.all([fetch('/api/notifications/settings'), fetch('/api/notifications/preferences')])
      if (s.ok) setSettings((await s.json()).settings)
      if (p.ok) {
        const json = await p.json()
        setPrefs(json.preferences)
        if (json.tenantTimezone) setTenantTz(json.tenantTimezone)
      }
    } catch {
      toast.error('Failed to load alert settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const muted = useMemo(() => new Set(prefs.mutedTypes), [prefs.mutedTypes])
  const setTypeOn = (type: AlertType, on: boolean) => {
    const next = new Set(prefs.mutedTypes)
    if (on) next.delete(type)
    else next.add(type)
    setPrefs({ ...prefs, mutedTypes: [...next] })
  }

  async function saveCompany() {
    setSavingCompany(true)
    try {
      const res = await fetch('/api/notifications/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultMinStock: settings.defaultMinStock ?? undefined,
          expiryWarningDays: settings.expiryWarningDays,
          largeRefundAmount: settings.largeRefundAmount ?? undefined,
          varianceThreshold: settings.varianceThreshold,
          digestEnabled: settings.digestEnabled,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Failed to save')
      setSettings(json.settings)
      toast.success('Company alert settings saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSavingCompany(false)
    }
  }

  async function saveMine() {
    setSavingMine(true)
    try {
      const res = await fetch('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabledTypes: prefs.enabledTypes ?? undefined,
          mutedTypes: prefs.mutedTypes,
          quietStart: prefs.quietStart || undefined,
          quietEnd: prefs.quietEnd || undefined,
          timezone: prefs.timezone || undefined,
          digestHour: prefs.digestHour ?? undefined,
          pushEnabled: prefs.pushEnabled,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.details?.[0]?.message || json.error || 'Failed to save')
      setPrefs(json.preferences)
      toast.success('Your alert preferences were saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSavingMine(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>

  return (
    <div className="p-4 sm:p-6 max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700" aria-label="Back">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Alerts &amp; reminders</h1>
          <p className="text-sm text-gray-500">Push notifications on the POSLanka app and the in-app alert inbox</p>
        </div>
      </div>

      {/* ---------------- company settings ---------------- */}
      <Card className="p-5 space-y-4">
        <div>
          <h2 className="text-lg font-medium">Company alert rules</h2>
          <p className="text-sm text-gray-500">{canManage ? 'Thresholds used for everyone in this company.' : 'Only users who can manage settings may change these.'}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-sm">
            <span className="block font-medium mb-1">Default minimum stock</span>
            <input type="number" min={0} step="any" className={inputCls} disabled={!canManage}
              value={settings.defaultMinStock ?? ''} placeholder="Off"
              onChange={(e) => setSettings({ ...settings, defaultMinStock: numOrUndef(e.target.value) ?? null })} />
            <span className="block text-xs text-gray-500 mt-1">Used when a branch has no minimum set for an item</span>
          </label>
          <label className="text-sm">
            <span className="block font-medium mb-1">Expiry warning (days)</span>
            <input type="number" min={1} max={365} className={inputCls} disabled={!canManage}
              value={settings.expiryWarningDays}
              onChange={(e) => setSettings({ ...settings, expiryWarningDays: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label className="text-sm">
            <span className="block font-medium mb-1">Large refund amount</span>
            <input type="number" min={0} step="any" className={inputCls} disabled={!canManage}
              value={settings.largeRefundAmount ?? ''} placeholder="Off"
              onChange={(e) => setSettings({ ...settings, largeRefundAmount: numOrUndef(e.target.value) ?? null })} />
          </label>
          <label className="text-sm">
            <span className="block font-medium mb-1">Shift cash variance threshold</span>
            <input type="number" min={0} step="any" className={inputCls} disabled={!canManage}
              value={settings.varianceThreshold}
              onChange={(e) => setSettings({ ...settings, varianceThreshold: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
        <Toggle checked={settings.digestEnabled} disabled={!canManage} onChange={(v) => setSettings({ ...settings, digestEnabled: v })}
          label="Daily low-stock digest" description="A morning summary for stock managers at their chosen hour" />
        {canManage && (
          <div className="flex justify-end">
            <Button onClick={saveCompany} disabled={savingCompany}>{savingCompany ? 'Saving…' : 'Save company rules'}</Button>
          </div>
        )}
      </Card>

      {/* ---------------- my preferences ---------------- */}
      <Card className="p-5 space-y-4">
        <div>
          <h2 className="text-lg font-medium">My alerts</h2>
          <p className="text-sm text-gray-500">You only receive alerts your role is allowed to see.</p>
        </div>
        <Toggle checked={prefs.pushEnabled} onChange={(v) => setPrefs({ ...prefs, pushEnabled: v })}
          label="Push notifications on my phone" description="Alerts are always kept in the inbox (bell icon)" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="text-sm">
            <span className="block font-medium mb-1">Quiet hours from</span>
            <input type="time" className={inputCls} value={prefs.quietStart || ''}
              onChange={(e) => setPrefs({ ...prefs, quietStart: e.target.value || null })} />
          </label>
          <label className="text-sm">
            <span className="block font-medium mb-1">Quiet hours until</span>
            <input type="time" className={inputCls} value={prefs.quietEnd || ''}
              onChange={(e) => setPrefs({ ...prefs, quietEnd: e.target.value || null })} />
          </label>
          <label className="text-sm">
            <span className="block font-medium mb-1">Daily digest at</span>
            <select className={inputCls} value={prefs.digestHour ?? ''}
              onChange={(e) => setPrefs({ ...prefs, digestHour: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">Off</option>
              {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </select>
          </label>
        </div>
        <label className="text-sm block">
          <span className="block font-medium mb-1">Time zone</span>
          <input type="text" className={inputCls} value={prefs.timezone || ''} placeholder={`Company default (${tenantTz})`}
            onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value || null })} />
          <span className="block text-xs text-gray-500 mt-1">During quiet hours alerts go to the inbox only (no push).</span>
        </label>

        <div className="space-y-4">
          {GROUPS.map((group) => (
            <div key={group}>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-700 pb-1">{group}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                {ALERT_TYPES.filter((t) => ALERT_TYPE_INFO[t].group === group).map((t) => (
                  <Toggle key={t} checked={!muted.has(t)} onChange={(v) => setTypeOn(t, v)}
                    label={ALERT_TYPE_INFO[t].label} description={ALERT_TYPE_INFO[t].description} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button onClick={saveMine} disabled={savingMine}>{savingMine ? 'Saving…' : 'Save my alerts'}</Button>
        </div>
      </Card>
    </div>
  )
}
