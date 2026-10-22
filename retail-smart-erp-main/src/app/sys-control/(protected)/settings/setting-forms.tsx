'use client'

import type { ReactNode } from 'react'
import { Landmark, Megaphone, Percent, Phone, Plus, Sparkles, Trash2 } from 'lucide-react'
import {
  AdminCard,
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
  fmtDateTime,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { cn } from '@/lib/utils'
import { useSetting, type SettingsPayload } from './use-setting'

type Saved = (key: string, value: unknown, updatedAt: string) => void

interface FormProps<T> {
  initial: T
  savedAt: string | null
  onSaved: Saved
}

/** Footer row shared by every setting card: last saved + feedback + Reset / Save. */
function SaveBar({ savedAt, dirty, saving, onSave, onReset, message }: {
  savedAt: string | null
  dirty: boolean
  saving: boolean
  onSave: () => void
  onReset: () => void
  message: { tone: 'success' | 'danger'; text: string } | null
}) {
  const canSave = useAdminCan('settings')
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 text-[12.5px] text-adm-subtle">
        {message ? (
          <span className={message.tone === 'success' ? 'text-adm-success' : 'text-adm-danger'} role={message.tone === 'danger' ? 'alert' : 'status'}>{message.text}</span>
        ) : !canSave ? 'Only owners can change platform settings.' : savedAt ? `Last saved ${fmtDateTime(savedAt)}` : 'Not saved yet — defaults are shown'}
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={!dirty || saving} onClick={onReset}>Reset</Button>
        <Button size="sm" variant="primary" disabled={!dirty || !canSave} loading={saving} onClick={onSave}>Save changes</Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ announcement */

interface Announcement { enabled: boolean; message: string; type: 'info' | 'warning' | 'error' }

const BANNER_TONE: Record<Announcement['type'], string> = {
  info: 'bg-adm-info-soft text-adm-info',
  warning: 'bg-adm-warning-soft text-adm-warning',
  error: 'bg-adm-danger-soft text-adm-danger',
}

export function AnnouncementForm({ initial, savedAt, onSaved }: FormProps<Announcement>) {
  const f = useSetting('system_announcement', initial, savedAt, onSaved)
  const v = f.value
  return (
    <AdminCard
      title="Announcement banner"
      description="A short message shown at the top of the vendor app for every signed-in user, e.g. planned maintenance."
      icon={<Megaphone size={17} />}
      footer={<SaveBar savedAt={savedAt} dirty={f.dirty} saving={f.saving} onSave={() => f.save()} onReset={f.reset} message={f.message} />}
    >
      <div className="space-y-4">
        <Switch checked={v.enabled} onChange={(c) => f.set('enabled', c)} label="Show the banner" description="Turn off to hide it without losing the text." />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
          <Field label="Style" htmlFor="ann-type">
            <Select id="ann-type" value={v.type} onChange={(e) => f.set('type', e.target.value as Announcement['type'])}>
              <option value="info">Information</option>
              <option value="warning">Warning</option>
              <option value="error">Urgent</option>
            </Select>
          </Field>
          <Field label="Message" htmlFor="ann-msg" required={v.enabled} error={f.errors.message} hint={`${v.message.length}/300`}>
            <Textarea id="ann-msg" rows={3} maxLength={300} value={v.message} invalid={!!f.errors.message} onChange={(e) => f.set('message', e.target.value)} />
          </Field>
        </div>
        <div className="space-y-1.5">
          <p className="text-[12.5px] font-medium text-adm-muted">Preview</p>
          {v.message.trim() ? (
            <div className={cn('rounded-lg px-3.5 py-2.5 text-[13.5px] font-medium', BANNER_TONE[v.type], !v.enabled && 'opacity-50')}>
              {v.message.trim()}
            </div>
          ) : <p className="text-[13px] text-adm-subtle">Nothing to show.</p>}
          {!v.enabled && v.message.trim() && <p className="text-[12.5px] text-adm-subtle">Hidden — turn the banner on to show it.</p>}
        </div>
      </div>
    </AdminCard>
  )
}

/* ------------------------------------------------------------------ bank details */

interface Bank { bankName: string; branchName: string; accountName: string; accountNumber: string; swiftCode: string; notes: string }

export function BankDetailsForm({ initial, savedAt, onSaved }: FormProps<Bank>) {
  const f = useSetting('bank_details', initial, savedAt, onSaved)
  const v = f.value
  const text = (k: keyof Bank, label: string, opts: { required?: boolean; hint?: string; mono?: boolean } = {}) => (
    <Field label={label} htmlFor={`bank-${k}`} required={opts.required} error={f.errors[k]} hint={opts.hint}>
      <Input id={`bank-${k}`} value={v[k] ?? ''} invalid={!!f.errors[k]} className={opts.mono ? 'font-mono' : undefined} onChange={(e) => f.set(k, e.target.value)} />
    </Field>
  )
  return (
    <AdminCard
      title="Bank transfer details"
      description="Shown to vendors who pay by bank transfer and upload a deposit slip."
      icon={<Landmark size={17} />}
      footer={<SaveBar savedAt={savedAt} dirty={f.dirty} saving={f.saving} onSave={() => f.save()} onReset={f.reset} message={f.message} />}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {text('bankName', 'Bank', { required: true })}
        {text('branchName', 'Branch', { required: true })}
        {text('accountName', 'Account name', { required: true })}
        {text('accountNumber', 'Account number', { required: true, mono: true })}
        {text('swiftCode', 'SWIFT code', { hint: 'Optional, for payments from abroad', mono: true })}
        <Field label="Notes for the payer" htmlFor="bank-notes" error={f.errors.notes} hint="Optional, e.g. “Use your Business ID as the reference”" className="sm:col-span-2">
          <Textarea id="bank-notes" rows={2} maxLength={500} value={v.notes ?? ''} onChange={(e) => f.set('notes', e.target.value)} />
        </Field>
      </div>
    </AdminCard>
  )
}

/* ------------------------------------------------------------------ volume discounts */

interface Tier { min: number; max: number | null; percent: number }

export function VolumeDiscountsForm({ initial, savedAt, onSaved }: FormProps<{ tiers: Tier[] }>) {
  const f = useSetting('volume_discounts', initial, savedAt, onSaved)
  const tiers = f.value.tiers
  const update = (i: number, patch: Partial<Tier>) => f.set('tiers', tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s))
  const tierErrors = Object.entries(f.errors).filter(([k]) => k.startsWith('tiers')).map(([, m]) => m)
  return (
    <AdminCard
      title="Multi-business discount"
      description="Discount on each subscription for accounts that run several businesses. Applied at checkout."
      icon={<Percent size={17} />}
      footer={<SaveBar savedAt={savedAt} dirty={f.dirty} saving={f.saving} onSave={() => f.save()} onReset={f.reset} message={f.message} />}
    >
      <div className="space-y-3">
        {tierErrors.length > 0 && <Alert tone="danger">{[...new Set(tierErrors)].join(' ')}</Alert>}
        {tiers.length === 0 && <p className="text-[13px] text-adm-subtle">No tiers: nobody gets a multi-business discount.</p>}
        {tiers.map((t, i) => (
          <div key={i} className="grid grid-cols-2 items-end gap-3 rounded-lg border border-adm-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Field label="From (businesses)" htmlFor={`vt-min-${i}`}>
              <Input id={`vt-min-${i}`} type="number" inputMode="numeric" min={2} value={Number.isFinite(t.min) ? t.min : ''} onChange={(e) => update(i, { min: num(e.target.value) })} />
            </Field>
            <Field label="Up to" htmlFor={`vt-max-${i}`} hint={i === tiers.length - 1 ? 'Empty = no upper limit' : undefined}>
              <Input id={`vt-max-${i}`} type="number" inputMode="numeric" min={2} value={t.max ?? ''} onChange={(e) => update(i, { max: e.target.value.trim() === '' ? null : num(e.target.value) })} />
            </Field>
            <Field label="Discount %" htmlFor={`vt-pct-${i}`}>
              <Input id={`vt-pct-${i}`} type="number" inputMode="decimal" min={0} max={90} value={Number.isFinite(t.percent) ? t.percent : ''} onChange={(e) => update(i, { percent: num(e.target.value) })} />
            </Field>
            <Button size="icon" variant="ghost" aria-label={`Remove tier ${i + 1}`} onClick={() => f.set('tiers', tiers.filter((_, j) => j !== i))}>
              <Trash2 size={16} aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          icon={Plus}
          disabled={tiers.length >= 10 || (tiers.length > 0 && tiers[tiers.length - 1].max === null)}
          onClick={() => {
            const last = tiers[tiers.length - 1]
            const min = last ? (last.max ?? last.min) + 1 : 2
            f.set('tiers', [...tiers, { min, max: null, percent: last ? last.percent : 10 }])
          }}
        >
          Add tier
        </Button>
        {tiers.length > 0 && tiers[tiers.length - 1].max === null && <p className="text-[12.5px] text-adm-subtle">Give the last tier an upper limit to add another after it.</p>}
      </div>
    </AdminCard>
  )
}

/* ------------------------------------------------------------------ contact & branding */

interface Contact { companyName: string; email: string; phone: string; whatsapp: string; address: string; businessHours: string }

export function ContactForm({ initial, savedAt, onSaved }: FormProps<Contact>) {
  const f = useSetting('contact_info', initial, savedAt, onSaved)
  const v = f.value
  const field = (k: keyof Contact, label: string, input: ReactNode, opts: { required?: boolean; hint?: string; wide?: boolean } = {}) => (
    <Field label={label} htmlFor={`ci-${k}`} required={opts.required} error={f.errors[k]} hint={opts.hint} className={opts.wide ? 'sm:col-span-2' : undefined}>
      {input}
    </Field>
  )
  return (
    <AdminCard
      title="Branding and contact details"
      description="The company name and support contacts shown on the public website, pricing page and in emails."
      icon={<Phone size={17} />}
      footer={<SaveBar savedAt={savedAt} dirty={f.dirty} saving={f.saving} onSave={() => f.save()} onReset={f.reset} message={f.message} />}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field('companyName', 'Company name', <Input id="ci-companyName" value={v.companyName} invalid={!!f.errors.companyName} onChange={(e) => f.set('companyName', e.target.value)} />, { required: true })}
        {field('email', 'Support email', <Input id="ci-email" type="email" value={v.email} invalid={!!f.errors.email} onChange={(e) => f.set('email', e.target.value)} />, { required: true })}
        {field('phone', 'Phone', <Input id="ci-phone" type="tel" value={v.phone} invalid={!!f.errors.phone} onChange={(e) => f.set('phone', e.target.value)} placeholder="+94 11 234 5678" />, { required: true })}
        {field('whatsapp', 'WhatsApp', <Input id="ci-whatsapp" type="tel" value={v.whatsapp} invalid={!!f.errors.whatsapp} onChange={(e) => f.set('whatsapp', e.target.value)} placeholder="+94 77 123 4567" />, { hint: 'Optional' })}
        {field('businessHours', 'Support hours', <Input id="ci-businessHours" value={v.businessHours} onChange={(e) => f.set('businessHours', e.target.value)} placeholder="Mon–Fri 9:00–18:00" />, { hint: 'Optional' })}
        {field('address', 'Address', <Textarea id="ci-address" rows={2} value={v.address} onChange={(e) => f.set('address', e.target.value)} />, { hint: 'Optional', wide: true })}
      </div>
    </AdminCard>
  )
}

/* ------------------------------------------------------------------ seasonal offer */

interface Offer {
  enabled: boolean
  title: string
  description: string
  discountPercent: number
  validUntil: string
  badgeText: string
  applicableTiers: string[]
  showOnLanding: boolean
  showOnPricing: boolean
}

export function SeasonalOfferForm({ initial, savedAt, onSaved, tiers }: FormProps<Offer> & { tiers: SettingsPayload['tiers'] }) {
  const f = useSetting('seasonal_offer', { ...initial, validUntil: (initial.validUntil || '').slice(0, 10) }, savedAt, onSaved)
  const v = f.value
  const expired = v.validUntil && new Date(`${v.validUntil}T23:59:59`) < new Date()
  return (
    <AdminCard
      title="Limited-time offer"
      description="A discount advertised on the landing and pricing pages until its end date."
      icon={<Sparkles size={17} />}
      footer={<SaveBar savedAt={savedAt} dirty={f.dirty} saving={f.saving} onSave={() => f.save()} onReset={f.reset} message={f.message} />}
    >
      <div className="space-y-4">
        <Switch checked={v.enabled} onChange={(c) => f.set('enabled', c)} label="Offer is running" description="Turn off to stop advertising it." />
        {v.enabled && expired && <Alert tone="warning">The end date has passed. Choose a new date or turn the offer off.</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="so-title" required={v.enabled} error={f.errors.title}>
            <Input id="so-title" maxLength={80} value={v.title} invalid={!!f.errors.title} onChange={(e) => f.set('title', e.target.value)} placeholder="Avurudu offer" />
          </Field>
          <Field label="Badge text" htmlFor="so-badge" error={f.errors.badgeText} hint="Optional, e.g. “20% off”">
            <Input id="so-badge" maxLength={30} value={v.badgeText} onChange={(e) => f.set('badgeText', e.target.value)} />
          </Field>
          <Field label="Discount %" htmlFor="so-pct" required={v.enabled} error={f.errors.discountPercent}>
            <Input id="so-pct" type="number" inputMode="decimal" min={0} max={90} value={Number.isFinite(v.discountPercent) ? v.discountPercent : ''} invalid={!!f.errors.discountPercent} onChange={(e) => f.set('discountPercent', e.target.value.trim() === '' ? NaN : Number(e.target.value))} />
          </Field>
          <Field label="Last day" htmlFor="so-until" required={v.enabled} error={f.errors.validUntil}>
            <Input id="so-until" type="date" value={v.validUntil} invalid={!!f.errors.validUntil} onChange={(e) => f.set('validUntil', e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="so-desc" error={f.errors.description} className="sm:col-span-2">
            <Textarea id="so-desc" rows={2} maxLength={300} value={v.description} onChange={(e) => f.set('description', e.target.value)} />
          </Field>
        </div>
        <Field label="Plans" hint={v.applicableTiers.length ? undefined : 'None ticked: the offer applies to every paid plan.'}>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {tiers.filter((t) => t.isActive).map((t) => (
              <Checkbox key={t.id} label={t.displayName} checked={v.applicableTiers.includes(t.id)}
                onChange={() => f.set('applicableTiers', v.applicableTiers.includes(t.id) ? v.applicableTiers.filter((x) => x !== t.id) : [...v.applicableTiers, t.id])} />
            ))}
          </div>
        </Field>
        <Field label="Where to show it" error={f.errors.showOnPricing ?? f.errors.showOnLanding}>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <Checkbox label="Landing page" checked={v.showOnLanding} onChange={(e) => f.set('showOnLanding', e.target.checked)} />
            <Checkbox label="Pricing page" checked={v.showOnPricing} onChange={(e) => f.set('showOnPricing', e.target.checked)} />
          </div>
        </Field>
      </div>
    </AdminCard>
  )
}
