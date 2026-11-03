// Compose + preview + send a platform broadcast (notification or email) to a vendor audience.
// Used by notifications.tsx and send-email.tsx. POSTs to notifications / send-email; `dryRun`
// returns recipient counts only. Requires the `notifications` permission.
import React, { useState } from 'react'
import { View, Text, Alert } from 'react-native'
import { adminPost } from '../../lib/adminApi'
import { THEME } from '../../lib/theme'
import { Btn, Choice, Field, MultiChoice, Notice, SwitchRow } from './AdminForm'
import { adminStyles } from './AdminShell'
import { alertIfFailed, confirmAction } from '../../lib/adminForms'

export type BroadcastKind = 'notification' | 'email'
type Mode = 'all' | 'filtered' | 'selected' | 'addresses'
type Channel = 'in_app' | 'account' | 'email' | 'push'
type Category = 'info' | 'maintenance' | 'billing' | 'feature' | 'warning'

export interface AudienceTier { id: string; displayName: string; isActive?: boolean }

interface Preview {
  vendorCount: number
  userCount: number
  accountCount: number
  emailCount: number
  pushUserCount: number
  pushDeviceCount: number
  unknownBusinessIds: string[]
  tooLarge: string | null
}

const CHANNELS: Array<{ value: Channel; label: string }> = [
  { value: 'in_app', label: 'Vendor app inbox' },
  { value: 'account', label: 'Account portal' },
  { value: 'email', label: 'Email' },
  { value: 'push', label: 'Phone push' },
]
const CATEGORIES: Category[] = ['info', 'maintenance', 'billing', 'feature', 'warning']
const SUB_STATUSES = ['trial', 'active', 'past_due', 'locked', 'cancelled'] as const

const splitList = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)

