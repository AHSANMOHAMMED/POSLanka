// Platform messaging accounts (SMS gateway + WhatsApp Business) and test sends.
// GET/PUT /api/sys-control/messaging (PUT needs `settings`), POST messaging/test.
// Secrets are never returned by the server (only set + last 4 characters): a blank field keeps
// the saved secret, a typed value replaces it, "Clear" removes it.
import React, { useCallback, useEffect, useState } from 'react'
import { View, Text, ScrollView, RefreshControl, Alert } from 'react-native'
import { adminGet, adminPost, adminPut, useAdminUser } from '../../src/lib/adminApi'
import { ErrorView, LoadingView } from '../../src/components/StateViews'
import { Card, ListRow, Pill, SectionTitle, adminStyles, timeAgo } from '../../src/components/admin/AdminShell'
import { Btn, Choice, Field, LinkButton, MoreShell, Notice, SwitchRow } from '../../src/components/admin/AdminForm'
import { alertIfFailed, confirmAction } from '../../src/lib/adminForms'

type Provider = 'none' | 'notify_lk' | 'text_lk' | 'websms_lk' | 'twilio' | 'generic_http'
interface FieldSpec { path: string; label: string; secret?: boolean; hint?: string; placeholder?: string }

const PROVIDERS: Array<{ value: Provider; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'notify_lk', label: 'Notify.lk' },
  { value: 'text_lk', label: 'Text.lk' },
  { value: 'websms_lk', label: 'WebSMS.lk' },
  { value: 'twilio', label: 'Twilio' },
  { value: 'generic_http', label: 'Custom HTTPS' },
]

const SMS_FIELDS: Record<Exclude<Provider, 'none'>, FieldSpec[]> = {
  notify_lk: [
    { path: 'sms.notify_lk.userId', label: 'User ID' },
    { path: 'sms.notify_lk.apiKey', label: 'API key', secret: true },
    { path: 'sms.notify_lk.senderId', label: 'Sender ID', hint: 'At most 11 characters.' },
  ],
  text_lk: [
    { path: 'sms.text_lk.apiToken', label: 'API token', secret: true },
    { path: 'sms.text_lk.senderId', label: 'Sender ID', hint: 'At most 11 characters.' },
  ],
  websms_lk: [
    { path: 'sms.websms_lk.apiKey', label: 'API key', secret: true },
    { path: 'sms.websms_lk.apiToken', label: 'API token', secret: true },
    { path: 'sms.websms_lk.senderId', label: 'Sender ID', hint: 'At most 11 characters.' },
  ],
  twilio: [
    { path: 'sms.twilio.accountSid', label: 'Account SID' },
    { path: 'sms.twilio.authToken', label: 'Auth token', secret: true },
    { path: 'sms.twilio.fromNumber', label: 'From number', placeholder: '+1555…' },
  ],
  generic_http: [
    { path: 'sms.generic_http.url', label: 'Gateway URL (https://)', placeholder: 'https://sms.example.com/send' },
    { path: 'sms.generic_http.recipientParam', label: 'Recipient parameter', placeholder: 'to' },
    { path: 'sms.generic_http.messageParam', label: 'Message parameter', placeholder: 'text' },
    { path: 'sms.generic_http.senderParam', label: 'Sender parameter (optional)' },
    { path: 'sms.generic_http.senderId', label: 'Sender ID (optional)' },
    { path: 'sms.generic_http.apiKeyParam', label: 'API key parameter (optional)' },
    { path: 'sms.generic_http.apiKey', label: 'API key', secret: true },
    { path: 'sms.generic_http.successMatch', label: 'Success text match (optional)' },
  ],
}

