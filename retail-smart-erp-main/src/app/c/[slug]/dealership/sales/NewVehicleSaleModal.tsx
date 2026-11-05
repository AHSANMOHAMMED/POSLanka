'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormSelect, FormTextarea } from '@/components/ui/form-elements'
import { AsyncCreatableSelect, type AsyncSelectOption } from '@/components/ui/async-creatable-select'
import { toast } from '@/components/ui/toast'
import { roundCurrency } from '@/lib/utils/currency'

interface Vehicle {
  id: string
  stockNo: string | null
  vin: string | null
  year: number | null
  makeName: string | null
  modelName: string | null
  trim: string | null
  askingPrice: string | null
  minimumPrice: string | null
}

interface FinancingOption {
  id: string
  lenderName: string
  interestRateMin: string | null
  maxTermMonths: number | null
}

const btn = 'px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
const btnPrimary = 'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'

const num = (v: string) => (v.trim() === '' ? 0 : Number(v))
const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function vehicleLabel(v: Pick<Vehicle, 'year' | 'makeName' | 'modelName' | 'trim'>): string {
  return [v.year, v.makeName, v.modelName, v.trim].filter(Boolean).join(' ')
}

/** Monthly instalment of an amortised loan (0 % interest = equal parts). */
export function monthlyInstalment(principal: number, annualRatePercent: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0
  const r = annualRatePercent / 100 / 12
  if (r === 0) return roundCurrency(principal / months)
  return roundCurrency((principal * r) / (1 - Math.pow(1 + r, -months)))
}

