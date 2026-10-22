'use client'

// H5: create / edit a promotion (engine rules: src/lib/pricing/engine.ts).
import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui'
import { Modal } from '@/components/ui/modal'
import { FormInput, FormSelect, FormLabel } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { EntityMultiPicker, fetchLabels, type PickedOption } from './EntityMultiPicker'

export type PromotionType = 'percent_off' | 'fixed_off' | 'buy_x_get_y' | 'bundle_price' | 'min_spend'

export interface PromotionRow {
  id: string
  name: string
  description: string | null
  type: PromotionType
  applyTo: 'items' | 'categories' | 'cart'
  discountType: 'percent' | 'fixed'
  value: string
  itemIds: string[]
  categoryIds: string[]
  buyQty: string | null
  getQty: string | null
  getItemIds: string[]
  getDiscountPercent: string
  bundleItems: Array<{ itemId: string; qty: number }>
  bundlePrice: string | null
  minSpend: string | null
  startsOn: string | null
  endsOn: string | null
  daysOfWeek: number[]
  timeFrom: string | null
  timeTo: string | null
  posProfileIds: string[]
  customerTypes: string[]
  priority: number
  stackable: boolean
  couponCode: string | null
  usageLimit: number | null
  perCustomerLimit: number | null
  usageCount: number
  isActive: boolean
  label?: string
}

export const PROMOTION_TYPES: Record<PromotionType, string> = {
  percent_off: '% off',
  fixed_off: 'Amount off',
  buy_x_get_y: 'Buy X get Y',
  bundle_price: 'Bundle price',
  min_spend: 'Spend & save (cart)',
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const blank = {
  name: '', description: '', type: 'percent_off' as PromotionType, applyTo: 'items' as PromotionRow['applyTo'],
  discountType: 'percent' as PromotionRow['discountType'], value: '', buyQty: '1', getQty: '1', getDiscountPercent: '100',
  bundlePrice: '', minSpend: '', startsOn: '', endsOn: '', daysOfWeek: [] as number[], timeFrom: '', timeTo: '',
  customerTypes: [] as string[], priority: '0', stackable: false, couponCode: '', usageLimit: '', perCustomerLimit: '', isActive: true,
}

const s = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(Number(v)))

