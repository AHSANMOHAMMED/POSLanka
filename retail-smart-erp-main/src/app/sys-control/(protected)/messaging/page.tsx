'use client'

import { useCallback, useEffect, useState } from 'react'
import { MessageCircle, MessageSquare, Send, Users } from 'lucide-react'
import {
  AdminCard,
  AdminPage,
  AdminTable,
  Alert,
  Badge,
  Button,
  Field,
  Input,
  PasswordInput,
  Select,
  Skeleton,
  Switch,
  fmtDateTime,
  fmtNumber,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { adminFetch } from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'
import { MESSAGE_PURPOSES, PURPOSE_LABELS, WHATSAPP_TEMPLATE_PARAMS } from '@/lib/messaging/templates'
import type { MaskedPlatformConfig, PlatformMessagingConfig, SecretPath } from '@/lib/messaging/platform-config'

type Payload = Omit<MaskedPlatformConfig, 'updatedAt'> & {
  updatedAt: string | null
  vendors: Array<{ tenantId: string; name: string; businessId: string; plan: VendorPlan }>
}
interface VendorPlan {
  smsEnabled: boolean; whatsappEnabled: boolean; useOwnSmsProvider: boolean; billingMode: string
  smsCredits: number; whatsappCredits: number; smsMonthlyQuota: number; whatsappMonthlyQuota: number
  smsUsedThisMonth: number; whatsappUsedThisMonth: number; expiresAt: string | null
}
type Sms = PlatformMessagingConfig['sms']
type Wa = PlatformMessagingConfig['whatsapp']
type Msg = { tone: 'success' | 'danger'; text: string } | null

const PROVIDERS: Array<{ value: Sms['provider']; label: string; hint: string }> = [
  { value: 'none', label: 'Not set up', hint: '' },
  { value: 'notify_lk', label: 'Notify.lk', hint: 'app.notify.lk → Settings → API Keys: User ID and API Key. Sender ID = your approved mask (NotifyDEMO until one is approved).' },
  { value: 'text_lk', label: 'Text.lk', hint: 'app.text.lk → Developers → API token (Bearer). Sender ID = your approved mask.' },
  { value: 'websms_lk', label: 'WebSMS.lk / Newsletters.lk', hint: 'Account → API: API key and API token. Sender ID = your approved mask.' },
  { value: 'twilio', label: 'Twilio', hint: 'Console → Account SID and Auth Token; From = a Twilio number or alphanumeric sender.' },
  { value: 'generic_http', label: 'Other HTTP gateway', hint: 'Any gateway with an HTTP API (Dialog / Mobitel / Hutch enterprise APIs via an aggregator).' },
]

export default function MessagingSettingsPage() {
  const canEdit = useAdminCan('settings')
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => adminFetch<Payload>('/api/sys-control/messaging').then((d) => { setData(d); setError(null) }).catch((e) => setError(e.message)), [])
  useEffect(() => { void load() }, [load])

  return (
    <AdminPage
      title="SMS & WhatsApp"
      description="The platform’s SMS gateway and WhatsApp Business number. Vendors with a messaging plan send through these; manage each vendor’s plan on the vendor page → Messaging."
    >
      {error && <Alert tone="danger" title="Could not load" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>}
      {!data && !error && <Skeleton className="h-64 w-full rounded-xl" />}
      {data && (
        <>
          <SmsCard key={`sms-${data.updatedAt}`} data={data} canEdit={canEdit} onSaved={setData} />
          <WhatsAppCard key={`wa-${data.updatedAt}`} data={data} canEdit={canEdit} onSaved={setData} />
          <VendorsCard vendors={data.vendors} />
        </>
      )}
    </AdminPage>
  )
}

/* ------------------------------------------------------------------ shared bits */

