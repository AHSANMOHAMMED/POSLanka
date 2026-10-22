'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Home, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils/currency'

interface Receipt { id: string; receiptNo: string; supplierName: string | null; receiptDate: string; status: string; orderNo: string | null }
interface Purchase { id: string; purchaseNo: string; supplierName: string | null; status: string; isReturn: boolean; total: string }
interface Supplier { id: string; name: string }
interface Account { id: string; accountNumber: string; name: string; isGroup: boolean; rootType: string }

type ChargeType = 'freight' | 'duty' | 'insurance' | 'clearing' | 'other'
interface ChargeRow { chargeType: ChargeType; description: string; amount: string; creditTo: 'supplier' | 'account'; supplierId: string; creditAccountId: string }

const CHARGE_LABELS: Record<ChargeType, string> = {
  freight: 'Freight', duty: 'Duty / Customs', insurance: 'Insurance', clearing: 'Clearing', other: 'Other',
}

const emptyCharge = (): ChargeRow => ({ chargeType: 'freight', description: '', amount: '', creditTo: 'supplier', supplierId: '', creditAccountId: '' })

// H3: new landed cost voucher
export default function NewLandedCostPage() {
  const router = useRouter()
  const { tenantSlug, currency } = useCompany()
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [invoices, setInvoices] = useState<Purchase[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Record<string, 'grn' | 'purchase'>>({})
  const [allocationMethod, setAllocationMethod] = useState<'value' | 'quantity'>('value')
  const [postingDate, setPostingDate] = useState('')
  const [notes, setNotes] = useState('')
  const [charges, setCharges] = useState<ChargeRow[]>([emptyCharge()])
  const [search, setSearch] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [r, p, s, a] = await Promise.all([
          fetch('/api/purchase-receipts?status=completed&pageSize=200'),
          fetch('/api/purchases?all=true'),
          fetch('/api/suppliers?all=true'),
          fetch('/api/accounting/accounts?all=true'),
        ])
        if (r.ok) { const j = await r.json(); setReceipts(Array.isArray(j) ? j : j.data || []) }
        if (p.ok) {
          const j = await p.json()
          const list: Purchase[] = Array.isArray(j) ? j : j.data || []
          setInvoices(list.filter(x => !x.isReturn && x.status !== 'cancelled' && x.status !== ('draft' as string)))
        }
        if (s.ok) { const j = await s.json(); setSuppliers(Array.isArray(j) ? j : j.data || []) }
        if (a.ok) { const j = await a.json(); setAccounts((Array.isArray(j) ? j : j.data || []).filter((x: Account) => !x.isGroup)) }
      } catch {
        toast.error('Error loading documents')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  function toggle(id: string, type: 'grn' | 'purchase') {
    setSelected(prev => {
      const next = { ...prev }
      if (next[id]) delete next[id]
      else next[id] = type
      return next
    })
  }

  function updateCharge(i: number, patch: Partial<ChargeRow>) {
    setCharges(prev => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }

  const total = charges.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0)
  const q = search.trim().toLowerCase()
  const shownReceipts = receipts.filter(r => !q || r.receiptNo.toLowerCase().includes(q) || (r.supplierName || '').toLowerCase().includes(q) || (r.orderNo || '').toLowerCase().includes(q))
  const shownInvoices = invoices.filter(p => !q || p.purchaseNo.toLowerCase().includes(q) || (p.supplierName || '').toLowerCase().includes(q))

  async function save(submit: boolean) {
    const sources = Object.entries(selected).map(([id, type]) => ({ type, id }))
    if (sources.length === 0) { toast.error('Select at least one goods receipt or purchase invoice'); return }
    const body = {
      sources,
      allocationMethod,
      postingDate: postingDate || undefined,
      notes: notes || null,
      submit,
      charges: charges.filter(c => parseFloat(c.amount) > 0).map(c => ({
        chargeType: c.chargeType,
        description: c.description || null,
        amount: parseFloat(c.amount),
        supplierId: c.creditTo === 'supplier' ? c.supplierId || null : null,
        creditAccountId: c.creditTo === 'account' ? c.creditAccountId || null : null,
      })),
    }
    if (body.charges.length === 0) { toast.error('Add at least one charge with an amount'); return }
    if (body.charges.some(c => !c.supplierId && !c.creditAccountId)) { toast.error('Each charge needs a supplier or a credit account'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/landed-cost-vouchers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const result = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(`Landed cost ${result.voucherNo} ${submit ? 'submitted' : 'saved as draft'}`)
        router.push(`/c/${tenantSlug}/purchases/landed-costs`)
      } else {
        toast.error(result.error || 'Failed to save landed cost voucher')
      }
    } catch {
      toast.error('Failed to save landed cost voucher')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-2 py-1.5 border rounded text-sm bg-background text-foreground'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-foreground"><Home className="h-4 w-4" /></Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/c/${tenantSlug}/purchases/landed-costs`} className="hover:text-foreground">Landed Costs</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">New</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">New Landed Cost</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Charges are spread over the selected documents&apos; lines. The share of goods still in stock raises their average cost;
          the share of goods already sold goes to cost of goods sold.
        </p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : (
        <>
          <div className="bg-card rounded border p-4 space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-muted-foreground">Posting date</label>
                <input type="date" value={postingDate} onChange={e => setPostingDate(e.target.value)} className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Allocate by</label>
                <select value={allocationMethod} onChange={e => setAllocationMethod(e.target.value as 'value' | 'quantity')} className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground">
                  <option value="value">Value</option>
                  <option value="quantity">Quantity</option>
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-muted-foreground">Notes</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} className="block mt-1 w-full px-3 py-2 border rounded text-sm bg-background text-foreground" />
              </div>
            </div>
          </div>

          <div className="bg-card rounded border p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-foreground">Documents ({Object.keys(selected).length} selected)</h2>
              <input placeholder="Search number / supplier" value={search} onChange={e => setSearch(e.target.value)} className="px-3 py-1.5 border rounded text-sm bg-background text-foreground" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-1">Goods receipts (GRN)</h3>
                <div className="max-h-64 overflow-y-auto border rounded divide-y">
                  {shownReceipts.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No goods receipts</p> : shownReceipts.map(r => (
                    <label key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/30 cursor-pointer">
                      <input type="checkbox" checked={!!selected[r.id]} onChange={() => toggle(r.id, 'grn')} />
                      <span className="font-medium">{r.receiptNo}</span>
                      <span className="text-muted-foreground truncate">{r.supplierName || ''}{r.orderNo ? ` · ${r.orderNo}` : ''}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{r.receiptDate}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-xs font-medium text-muted-foreground mb-1">Purchase invoices</h3>
                <div className="max-h-64 overflow-y-auto border rounded divide-y">
                  {shownInvoices.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No submitted purchase invoices</p> : shownInvoices.map(p => (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/30 cursor-pointer">
                      <input type="checkbox" checked={!!selected[p.id]} onChange={() => toggle(p.id, 'purchase')} />
                      <span className="font-medium">{p.purchaseNo}</span>
                      <span className="text-muted-foreground truncate">{p.supplierName || ''}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{formatCurrency(parseFloat(p.total) || 0, currency)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card rounded border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground">Charges</h2>
              <button onClick={() => setCharges(prev => [...prev, emptyCharge()])} className="inline-flex items-center gap-1 px-2 py-1 text-sm border rounded hover:bg-muted/50">
                <Plus className="h-4 w-4" /> Add charge
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-2 py-2 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-2 py-2 font-medium text-muted-foreground">Description</th>
                    <th className="text-right px-2 py-2 font-medium text-muted-foreground">Amount</th>
                    <th className="text-left px-2 py-2 font-medium text-muted-foreground">Credit to</th>
                    <th className="text-left px-2 py-2 font-medium text-muted-foreground">Supplier / Account</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {charges.map((c, i) => (
                    <tr key={i} className="border-b">
                      <td className="px-2 py-2">
                        <select value={c.chargeType} onChange={e => updateCharge(i, { chargeType: e.target.value as ChargeType })} className={inputCls}>
                          {(Object.keys(CHARGE_LABELS) as ChargeType[]).map(t => <option key={t} value={t}>{CHARGE_LABELS[t]}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2"><input value={c.description} onChange={e => updateCharge(i, { description: e.target.value })} className={inputCls} /></td>
                      <td className="px-2 py-2"><input type="number" min="0" step="0.01" value={c.amount} onChange={e => updateCharge(i, { amount: e.target.value })} className={`${inputCls} text-right`} /></td>
                      <td className="px-2 py-2">
                        <select value={c.creditTo} onChange={e => updateCharge(i, { creditTo: e.target.value as 'supplier' | 'account' })} className={inputCls}>
                          <option value="supplier">Supplier (payable)</option>
                          <option value="account">Account</option>
                        </select>
                      </td>
                      <td className="px-2 py-2">
                        {c.creditTo === 'supplier' ? (
                          <select value={c.supplierId} onChange={e => updateCharge(i, { supplierId: e.target.value })} className={inputCls}>
                            <option value="">Select supplier</option>
                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        ) : (
                          <select value={c.creditAccountId} onChange={e => updateCharge(i, { creditAccountId: e.target.value })} className={inputCls}>
                            <option value="">Select account</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.accountNumber} {a.name}</option>)}
                          </select>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {charges.length > 1 && (
                          <button onClick={() => setCharges(prev => prev.filter((_, idx) => idx !== i))} className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} className="px-2 py-2 text-right font-medium">Total</td>
                    <td className="px-2 py-2 text-right font-semibold">{formatCurrency(total, currency)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Link href={`/c/${tenantSlug}/purchases/landed-costs`} className="px-4 py-2 text-sm border rounded hover:bg-muted/50">Cancel</Link>
            <button disabled={saving} onClick={() => save(false)} className="px-4 py-2 text-sm border rounded hover:bg-muted/50 disabled:opacity-50">Save draft</button>
            <button disabled={saving} onClick={() => save(true)} className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save & submit'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
