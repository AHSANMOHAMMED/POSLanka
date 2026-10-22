'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { HardDrive, RefreshCw, Server, Trash2 } from 'lucide-react'
import {
  AdminCard,
  AdminPage,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  KeyValueList,
  SegmentedControl,
  Skeleton,
  fmtNumber,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { TwoFactorCard } from '@/components/admin/TwoFactorCard'
import { ChangePasswordCard } from '@/components/admin/AccountSetupGate'
import { adminFetch } from '@/components/admin/console-helpers'
import { AnnouncementForm, BankDetailsForm, ContactForm, SeasonalOfferForm, VolumeDiscountsForm } from './setting-forms'
import { CouponsCard } from './coupons'
import type { SettingsPayload } from './use-setting'

type Tab = 'general' | 'security' | 'announcement' | 'billing' | 'branding' | 'promotions'

const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'general', label: 'General' },
  { value: 'security', label: 'Security' },
  { value: 'announcement', label: 'Announcement' },
  { value: 'billing', label: 'Billing & bank' },
  { value: 'branding', label: 'Branding & contact' },
  { value: 'promotions', label: 'Promotions' },
]

const isTab = (v: string | null): v is Tab => !!v && TABS.some((t) => t.value === v)

export default function SettingsPage() {
  const searchParams = useSearchParams()
  // ?tab=security etc. (deep links from other pages); the URL is kept in step without a navigation
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab')
    return isTab(t) ? t : 'general'
  })
  const [data, setData] = useState<SettingsPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const changeTab = (t: Tab) => {
    setTab(t)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url.toString())
  }

  const load = useCallback(() => adminFetch<SettingsPayload>('/api/sys-control/settings')
    .then((d) => { setData(d); setError(null) })
    .catch((e) => setError(e instanceof Error ? e.message : 'Could not load settings')), [])
  useEffect(() => { void load() }, [load])

  const onSaved = useCallback((key: string, value: unknown, updatedAt: string) => {
    setData((d) => (d ? { ...d, settings: { ...d.settings, [key]: value }, updatedAt: { ...d.updatedAt, [key]: updatedAt } } : d))
  }, [])

  const formProps = <T,>(key: string) => ({
    initial: data!.settings[key] as T,
    savedAt: data!.updatedAt[key] ?? null,
    onSaved,
  })

  const needsData = tab !== 'security'

  return (
    <AdminPage title="Platform settings" description="Settings that apply to the whole platform and every vendor.">
      <SegmentedControl ariaLabel="Settings section" value={tab} onChange={changeTab} options={TABS} />

      {needsData && error ? (
        <Alert tone="danger" title="Could not load settings" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>
      ) : needsData && !data ? (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          {tab === 'general' && data && <GeneralTab platform={data.platform} />}

          {tab === 'security' && (
            <>
              <TwoFactorCard />
              <ChangePasswordCard />
              <AdminCard title="Other admins" description="Add admins, require two-factor authentication, reset passwords or deactivate access.">
                <Link href="/sys-control/users" className="text-[14px] font-medium text-adm-primary hover:underline">Manage console admins</Link>
              </AdminCard>
            </>
          )}

          {tab === 'announcement' && data && <AnnouncementForm {...formProps<Parameters<typeof AnnouncementForm>[0]['initial']>('system_announcement')} />}

          {tab === 'billing' && data && (
            <>
              <AdminCard title="Online payments" description="Card payments go through PayHere. Credentials come from the server environment.">
                <KeyValueList
                  items={[
                    {
                      label: 'PayHere',
                      value: data.platform.payhere.configured
                        ? <Badge tone={data.platform.payhere.sandbox ? 'warning' : 'success'} dot>{data.platform.payhere.sandbox ? 'Sandbox (test payments)' : 'Live'}</Badge>
                        : <Badge tone="danger" dot>Not configured</Badge>,
                    },
                    { label: 'Grace period after a missed renewal', value: `${data.platform.graceDays} days, then the vendor is locked` },
                  ]}
                />
                {!data.platform.payhere.configured && (
                  <p className="mt-3 text-[13px] text-adm-muted">Set PAYHERE_MERCHANT_ID and PAYHERE_MERCHANT_SECRET on the server to accept card payments. Vendors can still pay by bank transfer.</p>
                )}
              </AdminCard>
              <BankDetailsForm {...formProps<Parameters<typeof BankDetailsForm>[0]['initial']>('bank_details')} />
              <VolumeDiscountsForm {...formProps<Parameters<typeof VolumeDiscountsForm>[0]['initial']>('volume_discounts')} />
            </>
          )}

          {tab === 'branding' && data && <ContactForm {...formProps<Parameters<typeof ContactForm>[0]['initial']>('contact_info')} />}

          {tab === 'promotions' && data && (
            <>
              <SeasonalOfferForm {...formProps<Parameters<typeof SeasonalOfferForm>[0]['initial']>('seasonal_offer')} tiers={data.tiers} />
              <CouponsCard tiers={data.tiers} />
            </>
          )}
        </div>
      )}
    </AdminPage>
  )
}

/* ------------------------------------------------------------------ general */