function SecretField({ path, label, value, onChange, secrets, clear, onClear, hint }: {
  path: SecretPath; label: string; value: string; onChange: (v: string) => void
  secrets: Payload['secrets']; clear: SecretPath[]; onClear: (p: SecretPath, on: boolean) => void; hint?: string
}) {
  const s = secrets[path]
  const removing = clear.includes(path)
  return (
    <Field
      label={label}
      htmlFor={path}
      hint={removing ? 'Will be removed when you save' : s.set ? `Saved (${s.hint}). Leave blank to keep it.` : hint ?? 'Not saved yet'}
      labelAside={s.set ? <button type="button" className="text-[12px] text-adm-danger hover:underline" onClick={() => onClear(path, !removing)}>{removing ? 'Keep' : 'Remove'}</button> : undefined}
    >
      <PasswordInput id={path} value={value} autoComplete="off" placeholder={s.set ? s.hint : ''} onChange={(e) => onChange(e.target.value)} disabled={removing} />
    </Field>
  )
}

async function save(body: unknown): Promise<Payload> {
  return adminFetch<Payload>('/api/sys-control/messaging', { method: 'PUT', json: body })
}

function TestSend({ channel, ready }: { channel: 'sms' | 'whatsapp'; ready: boolean }) {
  const can = useAdminCan('settings')
  const [to, setTo] = useState('')
  const [hello, setHello] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  async function run() {
    setBusy(true); setMsg(null)
    try {
      const r = await adminFetch<{ ok: boolean; code: string; error?: string; messageId?: string }>('/api/sys-control/messaging/test', { method: 'POST', json: { channel, to, useHelloWorld: channel === 'whatsapp' ? hello : undefined } })
      setMsg(r.ok ? { tone: 'success', text: `Sent${r.messageId ? ` (id ${r.messageId})` : ''}. Check the phone.` } : { tone: 'danger', text: `${r.code}: ${r.error ?? 'failed'}` })
    } catch (e) {
      setMsg({ tone: 'danger', text: (e as Error).message })
    } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2 rounded-lg border border-adm-border p-3">
      <p className="text-[13px] font-medium text-adm-fg">Send a test {channel === 'sms' ? 'SMS' : 'WhatsApp message'}</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Mobile number" htmlFor={`test-${channel}`} className="w-full sm:w-64">
          <Input id={`test-${channel}`} value={to} inputMode="tel" placeholder="077 123 4567" onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button icon={Send} loading={busy} disabled={!can || !ready || to.trim().length < 9} title={ready ? undefined : 'Save the settings first'} onClick={run}>Send test</Button>
      </div>
      {channel === 'whatsapp' && (
        <Switch checked={hello} onChange={setHello} label="Use the hello_world template" description="Works for any number. Plain text only reaches numbers that messaged your WhatsApp number in the last 24 hours." />
      )}
      {!ready && <p className="text-[12.5px] text-adm-subtle">Fill in and save the required fields to enable the test.</p>}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  )
}

/* ------------------------------------------------------------------ SMS */

