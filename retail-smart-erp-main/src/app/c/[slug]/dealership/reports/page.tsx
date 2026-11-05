'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Clock, Download, FileWarning, Loader2, Receipt, TrendingUp, Users } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { downloadCsv } from '@/components/hr/AttendanceNav'

type ReportKey = 'aging' | 'profit' | 'import-tax' | 'dealers' | 'documents'
type Row = Record<string, unknown>
interface ReportData { fromDate: string; toDate: string; today: string; totals: Record<string, number | null>; rows: Row[]; buckets?: Array<{ label: string; count: number; cost: number }> }

interface Column { key: string; label: string; kind?: 'money' | 'number' | 'date' | 'percent'; link?: (r: Row, slug: string) => string | null }
interface ReportDef { key: ReportKey; title: string; icon: React.ReactNode; color: string; usesPeriod: boolean; columns: Column[]; totals: Array<{ key: string; label: string; kind?: Column['kind'] }> }

const vehicleCols: Column[] = [
  { key: 'stockNo', label: 'Stock #', link: (r, s) => (r.id ? `/c/${s}/dealership/inventory/${r.id}` : null) },
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'vin', label: 'VIN' },
]

const REPORTS: ReportDef[] = [
  {
    key: 'aging', title: 'Vehicle aging', icon: <Clock size={20} />, color: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20', usesPeriod: false,
    columns: [...vehicleCols, { key: 'branch', label: 'Branch' }, { key: 'status', label: 'Status' }, { key: 'since', label: 'In stock since', kind: 'date' }, { key: 'days', label: 'Days', kind: 'number' }, { key: 'cost', label: 'Cost', kind: 'money' }, { key: 'askingPrice', label: 'Asking price', kind: 'money' }],
    totals: [{ key: 'count', label: 'Vehicles in stock', kind: 'number' }, { key: 'cost', label: 'Stock at cost', kind: 'money' }, { key: 'askingPrice', label: 'At asking price', kind: 'money' }],
  },
  {
    key: 'profit', title: 'Profit per vehicle', icon: <TrendingUp size={20} />, color: 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20', usesPeriod: true,
    columns: [{ key: 'invoiceNo', label: 'Invoice', link: (r, s) => (r.saleId ? `/c/${s}/sales/${r.saleId}` : null) }, { key: 'soldAt', label: 'Sold', kind: 'date' }, ...vehicleCols, { key: 'customer', label: 'Customer' }, { key: 'salesperson', label: 'Salesperson' }, { key: 'revenue', label: 'Price (no tax)', kind: 'money' }, { key: 'cost', label: 'Cost', kind: 'money' }, { key: 'commission', label: 'Commission', kind: 'money' }, { key: 'profit', label: 'Profit', kind: 'money' }, { key: 'marginPercent', label: 'Margin', kind: 'percent' }],
    totals: [{ key: 'count', label: 'Vehicles sold', kind: 'number' }, { key: 'revenue', label: 'Sales (no tax)', kind: 'money' }, { key: 'cost', label: 'Cost', kind: 'money' }, { key: 'profit', label: 'Profit', kind: 'money' }, { key: 'marginPercent', label: 'Margin', kind: 'percent' }],
  },
  {
    key: 'import-tax', title: 'Import tax summary', icon: <Receipt size={20} />, color: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20', usesPeriod: true,
    columns: [{ key: 'importNo', label: 'Import #', link: (r, s) => (r.id ? `/c/${s}/dealership/imports/${r.id}` : null) }, { key: 'date', label: 'Arrived', kind: 'date' }, { key: 'vehicle', label: 'Vehicle' }, { key: 'hsCode', label: 'HS code' }, { key: 'cif', label: 'CIF (LKR)', kind: 'money' }, { key: 'customsDuty', label: 'Customs duty', kind: 'money' }, { key: 'surcharge', label: 'Surcharge', kind: 'money' }, { key: 'exciseDuty', label: 'Excise', kind: 'money' }, { key: 'luxuryTax', label: 'Luxury tax', kind: 'money' }, { key: 'vat', label: 'VAT', kind: 'money' }, { key: 'palCess', label: 'PAL + CESS', kind: 'money' }, { key: 'totalTaxes', label: 'Total taxes', kind: 'money' }, { key: 'landedCost', label: 'Landed cost', kind: 'money' }],
    totals: [{ key: 'count', label: 'Imports', kind: 'number' }, { key: 'cif', label: 'CIF (LKR)', kind: 'money' }, { key: 'totalTaxes', label: 'Total taxes', kind: 'money' }, { key: 'landedCost', label: 'Landed cost', kind: 'money' }],
  },
  {
    key: 'dealers', title: 'Dealer performance', icon: <Users size={20} />, color: 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20', usesPeriod: true,
    columns: [{ key: 'name', label: 'Dealer', link: (r, s) => (r.id ? `/c/${s}/dealership/dealers/${r.id}` : null) }, { key: 'territory', label: 'Territory' }, { key: 'branch', label: 'Branch' }, { key: 'holding', label: 'Holding now', kind: 'number' }, { key: 'allocated', label: 'Allocated', kind: 'number' }, { key: 'returned', label: 'Returned', kind: 'number' }, { key: 'sold', label: 'Sold', kind: 'number' }, { key: 'received', label: 'Received', kind: 'money' }, { key: 'paid', label: 'Paid out', kind: 'money' }, { key: 'balance', label: 'Balance', kind: 'money' }, { key: 'creditLimit', label: 'Credit limit', kind: 'money' }],
    totals: [{ key: 'dealers', label: 'Dealers', kind: 'number' }, { key: 'holding', label: 'Vehicles with dealers', kind: 'number' }, { key: 'sold', label: 'Sold in period', kind: 'number' }, { key: 'received', label: 'Received', kind: 'money' }, { key: 'balance', label: 'Dealer balances', kind: 'money' }],
  },
  {
    key: 'documents', title: 'Document expiry', icon: <FileWarning size={20} />, color: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20', usesPeriod: false,
    columns: [{ key: 'name', label: 'Document' }, { key: 'type', label: 'Type' }, { key: 'documentNo', label: 'Number' }, { key: 'for', label: 'For', link: (r, s) => (r.vehicleId ? `/c/${s}/dealership/inventory/${r.vehicleId}` : r.importId ? `/c/${s}/dealership/imports/${r.importId}` : r.dealerId ? `/c/${s}/dealership/dealers/${r.dealerId}` : null) }, { key: 'expiryDate', label: 'Expires', kind: 'date' }, { key: 'daysLeft', label: 'Days left', kind: 'number' }],
    totals: [{ key: 'expired', label: 'Expired', kind: 'number' }, { key: 'expiring', label: 'Expiring soon', kind: 'number' }],
  },
]

