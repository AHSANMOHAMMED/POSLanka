'use client'

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Moon,
  Power,
  PowerOff,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Store,
  Wallet,
} from 'lucide-react'
import {
  AdminCard,
  AdminModal,
  AdminPage,
  AdminToolbar,
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  LinkButton,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  StatCard,
  StatGrid,
  Switch,
  fmtCompact,
  fmtLKR,
  fmtNumber,
  statusTone,
  timeAgo,
  type Tone,
} from '@/components/admin/kit'
import { useAdminCan, useDeniedTitle } from '@/components/admin/AdminRoleContext'
import { VENDOR_STATUS_LABEL, adminFetch, labelFor } from '@/components/admin/console-helpers'
import {
  businessTypeHref,
  BusinessTypeIcon,
  pctOf,
  type ApplyFeaturesBody,
  type ApplyFeaturesResult,
  type BusinessTypeDetail,
  type TypeFeature,
  type TypeTenant,
} from '@/components/admin/business-types-shared'
import { BUSINESS_TYPE_LABELS } from '@/lib/business-types/labels'
import { formatBusinessId } from '@/lib/tenant/business-id-format'
import { cn } from '@/lib/utils'

type Tab = 'features' | 'vendors'

/** What the confirmation modal is about to send. */
interface ApplyRequest {
  /** Fixed switches to set (features tab). Omitted = the admin picks them in the modal (vendors tab). */
  changes?: Record<string, boolean>
  /** Only these vendors; omitted = every vendor of the type */
  tenantIds?: string[]
  existing: boolean
  newVendors: boolean
}

/* ------------------------------------------------------------------ small pieces */

function Meter({ value, total, tone = 'primary', label, title }: { value: number; total: number; tone?: 'primary' | 'success'; label: ReactNode; title?: string }) {
  const pct = pctOf(value, total)
  return (
    <div className="min-w-0 space-y-1" title={title}>
      <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
        <span className="truncate text-adm-muted">{label}</span>
        <span className="adm-num shrink-0 text-adm-subtle">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-adm-surface-3" aria-hidden>
        <div className={cn('h-full rounded-full', tone === 'success' ? 'bg-adm-success' : 'bg-adm-primary')} style={{ width: `${value > 0 ? Math.max(pct, 3) : 0}%` }} />
      </div>
    </div>
  )
}

function OnOff({ on }: { on: boolean }) {
  return <Badge tone={on ? 'success' : 'neutral'}>{on ? 'On' : 'Off'}</Badge>
}

/* ------------------------------------------------------------------ confirmation modal */