export function NewVehicleSaleModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null)
  const [lenders, setLenders] = useState<FinancingOption[]>([])
  const [vehicleId, setVehicleId] = useState('')
  const [customer, setCustomer] = useState<AsyncSelectOption | null>(null)
  const [price, setPrice] = useState('')
  const [tradeIn, setTradeIn] = useState('')
  const [tax, setTax] = useState('')
  const [down, setDown] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [financingOptionId, setFinancing] = useState('')
  const [interestRate, setRate] = useState('')
  const [termMonths, setTerm] = useState('')
  const [warrantyType, setWarrantyType] = useState('')
  const [warrantyMonths, setWarrantyMonths] = useState('')
  const [deliveryDate, setDeliveryDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([
      fetch('/api/vehicle-inventory?all=true&status=available').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/financing-options?all=true&isActive=true').then((r) => (r.ok ? r.json() : [])),
    ]).then(([v, f]) => {
      if (!alive) return
      setVehicles(Array.isArray(v) ? v : v?.data ?? [])
      setLenders(Array.isArray(f) ? f : f?.data ?? [])
    }).catch(() => { if (alive) setVehicles([]) })
    return () => { alive = false }
  }, [])

  const vehicle = vehicles?.find((v) => v.id === vehicleId) ?? null
  const total = roundCurrency(Math.max(0, num(price) - num(tradeIn)) + num(tax))
  const balance = roundCurrency(Math.max(0, total - num(down)))
  const instalment = useMemo(
    () => (financingOptionId ? monthlyInstalment(balance, num(interestRate), Math.trunc(num(termMonths))) : 0),
    [financingOptionId, balance, interestRate, termMonths],
  )

  function pickVehicle(id: string) {
    setVehicleId(id)
    const v = vehicles?.find((x) => x.id === id)
    if (v?.askingPrice) setPrice(String(Number(v.askingPrice)))
  }

  function pickLender(id: string) {
    setFinancing(id)
    const l = lenders.find((x) => x.id === id)
    if (l?.interestRateMin && !interestRate) setRate(String(Number(l.interestRateMin)))
    if (l?.maxTermMonths && !termMonths) setTerm(String(l.maxTermMonths))
    if (id) setPaymentMethod('bank_transfer')
  }

  async function fetchCustomers(search: string): Promise<AsyncSelectOption[]> {
    const res = await fetch(`/api/customers?pageSize=20&search=${encodeURIComponent(search)}`)
    if (!res.ok) return []
    const body = await res.json()
    const list: Array<{ id: string; name: string; phone?: string | null }> = Array.isArray(body) ? body : body.data ?? []
    return list.map((c) => ({ value: c.id, label: c.phone ? `${c.name} · ${c.phone}` : c.name }))
  }

  async function save() {
    if (!vehicle) { toast.error('Choose a vehicle'); return }
    if (!(num(price) > 0)) { toast.error('Enter the sale price'); return }
    if (num(tradeIn) > num(price)) { toast.error('Trade-in cannot be more than the price'); return }
    if (num(down) > total) { toast.error('Down payment cannot be more than the total'); return }
    if (balance > 0 && !customer) { toast.error('Choose a customer: they owe the balance after the down payment'); return }
    if (vehicle.minimumPrice && num(price) < Number(vehicle.minimumPrice)
      && !window.confirm(`The price is below this vehicle's minimum (${fmt(Number(vehicle.minimumPrice))}). Sell anyway?`)) return

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        vehicleInventoryId: vehicle.id,
        customerId: customer?.value,
        askingPrice: num(price),
        tradeInAllowance: num(tradeIn),
        taxAmount: num(tax),
        downPayment: num(down),
        paymentMethod,
        financingOptionId: financingOptionId || undefined,
        warrantyType: warrantyType || undefined,
        warrantyMonths: warrantyMonths ? Math.trunc(num(warrantyMonths)) : undefined,
        deliveryDate: deliveryDate || undefined,
        notes: notes || undefined,
      }
      if (financingOptionId) {
        body.financeAmount = balance
        body.interestRate = num(interestRate)
        body.loanTermMonths = Math.trunc(num(termMonths))
        body.monthlyPayment = instalment
      }
      const res = await fetch('/api/vehicle-sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error || 'Failed to record the sale')
      toast.success(`Sold: ${vehicleLabel(vehicle)} (${out.sale?.invoiceNo ?? 'invoice created'})`)
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to record the sale')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="New vehicle sale" size="lg" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving || !vehicle} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Record sale</button>
      </ModalFooter>
    }>
      <div className="space-y-4">
        <FormField label="Vehicle" required hint={vehicles && vehicles.length === 0 ? 'No vehicles are available for sale. Add one under Dealership → Inventory.' : undefined}>
          <FormSelect value={vehicleId} onChange={(e) => pickVehicle(e.target.value)} disabled={!vehicles}>
            <option value="">{vehicles ? 'Choose an available vehicle' : 'Loading vehicles…'}</option>
            {(vehicles ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {vehicleLabel(v) || 'Vehicle'}{v.stockNo ? ` · ${v.stockNo}` : ''}{v.vin ? ` · ${v.vin}` : ''}{v.askingPrice ? ` · ${fmt(Number(v.askingPrice))}` : ''}
              </option>
            ))}
          </FormSelect>
        </FormField>

        <FormField label="Customer" hint="Needed when part of the price is financed or paid later">
          <AsyncCreatableSelect
            fetchOptions={fetchCustomers}
            value={customer?.value ?? ''}
            selectedOption={customer}
            onChange={(_v, option) => setCustomer(option)}
            placeholder="Search customers by name or phone"
          />
        </FormField>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label="Sale price" required><FormInput type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></FormField>
          <FormField label="Trade-in allowance"><FormInput type="number" min="0" step="0.01" value={tradeIn} onChange={(e) => setTradeIn(e.target.value)} /></FormField>
          <FormField label="Tax"><FormInput type="number" min="0" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} /></FormField>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Down payment"><FormInput type="number" min="0" step="0.01" value={down} onChange={(e) => setDown(e.target.value)} /></FormField>
          <FormField label="Paid by">
            <FormSelect value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cheque">Cheque</option>
            </FormSelect>
          </FormField>
        </div>

        <div className="rounded border border-gray-200 dark:border-gray-700 p-3 space-y-3">
          <FormField label="Financing" hint="The balance after the down payment is financed by this lender">
            <FormSelect value={financingOptionId} onChange={(e) => pickLender(e.target.value)}>
              <option value="">No financing (customer pays the balance)</option>
              {lenders.map((l) => <option key={l.id} value={l.id}>{l.lenderName}</option>)}
            </FormSelect>
          </FormField>
          {financingOptionId && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label="Interest rate (% a year)"><FormInput type="number" min="0" step="0.01" value={interestRate} onChange={(e) => setRate(e.target.value)} /></FormField>
              <FormField label="Term (months)"><FormInput type="number" min="1" step="1" value={termMonths} onChange={(e) => setTerm(e.target.value)} /></FormField>
              <FormField label="Monthly payment"><div className="px-3 py-2 text-sm font-medium">{fmt(instalment)}</div></FormField>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label="Warranty"><FormInput value={warrantyType} onChange={(e) => setWarrantyType(e.target.value)} placeholder="e.g. Dealer warranty" /></FormField>
          <FormField label="Warranty months"><FormInput type="number" min="0" step="1" value={warrantyMonths} onChange={(e) => setWarrantyMonths(e.target.value)} /></FormField>
          <FormField label="Delivery date"><FormInput type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></FormField>
        </div>
        <FormField label="Notes"><FormTextarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>

        <dl className="grid grid-cols-3 gap-2 rounded bg-gray-50 dark:bg-gray-900 p-3 text-sm">
          <div><dt className="text-gray-500">Invoice total</dt><dd className="font-semibold">{fmt(total)}</dd></div>
          <div><dt className="text-gray-500">Paid now</dt><dd className="font-semibold">{fmt(Math.min(num(down), total))}</dd></div>
          <div><dt className="text-gray-500">{financingOptionId ? 'Financed' : 'Balance due'}</dt><dd className="font-semibold">{fmt(balance)}</dd></div>
        </dl>
      </div>
    </Modal>
  )
}
