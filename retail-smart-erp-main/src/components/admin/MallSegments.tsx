'use client'

import { useState } from 'react'
import { Building2 } from 'lucide-react'
import { AdminModal, Alert, Badge, Button, Field, Select, BUSINESS_TYPE_LABELS, businessTypeLabel } from '@/components/admin/kit'
import { adminFetch } from '@/components/admin/console-helpers'
import { getBusinessType } from '@/lib/constants/business-types'
import { DEFAULT_MALL_SEGMENTS, MALL, SEGMENT_TYPES, cleanSegments, scopeTypes } from '@/lib/business-types/scope'
import { FEATURE_DEFS, FEATURE_FLAG_LABELS, defaultFeatureFlagsForBusinessType, featureAppliesTo } from '@/lib/features/flags'
import { cn } from '@/lib/utils'

/** Tick boxes for the business types a mall runs (at least one is required). */
export function MallSegmentPicker({ value, onChange, error, disabled }: {
  value: string[]
  onChange: (next: string[]) => void
  error?: string
  disabled?: boolean
}) {
  function toggle(t: string) {
    onChange(cleanSegments(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]))
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SEGMENT_TYPES.map((t) => {
          const def = getBusinessType(t)
          const Icon = def?.icon
          const on = value.includes(t)
          return (
            <label
              key={t}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13.5px] transition-colors',
                on ? 'border-adm-primary bg-adm-surface-2' : 'border-adm-border hover:bg-adm-surface-2',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input type="checkbox" className="adm-checkbox mt-0.5 shrink-0" checked={on} disabled={disabled} onChange={() => toggle(t)} />
              {Icon && <Icon size={16} className="mt-0.5 shrink-0 text-adm-muted" aria-hidden />}
              <span className="min-w-0">
                <span className="block font-medium text-adm-fg">{businessTypeLabel(t)}</span>
                {def?.description && <span className="block text-[12px] leading-snug text-adm-subtle">{def.description}</span>}
              </span>
            </label>
          )
        })}
      </div>
      {error && <p className="text-[12.5px] text-adm-danger">{error}</p>}
    </div>
  )
}

/** "Mall / multi-shop" followed by its segments as chips; any other type is its plain label. */
export function BusinessTypeChips({ type, segments, className, max }: {
  type: string
  segments?: readonly string[] | null
  className?: string
  /** Show at most this many chips, then "+N" */
  max?: number
}) {
  if (type !== MALL) return <span className={className}>{businessTypeLabel(type)}</span>
  const list = scopeTypes({ businessType: type, businessSegments: segments })
  const shown = max ? list.slice(0, max) : list
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      <span className="inline-flex items-center gap-1"><Building2 size={13} aria-hidden />{businessTypeLabel(type)}</span>
      {shown.map((s) => <Badge key={s} tone="info">{businessTypeLabel(s)}</Badge>)}
      {max && list.length > max && <Badge tone="neutral">+{list.length - max}</Badge>}
    </span>
  )
}

export interface BusinessTypeChangeResult {
  ok: true
  vendor: { id: string; businessType: string; businessSegments: string[] | null }
  changes: { featuresTurnedOn: string[]; seeded: Record<string, number>; rolesAdded: string[] }
}

/** Features the new type(s) switch on that the current type(s) did not cover (preview only). */
function featuresGained(from: { businessType: string; businessSegments: string[] | null }, to: { businessType: string; businessSegments: string[] | null }): string[] {
  const presets = defaultFeatureFlagsForBusinessType(to)
  return FEATURE_DEFS
    .filter((d) => d.businessTypes && presets[d.key] && featureAppliesTo(d.key, to) && !featureAppliesTo(d.key, from))
    .map((d) => d.label)
}

/**
 * Super admin: change a vendor's business type (e.g. supermarket → mall). Everything the vendor
 * has is kept; the server switches on the new types' features and adds missing defaults.
 */