function display(v: unknown, kind?: Column['kind']): string {
  if (v == null || v === '') return '-'
  if (kind === 'money') return Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (kind === 'percent') return `${Number(v).toFixed(1)} %`
  if (kind === 'number') return Number(v).toLocaleString()
  if (kind === 'date') return new Date(String(v)).toLocaleDateString()
  return String(v)
}

/** Derived display fields shared by several reports. */
function withDerived(r: Row): Row {
  const vehicle = [r.year, r.make, r.model].filter(Boolean).join(' ')
  const forLabel = r.stockNo || r.vin ? `Vehicle ${r.stockNo || r.vin}` : r.importNo ? `Import ${r.importNo}` : r.dealer ? `Dealer ${r.dealer}` : null
  return { ...r, vehicle: vehicle || null, for: forLabel }
}

export default function DealershipReportsPage() {
  const { tenantSlug } = useCompany()
  const [active, setActive] = useState<ReportKey>('aging')
  const [fromDate, setFrom] = useState('')
  const [toDate, setTo] = useState('')
  const [days, setDays] = useState('30')
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const def = REPORTS.find((r) => r.key === active)!

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ report: active })
      if (def.usesPeriod && fromDate) q.set('fromDate', fromDate)
      if (def.usesPeriod && toDate) q.set('toDate', toDate)
      if (active === 'documents' && days) q.set('days', days)
      const res = await fetch(`/api/dealership/reports?${q}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to load the report')
      setData({ ...body, rows: (body.rows as Row[]).map(withDerived) })
      if (def.usesPeriod && !fromDate) { setFrom(body.fromDate); setTo(body.toDate) }
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Failed to load the report')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on report change; dates apply with the Show button
  }, [active])

  useEffect(() => { void load() }, [load])

  function exportCsv() {
    if (!data) return
    downloadCsv(`${active}-${data.fromDate}-${data.toDate}.csv`, [
      def.columns.map((c) => c.label),
      ...data.rows.map((r) => def.columns.map((c) => (r[c.key] == null ? '' : (r[c.key] as string | number)))),
    ])
  }

  return (
    <ListPageLayout module="Dealership" moduleHref="/dealership/inventory" title="Reports" onRefresh={load}>
      <div className="px-4 pb-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          {REPORTS.map((r) => (
            <button
              key={r.key}
              onClick={() => { setActive(r.key); setData(null) }}
              className={`flex items-center gap-2 rounded border p-3 text-left text-sm font-medium transition ${active === r.key ? 'border-blue-500 ring-1 ring-blue-500 bg-white dark:bg-gray-800' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:shadow-sm'}`}
            >
              <span className={`p-1.5 rounded ${r.color}`}>{r.icon}</span>
              {r.title}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {def.usesPeriod && (
            <>
              <label className="text-sm">From<input type="date" value={fromDate} onChange={(e) => setFrom(e.target.value)} className="block mt-1 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900" /></label>
              <label className="text-sm">To<input type="date" value={toDate} onChange={(e) => setTo(e.target.value)} className="block mt-1 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900" /></label>
            </>
          )}
          {active === 'documents' && (
            <label className="text-sm">Expiring within (days)<input type="number" min="0" max="3650" value={days} onChange={(e) => setDays(e.target.value)} className="block mt-1 w-28 px-2 py-1.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900" /></label>
          )}
          {(def.usesPeriod || active === 'documents') && (
            <button onClick={() => void load()} className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700">Show</button>
          )}
          <button onClick={exportCsv} disabled={!data?.rows.length} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50"><Download size={14} />CSV</button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading && !data && <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" />Loading…</div>}

        {data && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {def.totals.map((t) => (
                <div key={t.key} className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                  <div className="text-xs text-gray-500">{t.label}</div>
                  <div className="text-lg font-semibold">{display(data.totals[t.key], t.kind)}</div>
                </div>
              ))}
            </div>
            {data.buckets && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {data.buckets.map((b) => (
                  <div key={b.label} className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
                    <div className="text-xs text-gray-500">{b.label}</div>
                    <div className="font-semibold">{b.count} vehicles · {display(b.cost, 'money')}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{def.title}</caption>
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>{def.columns.map((c) => <th key={c.key} scope="col" className={`px-3 py-2 font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap ${c.kind && c.kind !== 'date' ? 'text-right' : 'text-left'}`}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 ? (
                    <tr><td colSpan={def.columns.length} className="px-3 py-8 text-center text-gray-500">Nothing to show for this report{def.usesPeriod ? ' and period' : ''}.</td></tr>
                  ) : data.rows.map((r, i) => (
                    <tr key={String(r.id ?? i)} className={`border-t border-gray-200 dark:border-gray-700 ${active === 'documents' && Number(r.daysLeft) < 0 ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                      {def.columns.map((c) => {
                        const href = c.link?.(r, tenantSlug)
                        const text = display(r[c.key], c.kind)
                        return (
                          <td key={c.key} className={`px-3 py-2 whitespace-nowrap ${c.kind && c.kind !== 'date' ? 'text-right' : ''} ${c.key === 'profit' && Number(r.profit) < 0 ? 'text-red-600' : ''}`}>
                            {href && text !== '-' ? <Link href={href} className="text-blue-600 dark:text-blue-400 hover:underline">{text}</Link> : text}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </ListPageLayout>
  )
}
