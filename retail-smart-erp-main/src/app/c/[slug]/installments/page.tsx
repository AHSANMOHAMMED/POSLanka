'use client'

import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, CalendarClock, Wallet, X } from 'lucide-react'
import { usePaginatedData, useTerminology, useDateFormat } from '@/hooks'
import { useCurrency } from '@/hooks/useCurrency'
import { Pagination } from '@/components/ui/pagination'
import { PageLoading } from '@/components/ui/loading-spinner'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { PLAN_STATUS_COLORS } from '@/lib/installments/constants'

interface PlanRow {
  id: string
  planNo: string
  invoiceNo: string | null
  customerName: string
  customerPhone: string | null
  customerNic: string | null
  items: Array<{ itemName: string; serialNumbers?: string[] }>
  totalPayable: string
  installmentAmount: string
  installmentCount: number
  frequency: 'monthly' | 'weekly'
  paidAmount: string
  balance: string
  status: string
  nextDueDate: string | null
  overdueCount: number
  warehouseName: string | null
  createdAt: string
}

interface DueRow {
  scheduleId: string
  planId: string
  planNo: string
  customerName: string
  customerPhone: string | null
  guarantorName: string | null
  guarantorPhone: string | null
  installmentNo: number
  dueDate: string
  amount: string
  paidAmount: string
  lateFee: string
  lateFeePaid: string
  daysOverdue: number
  planBalance: string
  warehouseName: string | null
}


const VIEWS = [
  { key: 'plans', label: 'All plans' },
  { key: 'due', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
] as const

export default function InstallmentsPage() {
  const t = useTerminology()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { tenantSlug } = useCompany()
  const { fCurrency } = useCurrency()
  const { fDate } = useDateFormat()
  const initialView = (searchParams.get('view') as 'plans' | 'due' | 'overdue') || 'plans'
  const [view, setView] = useState<'plans' | 'due' | 'overdue'>(VIEWS.some((v) => v.key === initialView) ? initialView : 'plans')
  const [status, setStatus] = useState('')

  const additionalParams = useMemo(() => {
    const p: Record<string, string> = { view }
    if (status && view === 'plans') p.status = status
    return p
  }, [view, status])

  const { data, pagination, loading, search, setSearch, setPage, setPageSize, refresh } = usePaginatedData<PlanRow & DueRow>({
    endpoint: '/api/installments',
    entityType: 'installment-plan',
    storageKey: 'installments-page-size',
    additionalParams,
  })

  if (loading && data.length === 0) return <PageLoading text="Loading installment plans..." />

  const open = (planId: string) => router.push(`/c/${tenantSlug}/installments/${planId}`)

  return (
    <ListPageLayout
      module={t.sellingModule}
      moduleHref="/selling"
      title="Hire Purchase / Installments"
      actionButton={{ label: 'New Plan', onClick: () => router.push(`/c/${tenantSlug}/installments/new`) }}
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Plan no, customer, NIC, phone, invoice, serial / IMEI..."
      filterContent={
        <>
          <div className="flex rounded border border-gray-300 dark:border-gray-600 overflow-hidden text-sm">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => { setView(v.key); setPage(1) }}
                className={`px-3 py-1.5 ${view === v.key ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          {view === 'plans' && (
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1) }}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white"
            >
              <option value="">All statuses</option>
              {Object.keys(PLAN_STATUS_COLORS).map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          )}
          {status && view === 'plans' && (
            <button onClick={() => setStatus('')} className="text-xs text-gray-500 hover:text-red-600 px-2 py-1.5" aria-label="Clear filter"><X size={14} /></button>
          )}
        </>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        {view === 'plans' ? (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Plan #</th>
                <th className="px-4 py-3 text-left font-medium">Customer</th>
                <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Goods</th>
                <th className="px-4 py-3 text-right font-medium">Installment</th>
                <th className="px-4 py-3 text-right font-medium">Balance</th>
                <th className="px-4 py-3 text-left font-medium hidden md:table-cell">Next due</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                  {search || status ? 'No plans match your filters' : 'No hire purchase plans yet. Put a credit sale on installments with “New Plan”.'}
                </td></tr>
              ) : data.map((p) => (
                <tr key={p.id} onClick={() => open(p.id)} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-medium text-blue-600 dark:text-blue-400"><Wallet size={15} className="text-gray-400" />{p.planNo}</div>
                    {p.invoiceNo && <div className="text-xs text-gray-500">{p.invoiceNo}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900 dark:text-white">{p.customerName}</div>
                    <div className="text-xs text-gray-500">{[p.customerPhone, p.customerNic].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-gray-600 dark:text-gray-300 max-w-xs truncate">
                    {(p.items || []).map((i) => i.itemName).join(', ')}
                  </td>
                  <td className="px-4 py-3 text-right dark:text-white">
                    {fCurrency(p.installmentAmount)}
                    <div className="text-xs text-gray-500">× {p.installmentCount} {p.frequency === 'weekly' ? 'weeks' : 'months'}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-orange-600 dark:text-orange-400">{Number(p.balance) > 0 ? fCurrency(p.balance) : '—'}</td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {p.nextDueDate ? (
                      <span className={p.overdueCount > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-700 dark:text-gray-300'}>
                        {fDate(p.nextDueDate)}{p.overdueCount > 0 && <span className="ml-1 inline-flex items-center gap-0.5"><AlertTriangle size={12} />{p.overdueCount} overdue</span>}
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs font-medium rounded-full capitalize ${PLAN_STATUS_COLORS[p.status] || ''}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Plan #</th>
                <th className="px-4 py-3 text-left font-medium">Customer / guarantor</th>
                <th className="px-4 py-3 text-left font-medium">Installment</th>
                <th className="px-4 py-3 text-right font-medium">Due</th>
                {view === 'overdue' && <th className="px-4 py-3 text-right font-medium">Days overdue</th>}
                <th className="px-4 py-3 text-right font-medium hidden md:table-cell">Plan balance</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                  {view === 'due' ? 'No installments due today.' : 'No overdue installments.'}
                </td></tr>
              ) : data.map((r) => {
                const due = Number(r.amount) - Number(r.paidAmount) + Number(r.lateFee) - Number(r.lateFeePaid)
                return (
                  <tr key={r.scheduleId} onClick={() => open(r.planId)} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                    <td className="px-4 py-3 font-medium text-blue-600 dark:text-blue-400">{r.planNo}</td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900 dark:text-white">{r.customerName} {r.customerPhone && <span className="text-xs text-gray-500">· {r.customerPhone}</span>}</div>
                      {r.guarantorName && <div className="text-xs text-gray-500">Guarantor: {r.guarantorName}{r.guarantorPhone ? ` · ${r.guarantorPhone}` : ''}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 text-gray-700 dark:text-gray-300"><CalendarClock size={14} className="text-gray-400" />#{r.installmentNo} · {fDate(r.dueDate)}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium dark:text-white">
                      {fCurrency(due)}
                      {Number(r.lateFee) > 0 && <div className="text-xs text-red-600">incl. late fee {fCurrency(Number(r.lateFee) - Number(r.lateFeePaid))}</div>}
                    </td>
                    {view === 'overdue' && (
                      <td className="px-4 py-3 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.daysOverdue > 60 ? 'bg-red-600 text-white' : r.daysOverdue > 30 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{r.daysOverdue} days</span>
                      </td>
                    )}
                    <td className="px-4 py-3 text-right hidden md:table-cell text-gray-600 dark:text-gray-300">{fCurrency(r.planBalance)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t dark:border-gray-700 px-4"
        />
      </div>
    </ListPageLayout>
  )
}