function SmsCard({ data, canEdit, onSaved }: { data: Payload; canEdit: boolean; onSaved: (d: Payload) => void }) {
  const [v, setV] = useState<Sms>(data.config.sms)
  const [clear, setClear] = useState<SecretPath[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const set = <K extends keyof Sms>(k: K, patch: Partial<Sms[K]> | Sms[K]) =>
    setV((s) => ({ ...s, [k]: typeof patch === 'object' && patch !== null && !Array.isArray(patch) ? { ...(s[k] as object), ...patch } : patch }))
  const onClear = (p: SecretPath, on: boolean) => setClear((c) => (on ? [...c, p] : c.filter((x) => x !== p)))
  const secretProps = { secrets: data.secrets, clear, onClear }
  const provider = PROVIDERS.find((p) => p.value === v.provider)!

  async function submit() {
    setBusy(true); setMsg(null)
    try {
      const next = await save({ sms: v, clearSecrets: clear.filter((p) => p.startsWith('sms.')) })
      onSaved(next)
      setMsg({ tone: 'success', text: 'Saved' })
    } catch (e) { setMsg({ tone: 'danger', text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <AdminCard
      title="SMS gateway"
      icon={<MessageSquare size={17} />}
      description="The SMS account vendors’ messages go through (unless a vendor uses their own gateway). Messages are sent from the vendor’s own approved mask when set, otherwise from the sender ID below."
      actions={data.status.sms ? <Badge tone="success" dot>Ready</Badge> : <Badge tone="warning" dot>Not ready</Badge>}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-adm-subtle">{msg ? <span className={msg.tone === 'success' ? 'text-adm-success' : 'text-adm-danger'}>{msg.text}</span> : data.updatedAt ? `Last saved ${fmtDateTime(data.updatedAt)}` : 'Not saved yet'}</span>
          <Button variant="primary" size="sm" loading={busy} disabled={!canEdit} onClick={submit}>Save SMS settings</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Provider" htmlFor="sms-provider" hint={provider.hint}>
          <Select id="sms-provider" value={v.provider} onChange={(e) => setV((s) => ({ ...s, provider: e.target.value as Sms['provider'] }))}>
            {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </Field>

        {v.provider === 'notify_lk' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="User ID" htmlFor="nl-user"><Input id="nl-user" value={v.notify_lk.userId} onChange={(e) => set('notify_lk', { userId: e.target.value })} /></Field>
            <SecretField path="sms.notify_lk.apiKey" label="API key" value={v.notify_lk.apiKey} onChange={(x) => set('notify_lk', { apiKey: x })} {...secretProps} />
            <Field label="Sender ID (mask)" htmlFor="nl-sender" hint="Max 11 characters"><Input id="nl-sender" maxLength={11} value={v.notify_lk.senderId} onChange={(e) => set('notify_lk', { senderId: e.target.value })} /></Field>
          </div>
        )}
        {v.provider === 'text_lk' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SecretField path="sms.text_lk.apiToken" label="API token" value={v.text_lk.apiToken} onChange={(x) => set('text_lk', { apiToken: x })} {...secretProps} />
            <Field label="Sender ID (mask)" htmlFor="tl-sender" hint="Max 11 characters"><Input id="tl-sender" maxLength={11} value={v.text_lk.senderId} onChange={(e) => set('text_lk', { senderId: e.target.value })} /></Field>
          </div>
        )}
        {v.provider === 'websms_lk' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SecretField path="sms.websms_lk.apiKey" label="API key" value={v.websms_lk.apiKey} onChange={(x) => set('websms_lk', { apiKey: x })} {...secretProps} />
            <SecretField path="sms.websms_lk.apiToken" label="API token" value={v.websms_lk.apiToken} onChange={(x) => set('websms_lk', { apiToken: x })} {...secretProps} />
            <Field label="Sender ID (mask)" htmlFor="ws-sender" hint="Max 11 characters"><Input id="ws-sender" maxLength={11} value={v.websms_lk.senderId} onChange={(e) => set('websms_lk', { senderId: e.target.value })} /></Field>
          </div>
        )}
        {v.provider === 'twilio' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Account SID" htmlFor="tw-sid"><Input id="tw-sid" className="font-mono" value={v.twilio.accountSid} onChange={(e) => set('twilio', { accountSid: e.target.value })} /></Field>
            <SecretField path="sms.twilio.authToken" label="Auth token" value={v.twilio.authToken} onChange={(x) => set('twilio', { authToken: x })} {...secretProps} />
            <Field label="From" htmlFor="tw-from" hint="+1… number or sender name"><Input id="tw-from" value={v.twilio.fromNumber} onChange={(e) => set('twilio', { fromNumber: e.target.value })} /></Field>
          </div>
        )}
        {v.provider === 'generic_http' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Gateway URL" htmlFor="g-url" hint="https:// only" className="sm:col-span-2"><Input id="g-url" value={v.generic_http.url} onChange={(e) => set('generic_http', { url: e.target.value })} placeholder="https://gateway.example.lk/send" /></Field>
            <Field label="Method" htmlFor="g-method"><Select id="g-method" value={v.generic_http.method} onChange={(e) => set('generic_http', { method: e.target.value as 'GET' | 'POST' })}><option>POST</option><option>GET</option></Select></Field>
            <Field label="Success text in the response" htmlFor="g-ok" hint="Optional; otherwise any 2xx without “error”"><Input id="g-ok" value={v.generic_http.successMatch} onChange={(e) => set('generic_http', { successMatch: e.target.value })} /></Field>
            <Field label="Recipient parameter" htmlFor="g-to"><Input id="g-to" value={v.generic_http.recipientParam} onChange={(e) => set('generic_http', { recipientParam: e.target.value })} /></Field>
            <Field label="Message parameter" htmlFor="g-msg"><Input id="g-msg" value={v.generic_http.messageParam} onChange={(e) => set('generic_http', { messageParam: e.target.value })} /></Field>
            <Field label="Sender parameter" htmlFor="g-sp" hint="Optional"><Input id="g-sp" value={v.generic_http.senderParam} onChange={(e) => set('generic_http', { senderParam: e.target.value })} /></Field>
            <Field label="Sender ID (mask)" htmlFor="g-sid"><Input id="g-sid" maxLength={11} value={v.generic_http.senderId} onChange={(e) => set('generic_http', { senderId: e.target.value })} /></Field>
            <Field label="API key parameter" htmlFor="g-kp" hint="e.g. api_key"><Input id="g-kp" value={v.generic_http.apiKeyParam} onChange={(e) => set('generic_http', { apiKeyParam: e.target.value })} /></Field>
            <SecretField path="sms.generic_http.apiKey" label="API key" value={v.generic_http.apiKey} onChange={(x) => set('generic_http', { apiKey: x })} {...secretProps} />
          </div>
        )}

        <TestSend channel="sms" ready={data.status.sms} />
      </div>
    </AdminCard>
  )
}

