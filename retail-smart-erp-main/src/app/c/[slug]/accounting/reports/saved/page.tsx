'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bookmark, Trash2, ExternalLink, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { toast } from '@/components/ui/toast'

interface SavedReport {
  id: string
  name: string
  reportType: string
  filters: Record<string, unknown>
  isPublic: boolean
  createdAt: string
}

const REPORT_TYPE_LABELS: Record<string, string> = {
  profit_and_loss: 'Profit & Loss',
  balance_sheet: 'Balance Sheet',
  trial_balance: 'Trial Balance',
  cash_flow: 'Cash Flow',
  accounts_receivable: 'Accounts Receivable',
  accounts_payable: 'Accounts Payable',
  sales_summary: 'Sales Summary',
  sales_by_item: 'Sales by Item',
  sales_by_customer: 'Sales by Customer',
  daily_sales: 'Daily Sales',
  payment_collection: 'Payment Collection',
  tax_report: 'Tax Report',
  stock_balance: 'Stock Balance',
  stock_movement: 'Stock Movement',
  purchase_summary: 'Purchase Summary',
  purchase_by_supplier: 'Purchase by Supplier',
  item_profitability: 'Item Profitability',
  service_revenue: 'Service Revenue',
  technician_performance: 'Technician Performance',
  table_turnover: 'Table Turnover',
  menu_performance: 'Menu Performance',
  category_sales: 'Category Sales',
  item_velocity: 'Item Velocity',
}

const REPORT_TYPE_PATHS: Record<string, string> = {
  profit_and_loss: 'profit-and-loss',
  balance_sheet: 'balance-sheet',
  trial_balance: 'trial-balance',
  cash_flow: 'cash-flow',
  accounts_receivable: 'accounts-receivable',
  accounts_payable: 'accounts-payable',
  sales_summary: 'sales-summary',
  sales_by_item: 'sales-by-item',
  sales_by_customer: 'sales-by-customer',
  daily_sales: 'daily-sales',
  payment_collection: 'payment-collection',
  tax_report: 'tax-report',
  stock_balance: 'stock-balance',
  stock_movement: 'stock-movement',
  purchase_summary: 'purchase-summary',
  purchase_by_supplier: 'purchase-by-supplier',
  item_profitability: 'item-profitability',
  service_revenue: 'service-revenue',
  technician_performance: 'technician-performance',
  table_turnover: 'table-turnover',
  menu_performance: 'menu-performance',
  category_sales: 'category-sales',
  item_velocity: 'item-velocity',
}

export default function SavedReportsPage() {
  const { tenantSlug } = useCompany()
  const [reports, setReports] = useState<SavedReport[]>([])
  const [loading, setLoading] = useState(true)

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch('/api/saved-reports')
      if (res.ok) setReports(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchReports() }, [fetchReports])

  async function handleDelete(id: string) {
    if (!confirm('Delete this saved report?')) return
    try {
      const res = await fetch(`/api/saved-reports/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setReports((prev) => prev.filter((r) => r.id !== id))
        toast.success('Report deleted')
      } else {
        toast.error('Failed to delete report')
      }
    } catch {
      toast.error('Error deleting report')
    }
  }

  function buildReportUrl(report: SavedReport): string {
    const path = REPORT_TYPE_PATHS[report.reportType]
    if (!path) return '#'
    const params = new URLSearchParams()
    params.set('savedReportId', report.id)
    if (report.filters) {
      Object.entries(report.filters).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          params.set(key, String(value))
        }
      })
    }
    return `/c/${tenantSlug}/accounting/reports/${path}?${params}`
  }

  // Group by report type
  const grouped = reports.reduce<Record<string, SavedReport[]>>((acc, r) => {
    const label = REPORT_TYPE_LABELS[r.reportType] || r.reportType
    if (!acc[label]) acc[label] = []
    acc[label].push(r)
    return acc
  }, {})

  return (
    <div className="space-y-4 p-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Bookmark size={24} className="text-blue-600 dark:text-blue-400" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Saved Reports</h1>
      </div>

      {loading && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
          <Loader2 size={32} className="mx-auto mb-3 text-blue-500 animate-spin" />
          <p className="text-gray-500 dark:text-gray-400">Loading saved reports...</p>
        </div>
      )}

      {!loading && reports.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-12 text-center">
          <Bookmark size={40} className="mx-auto mb-3 text-gray-300 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400">No saved reports yet. Use the Save button on any report to save filter configurations.</p>
        </div>
      )}

      {!loading && Object.entries(grouped).map(([reportLabel, items]) => (
        <div key={reportLabel} className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="px-4 py-3 border-b dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{reportLabel}</h3>
          </div>
          <div className="divide-y dark:divide-gray-700">
            {items.map((report) => (
              <div key={report.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{report.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Saved {new Date(report.createdAt).toLocaleDateString()}
                    {report.filters && Object.keys(report.filters).length > 0 && (
                      <span className="ml-2">
                        {Object.entries(report.filters)
                          .filter(([, v]) => v)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(', ')}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    href={buildReportUrl(report)}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors"
                  >
                    <ExternalLink size={14} />
                    Open
                  </Link>
                  <button
                    onClick={() => handleDelete(report.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
