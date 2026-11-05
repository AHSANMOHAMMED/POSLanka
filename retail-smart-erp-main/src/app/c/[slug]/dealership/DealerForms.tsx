'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormSelect, FormTextarea } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'

interface DealerOption { id: string; name: string; code: string | null; status: string | null }
interface VehicleOption { id: string; stockNo: string | null; vin: string | null; year: number | null; makeName: string | null; modelName: string | null; askingPrice: string | null; minimumPrice: string | null }

const btn = 'px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
const btnPrimary = 'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50'

function listOf<T>(body: unknown): T[] {
  return Array.isArray(body) ? body as T[] : ((body as { data?: T[] })?.data ?? [])
}

function useDealers() {
  const [dealers, setDealers] = useState<DealerOption[] | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/dealers?all=true').then((r) => (r.ok ? r.json() : [])).then((b) => {
      if (alive) setDealers(listOf<DealerOption>(b).filter((d) => !d.status || d.status === 'active'))
    }).catch(() => { if (alive) setDealers([]) })
    return () => { alive = false }
  }, [])
  return dealers
}

async function send(url: string, method: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out.error || 'Request failed')
  return out
}

/** Give a vehicle in stock to a dealer to sell (POST /api/dealer-allocations). */
export function NewAllocationModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dealers = useDealers()
  const [vehicles, setVehicles] = useState<VehicleOption[] | null>(null)
  const [dealerId, setDealerId] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [askingPrice, setAsking] = useState('')
  const [minimumPrice, setMinimum] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/vehicle-inventory?all=true&status=available').then((r) => (r.ok ? r.json() : [])).then((b) => {
      if (alive) setVehicles(listOf<VehicleOption>(b))
    }).catch(() => { if (alive) setVehicles([]) })
    return () => { alive = false }
  }, [])

  function pickVehicle(id: string) {
    setVehicleId(id)
    const v = vehicles?.find((x) => x.id === id)
    if (v?.askingPrice) setAsking(String(Number(v.askingPrice)))
    if (v?.minimumPrice) setMinimum(String(Number(v.minimumPrice)))
  }

  async function save() {
    if (!dealerId || !vehicleId) { toast.error('Choose a dealer and a vehicle'); return }
    setSaving(true)
    try {
      await send('/api/dealer-allocations', 'POST', {
        dealerId, vehicleInventoryId: vehicleId,
        askingPrice: askingPrice ? Number(askingPrice) : undefined,
        minimumPrice: minimumPrice ? Number(minimumPrice) : undefined,
        notes: notes || undefined,
      })
      toast.success('Vehicle allocated to the dealer')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to allocate')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Allocate a vehicle to a dealer" size="md" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Allocate</button>
      </ModalFooter>
    }>
      <div className="space-y-3">
        <FormField label="Dealer" required hint={dealers && dealers.length === 0 ? 'No active dealers. Add one under Dealership → Dealers.' : undefined}>
          <FormSelect value={dealerId} onChange={(e) => setDealerId(e.target.value)} disabled={!dealers}>
            <option value="">{dealers ? 'Choose a dealer' : 'Loading…'}</option>
            {(dealers ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Vehicle" required hint={vehicles && vehicles.length === 0 ? 'No vehicles are available.' : undefined}>
          <FormSelect value={vehicleId} onChange={(e) => pickVehicle(e.target.value)} disabled={!vehicles}>
            <option value="">{vehicles ? 'Choose an available vehicle' : 'Loading…'}</option>
            {(vehicles ?? []).map((v) => (
              <option key={v.id} value={v.id}>{[v.year, v.makeName, v.modelName].filter(Boolean).join(' ') || 'Vehicle'}{v.stockNo ? ` · ${v.stockNo}` : ''}{v.vin ? ` · ${v.vin}` : ''}</option>
            ))}
          </FormSelect>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Dealer asking price"><FormInput type="number" min="0" step="0.01" value={askingPrice} onChange={(e) => setAsking(e.target.value)} /></FormField>
          <FormField label="Minimum price"><FormInput type="number" min="0" step="0.01" value={minimumPrice} onChange={(e) => setMinimum(e.target.value)} /></FormField>
        </div>
        <FormField label="Notes"><FormTextarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
      </div>
    </Modal>
  )
}

const PAYMENT_TYPES: Array<[string, string]> = [['advance', 'Advance'], ['settlement', 'Settlement'], ['commission', 'Commission'], ['refund', 'Refund'], ['adjustment', 'Adjustment']]

/** Record money received from or paid to a dealer (POST /api/dealer-payments; confirm it to post the balance). */
export function NewDealerPaymentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const dealers = useDealers()
  const [dealerId, setDealerId] = useState('')
  const [type, setType] = useState('settlement')
  const [direction, setDirection] = useState('inbound')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setMethod] = useState('bank_transfer')
  const [referenceNo, setReference] = useState('')
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  function pickType(t: string) {
    setType(t)
    // Commission and refunds go to the dealer; advances and settlements come from them
    setDirection(t === 'commission' || t === 'refund' ? 'outbound' : 'inbound')
  }

  async function save() {
    if (!dealerId) { toast.error('Choose a dealer'); return }
    if (!(Number(amount) > 0)) { toast.error('Enter the amount'); return }
    setSaving(true)
    try {
      await send('/api/dealer-payments', 'POST', {
        dealerId, type, direction, amount: Number(amount), paymentMethod,
        referenceNo: referenceNo || undefined, paymentDate: paymentDate || undefined, notes: notes || undefined,
      })
      toast.success('Payment recorded. Confirm it to update the dealer balance.')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to record the payment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title="Record a dealer payment" size="md" footer={
      <ModalFooter>
        <button className={btn} onClick={onClose}>Cancel</button>
        <button className={btnPrimary} disabled={saving} onClick={save}>{saving && <Loader2 size={14} className="animate-spin" />}Save</button>
      </ModalFooter>
    }>
      <div className="space-y-3">
        <FormField label="Dealer" required>
          <FormSelect value={dealerId} onChange={(e) => setDealerId(e.target.value)} disabled={!dealers}>
            <option value="">{dealers ? 'Choose a dealer' : 'Loading…'}</option>
            {(dealers ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}{d.code ? ` (${d.code})` : ''}</option>)}
          </FormSelect>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Type">
            <FormSelect value={type} onChange={(e) => pickType(e.target.value)}>
              {PAYMENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Direction">
            <FormSelect value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="inbound">Received from dealer</option>
              <option value="outbound">Paid to dealer</option>
            </FormSelect>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Amount" required><FormInput type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></FormField>
          <FormField label="Method">
            <FormSelect value={paymentMethod} onChange={(e) => setMethod(e.target.value)}>
              <option value="bank_transfer">Bank transfer</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
              <option value="offset">Offset against balance</option>
            </FormSelect>
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Reference"><FormInput value={referenceNo} onChange={(e) => setReference(e.target.value)} /></FormField>
          <FormField label="Date"><FormInput type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></FormField>
        </div>
        <FormField label="Notes"><FormTextarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></FormField>
      </div>
    </Modal>
  )
}

/** Confirm (posts to the dealer balance) or cancel a pending dealer payment. */
export async function confirmDealerPayment(id: string) {
  await send(`/api/dealer-payments/${id}/confirm`, 'POST', {})
}
export async function cancelDealerPayment(id: string, reason: string) {
  await send(`/api/dealer-payments/${id}`, 'PUT', { cancellationReason: reason })
}
/** A dealer gives a vehicle back: it returns to available stock. */
export async function returnAllocation(id: string, reason: string) {
  await send(`/api/dealer-allocations/${id}`, 'PUT', { status: 'returned', returnReason: reason })
}