/* ------------------------------------------------------------------ WhatsApp */

function WhatsAppCard({ data, canEdit, onSaved }: { data: Payload; canEdit: boolean; onSaved: (d: Payload) => void }) {
  const [v, setV] = useState<Wa>(data.config.whatsapp)
  const [clear, setClear] = useState<SecretPath[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const set = (patch: Partial<Wa>) => setV((s) => ({ ...s, ...patch }))
  const onClear = (p: SecretPath, on: boolean) => setClear((c) => (on ? [...c, p] : c.filter((x) => x !== p)))

  async function submit() {
    setBusy(true); setMsg(null)
    try {
      const next = await save({ whatsapp: v, clearSecrets: clear.filter((p) => p.startsWith('whatsapp.')) })
      onSaved(next)
      setMsg({ tone: 'success', text: 'Saved' })
    } catch (e) { setMsg({ tone: 'danger', text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <AdminCard
      title="WhatsApp Business (Meta Cloud API)"
      icon={<MessageCircle size={17} />}
      description="Meta Business Suite → WhatsApp Manager / developers.facebook.com → your app → WhatsApp → API Setup. Use a permanent System User access token with whatsapp_business_messaging permission."
      actions={data.status.whatsapp ? <Badge tone="success" dot>Ready</Badge> : <Badge tone="warning" dot>Not ready</Badge>}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] text-adm-subtle">{msg ? <span className={msg.tone === 'success' ? 'text-adm-success' : 'text-adm-danger'}>{msg.text}</span> : ''}</span>
          <Button variant="primary" size="sm" loading={busy} disabled={!canEdit} onClick={submit}>Save WhatsApp settings</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Switch checked={v.enabled} onChange={(c) => set({ enabled: c })} label="WhatsApp sending on" description="Off = vendors fall back to the free share link." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Phone number ID" htmlFor="wa-pnid" hint="Not the phone number itself"><Input id="wa-pnid" className="font-mono" value={v.phoneNumberId} onChange={(e) => set({ phoneNumberId: e.target.value })} /></Field>
          <Field label="WhatsApp Business Account ID" htmlFor="wa-waba"><Input id="wa-waba" className="font-mono" value={v.businessAccountId} onChange={(e) => set({ businessAccountId: e.target.value })} /></Field>
          <SecretField path="whatsapp.accessToken" label="Access token" value={v.accessToken} onChange={(x) => set({ accessToken: x })} secrets={data.secrets} clear={clear} onClear={onClear} />
          <Field label="Graph API version" htmlFor="wa-ver"><Input id="wa-ver" value={v.apiVersion} onChange={(e) => set({ apiVersion: e.target.value })} /></Field>
          <Field label="Template language" htmlFor="wa-lang" hint="e.g. en, en_US, si"><Input id="wa-lang" value={v.templateLanguage} onChange={(e) => set({ templateLanguage: e.target.value })} /></Field>
          <Field label="Template namespace" htmlFor="wa-ns" hint="Optional (older accounts)"><Input id="wa-ns" value={v.templateNamespace} onChange={(e) => set({ templateNamespace: e.target.value })} /></Field>
        </div>
        <div className="space-y-3">
          <p className="text-[13px] text-adm-muted">
            Approved message templates (WhatsApp Manager → Message templates, category Utility). Messages a customer did not start must use a template;
            leave blank to send plain text (only delivered within 24 hours of the customer messaging you).
          </p>
          {MESSAGE_PURPOSES.map((p) => (
            <Field key={p} label={PURPOSE_LABELS[p]} htmlFor={`wa-t-${p}`} hint={`Body variables: ${WHATSAPP_TEMPLATE_PARAMS[p].map((k, i) => `{{${i + 1}}} = ${k}`).join(', ')}`}>
              <Input id={`wa-t-${p}`} className="font-mono" value={v.templates[p] ?? ''} placeholder={`e.g. ${p}`} onChange={(e) => set({ templates: { ...v.templates, [p]: e.target.value } })} />
            </Field>
          ))}
        </div>
        <TestSend channel="whatsapp" ready={data.status.whatsapp} />
      </div>
    </AdminCard>
  )
}

/* ------------------------------------------------------------------ vendors */

function VendorsCard({ vendors }: { vendors: Payload['vendors'] }) {
  const bal = (p: VendorPlan, ch: 'sms' | 'whatsapp') => {
    if (!(ch === 'sms' ? p.smsEnabled : p.whatsappEnabled)) return '—'
    if (ch === 'sms' && p.useOwnSmsProvider) return 'Own gateway'
    return p.billingMode === 'prepaid'
      ? `${fmtNumber(ch === 'sms' ? p.smsCredits : p.whatsappCredits)} credits`
      : `${fmtNumber(ch === 'sms' ? p.smsUsedThisMonth : p.whatsappUsedThisMonth)} / ${fmtNumber(ch === 'sms' ? p.smsMonthlyQuota : p.whatsappMonthlyQuota)}`
  }
  return (
    <AdminCard title="Vendors with a messaging plan" icon={<Users size={17} />} flush>
      <AdminTable
        rows={vendors}
        rowKey={(r) => r.tenantId}
        rowHref={(r) => `/sys-control/vendors/${r.tenantId}/messaging`}
        empty="No vendor has SMS or WhatsApp yet. Open a vendor → Messaging to add a plan."
        columns={[
          { key: 'name', header: 'Vendor', primary: true, cell: (r) => <span><span className="font-medium">{r.name}</span> <span className="text-adm-subtle">{formatBusinessId(r.businessId)}</span></span> },
          { key: 'sms', header: 'SMS', cell: (r) => bal(r.plan, 'sms') },
          { key: 'wa', header: 'WhatsApp', cell: (r) => bal(r.plan, 'whatsapp') },
          { key: 'exp', header: 'Valid until', cell: (r) => r.plan.expiresAt ?? 'No end date' },
        ]}
      />
    </AdminCard>
  )
}