const WA_FIELDS: FieldSpec[] = [
  { path: 'whatsapp.phoneNumberId', label: 'Phone number ID', hint: 'Digits only, from WhatsApp Manager.' },
  { path: 'whatsapp.businessAccountId', label: 'Business account ID', hint: 'Digits only.' },
  { path: 'whatsapp.accessToken', label: 'Access token', secret: true },
  { path: 'whatsapp.apiVersion', label: 'API version', placeholder: 'v21.0' },
  { path: 'whatsapp.templateNamespace', label: 'Template namespace (optional)' },
  { path: 'whatsapp.templateLanguage', label: 'Template language', placeholder: 'en' },
]

function getPath(o: any, path: string): any {
  return path.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o)
}
function setPath(o: any, path: string, v: unknown) {
  const keys = path.split('.')
  let cur = o
  for (const k of keys.slice(0, -1)) cur = cur[k] = cur[k] && typeof cur[k] === 'object' ? cur[k] : {}
  cur[keys[keys.length - 1]] = v
}

interface MessagingData {
  config: any
  secrets: Record<string, { set: boolean; hint: string }>
  updatedAt?: string | null
  status: { sms: boolean; whatsapp: boolean }
  vendors: Array<{ tenantId: string; name: string; slug: string; businessId: string; plan: { smsEnabled: boolean; whatsappEnabled: boolean; smsCredits: number; whatsappCredits: number; billingMode: string } }>
}

