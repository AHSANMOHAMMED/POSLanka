'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Loader2, TrendingUp } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { formatCurrency } from '@/lib/utils/currency'

interface SupplierPerformance {
  id: string
  name: string
  totalOrders: number
  totalOrderValue: string
  totalInvoices: number
  totalPurchased: string
  outstandingBalance: string
}

export default function SupplierPerformancePage() {
  const { tenantSlug, currency } = useCompany()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<SupplierPerformance[]>([])
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  useEffect(() => {
    fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate])

  async function fetchData() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (fromDate) params.set('from', fromDate)
      if (toDate) params.set('to', toDate)
      const res = await fetch(`/api/reports/supplier-performance?${params}`)
      if (res.ok) {
        const result = await res.json()
        setData(result)
      }
    } catch {
      // Failed to load
    } finally {
      setLoading(false)
    }
  }

  const totalOrderValue = data.reduce((sum, s) => sum + (parseFloat(s.totalOrderValue) || 0), 0)
  const totalPurchased = data.reduce((sum, s) => sum + (parseFloat(s.totalPurchased) || 0), 0)
  const totalOutstanding = data.reduce((sum, s) => sum + (parseFloat(s.outstandingBalance) || 0), 0)

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-foreground"><Home className="h-4 w-4" /></Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Supplier Performance</span>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Supplier Performance</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of supplier activity and metrics</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs text-muted-foreground">From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="block mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground" />
        </div>
        {(fromDate || toDate) && (
          <button onClick={() => { setFromDate(''); setToDate('') }} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            Clear
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-card rounded border p-4">
          <p className="text-xs text-muted-foreground">Active Suppliers</p>
          <p className="text-2xl font-bold text-foreground mt-1">{data.length}</p>
        </div>
        <div className="bg-card rounded border p-4">
          <p className="text-xs text-muted-foreground">Total Order Value</p>
          <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(totalOrderValue, currency)}</p>
        </div>
        <div className="bg-card rounded border p-4">
          <p className="text-xs text-muted-foreground">Total Purchased</p>
          <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(totalPurchased, currency)}</p>
        </div>
        <div className="bg-card rounded border p-4">
          <p className="text-xs text-muted-foreground">Outstanding Balance</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{formatCurrency(totalOutstanding, currency)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-sticky-header">
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Supplier</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Orders</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Order Value</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Invoices</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Purchased</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading...
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <TrendingUp className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No supplier activity found</p>
                  </td>
                </tr>
              ) : (
                data.map(s => (
                  <tr key={s.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-foreground">{s.name}</td>
                    <td className="px-4 py-3 text-right">{s.totalOrders}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(parseFloat(s.totalOrderValue) || 0, currency)}</td>
                    <td className="px-4 py-3 text-right">{s.totalInvoices}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(parseFloat(s.totalPurchased) || 0, currency)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={(parseFloat(s.outstandingBalance) || 0) > 0 ? 'text-red-600' : 'text-green-600'}>
                        {formatCurrency(parseFloat(s.outstandingBalance) || 0, currency)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