export function BroadcastForm({ kind, tiers, canSend, onSent }: { kind: BroadcastKind; tiers: AudienceTier[]; canSend: boolean; onSent: () => void }) {
  const isEmail = kind === 'email'
  const [mode, setMode] = useState<Mode>('all')
  const [tierIds, setTierIds] = useState<string[]>([])
  const [subStatuses, setSubStatuses] = useState<Array<(typeof SUB_STATUSES)[number]>>([])
  const [businessIds, setBusinessIds] = useState('')
  const [addresses, setAddresses] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [titleSi, setTitleSi] = useState('')
  const [bodySi, setBodySi] = useState('')
  const [titleTa, setTitleTa] = useState('')
  const [bodyTa, setBodyTa] = useState('')
  const [showOnLogin, setShowOnLogin] = useState(!isEmail)
  const [link, setLink] = useState('')
  const [category, setCategory] = useState<Category>('info')
  const [channels, setChannels] = useState<Channel[]>(['in_app'])
  const [allStaff, setAllStaff] = useState(false)
  const [pushAllStaff, setPushAllStaff] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)

  function build(dryRun: boolean): Record<string, unknown> | null {
    const t = title.trim()
    const b = body.trim()
    if (t.length < 3) return fail(`Enter a ${isEmail ? 'subject' : 'title'} of at least 3 characters.`)
    if (b.length < 5) return fail('Enter a message of at least 5 characters.')
    if (link.trim() && !/^\/(?!\/)/.test(link.trim()) && !/^https:\/\/\S+$/.test(link.trim())) return fail('The link must be a path like /account/billing or an https:// address.')
    const audience: Record<string, unknown> = { mode }
    if (mode === 'filtered') {
      if (tierIds.length) audience.tierIds = tierIds
      if (subStatuses.length) audience.subscriptionStatuses = subStatuses
    }
    if (mode === 'selected') {
      const ids = splitList(businessIds)
      if (!ids.length) return fail('Enter at least one Business ID.')
      audience.businessIds = ids
    }
    if (mode === 'addresses') {
      const list = splitList(addresses)
      if (!list.length) return fail('Enter at least one email address.')
      if (list.some((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))) return fail('One of the email addresses looks invalid.')
      audience.addresses = list
    }
    const payload: Record<string, unknown> = {
      [isEmail ? 'subject' : 'title']: t,
      body: b,
      category,
      audience,
      recipientScope: allStaff ? 'all_staff' : 'owners',
      translations: {
        en: { title: t, body: b },
        ...(titleSi.trim() || bodySi.trim() ? { si: { title: titleSi.trim(), body: bodySi.trim() } } : {}),
        ...(titleTa.trim() || bodyTa.trim() ? { ta: { title: titleTa.trim(), body: bodyTa.trim() } } : {}),
      },
      showOnLogin: !isEmail && showOnLogin,
    }
    if (link.trim()) payload.link = link.trim()
    if (!isEmail) {
      if (!channels.length) return fail('Choose at least one channel.')
      payload.channels = channels
      payload.pushScope = pushAllStaff ? 'all_staff' : 'owners_managers'
    }
    if (dryRun) payload.dryRun = true
    setError(null)
    return payload
  }

  function fail(msg: string): null {
    setError(msg)
    return null
  }

  const path = isEmail ? '/api/sys-control/send-email' : '/api/sys-control/notifications'

  async function runPreview() {
    const payload = build(true)
    if (!payload) return
    setBusy('preview')
    const res = await adminPost<{ preview: Preview }>(path, payload)
    setBusy(null)
    if (!alertIfFailed(res, 'Preview failed')) return
    setPreview(res.data.preview)
  }

  function send() {
    const payload = build(false)
    if (!payload) return
    confirmAction(isEmail ? 'Send email?' : 'Send notification?', 'This goes to real vendors immediately and cannot be recalled.', 'Send', async () => {
      setBusy('send')
      const res = await adminPost<{ result: any }>(path, payload)
      setBusy(null)
      if (!alertIfFailed(res, 'Send failed')) return
      const r = res.data?.result || {}
      setTitle('')
      setBody('')
      setTitleSi('')
      setBodySi('')
      setTitleTa('')
      setBodyTa('')
      setLink('')
      setPreview(null)
      Alert.alert(
        'Sent',
        `${r.vendorCount ?? 0} vendor(s)${r.emailSent != null ? ` · ${r.emailSent} email(s) sent` : ''}${r.inAppCount ? ` · ${r.inAppCount} in-app` : ''}${r.pushSent ? ` · ${r.pushSent} push` : ''}.`
      )
      onSent()
    })
  }

  const modes: Array<{ value: Mode; label: string }> = [
    { value: 'all', label: 'All vendors' },
    { value: 'filtered', label: 'By plan / status' },
    { value: 'selected', label: 'Business IDs' },
    ...(isEmail ? [{ value: 'addresses' as Mode, label: 'Email addresses' }] : []),
  ]

  return (
    <View>
      {!canSend ? <Notice tone="warn" text="Sending needs the Support or Owner role." /> : null}

      <Choice label="Audience" value={mode} onChange={(m) => { setMode(m); setPreview(null) }} options={modes} />
      {mode === 'filtered' ? (
        <>
          <MultiChoice label="Plans (blank = any)" values={tierIds} onChange={(v) => setTierIds(v)} options={tiers.map((t) => ({ value: t.id, label: t.displayName }))} />
          <MultiChoice label="Subscription status (blank = any)" values={subStatuses} onChange={(v) => setSubStatuses(v)} options={SUB_STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }))} />
        </>
      ) : null}
      {mode === 'selected' ? <Field label="Business IDs" value={businessIds} onChangeText={setBusinessIds} multiline placeholder="PL-123456, PL-234567" hint="Separate with commas, spaces or new lines." /> : null}
      {mode === 'addresses' ? <Field label="Email addresses" value={addresses} onChangeText={setAddresses} multiline placeholder="a@example.com, b@example.com" keyboardType="email-address" hint="Up to 1000 addresses." /> : null}

      <Field label={isEmail ? 'Subject (English) *' : 'Title (English) *'} value={title} onChangeText={setTitle} autoCapitalize="sentences" maxLength={200} />
      <Field label="Message (English) *" value={body} onChangeText={setBody} multiline autoCapitalize="sentences" maxLength={5000} />
      <Field label="Title (සිංහල, optional)" value={titleSi} onChangeText={setTitleSi} maxLength={200} />
      <Field label="Message (සිංහල, optional)" value={bodySi} onChangeText={setBodySi} multiline maxLength={5000} />
      <Field label="Title (தமிழ், optional)" value={titleTa} onChangeText={setTitleTa} maxLength={200} />
      <Field label="Message (தமிழ், optional)" value={bodyTa} onChangeText={setBodyTa} multiline maxLength={5000} />
      <Field label="Link (optional)" value={link} onChangeText={setLink} placeholder="/account/billing or https://…" />
      <Choice label="Category" value={category} onChange={(v) => setCategory(v)} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
      {!isEmail ? <MultiChoice label="Channels" values={channels} onChange={(v) => setChannels(v)} options={CHANNELS} /> : null}
      {!isEmail ? <SwitchRow label="Show on vendor login" hint="Also appear on company sign-in screens." value={showOnLogin} onValueChange={setShowOnLogin} /> : null}
      {mode !== 'addresses' ? <SwitchRow label="Send to all staff" hint="Off = vendor owners only." value={allStaff} onValueChange={setAllStaff} /> : null}
      {!isEmail && channels.includes('push') ? <SwitchRow label="Push to all staff" hint="Off = owners and managers only." value={pushAllStaff} onValueChange={setPushAllStaff} /> : null}

      {error ? <Notice tone="error" text={error} /> : null}
      {preview ? (
        <View style={{ marginTop: 8 }}>
          <Notice
            tone={preview.tooLarge ? 'warn' : 'ok'}
            text={
              preview.tooLarge ||
              `${preview.vendorCount} vendor(s) · ${preview.userCount} user(s) · ${preview.accountCount} account(s) · ${preview.emailCount} email(s)` +
                (!isEmail && channels.includes('push') ? ` · ${preview.pushDeviceCount} phone(s)` : '') +
                (preview.unknownBusinessIds?.length ? `\nUnknown IDs: ${preview.unknownBusinessIds.join(', ')}` : '')
            }
          />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Btn label="Preview audience" tone="ghost" style={{ flex: 1 }} busy={busy === 'preview'} disabled={!canSend || busy === 'send'} onPress={runPreview} />
        <Btn label="Send" style={{ flex: 1 }} busy={busy === 'send'} disabled={!canSend || busy === 'preview'} onPress={send} />
      </View>
      <Text style={[adminStyles.muted, { marginTop: 8, color: THEME.colors.textMuted }]}>Audited. Messages cannot be recalled once sent.</Text>
    </View>
  )
}
