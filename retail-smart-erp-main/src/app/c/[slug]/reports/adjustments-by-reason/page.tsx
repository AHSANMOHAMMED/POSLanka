'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Loader2, ClipboardList } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { formatCurrency } from '@/lib/utils/currency'

interface ReasonRow {
  reasonCode: string
  reasonLabel: string
  movements: number
  qtyIn: number
  qtyOut: number
  value: number
  unvaluedMovements: number
  unvaluedEstimate: number
}
interface Summary { movements: number; netValue: number; lossValue: number; unvaluedMovements: number }
interface Warehouse { id: string; name: string }

// H3: stock adjustments (manual, bulk, stock takes, waste) by reason code and value
export default function AdjustmentsByReasonPage() {
  const { tenantSlug, currency } = useCompany()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<ReasonRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  useEffect(() => {
    fetch('/api/warehouses?all=true').then(r => r.json()).then(d => setWarehouses(Array.isArray(d) ? d : d.data || [])).catch(() => {})
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (warehouseId) params.set('warehouseId', warehouseId)
      const res = await fetch(`/api/reports/adjustments-by-reason?${params}`)
      if (res.ok) {
        const result = await res.json()
        setData(result.data || [])
        setSummary(result.summary || null)
      }
    } catch {
      // Failed to load
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, warehouseId])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-foreground"><Home className="h-4 w-4" /></Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Adjustments by Reason</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Stock Adjustments by Reason</h1>
        <p className="text-sm text-muted-foreground mt-1">Shrinkage, damage, theft, expiry and other adjustments with their ledger value</p>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground">From</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">To</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Warehouse</label>
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground">
            <option value="">All warehouses</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-card rounded border p-4">
            <p className="text-xs text-muted-foreground">Adjustments</p>
            <p className="text-2xl font-bold text-foreground mt-1">{summary.movements}</p>
          </div>
          <div className="bg-card rounded border p-4">
            <p className="text-xs text-muted-foreground">Net value</p>
            <p className={`text-2xl font-bold mt-1 ${summary.netValue < 0 ? 'text-red-600' : 'text-foreground'}`}>{formatCurrency(summary.netValue, currency)}</p>
          </div>
          <div className="bg-card rounded border p-4">
            <p className="text-xs text-muted-foreground">Losses</p>
            <p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(summary.lossValue, currency)}</p>
          </div>
          <div className="bg-card rounded border p-4">
            <p className="text-xs text-muted-foreground">Not valued in GL</p>
            <p className={`text-2xl font-bold mt-1 ${summary.unvaluedMovements > 0 ? 'text-amber-600' : 'text-foreground'}`}>{summary.unvaluedMovements}</p>
          </div>
        </div>
      )}

      <div className="bg-card rounded border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-sticky-header">
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reason</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Adjustments</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Qty In</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Qty Out</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">GL Value</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Unvalued</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Unvalued (est.)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Loading...
                </td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No stock adjustments in this period</p>
                </td></tr>
              ) : data.map(r => (
                <tr key={r.reasonCode} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-foreground">{r.reasonLabel}</td>
                  <td className="px-4 py-3 text-right">{r.movements}</td>
                  <td className="px-4 py-3 text-right">{r.qtyIn}</td>
                  <td className="px-4 py-3 text-right">{r.qtyOut}</td>
                  <td className={`px-4 py-3 text-right ${r.value < 0 ? 'text-red-600' : r.value > 0 ? 'text-green-600' : ''}`}>{formatCurrency(r.value, currency)}</td>
                  <td className={`px-4 py-3 text-right ${r.unvaluedMovements > 0 ? 'text-amber-600' : ''}`}>{r.unvaluedMovements}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{r.unvaluedMovements > 0 ? formatCurrency(r.unvaluedEstimate, currency) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
