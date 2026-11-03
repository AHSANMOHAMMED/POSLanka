// Platform settings (bank details, announcement banner, contact info, seasonal offer, volume
// discounts) and the file-storage orphan cleanup.
// GET/PUT /api/sys-control/settings (PUT needs `settings`), GET/POST /api/sys-control/r2-cleanup.
import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, RefreshControl, Alert } from 'react-native'
import { adminGet, adminPost, adminPut, useAdminUser } from '../../src/lib/adminApi'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { Card, ListRow, Pill, SectionTitle, adminStyles, timeAgo } from '../../src/components/admin/AdminShell'
import { Btn, Choice, Field, FormModal, LinkButton, MoreShell, Notice, SwitchRow } from '../../src/components/admin/AdminForm'
import { confirmAction, parseNum } from '../../src/lib/adminForms'

type Kind = 'text' | 'multiline' | 'number' | 'bool' | 'choice'
interface FieldDef { key: string; label: string; kind: Kind; options?: Array<{ value: string; label: string }>; hint?: string; placeholder?: string }

const SECTIONS: Array<{ key: string; title: string; description: string; fields: FieldDef[] }> = [
  {
    key: 'bank_details',
    title: 'Bank details',
    description: 'Account vendors pay into by bank transfer',
    fields: [
      { key: 'bankName', label: 'Bank name', kind: 'text' },
      { key: 'branchName', label: 'Branch', kind: 'text' },
      { key: 'accountName', label: 'Account name', kind: 'text' },
      { key: 'accountNumber', label: 'Account number', kind: 'text', hint: '4–30 digits; spaces and dashes allowed.' },
      { key: 'swiftCode', label: 'SWIFT code (optional)', kind: 'text' },
      { key: 'notes', label: 'Notes (optional)', kind: 'multiline' },
    ],
  },
  {
    key: 'system_announcement',
    title: 'Announcement banner',
    description: 'Banner in the vendor app and on login (EN / සිංහල / தமிழ்)',
    fields: [
      { key: 'enabled', label: 'Show banner', kind: 'bool' },
      { key: 'showOnLogin', label: 'Show on login screens', kind: 'bool' },
      { key: 'type', label: 'Type', kind: 'choice', options: [{ value: 'info', label: 'Info' }, { value: 'warning', label: 'Warning' }, { value: 'error', label: 'Error' }] },
      { key: 'message', label: 'English message', kind: 'multiline', hint: 'Up to 300 characters; 5+ to turn it on.' },
      { key: 'messageSi', label: 'Sinhala (සිංහල)', kind: 'multiline', hint: 'Optional; vendors using Sinhala see this.' },
      { key: 'messageTa', label: 'Tamil (தமிழ்)', kind: 'multiline', hint: 'Optional; vendors using Tamil see this.' },
    ],
  },
  {
    key: 'contact_info',
    title: 'Contact info',
    description: 'Shown on public pages and emails',
    fields: [
      { key: 'companyName', label: 'Company name', kind: 'text' },
      { key: 'email', label: 'Email', kind: 'text' },
      { key: 'phone', label: 'Phone', kind: 'text' },
      { key: 'whatsapp', label: 'WhatsApp (optional)', kind: 'text' },
      { key: 'address', label: 'Address (optional)', kind: 'multiline' },
      { key: 'businessHours', label: 'Business hours (optional)', kind: 'text' },
    ],
  },
  {
    key: 'seasonal_offer',
    title: 'Seasonal offer',
    description: 'Limited-time offer on landing and pricing pages',
    fields: [
      { key: 'enabled', label: 'Offer is on', kind: 'bool' },
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'description', label: 'Description', kind: 'multiline' },
      { key: 'discountPercent', label: 'Discount (%)', kind: 'number' },
      { key: 'validUntil', label: 'Valid until (YYYY-MM-DD)', kind: 'text', placeholder: '2027-01-31' },
      { key: 'badgeText', label: 'Badge text', kind: 'text' },
      { key: 'showOnLanding', label: 'Show on landing page', kind: 'bool' },
      { key: 'showOnPricing', label: 'Show on pricing page', kind: 'bool' },
    ],
  },
]

interface SettingsData {
  settings: Record<string, any>
  updatedAt: Record<string, string | null>
  tiers: Array<{ id: string; displayName: string }>
  platform: {
    appName: string
    baseUrl: string
    environment?: string
    emailConfigured: boolean
    emailFrom?: string
    storageConfigured: boolean
    payhere: { configured: boolean; sandbox: boolean }
    graceDays?: number
  }
}