export function PromotionFormModal({ isOpen, edit, onClose, onSaved }: {
  isOpen: boolean; edit: PromotionRow | null; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState(blank)
  const [items, setItems] = useState<PickedOption[]>([])
  const [categories, setCategories] = useState<PickedOption[]>([])
  const [getItems, setGetItems] = useState<PickedOption[]>([])
  const [bundle, setBundle] = useState<Array<{ item: PickedOption; qty: string }>>([])
  const [profiles, setProfiles] = useState<PickedOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setError('')
    if (!edit) {
      setForm(blank); setItems([]); setCategories([]); setGetItems([]); setBundle([]); setProfiles([])
      return
    }
    setForm({
      name: edit.name, description: edit.description || '', type: edit.type, applyTo: edit.applyTo, discountType: edit.discountType,
      value: s(edit.value), buyQty: s(edit.buyQty) || '1', getQty: s(edit.getQty) || '1', getDiscountPercent: s(edit.getDiscountPercent) || '100',
      bundlePrice: s(edit.bundlePrice), minSpend: s(edit.minSpend), startsOn: edit.startsOn || '', endsOn: edit.endsOn || '',
      daysOfWeek: edit.daysOfWeek || [], timeFrom: edit.timeFrom?.slice(0, 5) || '', timeTo: edit.timeTo?.slice(0, 5) || '',
      customerTypes: edit.customerTypes || [], priority: String(edit.priority), stackable: edit.stackable, couponCode: edit.couponCode || '',
      usageLimit: edit.usageLimit ? String(edit.usageLimit) : '', perCustomerLimit: edit.perCustomerLimit ? String(edit.perCustomerLimit) : '',
      isActive: edit.isActive,
    })
    fetchLabels('items', edit.itemIds).then(setItems)
    fetchLabels('categories', edit.categoryIds).then(setCategories)
    fetchLabels('items', edit.getItemIds).then(setGetItems)
    fetchLabels('posProfiles', edit.posProfileIds).then(setProfiles)
    fetchLabels('items', edit.bundleItems.map((b) => b.itemId)).then((labels) =>
      setBundle(edit.bundleItems.map((b, i) => ({ item: labels[i], qty: String(b.qty) }))))
  }, [isOpen, edit])

  const num = (v: string) => (v === '' ? undefined : Number(v))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body = {
        name: form.name,
        description: form.description || undefined,
        type: form.type,
        applyTo: form.applyTo,
        discountType: form.discountType,
        value: Number(form.value) || 0,
        itemIds: items.map((i) => i.id),
        categoryIds: categories.map((c) => c.id),
        buyQty: num(form.buyQty),
        getQty: num(form.getQty),
        getItemIds: getItems.map((i) => i.id),
        getDiscountPercent: num(form.getDiscountPercent),
        bundleItems: bundle.filter((b) => b.item).map((b) => ({ itemId: b.item.id, qty: Number(b.qty) || 1 })),
        bundlePrice: num(form.bundlePrice),
        minSpend: num(form.minSpend),
        startsOn: form.startsOn || undefined,
        endsOn: form.endsOn || undefined,
        daysOfWeek: form.daysOfWeek,
        timeFrom: form.timeFrom || undefined,
        timeTo: form.timeTo || undefined,
        posProfileIds: profiles.map((p) => p.id),
        customerTypes: form.customerTypes,
        priority: parseInt(form.priority) || 0,
        stackable: form.stackable,
        couponCode: form.couponCode || undefined,
        usageLimit: num(form.usageLimit),
        perCustomerLimit: num(form.perCustomerLimit),
        isActive: form.isActive,
      }
      const res = await fetch(edit ? `/api/promotions/${edit.id}` : '/api/promotions', {
        method: edit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.details?.[0]?.message || data.error || 'Failed to save'); return }
      toast.success(edit ? 'Promotion updated' : 'Promotion created')
      onSaved()
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const t = form.type
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={edit ? 'Edit Promotion' : 'New Promotion'} size="2xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <FormLabel required>Name</FormLabel>
            <FormInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Avurudu soap offer" required />
          </div>
          <div>
            <FormLabel>Type</FormLabel>
            <FormSelect value={t} onChange={(e) => setForm({ ...form, type: e.target.value as PromotionType })}>
              {Object.entries(PROMOTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </FormSelect>
          </div>
        </div>

        {(t === 'percent_off' || t === 'fixed_off') && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <FormLabel>Applies to</FormLabel>
              <FormSelect value={form.applyTo} onChange={(e) => setForm({ ...form, applyTo: e.target.value as PromotionRow['applyTo'] })}>
                <option value="items">Selected items</option>
                <option value="categories">Categories</option>
                <option value="cart">Whole bill</option>
              </FormSelect>
            </div>
            <div>
              <FormLabel>{t === 'percent_off' ? 'Discount %' : form.applyTo === 'cart' ? 'Amount off the bill' : 'Amount off each'}</FormLabel>
              <FormInput type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} required />
            </div>
          </div>
        )}
        {(t === 'percent_off' || t === 'fixed_off') && form.applyTo === 'items' && <EntityMultiPicker entity="items" value={items} onChange={setItems} placeholder="Add items…" />}
        {(t === 'percent_off' || t === 'fixed_off') && form.applyTo === 'categories' && <EntityMultiPicker entity="categories" value={categories} onChange={setCategories} placeholder="Add categories…" />}

        {t === 'buy_x_get_y' && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-4">
              <div><FormLabel>Buy qty</FormLabel><FormInput type="number" min="1" value={form.buyQty} onChange={(e) => setForm({ ...form, buyQty: e.target.value })} /></div>
              <div><FormLabel>Get qty</FormLabel><FormInput type="number" min="1" value={form.getQty} onChange={(e) => setForm({ ...form, getQty: e.target.value })} /></div>
              <div><FormLabel>Discount on the &quot;get&quot; items %</FormLabel><FormInput type="number" min="1" max="100" value={form.getDiscountPercent} onChange={(e) => setForm({ ...form, getDiscountPercent: e.target.value })} /></div>
            </div>
            <div><FormLabel>Buy (items)</FormLabel><EntityMultiPicker entity="items" value={items} onChange={setItems} placeholder="Items that qualify…" /></div>
            <div><FormLabel>Buy (categories)</FormLabel><EntityMultiPicker entity="categories" value={categories} onChange={setCategories} placeholder="…or whole categories" /></div>
            <div>
              <FormLabel>Get (items)</FormLabel>
              <EntityMultiPicker entity="items" value={getItems} onChange={setGetItems} placeholder="Leave empty: same items as bought (BOGO)" />
              <p className="text-xs text-gray-500 mt-1">The cheapest qualifying units get the discount.</p>
            </div>
          </div>
        )}

        {t === 'bundle_price' && (
          <div className="space-y-2">
            <FormLabel>Bundle items</FormLabel>
            {bundle.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="flex-1 text-sm dark:text-gray-200">{b.item?.label}</span>
                <input type="number" min="1" className="w-20 px-2 py-1 text-sm border rounded dark:bg-gray-800 dark:border-gray-600 dark:text-white" value={b.qty}
                  onChange={(e) => setBundle(bundle.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
                <button type="button" aria-label="Remove" onClick={() => setBundle(bundle.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><Trash2 size={16} /></button>
              </div>
            ))}
            <EntityMultiPicker entity="items" single value={[]} placeholder="Add item to bundle…" onChange={(v) => v[0] && setBundle([...bundle, { item: v[0], qty: '1' }])} />
            <div className="w-48"><FormLabel>Bundle price</FormLabel><FormInput type="number" min="0" step="0.01" value={form.bundlePrice} onChange={(e) => setForm({ ...form, bundlePrice: e.target.value })} /></div>
          </div>
        )}

        {t === 'min_spend' && (
          <div className="grid grid-cols-3 gap-4">
            <div><FormLabel>Minimum bill</FormLabel><FormInput type="number" min="0" step="0.01" value={form.minSpend} onChange={(e) => setForm({ ...form, minSpend: e.target.value })} /></div>
            <div>
              <FormLabel>Discount</FormLabel>
              <FormSelect value={form.discountType} onChange={(e) => setForm({ ...form, discountType: e.target.value as PromotionRow['discountType'] })}>
                <option value="percent">% of the bill</option>
                <option value="fixed">Fixed amount</option>
              </FormSelect>
            </div>
            <div><FormLabel>Value</FormLabel><FormInput type="number" min="0" step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></div>
          </div>
        )}

        <details className="border rounded dark:border-gray-700 p-3" open={!!(form.startsOn || form.endsOn || form.timeFrom || form.daysOfWeek.length)}>
          <summary className="text-sm font-medium cursor-pointer dark:text-gray-200">Schedule</summary>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
            <div><FormLabel>From date</FormLabel><FormInput type="date" value={form.startsOn} onChange={(e) => setForm({ ...form, startsOn: e.target.value })} /></div>
            <div><FormLabel>To date</FormLabel><FormInput type="date" value={form.endsOn} onChange={(e) => setForm({ ...form, endsOn: e.target.value })} /></div>
            <div><FormLabel>From time</FormLabel><FormInput type="time" value={form.timeFrom} onChange={(e) => setForm({ ...form, timeFrom: e.target.value })} /></div>
            <div><FormLabel>To time</FormLabel><FormInput type="time" value={form.timeTo} onChange={(e) => setForm({ ...form, timeTo: e.target.value })} /></div>
          </div>
          <p className="text-xs text-gray-500 mt-1">An end time before the start time runs past midnight (e.g. 22:00 – 02:00).</p>
          <div className="flex flex-wrap gap-3 mt-3">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1 text-sm dark:text-gray-300">
                <input type="checkbox" checked={form.daysOfWeek.includes(i)}
                  onChange={(e) => setForm({ ...form, daysOfWeek: e.target.checked ? [...form.daysOfWeek, i] : form.daysOfWeek.filter((x) => x !== i) })} />
                {d}
              </label>
            ))}
            <span className="text-xs text-gray-500 self-center">None ticked = every day</span>
          </div>
        </details>

        <details className="border rounded dark:border-gray-700 p-3">
          <summary className="text-sm font-medium cursor-pointer dark:text-gray-200">Who, how often, combining</summary>
          <div className="space-y-3 mt-3">
            <div className="flex flex-wrap gap-4 items-center">
              <span className="text-sm dark:text-gray-300">Customer groups:</span>
              {['retail', 'wholesale', 'vip'].map((g) => (
                <label key={g} className="flex items-center gap-1 text-sm dark:text-gray-300">
                  <input type="checkbox" checked={form.customerTypes.includes(g)}
                    onChange={(e) => setForm({ ...form, customerTypes: e.target.checked ? [...form.customerTypes, g] : form.customerTypes.filter((x) => x !== g) })} />
                  {g === 'vip' ? 'VIP' : g[0].toUpperCase() + g.slice(1)}
                </label>
              ))}
              <span className="text-xs text-gray-500">None = everyone</span>
            </div>
            <div><FormLabel>POS profiles (none = all counters)</FormLabel><EntityMultiPicker entity="posProfiles" value={profiles} onChange={setProfiles} /></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div><FormLabel>Priority</FormLabel><FormInput type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></div>
              <div><FormLabel>Coupon code</FormLabel><FormInput value={form.couponCode} placeholder="Optional" onChange={(e) => setForm({ ...form, couponCode: e.target.value.toUpperCase() })} /></div>
              <div><FormLabel>Total uses</FormLabel><FormInput type="number" min="1" value={form.usageLimit} placeholder="Unlimited" onChange={(e) => setForm({ ...form, usageLimit: e.target.value })} /></div>
              <div><FormLabel>Uses per customer</FormLabel><FormInput type="number" min="1" value={form.perCustomerLimit} placeholder="Unlimited" onChange={(e) => setForm({ ...form, perCustomerLimit: e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm dark:text-gray-300">
              <input type="checkbox" checked={form.stackable} onChange={(e) => setForm({ ...form, stackable: e.target.checked })} />
              Can combine with other combinable promotions (otherwise exclusive on its items)
            </label>
          </div>
        </details>

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