export default function AdminMessagingScreen() {
  const { can } = useAdminUser()
  const canEdit = can('settings')
  const [data, setData] = useState<MessagingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider>('none')
  const [values, setValues] = useState<Record<string, string>>({})
  const [method, setMethod] = useState<'GET' | 'POST'>('POST')
  const [waEnabled, setWaEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [testChannel, setTestChannel] = useState<'sms' | 'whatsapp'>('sms')
  const [testTo, setTestTo] = useState('')
  const [testText, setTestText] = useState('')
  const [helloWorld, setHelloWorld] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const hydrate = useCallback((d: MessagingData) => {
    setData(d)
    setProvider((d.config?.sms?.provider as Provider) || 'none')
    setMethod(d.config?.sms?.generic_http?.method === 'GET' ? 'GET' : 'POST')
    setWaEnabled(!!d.config?.whatsapp?.enabled)
    const next: Record<string, string> = {}
    for (const f of [...Object.values(SMS_FIELDS).flat(), ...WA_FIELDS]) if (!f.secret) next[f.path] = String(getPath(d.config, f.path) ?? '')
    setValues(next)
  }, [])

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError(null)
      const res = await adminGet<MessagingData>('/api/sys-control/messaging')
      if (res.ok) hydrate(res.data)
      else setError(res.error)
      setLoading(false)
      setRefreshing(false)
    },
    [hydrate]
  )

  useEffect(() => {
    load()
  }, [load])

  const setVal = (path: string, v: string) => setValues((prev) => ({ ...prev, [path]: v }))

  function renderFields(specs: FieldSpec[]) {
    return specs.map((f) => {
      if (!f.secret) return <Field key={f.path} label={f.label} value={values[f.path] ?? ''} onChangeText={(v) => setVal(f.path, v)} hint={f.hint} placeholder={f.placeholder} editable={canEdit} />
      const s = data?.secrets?.[f.path]
      return (
        <View key={f.path}>
          <Field
            label={f.label}
            value={values[f.path] ?? ''}
            onChangeText={(v) => setVal(f.path, v)}
            secureTextEntry
            editable={canEdit}
            placeholder={s?.set ? 'Saved — leave blank to keep' : 'Not set'}
            hint={s?.set ? `Saved (${s.hint || '••••'})` : undefined}
          />
          {s?.set && canEdit ? (
            <View style={{ alignItems: 'flex-end', marginTop: -6, marginBottom: 6 }}>
              <LinkButton label="Clear saved value" tone="danger" onPress={() => confirmAction('Clear secret?', `${f.label} will be removed from the server.`, 'Clear', () => clearSecret(f.path), true)} />
            </View>
          ) : null}
        </View>
      )
    })
  }

  async function clearSecret(path: string) {
    const res = await adminPut<MessagingData>('/api/sys-control/messaging', { clearSecrets: [path] })
    if (alertIfFailed(res, 'Could not clear')) {
      setValues((p) => ({ ...p, [path]: '' }))
      load(true)
    }
  }

  async function save() {
    const patch: any = { sms: { provider }, whatsapp: { enabled: waEnabled } }
    if (provider !== 'none') {
      for (const f of SMS_FIELDS[provider]) {
        const v = (values[f.path] ?? '').trim()
        if (f.secret) {
          if (v) setPath(patch, f.path, v)
        } else {
          if (f.path.endsWith('senderId') && v.length > 11) return setFormError('A sender ID is at most 11 characters.')
          if (f.path.endsWith('.url') && v && !/^https:\/\//i.test(v)) return setFormError('The gateway address must start with https://')
          setPath(patch, f.path, v)
        }
      }
      if (provider === 'generic_http') patch.sms.generic_http.method = method
    }
    for (const f of WA_FIELDS) {
      const v = (values[f.path] ?? '').trim()
      if (f.secret) {
        if (v) setPath(patch, f.path, v)
        continue
      }
      if (f.path.endsWith('phoneNumberId') && v && !/^\d{1,30}$/.test(v)) return setFormError('The WhatsApp phone number ID is digits only.')
      if (f.path.endsWith('businessAccountId') && v && !/^\d{1,30}$/.test(v)) return setFormError('The WhatsApp business account ID is digits only.')
      if (f.path.endsWith('apiVersion') && v && !/^v\d{1,2}\.\d$/.test(v)) return setFormError('API version looks like v21.0.')
      if (f.path.endsWith('templateLanguage') && v && !/^[a-z]{2}(_[A-Z]{2})?$/.test(v)) return setFormError('Template language looks like en or en_US.')
      setPath(patch, f.path, v)
    }
    setFormError(null)
    setSaving(true)
    const res = await adminPut<MessagingData & { changed?: string[] }>('/api/sys-control/messaging', patch)
    setSaving(false)
    if (!alertIfFailed(res, 'Could not save')) return
    // The PUT response omits the vendor list; keep the one from the last load
    hydrate({ ...(res.data as MessagingData), vendors: (res.data as any).vendors ?? data?.vendors ?? [] })
    setValues((p) => {
      const n = { ...p }
      for (const f of [...Object.values(SMS_FIELDS).flat(), ...WA_FIELDS]) if (f.secret) delete n[f.path]
      return n
    })
    const changed = (res.data as any).changed?.length ?? 0
    Alert.alert('Saved', changed ? `${changed} setting(s) updated.` : 'Nothing changed.')
  }

  async function runTest() {
    const to = testTo.trim()
    if (to.replace(/\D/g, '').length < 7) return setTestResult({ ok: false, message: 'Enter a valid mobile number.' })
    setTesting(true)
    setTestResult(null)
    const res = await adminPost<{ ok: boolean; code?: string; error?: string; messageId?: string }>('/api/sys-control/messaging/test', {
      channel: testChannel,
      to,
      ...(testText.trim() ? { text: testText.trim() } : {}),
      ...(testChannel === 'whatsapp' && helloWorld ? { useHelloWorld: true } : {}),
    })
    setTesting(false)
    // The test route answers { ok:false, error } with 400 for provider problems; show both
    const body: any = res.data
    if (res.ok && body?.ok) setTestResult({ ok: true, message: `Sent${body.messageId ? ` (${body.messageId})` : ''}.` })
    else setTestResult({ ok: false, message: body?.error || res.error || 'The test failed.' + (body?.code ? ` [${body.code}]` : '') })
  }

  return (
    <MoreShell title="Platform messaging" subtitle="SMS gateway & WhatsApp Business">
      {loading ? (
        <LoadingView text="Loading messaging settings…" />
      ) : error || !data ? (
        <ErrorView message={error || 'Could not load'} onRetry={() => load()} />
      ) : (
        <ScrollView
          style={adminStyles.scroll}
          contentContainerStyle={adminStyles.content}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true) }} />}
        >
          {!canEdit ? <Notice text="Read-only: editing providers needs the Owner role (settings)." /> : null}

          <Card style={{ padding: 14, gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Pill text={data.status.sms ? 'SMS ready' : 'SMS not set up'} tone={data.status.sms ? 'ok' : 'muted'} />
              <Pill text={data.status.whatsapp ? 'WhatsApp ready' : 'WhatsApp off'} tone={data.status.whatsapp ? 'ok' : 'muted'} />
            </View>
            {data.updatedAt ? <Text style={adminStyles.muted}>Last saved {timeAgo(data.updatedAt)}</Text> : null}
          </Card>

          <SectionTitle>SMS provider</SectionTitle>
          <Card style={{ padding: 14 }}>
            <Choice value={provider} onChange={setProvider} options={PROVIDERS} disabled={!canEdit} />
            {provider !== 'none' ? renderFields(SMS_FIELDS[provider]) : <Text style={adminStyles.muted}>Choose a provider to configure SMS.</Text>}
            {provider === 'generic_http' ? <Choice label="HTTP method" value={method} onChange={setMethod} options={[{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }]} disabled={!canEdit} /> : null}
            {provider === 'generic_http' ? <Text style={adminStyles.muted}>Extra fixed parameters are edited on the web console.</Text> : null}
          </Card>

          <SectionTitle>WhatsApp Business</SectionTitle>
          <Card style={{ padding: 14 }}>
            <SwitchRow label="Enabled" value={waEnabled} onValueChange={setWaEnabled} disabled={!canEdit} />
            {renderFields(WA_FIELDS)}
            <Text style={adminStyles.muted}>Per-purpose template names are edited on the web console.</Text>
          </Card>

          {formError ? <Notice tone="error" text={formError} /> : null}
          {canEdit ? <Btn label="Save settings" busy={saving} onPress={save} /> : null}

          <SectionTitle>Test send</SectionTitle>
          <Card style={{ padding: 14 }}>
            <Choice value={testChannel} onChange={setTestChannel} options={[{ value: 'sms', label: 'SMS' }, { value: 'whatsapp', label: 'WhatsApp' }]} />
            <Field label="Mobile number" value={testTo} onChangeText={setTestTo} keyboardType="phone-pad" placeholder="+94771234567" />
            <Field label="Text (optional)" value={testText} onChangeText={setTestText} maxLength={300} autoCapitalize="sentences" />
            {testChannel === 'whatsapp' ? <SwitchRow label="Use hello_world template" hint="Works outside the 24-hour window." value={helloWorld} onValueChange={setHelloWorld} /> : null}
            {testResult ? <Notice tone={testResult.ok ? 'ok' : 'error'} text={testResult.message} /> : null}
            <Btn label="Send test message" tone="ghost" style={{ marginTop: 10 }} busy={testing} disabled={!canEdit} onPress={runTest} />
            <Text style={[adminStyles.muted, { marginTop: 6 }]}>Uses the saved account; nothing is charged to any vendor. Save changes first.</Text>
          </Card>

          <SectionTitle>Vendors with a messaging plan ({data.vendors?.length ?? 0})</SectionTitle>
          <Card>
            {(data.vendors || []).map((v) => (
              <ListRow
                key={v.tenantId}
                title={v.name}
                subtitle={`${v.businessId} · ${v.plan.billingMode === 'monthly_quota' ? 'monthly quota' : 'prepaid'}\nSMS ${v.plan.smsEnabled ? `on (${v.plan.smsCredits})` : 'off'} · WhatsApp ${v.plan.whatsappEnabled ? `on (${v.plan.whatsappCredits})` : 'off'}`}
              />
            ))}
            {(data.vendors || []).length === 0 ? <Text style={adminStyles.empty}>No vendor has a messaging plan.</Text> : null}
          </Card>
        </ScrollView>
      )}
    </MoreShell>
  )
}
