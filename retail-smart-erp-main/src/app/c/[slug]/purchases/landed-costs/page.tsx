'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Loader2, Plus, Truck, XCircle } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils/currency'

interface Voucher {
  id: string
  voucherNo: string
  postingDate: string
  status: 'draft' | 'submitted' | 'cancelled'
  allocationMethod: 'value' | 'quantity'
  totalCharges: string
  absorbedAmount: string
  expensedAmount: string
  createdByName: string | null
  sources: string | null
}

const statusStyle: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  submitted: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

// H3: landed cost vouchers — freight / duty / insurance / clearing charges spread onto GRNs / invoices
export default function LandedCostsPage() {
  const { tenantSlug, currency } = useCompany()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Voucher[]>([])
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ pageSize: '200' })
      if (status) params.set('status', status)
      const res = await fetch(`/api/landed-cost-vouchers?${params}`)
      if (res.ok) setData((await res.json()).data || [])
      else toast.error('Failed to load landed cost vouchers')
    } catch {
      toast.error('Error loading landed cost vouchers')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { fetchData() }, [fetchData])

  async function act(v: Voucher, action: 'submit' | 'cancel') {
    if (action === 'cancel' && !confirm(`Cancel ${v.voucherNo}? ${v.status === 'submitted' ? 'Item costs, GL entries and supplier balances are reversed.' : ''}`)) return
    setBusy(v.id)
    try {
      const res = action === 'submit'
        ? await fetch(`/api/landed-cost-vouchers/${v.id}/submit`, { method: 'POST' })
        : await fetch(`/api/landed-cost-vouchers/${v.id}`, {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
          })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(`${v.voucherNo} ${action === 'submit' ? 'submitted' : 'cancelled'}`)
        fetchData()
      } else {
        toast.error(body.error || `Failed to ${action} voucher`)
      }
    } catch {
      toast.error(`Failed to ${action} voucher`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-foreground"><Home className="h-4 w-4" /></Link>
        <ChevronRight className="h-3 w-3" />
        <Link href={`/c/${tenantSlug}/purchases`} className="hover:text-foreground">Purchase Invoices</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Landed Costs</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Landed Costs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Freight, duty, insurance and clearing charges added to the cost of received goods
          </p>
        </div>
        <Link href={`/c/${tenantSlug}/purchases/landed-costs/new`}
          className="inline-flex items-center gap-1 px-3 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">
          <Plus className="h-4 w-4" /> New Landed Cost
        </Link>
      </div>

      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)} className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground">
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div className="bg-card rounded border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-sticky-header">
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Voucher</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Documents</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Allocation</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Charges</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">To Stock</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">To COGS</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Loading...
                </td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                  <Truck className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No landed cost vouchers yet</p>
                </td></tr>
              ) : data.map(v => (
                <tr key={v.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-foreground">{v.voucherNo}</td>
                  <td className="px-4 py-3">{v.postingDate}</td>
                  <td className="px-4 py-3 text-muted-foreground">{v.sources || '-'}</td>
                  <td className="px-4 py-3 capitalize">{v.allocationMethod}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(parseFloat(v.totalCharges) || 0, currency)}</td>
                  <td className="px-4 py-3 text-right">{v.status === 'draft' ? '-' : formatCurrency(parseFloat(v.absorbedAmount) || 0, currency)}</td>
                  <td className="px-4 py-3 text-right">{v.status === 'draft' ? '-' : formatCurrency(parseFloat(v.expensedAmount) || 0, currency)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs capitalize ${statusStyle[v.status] || ''}`}>{v.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {v.status === 'draft' && (
                      <button disabled={busy === v.id} onClick={() => act(v, 'submit')}
                        className="px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 mr-2">Submit</button>
                    )}
                    {v.status !== 'cancelled' && (
                      <button disabled={busy === v.id} onClick={() => act(v, 'cancel')}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                        <XCircle className="h-3 w-3" /> Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
