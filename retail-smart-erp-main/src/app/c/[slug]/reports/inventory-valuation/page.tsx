'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Home, ChevronRight, Loader2, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { formatCurrency } from '@/lib/utils/currency'

interface WarehouseRow { warehouseId: string; warehouseName: string; items: number; stockValue: number; zeroCostItems: number; negativeStockValue: number }
interface AccountRow { accountId: string; accountNumber: string; name: string; isDefault: boolean; balance: number }
interface Recon {
  warehouses: WarehouseRow[]
  accounts: AccountRow[]
  srbnb: { accountId: string; accountNumber: string; name: string; balance: number } | null
  summary: { stockValue: number; glBalance: number; difference: number; tolerance: number; reconciled: boolean; zeroCostItems: number }
}

// H3: stock value at weighted-average cost vs the stock account(s) in the general ledger
export default function InventoryValuationPage() {
  const { tenantSlug, currency } = useCompany()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Recon | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/reports/inventory-valuation-reconciliation')
      if (res.ok) setData(await res.json())
    } catch {
      // Failed to load
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const s = data?.summary

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-foreground"><Home className="h-4 w-4" /></Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Inventory Valuation vs GL</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory Valuation vs GL</h1>
          <p className="text-sm text-muted-foreground mt-1">Stock on hand × weighted-average cost compared with the stock account balance</p>
        </div>
        <button onClick={fetchData} className="inline-flex items-center gap-1 px-3 py-2 text-sm border rounded hover:bg-muted/50">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {loading || !data || !s ? (
        <div className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : (
        <>
          <div className={`rounded border p-4 flex items-center gap-3 ${s.reconciled ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
            {s.reconciled ? <CheckCircle className="h-5 w-5 text-green-600" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}
            <span className="text-sm text-foreground">
              {s.reconciled
                ? `Reconciled: the difference ${formatCurrency(s.difference, currency)} is within the rounding tolerance of ${formatCurrency(s.tolerance, currency)}.`
                : `Not reconciled: the stock account differs from the stock valuation by ${formatCurrency(s.difference, currency)} (tolerance ${formatCurrency(s.tolerance, currency)}).`}
              {s.zeroCostItems > 0 && ` ${s.zeroCostItems} item(s) in stock have no cost price and are valued at zero.`}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-card rounded border p-4">
              <p className="text-xs text-muted-foreground">Stock valuation</p>
              <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(s.stockValue, currency)}</p>
            </div>
            <div className="bg-card rounded border p-4">
              <p className="text-xs text-muted-foreground">Stock account balance</p>
              <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(s.glBalance, currency)}</p>
            </div>
            <div className="bg-card rounded border p-4">
              <p className="text-xs text-muted-foreground">Difference (GL − stock)</p>
              <p className={`text-2xl font-bold mt-1 ${s.reconciled ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(s.difference, currency)}</p>
            </div>
            <div className="bg-card rounded border p-4">
              <p className="text-xs text-muted-foreground">Received not billed (SRBNB)</p>
              <p className="text-2xl font-bold text-foreground mt-1">{data.srbnb ? formatCurrency(data.srbnb.balance, currency) : '-'}</p>
              {!data.srbnb && <p className="text-xs text-amber-600 mt-1">No SRBNB account configured</p>}
            </div>
          </div>

          <div className="bg-card rounded border">
            <div className="px-4 py-3 border-b font-medium text-foreground">By warehouse</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Warehouse</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Items in stock</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Zero-cost items</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Negative stock value</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Stock value</th>
                  </tr>
                </thead>
                <tbody>
                  {data.warehouses.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No stock</td></tr>
                  ) : data.warehouses.map(w => (
                    <tr key={w.warehouseId} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-foreground">{w.warehouseName}</td>
                      <td className="px-4 py-3 text-right">{w.items}</td>
                      <td className={`px-4 py-3 text-right ${w.zeroCostItems > 0 ? 'text-amber-600' : ''}`}>{w.zeroCostItems}</td>
                      <td className={`px-4 py-3 text-right ${w.negativeStockValue < 0 ? 'text-red-600' : ''}`}>{formatCurrency(w.negativeStockValue, currency)}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(w.stockValue, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-card rounded border">
            <div className="px-4 py-3 border-b font-medium text-foreground">Stock accounts</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Account</th>
                    <th className="text-right px-4 py-3 font-medium text-muted-foreground">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.length === 0 ? (
                    <tr><td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">No stock account configured</td></tr>
                  ) : data.accounts.map(a => (
                    <tr key={a.accountId} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3 text-foreground">
                        {a.accountNumber} {a.name}
                        {a.isDefault && <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">default</span>}
                      </td>
                      <td className="px-4 py-3 text-right">{formatCurrency(a.balance, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
