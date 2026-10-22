'use client'

// H5: create / edit a price list header (rules are edited on /price-lists/[id]).
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { Modal } from '@/components/ui/modal'
import { FormInput, FormSelect, FormLabel } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { EntityMultiPicker, fetchLabels, type PickedOption } from './EntityMultiPicker'

export interface PriceListRow {
  id: string
  name: string
  currency: string
  priority: number
  isActive: boolean
  validFrom: string | null
  validTo: string | null
  appliesTo: 'all' | 'customer_group' | 'customers' | 'pos_profiles'
  customerTypes: string[]
  customerIds: string[]
  posProfileIds: string[]
  notes: string | null
  itemCount?: number
}

const APPLIES: Record<PriceListRow['appliesTo'], string> = {
  all: 'Everyone',
  customer_group: 'Customer group',
  customers: 'Specific customers',
  pos_profiles: 'POS profiles',
}

export function PriceListFormModal({ isOpen, editList, onClose, onSaved }: {
  isOpen: boolean; editList: PriceListRow | null; onClose: () => void; onSaved: (row: PriceListRow) => void
}) {
  const [form, setForm] = useState({
    name: '', currency: 'LKR', priority: '0', isActive: true, validFrom: '', validTo: '',
    appliesTo: 'all' as PriceListRow['appliesTo'], customerTypes: [] as string[], notes: '',
  })
  const [customers, setCustomers] = useState<PickedOption[]>([])
  const [profiles, setProfiles] = useState<PickedOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setError('')
    setForm({
      name: editList?.name || '', currency: editList?.currency || 'LKR', priority: String(editList?.priority ?? 0),
      isActive: editList?.isActive ?? true, validFrom: editList?.validFrom || '', validTo: editList?.validTo || '',
      appliesTo: editList?.appliesTo || 'all', customerTypes: editList?.customerTypes || [], notes: editList?.notes || '',
    })
    setCustomers([]); setProfiles([])
    if (editList?.customerIds.length) fetchLabels('customers', editList.customerIds).then(setCustomers)
    if (editList?.posProfileIds.length) fetchLabels('posProfiles', editList.posProfileIds).then(setProfiles)
  }, [isOpen, editList])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const res = await fetch(editList ? `/api/price-lists/${editList.id}` : '/api/price-lists', {
        method: editList ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          priority: parseInt(form.priority) || 0,
          validFrom: form.validFrom || undefined,
          validTo: form.validTo || undefined,
          customerIds: customers.map((c) => c.id),
          posProfileIds: profiles.map((p) => p.id),
          notes: form.notes || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.details?.[0]?.message || data.error || 'Failed to save'); return }
      toast.success(editList ? 'Price list updated' : 'Price list created')
      onSaved(data)
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editList ? 'Edit Price List' : 'New Price List'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <FormLabel required>Name</FormLabel>
            <FormInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Wholesale" required />
          </div>
          <div>
            <FormLabel>Priority</FormLabel>
            <FormInput type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} />
            <p className="text-xs text-gray-500 mt-1">Higher wins when several lists apply</p>
          </div>
          <div>
            <FormLabel>Valid from</FormLabel>
            <FormInput type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} />
          </div>
          <div>
            <FormLabel>Valid to</FormLabel>
            <FormInput type="date" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} />
          </div>
          <div>
            <FormLabel>Currency</FormLabel>
            <FormInput value={form.currency} maxLength={3} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
          </div>
        </div>
        <div>
          <FormLabel>Applies to</FormLabel>
          <FormSelect value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value as PriceListRow['appliesTo'] })}>
            {Object.entries(APPLIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </FormSelect>
        </div>
        {form.appliesTo === 'customer_group' && (
          <div className="flex gap-4">
            {['retail', 'wholesale', 'vip'].map((g) => (
              <label key={g} className="flex items-center gap-2 text-sm dark:text-gray-300">
                <input type="checkbox" checked={form.customerTypes.includes(g)}
                  onChange={(e) => setForm({ ...form, customerTypes: e.target.checked ? [...form.customerTypes, g] : form.customerTypes.filter((x) => x !== g) })} />
                {g === 'vip' ? 'VIP' : g[0].toUpperCase() + g.slice(1)}
              </label>
            ))}
          </div>
        )}
        {form.appliesTo === 'customers' && <EntityMultiPicker entity="customers" value={customers} onChange={setCustomers} placeholder="Search customers…" />}
        {form.appliesTo === 'pos_profiles' && <EntityMultiPicker entity="posProfiles" value={profiles} onChange={setProfiles} placeholder="Search POS profiles…" />}
        <div>
          <FormLabel>Notes</FormLabel>
          <FormInput value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm dark:text-gray-300">
          <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active
        </label>
        {error && <div className="p-2 text-sm text-red-700 bg-red-50 dark:bg-red-900/20 dark:text-red-300 rounded">{error}</div>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  )
}