interface Scan { totalObjects: number; referencedObjects: number; orphanedObjects: number; referencesFound: number; orphansByPrefix: Record<string, number>; sample: string[] }

function failureText(res: { error: string | null; data: any }): string {
  const details: Array<{ field: string; message: string }> | undefined = res.data?.details
  if (Array.isArray(details) && details.length) return details.map((d) => `${d.field ? `${d.field}: ` : ''}${d.message}`).join('\n')
  return res.error || 'Request failed.'
}

export default function AdminSettingsScreen() {
  const { can } = useAdminUser()
  const canEdit = can('settings')
  const [data, setData] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    const res = await adminGet<SettingsData>('/api/sys-control/settings')
    if (res.ok) setData(res.data)
    else setError(res.error)
    setLoading(false)
    setRefreshing(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Generic section editor
  const [editing, setEditing] = useState<(typeof SECTIONS)[number] | null>(null)
  const [form, setForm] = useState<Record<string, string | boolean>>({})
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function openSection(sec: (typeof SECTIONS)[number]) {
    const cur = data?.settings?.[sec.key] || {}
    const f: Record<string, string | boolean> = {}
    for (const fd of sec.fields) {
      let v = cur[fd.key]
      if (sec.key === 'system_announcement') {
        if (fd.key === 'messageSi') v = cur.messages?.si
        if (fd.key === 'messageTa') v = cur.messages?.ta
        if (fd.key === 'message') v = cur.messages?.en || cur.message
        if (fd.key === 'showOnLogin') v = cur.showOnLogin !== false
      }
      f[fd.key] = fd.kind === 'bool' ? !!v : fd.kind === 'choice' ? String(v ?? fd.options?.[0].value ?? '') : v == null ? '' : String(v)
    }
    setForm(f)
    setFormError(null)
    setEditing(sec)
  }

  async function saveSection() {
    if (!editing || !data) return
    const cur = data.settings?.[editing.key] || {}
    const value: Record<string, unknown> = { ...cur }
    for (const fd of editing.fields) {
      const raw = form[fd.key]
      if (fd.kind === 'bool') value[fd.key] = !!raw
      else if (fd.kind === 'number') {
        const n = parseNum(String(raw))
        if (String(raw).trim() && n === undefined) return setFormError(`${fd.label} must be a number.`)
        value[fd.key] = n ?? 0
      } else value[fd.key] = String(raw ?? '').trim()
    }
    if (editing.key === 'system_announcement') {
      const en = String(value.message || '').trim()
      value.message = en
      value.messages = {
        en,
        si: String(value.messageSi || '').trim(),
        ta: String(value.messageTa || '').trim(),
      }
      delete value.messageSi
      delete value.messageTa
      value.showOnLogin = value.showOnLogin !== false
    }
    setBusy(true)
    setFormError(null)
    const res = await adminPut('/api/sys-control/settings', { key: editing.key, value })
    setBusy(false)
    if (!res.ok) return setFormError(failureText(res))
    setEditing(null)
    load(true)
  }

  // Volume discounts editor
  const [tiersOpen, setTiersOpen] = useState(false)
  const [tierRows, setTierRows] = useState<Array<{ min: string; max: string; percent: string }>>([])
  function openTiers() {
    const t: Array<{ min: number; max: number | null; percent: number }> = data?.settings?.volume_discounts?.tiers || []
    setTierRows(t.map((x) => ({ min: String(x.min), max: x.max == null ? '' : String(x.max), percent: String(x.percent) })))
    setFormError(null)
    setTiersOpen(true)
  }
  async function saveTiers() {
    const tiers: Array<{ min: number; max: number | null; percent: number }> = []
    for (const [i, r] of tierRows.entries()) {
      const min = parseNum(r.min)
      const max = r.max.trim() ? parseNum(r.max) : null
      const percent = parseNum(r.percent)
      if (min === undefined || percent === undefined || (r.max.trim() && max === undefined)) return setFormError(`Tier ${i + 1}: enter numbers for min, max (or blank) and percent.`)
      tiers.push({ min, max: max ?? null, percent })
    }
    setBusy(true)
    setFormError(null)
    const res = await adminPut('/api/sys-control/settings', { key: 'volume_discounts', value: { tiers } })
    setBusy(false)
    if (!res.ok) return setFormError(failureText(res))
    setTiersOpen(false)
    load(true)
  }

  // File storage cleanup
  const [prefix, setPrefix] = useState('')
  const [scan, setScan] = useState<Scan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)

  async function runScan() {
    setScanning(true)
    setScanError(null)
    const q = prefix.trim() ? `?prefix=${encodeURIComponent(prefix.trim())}` : ''
    const res = await adminGet<Scan & { storage?: string }>(`/api/sys-control/r2-cleanup${q}`)
    setScanning(false)
    if (!res.ok) return setScanError(res.error)
    setScan(res.data)
  }

  function runCleanup() {
    if (!scan) return
    confirmAction('Delete orphaned files?', `${scan.orphanedObjects} uploaded file(s) that no record points to will be permanently deleted. This cannot be undone.`, 'Delete', async () => {
      setCleaning(true)
      const res = await adminPost<{ deleted: number; scanned: number }>('/api/sys-control/r2-cleanup', { confirm: true, ...(prefix.trim() ? { prefix: prefix.trim() } : {}) })
      setCleaning(false)
      if (!res.ok) return Alert.alert('Cleanup failed', res.error || 'Cleanup failed')
      Alert.alert('Cleanup done', `${res.data.deleted} file(s) deleted (${res.data.scanned} scanned).`)
      setScan(null)
    }, true)
  }

  const summary = (key: string): string => {
    const v = data?.settings?.[key] || {}
    switch (key) {
      case 'bank_details':
        return v.bankName ? `${v.bankName} · ${v.accountNumber || ''}` : 'Not set'
      case 'system_announcement':
        return v.enabled ? `On · ${String(v.message || '').slice(0, 60)}` : 'Off'
      case 'contact_info':
        return `${v.email || ''}${v.phone ? ` · ${v.phone}` : ''}`
      case 'seasonal_offer':
        return v.enabled ? `On · ${v.title || ''} · ${v.discountPercent || 0}% until ${v.validUntil || '—'}` : 'Off'
      default:
        return ''
    }
  }

  return (
    <MoreShell title="Settings" subtitle="Platform configuration">
      {loading ? (
        <LoadingView text="Loading settings…" />
      ) : error || !data ? (
        <ErrorView message={error || 'Could not load settings'} onRetry={() => load()} />
      ) : (
        <ScrollView
          style={adminStyles.scroll}
          contentContainerStyle={adminStyles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true) }} />}
        >
          {!canEdit ? <Notice text="Read-only: saving settings needs the Owner role." /> : null}

          <SectionTitle>Platform status</SectionTitle>
          <Card>
            <ListRow title={data.platform.appName} subtitle={`${data.platform.baseUrl} · ${data.platform.environment || ''}`} />
            <ListRow title="Email" subtitle={data.platform.emailFrom || ''} right={<Pill text={data.platform.emailConfigured ? 'configured' : 'not configured'} tone={data.platform.emailConfigured ? 'ok' : 'warn'} />} />
            <ListRow title="File storage" right={<Pill text={data.platform.storageConfigured ? 'object storage' : 'local disk'} tone={data.platform.storageConfigured ? 'ok' : 'warn'} />} />
            <ListRow title="PayHere" right={<Pill text={data.platform.payhere.configured ? (data.platform.payhere.sandbox ? 'sandbox' : 'live') : 'not configured'} tone={data.platform.payhere.configured && !data.platform.payhere.sandbox ? 'ok' : 'warn'} />} />
            {data.platform.graceDays != null ? <ListRow title="Payment grace period" right={`${data.platform.graceDays} days`} /> : null}
          </Card>

          <SectionTitle>Editable settings</SectionTitle>
          <Card>
            {SECTIONS.map((s) => (
              <ListRow
                key={s.key}
                title={s.title}
                subtitle={`${summary(s.key)}${data.updatedAt?.[s.key] ? `\nSaved ${timeAgo(data.updatedAt[s.key])}` : ''}`}
                right={canEdit ? <LinkButton label="Edit" onPress={() => openSection(s)} /> : undefined}
                onPress={canEdit ? () => openSection(s) : undefined}
              />
            ))}
            <ListRow
              title="Volume discounts"
              subtitle={(data.settings?.volume_discounts?.tiers || []).map((t: any) => `${t.min}${t.max == null ? '+' : `–${t.max}`} businesses: ${t.percent}%`).join('\n') || 'No tiers'}
              right={canEdit ? <LinkButton label="Edit" onPress={openTiers} /> : undefined}
              onPress={canEdit ? openTiers : undefined}
            />
          </Card>

          <SectionTitle>File storage cleanup</SectionTitle>
          <Card style={{ padding: 14, gap: 8 }}>
            <Text style={adminStyles.muted}>Finds uploaded files that no record points to (left behind by deleted data) and can delete them. Scanning changes nothing.</Text>
            <Field label="Folder prefix (optional)" value={prefix} onChangeText={setPrefix} placeholder="receipts/" hint="Letters, digits and / _ . - only." />
            <Btn label="Scan for orphaned files" tone="ghost" busy={scanning} onPress={runScan} />
            {scanError ? <Notice tone="error" text={scanError} /> : null}
            {scan ? (
              <View style={{ gap: 4 }}>
                <Text style={adminStyles.muted}>
                  {scan.totalObjects} files · {scan.referencedObjects} in use · {scan.orphanedObjects} orphaned ({scan.referencesFound} references found)
                </Text>
                {Object.entries(scan.orphansByPrefix || {}).map(([k, n]) => (
                  <Text key={k} style={adminStyles.muted}>• {k}: {n}</Text>
                ))}
                {scan.orphanedObjects > 0 && canEdit ? <Btn label={`Delete ${scan.orphanedObjects} orphaned file(s)`} tone="danger" busy={cleaning} onPress={runCleanup} /> : null}
                {scan.orphanedObjects === 0 ? <Notice tone="ok" text="No orphaned files." /> : null}
                {scan.orphanedObjects > 0 && !canEdit ? <Notice text="Deleting needs the Owner role." /> : null}
              </View>
            ) : null}
          </Card>
        </ScrollView>
      )}

      <FormModal visible={!!editing} title={editing?.title || ''} message={editing?.description} confirmLabel="Save" busy={busy} onCancel={() => setEditing(null)} onConfirm={saveSection}>
        {editing?.fields.map((fd) => {
          if (fd.kind === 'bool') return <SwitchRow key={fd.key} label={fd.label} value={!!form[fd.key]} onValueChange={(v) => setForm((p) => ({ ...p, [fd.key]: v }))} />
          if (fd.kind === 'choice') return <Choice key={fd.key} label={fd.label} options={fd.options || []} value={String(form[fd.key] ?? '')} onChange={(v) => setForm((p) => ({ ...p, [fd.key]: v }))} />
          return (
            <Field
              key={fd.key}
              label={fd.label}
              value={String(form[fd.key] ?? '')}
              onChangeText={(v) => setForm((p) => ({ ...p, [fd.key]: v }))}
              multiline={fd.kind === 'multiline'}
              keyboardType={fd.kind === 'number' ? 'decimal-pad' : undefined}
              hint={fd.hint}
              placeholder={fd.placeholder}
              autoCapitalize={fd.kind === 'multiline' ? 'sentences' : 'none'}
            />
          )
        })}
        {formError ? <Notice tone="error" text={formError} /> : null}
      </FormModal>

      <FormModal visible={tiersOpen} title="Volume discounts" message="Discount for accounts with several businesses. Tiers must not overlap; only the last tier can be open-ended (blank max)." confirmLabel="Save" busy={busy} onCancel={() => setTiersOpen(false)} onConfirm={saveTiers}>
        {tierRows.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <Field style={{ flex: 1 }} label="From" value={r.min} keyboardType="number-pad" onChangeText={(v) => setTierRows((p) => p.map((x, j) => (j === i ? { ...x, min: v } : x)))} />
            <Field style={{ flex: 1 }} label="To" value={r.max} placeholder="open" keyboardType="number-pad" onChangeText={(v) => setTierRows((p) => p.map((x, j) => (j === i ? { ...x, max: v } : x)))} />
            <Field style={{ flex: 1 }} label="%" value={r.percent} keyboardType="decimal-pad" onChangeText={(v) => setTierRows((p) => p.map((x, j) => (j === i ? { ...x, percent: v } : x)))} />
            <View style={{ marginBottom: 14 }}>
              <LinkButton label="Remove" tone="danger" onPress={() => setTierRows((p) => p.filter((_, j) => j !== i))} />
            </View>
          </View>
        ))}
        <Btn label="+ Add tier" tone="ghost" onPress={() => setTierRows((p) => [...p, { min: p.length ? String((parseNum(p[p.length - 1].max) ?? 0) + 1) : '2', max: '', percent: '' }])} />
        {formError ? <View style={{ marginTop: 8 }}><Notice tone="error" text={formError} /></View> : null}
      </FormModal>
    </MoreShell>
  )
}
