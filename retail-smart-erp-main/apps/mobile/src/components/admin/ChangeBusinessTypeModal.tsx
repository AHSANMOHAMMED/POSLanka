// Super admin → vendor → "Change business type" (e.g. supermarket → mall). PUT
// /api/sys-control/vendors/[id]/business-type keeps every item, sale, customer, staff member,
// setting and the Business ID; it only turns on the new type's features / roles / starter data.
import React, { useEffect, useState } from 'react'
import { Alert, Text, View } from 'react-native'
import { adminPut } from '../../lib/adminApi'
import { BUSINESS_TYPES } from '../../lib/adminForms'
import { DEFAULT_MALL_SEGMENTS, MALL, SEGMENT_TYPES, cleanSegments } from '../../lib/businessScope'
import { MALL_DESCRIPTION, businessTypeLabel } from '../../lib/businessTypeLabels'
import { Choice, FormModal, MultiChoice, Notice } from './AdminForm'
import { adminStyles } from './AdminShell'

export interface BusinessTypeChanges {
  featuresTurnedOn?: string[]
  seeded?: Record<string, number>
  rolesAdded?: string[]
}

interface ChangeResponse {
  ok: boolean
  vendor: { id: string; businessType: string; businessSegments: string[] | null }
  changes?: BusinessTypeChanges
}

/** One-paragraph summary of what the server added (nothing is ever removed). */
export function describeTypeChanges(c: BusinessTypeChanges | undefined): string {
  if (!c) return 'No other changes were needed.'
  const parts: string[] = []
  if (c.featuresTurnedOn?.length) parts.push(`Features turned on: ${c.featuresTurnedOn.join(', ')}.`)
  const seeded = Object.entries(c.seeded || {}).filter(([, n]) => n > 0)
  if (seeded.length) parts.push(`Starter data added: ${seeded.map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ')}.`)
  if (c.rolesAdded?.length) parts.push(`Roles available: ${c.rolesAdded.join(', ')}.`)
  return parts.length ? parts.join('\n') : 'No other changes were needed.'
}

export function ChangeBusinessTypeModal({
  visible,
  vendor,
  segmentOptions,
  onClose,
  onChanged,
}: {
  visible: boolean
  vendor: { id: string; name: string; businessType: string; businessSegments?: string[] | null; businessId?: string | null }
  /** From GET vendors/[id] `segmentTypes`; falls back to the app's list. */
  segmentOptions?: Array<{ value: string; label: string }> | null
  onClose: () => void
  onChanged: (vendor: ChangeResponse['vendor'], changes: BusinessTypeChanges | undefined) => void
}) {
  const [type, setType] = useState<string>(vendor.businessType)
  const [segments, setSegments] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Start from the vendor's current values each time the sheet opens
  useEffect(() => {
    if (!visible) return
    setType(vendor.businessType)
    const current = cleanSegments(vendor.businessSegments)
    setSegments(current.length ? current : vendor.businessType !== MALL && (SEGMENT_TYPES as readonly string[]).includes(vendor.businessType) ? [vendor.businessType] : [...DEFAULT_MALL_SEGMENTS])
    setError(null)
  }, [visible, vendor.businessType, vendor.businessSegments])

  const options = segmentOptions?.length ? segmentOptions : SEGMENT_TYPES.map((t) => ({ value: t, label: businessTypeLabel(t) }))
  const cleaned = cleanSegments(segments)
  const sameType = type === vendor.businessType && (type !== MALL || cleaned.join(',') === cleanSegments(vendor.businessSegments).join(','))

  function confirm() {
    if (type === MALL && cleaned.length === 0) {
      setError('Tick at least one shop type the mall runs.')
      return
    }
    const target = type === MALL ? `${businessTypeLabel(MALL)} (${cleaned.map(businessTypeLabel).join(', ')})` : businessTypeLabel(type)
    Alert.alert(
      'Change business type?',
      `${vendor.name} becomes ${target}.\n\nAll items, stock, sales, customers, staff, settings and the Business ID${vendor.businessId ? ` ${vendor.businessId}` : ''} are kept. Signed-in staff see the new menus within a few seconds.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Change type', onPress: submit },
      ]
    )
  }

  async function submit() {
    setBusy(true)
    setError(null)
    const body: Record<string, unknown> = { businessType: type }
    if (type === MALL) body.businessSegments = cleaned
    const res = await adminPut<ChangeResponse>(`/api/sys-control/vendors/${vendor.id}/business-type`, body)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onChanged(res.data.vendor, res.data.changes)
  }

  return (
    <FormModal
      visible={visible}
      title="Change business type"
      message={`Now: ${businessTypeLabel(vendor.businessType)}`}
      confirmLabel="Change type"
      busy={busy}
      disabled={sameType}
      onCancel={onClose}
      onConfirm={confirm}
    >
      {error ? <Notice tone="error" text={error} /> : null}
      <Choice label="New business type" value={type} onChange={setType} options={BUSINESS_TYPES.map((t) => ({ value: t, label: businessTypeLabel(t) }))} />
      {type === MALL ? (
        <View>
          <Text style={adminStyles.muted}>{MALL_DESCRIPTION}.</Text>
          <MultiChoice label="Shop types in this mall *" values={segments} onChange={setSegments} options={options} />
        </View>
      ) : null}
      <Notice text="Nothing is deleted: items, stock, sales, customers, staff, settings and the Business ID stay as they are. The new type's menus, features and roles are added." />
    </FormModal>
  )
}