function ApplyModal({
  detail,
  request,
  onClose,
  onDone,
}: {
  detail: BusinessTypeDetail
  request: ApplyRequest
  onClose: () => void
  onDone: (result: ApplyFeaturesResult, body: ApplyFeaturesBody) => void
}) {
  const editable = !request.changes
  const applicable = useMemo(() => detail.features.filter((f) => f.applies), [detail.features])
  const [picked, setPicked] = useState<Record<string, 'keep' | 'on' | 'off'>>({})
  const [existing, setExisting] = useState(request.existing)
  const [newVendors, setNewVendors] = useState(request.newVendors)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changes: Record<string, boolean> = useMemo(() => {
    if (request.changes) return request.changes
    const out: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(picked)) if (v !== 'keep') out[k] = v === 'on'
    return out
  }, [request.changes, picked])
  const changeList = Object.entries(changes)
  const featureByKey = useMemo(() => new Map(detail.features.map((f) => [f.key, f])), [detail.features])

  const target = useMemo(() => {
    if (!request.tenantIds) return detail.tenants
    const ids = new Set(request.tenantIds)
    return detail.tenants.filter((t) => ids.has(t.id))
  }, [detail.tenants, request.tenantIds])
  const willChange = target.filter((t) => changeList.some(([k, v]) => !!t.featureFlags[k] !== v)).length
  const presetDiffs = changeList.filter(([k, v]) => !!detail.preset[k] !== v)
  const typeLabel = detail.label.toLowerCase()
  const subset = !!request.tenantIds

  const title = editable
    ? `Change features for ${target.length} selected vendor${target.length === 1 ? '' : 's'}`
    : changeList.length === 1
      ? `Turn ${changeList[0][1] ? 'on' : 'off'} ${featureByKey.get(changeList[0][0])?.label ?? changeList[0][0]}`
      : `Change ${changeList.length} features`

  async function submit() {
    setSaving(true)
    setError(null)
    const body: ApplyFeaturesBody = { changes, applyToExisting: existing, applyToNew: newVendors, ...(request.tenantIds ? { tenantIds: request.tenantIds } : {}) }
    try {
      const res = await adminFetch<ApplyFeaturesResult>(`/api/sys-control/business-types/${encodeURIComponent(detail.type)}/features`, { method: 'PUT', json: body })
      onDone(res, body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the features')
      setSaving(false)
    }
  }

  const canSubmit = changeList.length > 0 && (existing || newVendors) && (!existing || target.length > 0 || newVendors)

  return (
    <AdminModal
      open
      onClose={onClose}
      size={editable ? 'lg' : 'md'}
      title={title}
      description={`${detail.label} · ${subset ? `${target.length} selected vendor${target.length === 1 ? '' : 's'}` : `all ${detail.tenantCount} vendor${detail.tenantCount === 1 ? '' : 's'}`}`}
      footer={
        <>
          {error && <span className="mr-auto self-center text-[13px] text-adm-danger">{error}</span>}
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={saving} disabled={!canSubmit}>Apply</Button>
        </>
      }
    >
      <div className="space-y-4">
        {editable ? (
          <div className="space-y-4">
            <p className="text-[13px] text-adm-muted">Pick the switches to change. “No change” leaves that switch as each vendor has it.</p>
            {detail.groups.map((g) => {
              const feats = applicable.filter((f) => f.group === g)
              if (!feats.length) return null
              return (
                <section key={g}>
                  <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-adm-subtle">{g}</h3>
                  <ul className="divide-y divide-[var(--adm-border)] rounded-lg border border-adm-border">
                    {feats.map((f) => {
                      const on = target.filter((t) => t.featureFlags[f.key]).length
                      return (
                        <li key={f.key} className="flex flex-col gap-2 px-3 py-2 min-[520px]:flex-row min-[520px]:items-center min-[520px]:justify-between">
                          <div className="min-w-0">
                            <p className="text-[13.5px] font-medium text-adm-fg">{f.label}</p>
                            <p className="text-[12px] text-adm-subtle">On for {on} of {target.length} selected</p>
                          </div>
                          <SegmentedControl
                            size="sm"
                            ariaLabel={`${f.label}: change`}
                            value={picked[f.key] ?? 'keep'}
                            onChange={(v) => setPicked((p) => ({ ...p, [f.key]: v }))}
                            options={[
                              { value: 'keep', label: 'No change' },
                              { value: 'on', label: 'On' },
                              { value: 'off', label: 'Off' },
                            ]}
                          />
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        ) : null}

        {changeList.length > 0 && (
          <ul className="space-y-2">
            {changeList.map(([k, v]) => {
              const f = featureByKey.get(k)
              return (
                <li key={k} className="rounded-lg border border-adm-border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[13.5px] font-medium text-adm-fg">{f?.label ?? k}</span>
                    <OnOff on={v} />
                  </div>
                  {!v && f?.offEffect && <p className="mt-1 text-[12.5px] text-adm-warning">{f.offEffect}</p>}
                </li>
              )
            })}
          </ul>
        )}

        {changeList.length > 0 && (
          <Alert tone={willChange > 0 && existing ? 'info' : 'neutral'}>
            {existing
              ? `${willChange} of ${target.length} vendor${target.length === 1 ? '' : 's'} will change; the others already have ${changeList.length === 1 ? 'this setting' : 'these settings'}.`
              : 'Existing vendors keep their switches as they are.'}
            {newVendors && (presetDiffs.length
              ? ` New ${typeLabel} vendors will start with ${presetDiffs.length === 1 ? 'this switch' : `${presetDiffs.length} switches`} changed.`
              : ` New ${typeLabel} vendors already start this way.`)}
          </Alert>
        )}

        <div className="space-y-2.5 border-t border-adm-border pt-3">
          <Checkbox
            label={subset ? `Apply to the ${target.length} selected vendor${target.length === 1 ? '' : 's'}` : `Apply to the ${detail.tenantCount} existing vendor${detail.tenantCount === 1 ? '' : 's'}`}
            description="Their menus, web and app follow within about a minute. Data is kept when a feature is switched off."
            checked={existing}
            disabled={target.length === 0}
            onChange={(e) => setExisting(e.target.checked)}
          />
          <Checkbox
            label="Also for new vendors"
            description={`Vendors of this type created from now on start with ${changeList.length === 1 ? 'this setting' : 'these settings'}.`}
            checked={newVendors}
            onChange={(e) => setNewVendors(e.target.checked)}
          />
          {!existing && !newVendors && <p className="text-[12.5px] text-adm-danger">Choose existing vendors, new vendors, or both.</p>}
        </div>
      </div>
    </AdminModal>
  )
}

/* ------------------------------------------------------------------ Features tab */

function FeatureRow({
  f,
  detail,
  canManage,
  deniedTitle,
  selected,
  onSelect,
  onApply,
}: {
  f: TypeFeature
  detail: BusinessTypeDetail
  canManage: boolean
  deniedTitle?: string
  selected: boolean
  onSelect: (on: boolean) => void
  onApply: (req: ApplyRequest) => void
}) {
  const n = detail.tenantCount
  const presetOn = !!detail.preset[f.key]
  const codeOn = !!detail.codePreset[f.key]
  const changed = detail.presetOverridden.includes(f.key)
  const inert = !f.applies
  return (
    <li className={cn('grid grid-cols-1 gap-3 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,auto)] lg:items-center lg:gap-5', inert && 'opacity-60', selected && 'bg-adm-primary-soft/40')}>
      <div className="flex min-w-0 items-start gap-2.5">
        {canManage && !inert && (
          <input type="checkbox" className="adm-checkbox mt-1 shrink-0" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${f.label}`} />
        )}
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-medium text-adm-fg">
            {f.label}
            {changed && <Badge tone="warning">New-vendor default changed</Badge>}
          </p>
          <p className="text-[12.5px] text-adm-muted">{f.description}</p>
          {f.offEffect && <p className="mt-0.5 text-[12px] text-adm-subtle">Off: {f.offEffect}</p>}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-1">
        <Meter value={f.enabledCount} total={n} label={<>On for <span className="adm-num font-medium text-adm-fg">{f.enabledCount}</span> of {n} vendors</>} />
        {f.usageTracked && f.usedCount !== null ? (
          <Meter
            value={f.usedCount}
            total={n}
            tone="success"
            label={<>Used by <span className="adm-num font-medium text-adm-fg">{f.usedCount}</span> in {detail.usageDays} days</>}
            title={f.activity !== null ? `${fmtNumber(f.activity)} records in the last ${detail.usageDays} days` : undefined}
          />
        ) : (
          <p className="self-end text-[12.5px] text-adm-subtle">Usage not tracked</p>
        )}
      </div>

      {inert ? (
        <p className="text-[12.5px] text-adm-subtle lg:text-right">Does not apply to {detail.label}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:justify-end">
          <div className="flex items-center gap-2" title={changed ? `Built-in default: ${codeOn ? 'On' : 'Off'}` : undefined}>
            <span className="text-[12.5px] text-adm-muted">New vendors start</span>
            {canManage ? (
              <Switch checked={presetOn} onChange={(v) => onApply({ changes: { [f.key]: v }, existing: false, newVendors: true })} />
            ) : (
              <OnOff on={presetOn} />
            )}
            {changed && <span className="text-[11.5px] text-adm-subtle">(built-in {codeOn ? 'on' : 'off'})</span>}
          </div>
          {canManage ? (
            <div className="flex gap-1.5">
              <Button size="sm" variant="secondary" icon={Power} disabled={n > 0 && f.enabledCount === n} onClick={() => onApply({ changes: { [f.key]: true }, existing: n > 0, newVendors: true })}>
                On for all
              </Button>
              <Button size="sm" variant="secondary" icon={PowerOff} disabled={n > 0 && f.enabledCount === 0} onClick={() => onApply({ changes: { [f.key]: false }, existing: n > 0, newVendors: true })}>
                Off for all
              </Button>
            </div>
          ) : (
            <span className="text-[12px] text-adm-subtle" title={deniedTitle}>Read only</span>
          )}
        </div>
      )}
    </li>
  )
}

function FeaturesTab({ detail, canManage, onApply, onReset }: { detail: BusinessTypeDetail; canManage: boolean; onApply: (req: ApplyRequest) => void; onReset: () => void }) {
  const deniedTitle = useDeniedTitle('vendors.manage')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showOther, setShowOther] = useState(false)
  const applicable = detail.features.filter((f) => f.applies)
  const other = detail.features.filter((f) => !f.applies)
  const toggle = (key: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  const applySelected = (on: boolean) => {
    onApply({ changes: Object.fromEntries([...selected].map((k) => [k, on])), existing: detail.tenantCount > 0, newVendors: true })
  }

  const row = (f: TypeFeature) => (
    <FeatureRow
      key={f.key}
      f={f}
      detail={detail}
      canManage={canManage}
      deniedTitle={deniedTitle}
      selected={selected.has(f.key)}
      onSelect={(on) => toggle(f.key, on)}
      onApply={onApply}
    />
  )

  return (
    <div className="space-y-4">
      {(canManage && selected.size > 0) || detail.presetOverridden.length > 0 ? (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-adm-border bg-adm-surface/95 px-4 py-2.5 shadow-[var(--adm-shadow)] backdrop-blur">
          {canManage && selected.size > 0 ? (
            <>
              <span className="text-[13px] font-medium text-adm-fg">{selected.size} selected</span>
              <Button size="sm" variant="primary" icon={Power} onClick={() => applySelected(true)}>Turn on</Button>
              <Button size="sm" variant="secondary" icon={PowerOff} onClick={() => applySelected(false)}>Turn off</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            </>
          ) : (
            <span className="text-[13px] text-adm-muted">
              {detail.presetOverridden.length} new-vendor default{detail.presetOverridden.length === 1 ? ' differs' : 's differ'} from the built-in preset.
            </span>
          )}
          <span className="flex-1" />
          {detail.presetOverridden.length > 0 && canManage && (
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={onReset}>Reset new-vendor defaults</Button>
          )}
        </div>
      ) : null}

      {detail.groups.map((g) => {
        const feats = applicable.filter((f) => f.group === g)
        if (!feats.length) return null
        return (
          <AdminCard
            key={g}
            title={g}
            description={`${feats.length} feature${feats.length === 1 ? '' : 's'}`}
            flush
            actions={
              canManage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const all = feats.every((f) => selected.has(f.key))
                    setSelected((s) => {
                      const next = new Set(s)
                      for (const f of feats) {
                        if (all) next.delete(f.key)
                        else next.add(f.key)
                      }
                      return next
                    })
                  }}
                >
                  {feats.every((f) => selected.has(f.key)) ? 'Unselect group' : 'Select group'}
                </Button>
              ) : undefined
            }
          >
            <ul className="divide-y divide-[var(--adm-border)]">{feats.map(row)}</ul>
          </AdminCard>
        )
      })}

      {other.length > 0 && (
        <AdminCard flush>
          <button
            type="button"
            onClick={() => setShowOther((v) => !v)}
            aria-expanded={showOther}
            className="adm-focus flex w-full items-center gap-2 px-4 py-3 text-left text-[13.5px] font-medium text-adm-muted hover:text-adm-fg sm:px-5"
          >
            {showOther ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
            Not used by this business type ({other.length})
          </button>
          {showOther && <ul className="divide-y divide-[var(--adm-border)] border-t border-adm-border">{other.map(row)}</ul>}
        </AdminCard>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Vendors tab */

type SortKey = 'sales' | 'name' | 'idle' | 'last'

function VendorChips({ t, features }: { t: TypeTenant; features: TypeFeature[] }) {
  const used = new Set(t.usedFeatures)
  const idle = new Set(t.unusedEnabled)
  const tone = (f: TypeFeature): { tone: Tone; hint: string } => {
    const on = !!t.featureFlags[f.key]
    if (!on) return { tone: 'neutral', hint: 'Off' }
    if (used.has(f.key)) return { tone: 'success', hint: 'On and used' }
    if (idle.has(f.key)) return { tone: 'warning', hint: 'On but not used — could be switched off' }
    return { tone: 'primary', hint: 'On (usage not tracked)' }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {features.map((f) => {
          const c = tone(f)
          return (
            <span key={f.key} title={c.hint}>
              <Badge tone={c.tone} className={cn(c.tone === 'neutral' && 'opacity-70')}>{f.label}</Badge>
            </span>
          )
        })}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-adm-subtle">
        <span><span className="text-adm-success">●</span> on + used</span>
        <span><span className="text-adm-warning">●</span> on, idle 30 days</span>
        <span><span className="text-adm-primary">●</span> on (not tracked)</span>
        <span><span className="text-adm-subtle">●</span> off</span>
      </p>
    </div>
  )
}

function VendorsTab({ detail, canManage, onApply }: { detail: BusinessTypeDetail; canManage: boolean; onApply: (req: ApplyRequest) => void }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [sort, setSort] = useState<SortKey>('sales')
  const [idleOnly, setIdleOnly] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const applicable = useMemo(() => detail.features.filter((f) => f.applies), [detail.features])

  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of detail.tenants) c[t.status] = (c[t.status] || 0) + 1
    return c
  }, [detail.tenants])

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const termDigits = term.replace(/[^0-9]/g, '')
    const list = detail.tenants.filter((t) => {
      if (status !== 'all' && t.status !== status) return false
      if (idleOnly && t.unusedEnabled.length === 0) return false
      if (!term) return true
      return (
        t.name.toLowerCase().includes(term) ||
        t.slug.toLowerCase().includes(term) ||
        (!!t.businessId && (t.businessId.toLowerCase().includes(term) || (termDigits.length >= 3 && t.businessId.includes(termDigits))))
      )
    })
    const by: Record<SortKey, (a: TypeTenant, b: TypeTenant) => number> = {
      sales: (a, b) => b.netSales30d - a.netSales30d,
      name: (a, b) => a.name.localeCompare(b.name),
      idle: (a, b) => b.unusedEnabled.length - a.unusedEnabled.length,
      last: (a, b) => (b.lastSaleAt ? Date.parse(b.lastSaleAt) : 0) - (a.lastSaleAt ? Date.parse(a.lastSaleAt) : 0),
    }
    return [...list].sort(by[sort])
  }, [detail.tenants, q, status, idleOnly, sort])

  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleSet = (setter: typeof setSelected, id: string, on?: boolean) =>
    setter((s) => {
      const next = new Set(s)
      if (on ?? !next.has(id)) next.add(id)
      else next.delete(id)
      return next
    })

  if (detail.tenants.length === 0) {
    return (
      <AdminCard>
        <EmptyState icon={Store} title={`No ${detail.label.toLowerCase()} vendors yet`} description="Vendors of this type appear here once they are created. You can still set what new vendors start with on the Features tab." />
      </AdminCard>
    )
  }

  const colCount = canManage ? 11 : 10
  return (
    <AdminCard flush>
      <div className="space-y-3 border-b border-adm-border p-4 sm:p-5">
        <SegmentedControl
          size="sm"
          ariaLabel="Vendor status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: `All ${detail.tenants.length}` },
            ...Object.entries(statusCounts).map(([s, n]) => ({ value: s, label: `${labelFor(VENDOR_STATUS_LABEL, s)} ${n}` })),
          ]}
        />
        <AdminToolbar
          end={
            canManage && selected.size > 0 ? (
              <>
                <span className="text-[13px] text-adm-muted">{selected.size} selected</span>
                <Button size="sm" variant="primary" icon={SlidersHorizontal} onClick={() => onApply({ tenantIds: [...selected], existing: true, newVendors: false })}>
                  Change features
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
              </>
            ) : undefined
          }
        >
          <SearchInput size="sm" wrapperClassName="w-full sm:w-72" placeholder="Name, web address or Business ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search vendors" />
          <Select size="sm" className="w-full min-[480px]:w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
            <option value="sales">Most sales first</option>
            <option value="last">Last sale first</option>
            <option value="idle">Most idle features first</option>
            <option value="name">Name A–Z</option>
          </Select>
          <Checkbox label="Only with idle features" checked={idleOnly} onChange={(e) => setIdleOnly(e.target.checked)} className="items-center" />
        </AdminToolbar>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          compact
          icon={Store}
          title="No vendors match these filters"
          action={<Button size="sm" onClick={() => { setQ(''); setStatus('all'); setIdleOnly(false) }}>Clear filters</Button>}
        />
      ) : (
        <div className="adm-scroll overflow-x-auto">
          <table className="adm-table" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                {canManage && (
                  <th scope="col" className="w-10">
                    <input
                      type="checkbox"
                      className="adm-checkbox"
                      aria-label="Select all shown vendors"
                      checked={allShownSelected}
                      onChange={(e) => setSelected((s) => {
                        const next = new Set(s)
                        for (const r of rows) {
                          if (e.target.checked) next.add(r.id)
                          else next.delete(r.id)
                        }
                        return next
                      })}
                    />
                  </th>
                )}
                <th scope="col" className="w-8"><span className="sr-only">Expand</span></th>
                <th scope="col" className="text-left">Vendor</th>
                <th scope="col" className="text-left">Status</th>
                <th scope="col" className="text-left">Plan</th>
                <th scope="col" className="text-right">Net sales {detail.usageDays}d</th>
                <th scope="col" className="text-right">Receipts</th>
                <th scope="col" className="text-left">Last sale</th>
                <th scope="col" className="text-right" title="Feature switches on">On</th>
                <th scope="col" className="text-right" title={`Features with activity in the last ${detail.usageDays} days`}>Used</th>
                <th scope="col" className="text-right" title={`On but not used in ${detail.usageDays} days — candidates to switch off`}>Idle</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const open = expanded.has(t.id)
                return (
                  <Fragment key={t.id}>
                    <tr className={cn(selected.has(t.id) && 'bg-adm-primary-soft/40')}>
                      {canManage && (
                        <td>
                          <input type="checkbox" className="adm-checkbox" aria-label={`Select ${t.name}`} checked={selected.has(t.id)} onChange={(e) => toggleSet(setSelected, t.id, e.target.checked)} />
                        </td>
                      )}
                      <td className="!px-1">
                        <Button size="icon-sm" variant="ghost" aria-expanded={open} aria-label={open ? `Hide features of ${t.name}` : `Show features of ${t.name}`} onClick={() => toggleSet(setExpanded, t.id)}>
                          {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
                        </Button>
                      </td>
                      <td>
                        <Link href={`/sys-control/vendors/${t.id}`} className="adm-focus font-medium text-adm-fg hover:text-adm-primary">{t.name}</Link>
                        <p className="text-[12px] text-adm-subtle">
                          {t.businessId && <span className="adm-num font-medium text-adm-muted">{formatBusinessId(t.businessId)} · </span>}
                          {t.slug}
                          {t.businessSegments?.length ? ` · ${t.businessSegments.map((s) => BUSINESS_TYPE_LABELS[s] ?? s).join(', ')}` : ''}
                        </p>
                      </td>
                      <td><Badge tone={statusTone(t.status)} dot>{labelFor(VENDOR_STATUS_LABEL, t.status)}</Badge></td>
                      <td className="capitalize text-adm-muted">{t.plan ?? '—'}</td>
                      <td className="text-right"><span className="adm-num" title={fmtLKR(t.netSales30d, 2)}>{fmtCompact(t.netSales30d)}</span></td>
                      <td className="text-right"><span className="adm-num">{fmtNumber(t.receipts30d)}</span></td>
                      <td className="text-adm-muted">{t.lastSaleAt ? timeAgo(t.lastSaleAt) : 'None'}</td>
                      <td className="text-right"><span className="adm-num">{t.enabledCount}</span></td>
                      <td className="text-right"><span className="adm-num">{t.usedFeatures.length}</span></td>
                      <td className="text-right">
                        {t.unusedEnabled.length > 0 ? <Badge tone="warning">{t.unusedEnabled.length}</Badge> : <span className="adm-num text-adm-subtle">0</span>}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={colCount} className="bg-adm-surface-2/60">
                          <VendorChips t={t} features={applicable} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-adm-border px-4 py-3 text-[12.5px] text-adm-subtle sm:px-5">
        Showing {rows.length} of {detail.tenants.length}. “Idle” = switched on but no activity in {detail.usageDays} days (only features whose usage is tracked).
      </div>
    </AdminCard>
  )
}

/* ------------------------------------------------------------------ page */

function TypeConsole({ type }: { type: string }) {
  const canManage = useAdminCan('vendors.manage')
  const [data, setData] = useState<BusinessTypeDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('features')
  const [request, setRequest] = useState<ApplyRequest | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [flash, setFlash] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  // Bumped after each write so the tabs drop their selections
  const [version, setVersion] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await adminFetch<BusinessTypeDetail>(`/api/sys-control/business-types/${encodeURIComponent(type)}`))
    } catch (e) {
      if ((e as { status?: number }).status === 404) setNotFound(true)
      else setError(e instanceof Error ? e.message : 'Could not load this business type')
    } finally {
      setLoading(false)
    }
  }, [type])

  useEffect(() => { load() }, [load])

  // Stable: AdminModal re-focuses its first control whenever onClose changes
  const closeModal = useCallback(() => setRequest(null), [])
  const closeReset = useCallback(() => setResetOpen(false), [])

  const label = data?.label ?? BUSINESS_TYPE_LABELS[type] ?? type
  const idleTotal = data?.tenants.reduce((a, t) => a + t.unusedEnabled.length, 0) ?? 0
  const vendorsWithIdle = data?.tenants.filter((t) => t.unusedEnabled.length > 0).length ?? 0

  const onDone = (res: ApplyFeaturesResult, body: ApplyFeaturesBody) => {
    setRequest(null)
    const parts = [body.applyToExisting ? `Updated ${res.updatedTenants} vendor${res.updatedTenants === 1 ? '' : 's'}.` : '']
    if (body.applyToNew) parts.push('New-vendor defaults saved.')
    setFlash({ tone: 'success', text: parts.filter(Boolean).join(' ') })
    setVersion((v) => v + 1)
    load()
  }

  async function reset() {
    setResetting(true)
    try {
      await adminFetch(`/api/sys-control/business-types/${encodeURIComponent(type)}/features`, { method: 'DELETE' })
      setFlash({ tone: 'success', text: 'New-vendor defaults reset to the built-in preset. Existing vendors were not changed.' })
      setResetOpen(false)
      setVersion((v) => v + 1)
      load()
    } catch (e) {
      setFlash({ tone: 'danger', text: e instanceof Error ? e.message : 'Could not reset the defaults' })
      setResetOpen(false)
    } finally {
      setResetting(false)
    }
  }

  if (notFound) {
    return (
      <AdminPage title="Unknown business type" breadcrumbs={[{ label: 'Business types', href: businessTypeHref() }, { label: type }]}>
        <AdminCard>
          <EmptyState icon={Store} title={`“${type}” is not a business type`} action={<LinkButton href={businessTypeHref()} size="sm" icon={ArrowLeft}>All business types</LinkButton>} />
        </AdminCard>
      </AdminPage>
    )
  }

  return (
    <AdminPage
      title={<span className="inline-flex items-center gap-2.5"><BusinessTypeIcon type={type} size={24} aria-hidden className="text-adm-muted" />{label}</span>}
      description={data ? `${data.tenantCount} vendor${data.tenantCount === 1 ? '' : 's'} · feature switches, what they use in the last ${data.usageDays} days, and what new vendors start with.` : 'Feature switches and usage of this business type.'}
      breadcrumbs={[{ label: 'Business types', href: businessTypeHref() }, { label }]}
      actions={<Button variant="ghost" icon={RefreshCw} onClick={load} loading={loading && !!data}>Refresh</Button>}
    >
      {flash && <Alert tone={flash.tone} action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash.text}</Alert>}
      {error && <Alert tone="danger" title="Could not load this business type" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>}
      {!canManage && data && <Alert tone="neutral">Read only: your role can view this page but cannot change feature switches.</Alert>}

      <StatGrid>
        <StatCard label="Vendors" value={fmtNumber(data?.tenantCount)} icon={Store} loading={!data && !error} />
        <StatCard label={`Active in ${data?.usageDays ?? 30} days`} value={fmtNumber(data?.activeTenants30d)} icon={Activity} tone="success" loading={!data && !error} hint={data ? `${pctOf(data.activeTenants30d, data.tenantCount)}% of vendors` : undefined} />
        <StatCard label={`Net sales ${data?.usageDays ?? 30} days`} value={fmtCompact(data?.netSales30d)} icon={Wallet} tone="info" loading={!data && !error} hint={data ? fmtLKR(data.netSales30d) : undefined} />
        <StatCard label="Idle switches" value={fmtNumber(idleTotal)} icon={Moon} tone="warning" loading={!data && !error} hint={data ? `On but unused, at ${vendorsWithIdle} vendor${vendorsWithIdle === 1 ? '' : 's'}` : undefined} />
      </StatGrid>

      {!data && !error ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : data ? (
        <>
          <SegmentedControl
            ariaLabel="Section"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'features', label: `Features ${data.features.filter((f) => f.applies).length}` },
              { value: 'vendors', label: `Vendors ${data.tenantCount}` },
            ]}
          />
          {data.tenantCount === 0 && tab === 'features' && (
            <Alert tone="info">No vendors of this type yet. Changes here only set what new vendors start with.</Alert>
          )}
          {tab === 'features' ? (
            <FeaturesTab key={version} detail={data} canManage={canManage} onApply={setRequest} onReset={() => setResetOpen(true)} />
          ) : (
            <VendorsTab key={version} detail={data} canManage={canManage} onApply={setRequest} />
          )}
          {request && canManage && <ApplyModal detail={data} request={request} onClose={closeModal} onDone={onDone} />}
          <ConfirmDialog
            open={resetOpen}
            onCancel={closeReset}
            onConfirm={reset}
            loading={resetting}
            title="Reset new-vendor defaults?"
            description={`New ${label.toLowerCase()} vendors will start with the built-in switches again.`}
            confirmLabel="Reset"
          >
            <ul className="space-y-1.5 text-[13px]">
              {data.presetOverridden.map((k) => {
                const f = data.features.find((x) => x.key === k)
                return (
                  <li key={k} className="flex items-center justify-between gap-2">
                    <span className="text-adm-fg">{f?.label ?? k}</span>
                    <span className="flex items-center gap-1.5 text-adm-subtle">
                      <OnOff on={!!data.preset[k]} /> → <OnOff on={!!data.codePreset[k]} />
                    </span>
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 text-[12.5px] text-adm-subtle">Existing vendors keep their switches.</p>
          </ConfirmDialog>
        </>
      ) : null}
    </AdminPage>
  )
}

export default function BusinessTypePage() {
  const params = useParams<{ type: string }>()
  const type = decodeURIComponent(params?.type ?? '')
  // A new type (sidebar link) starts from a clean state
  return <TypeConsole key={type} type={type} />
}