interface Scan {
  storage: 'object-storage' | 'local'
  totalObjects: number
  referencedObjects: number
  orphanedObjects: number
  referencesFound: number
  orphansByPrefix: Record<string, number>
  sample: string[]
}

function GeneralTab({ platform }: { platform: SettingsPayload['platform'] }) {
  const canMaintain = useAdminCan('settings')
  const [prefix, setPrefix] = useState('')
  const [scan, setScan] = useState<Scan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const prefixOk = /^[A-Za-z0-9/_.-]*$/.test(prefix)

  async function runScan() {
    setScanning(true)
    setMsg(null)
    try {
      setScan(await adminFetch<Scan>(`/api/sys-control/r2-cleanup${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ''}`))
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Scan failed' })
    } finally {
      setScanning(false)
    }
  }

  async function runDelete() {
    setDeleting(true)
    try {
      const res = await adminFetch<{ deleted: number }>('/api/sys-control/r2-cleanup', { method: 'POST', json: { confirm: true, prefix: prefix || undefined } })
      setMsg({ tone: 'success', text: `Deleted ${fmtNumber(res.deleted)} unused file${res.deleted === 1 ? '' : 's'}.` })
      setConfirming(false)
      setScan(null)
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Delete failed' })
      setConfirming(false)
    } finally {
      setDeleting(false)
    }
  }

  const ok = (b: boolean, yes: string, no: string) => <Badge tone={b ? 'success' : 'warning'} dot>{b ? yes : no}</Badge>

  return (
    <>
      <AdminCard title="Platform" description="Read from the server environment. Change these in the deployment settings." icon={<Server size={17} />}>
        <KeyValueList
          items={[
            { label: 'Product name', value: platform.appName },
            { label: 'Web address', value: <span className="break-all">{platform.baseUrl}</span> },
            { label: 'Environment', value: platform.environment === 'production' ? 'Production' : platform.environment },
            { label: 'System email', value: <span className="inline-flex flex-wrap items-center justify-end gap-2">{ok(platform.emailConfigured, 'Sending', 'Not configured — emails are only logged')}<span className="text-adm-muted">{platform.emailFrom}</span></span> },
            { label: 'File storage', value: ok(platform.storageConfigured, 'Object storage', 'Local disk') },
            { label: 'Card payments (PayHere)', value: ok(platform.payhere.configured, platform.payhere.sandbox ? 'Sandbox' : 'Live', 'Not configured') },
          ]}
        />
      </AdminCard>

      <AdminCard
        title="Storage clean-up"
        description="Finds uploaded files that no record in the database points to any more (for example images of deleted items) and deletes them."
        icon={<HardDrive size={17} />}
      >
        <div className="space-y-4">
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Field label="Folder" htmlFor="sc-prefix" hint="Optional: limit to one folder, e.g. a vendor’s web address" error={prefixOk ? undefined : 'Letters, digits, / _ . - only'} className="w-full sm:w-72">
              <Input id="sc-prefix" value={prefix} invalid={!prefixOk} onChange={(e) => { setPrefix(e.target.value); setScan(null) }} placeholder="All folders" />
            </Field>
            <Button icon={RefreshCw} loading={scanning} disabled={!prefixOk} onClick={runScan}>Scan</Button>
          </div>
          {scan && (
            <div className="space-y-3">
              <KeyValueList
                items={[
                  { label: 'Files in storage', value: fmtNumber(scan.totalObjects) },
                  { label: 'In use', value: fmtNumber(scan.referencedObjects) },
                  { label: 'Not used anywhere', value: <span className={scan.orphanedObjects ? 'text-adm-warning' : undefined}>{fmtNumber(scan.orphanedObjects)}</span> },
                ]}
              />
              {scan.orphanedObjects > 0 && (
                <>
                  <ul className="flex flex-wrap gap-1.5">
                    {Object.entries(scan.orphansByPrefix).slice(0, 20).map(([p, n]) => <li key={p}><Badge>{p}: {n}</Badge></li>)}
                  </ul>
                  <details className="text-[12.5px] text-adm-muted">
                    <summary className="cursor-pointer">Show examples</summary>
                    <ul className="mt-2 space-y-0.5 break-all font-mono">{scan.sample.slice(0, 20).map((k) => <li key={k}>{k}</li>)}</ul>
                  </details>
                  <Button variant="danger-soft" icon={Trash2} disabled={!canMaintain} title={canMaintain ? undefined : 'Only owners can delete files'} onClick={() => setConfirming(true)}>Delete {fmtNumber(scan.orphanedObjects)} unused file{scan.orphanedObjects === 1 ? '' : 's'}</Button>
                </>
              )}
              {scan.orphanedObjects === 0 && <p className="text-[13px] text-adm-muted">Nothing to clean up.</p>}
            </div>
          )}
        </div>
        {confirming && scan && (
          <ConfirmDialog
            open
            onCancel={() => setConfirming(false)}
            onConfirm={runDelete}
            loading={deleting}
            title="Delete unused files?"
            description={`${fmtNumber(scan.orphanedObjects)} file(s) that no record uses will be permanently deleted. The list is checked again before deleting.`}
            confirmLabel="Delete files"
            confirmVariant="danger"
          />
        )}
      </AdminCard>
    </>
  )
}