export function ChangeBusinessTypeDialog({ open, onClose, vendorId, vendorName, currentType, currentSegments, onChanged }: {
  open: boolean
  onClose: () => void
  vendorId: string
  vendorName: string
  currentType: string
  currentSegments: string[] | null
  onChanged: (result: BusinessTypeChangeResult) => void
}) {
  const [type, setType] = useState(currentType)
  // Converting a single-type shop to a mall starts with its own type ticked
  const [segments, setSegments] = useState<string[]>(
    currentType === MALL ? cleanSegments(currentSegments ?? DEFAULT_MALL_SEGMENTS) : cleanSegments([currentType]),
  )
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isMallType = type === MALL
  const from = { businessType: currentType, businessSegments: currentSegments }
  const to = { businessType: type, businessSegments: isMallType ? segments : null }
  const unchanged = type === currentType && (!isMallType || scopeTypes(to).join(',') === scopeTypes(from).join(','))
  const invalid = isMallType && segments.length === 0
  const gained = featuresGained(from, to)
  const removedTypes = scopeTypes(from).filter((t) => !scopeTypes(to).includes(t))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await adminFetch<BusinessTypeChangeResult>(`/api/sys-control/vendors/${vendorId}/business-type`, {
        method: 'PUT',
        json: { businessType: type, ...(isMallType ? { businessSegments: segments } : {}) },
      })
      onChanged(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change the business type')
      setConfirming(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <AdminModal
      open={open}
      onClose={saving ? () => {} : onClose}
      size="lg"
      title={confirming ? 'Confirm business type change' : 'Change business type'}
      description={vendorName}
      footer={
        confirming ? (
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={saving}>Back</Button>
            <Button onClick={save} loading={saving}>Change to {businessTypeLabel(type)}</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => setConfirming(true)} disabled={unchanged || invalid}>Continue</Button>
          </>
        )
      }
    >
      {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
      {!confirming ? (
        <div className="space-y-4">
          <Field label="Business type" htmlFor="bt-type" hint="A mall / multi-shop runs several shop types in one business, with the menus and features of all of them.">
            <Select id="bt-type" value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(BUSINESS_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}{v === currentType ? ' (current)' : ''}</option>)}
            </Select>
          </Field>
          {isMallType && (
            <Field label="Shop types in this mall" required hint="Tick every kind of shop it runs. Counters (POS profiles) can then be set to one of these, e.g. a food-court counter as Restaurant.">
              <MallSegmentPicker value={segments} onChange={setSegments} error={invalid ? 'Tick at least one shop type' : undefined} />
            </Field>
          )}
          {unchanged && <p className="text-[13px] text-adm-muted">This is the vendor’s current business type.</p>}
        </div>
      ) : (
        <div className="space-y-3 text-[13.5px]">
          <p>
            <strong>{vendorName}</strong> changes from <strong>{businessTypeLabel(currentType)}</strong>
            {currentType === MALL && currentSegments?.length ? ` (${currentSegments.map(businessTypeLabel).join(', ')})` : ''} to{' '}
            <strong>{businessTypeLabel(type)}</strong>{isMallType ? ` (${segments.map(businessTypeLabel).join(', ')})` : ''}.
          </p>
          <Alert tone="success" title="Everything is kept">
            All items, stock, sales, customers, suppliers, accounts, staff, settings and the same Business ID stay exactly as they are. Nothing is deleted or rewritten.
          </Alert>
          <div>
            <p className="font-medium text-adm-fg">Features that will switch on</p>
            {gained.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">{gained.map((g) => <Badge key={g} tone="primary">{g}</Badge>)}</div>
            ) : (
              <p className="text-adm-muted">No extra features — the vendor already has what the new type uses.</p>
            )}
            <p className="mt-1 text-[12.5px] text-adm-subtle">Missing defaults for the new types (roles, categories, tables …) are added; existing switches you turned off stay off.</p>
          </div>
          {removedTypes.length > 0 && (
            <Alert tone="warning" title="Menus that will be hidden">
              {removedTypes.map(businessTypeLabel).join(', ')} menus disappear for this vendor. Their data is kept and comes back if the type is added again.
            </Alert>
          )}
          <p className="text-adm-muted">Signed-in staff see the new menus within a few seconds (web and app), without signing out.</p>
        </div>
      )}
    </AdminModal>
  )
}

/** The API's report after a change: features switched on, defaults added, roles added. */
export function BusinessTypeChangeSummary({ result }: { result: BusinessTypeChangeResult }) {
  const { changes } = result
  const seeded = Object.entries(changes.seeded || {}).filter(([, n]) => n > 0)
  return (
    <div className="space-y-1 text-[13px]">
      <p>
        Now <strong>{businessTypeLabel(result.vendor.businessType)}</strong>
        {result.vendor.businessType === MALL && result.vendor.businessSegments?.length
          ? ` (${result.vendor.businessSegments.map(businessTypeLabel).join(', ')})`
          : ''}. All data, staff, settings and the Business ID were kept.
      </p>
      <p>
        Features switched on:{' '}
        {changes.featuresTurnedOn?.length
          ? changes.featuresTurnedOn.map((k) => (FEATURE_FLAG_LABELS as Record<string, string>)[k] ?? k).join(', ')
          : 'none'}
      </p>
      {seeded.length > 0 && <p>Defaults added: {seeded.map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ')}</p>}
      {changes.rolesAdded?.length > 0 && <p>Roles now available: {changes.rolesAdded.join(', ')}</p>}
    </div>
  )
}
