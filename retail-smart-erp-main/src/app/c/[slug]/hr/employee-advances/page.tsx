'use client'

import { useState } from 'react'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { Banknote, Loader2, Search, Eye, Plus } from 'lucide-react'
import Link from 'next/link'

interface EmployeeAdvance {
  id: string
  advanceNo: string
  employeeName: string
  requestedAmount: string
  approvedAmount: string | null
  disbursedAmount: string | null
  recoveredAmount: string
  balanceAmount: string
  status: string
  createdAt: string
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  pending_approval: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  disbursed: 'bg-indigo-100 text-indigo-800',
  partially_recovered: 'bg-orange-100 text-orange-800',
  fully_recovered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

function fmt(val: string | number | null) {
  if (val == null) return '—'
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(val))
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export default function EmployeeAdvancesPage() {
  const { tenantSlug: slug } = useCompany()
  const [statusFilter, setStatusFilter] = useState('')

  const {
    data: advances,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
  } = usePaginatedData<EmployeeAdvance>({
    endpoint: '/api/employee-advances',
    entityType: 'employee-advance',
    storageKey: 'employee-advances-page-size',
    additionalParams: statusFilter ? { status: statusFilter } : undefined,
  })

  return (
    <PermissionGuard permission="approveAdvances">
      <div className="p-6 space-y-6">
        <Breadcrumb items={[{ label: 'HR' }, { label: 'Employee Advances' }]} />

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by employee..."
                className="w-full pl-10 pr-4 py-2 border rounded text-sm"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border rounded text-sm"
            >
              <option value="">All Status</option>
              <option value="draft">Draft</option>
              <option value="pending_approval">Pending Approval</option>
              <option value="approved">Approved</option>
              <option value="disbursed">Disbursed</option>
              <option value="partially_recovered">Partially Recovered</option>
              <option value="fully_recovered">Fully Recovered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <Link
            href={`/c/${slug}/hr/employee-advances/new`}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            New Advance
          </Link>
        </div>

        <div className="bg-white rounded border">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : advances.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Banknote className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No employee advances found</p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="table-sticky-header">
                  <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Advance No</th>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3 text-right">Requested</th>
                    <th className="px-4 py-3 text-right">Approved</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {advances.map((adv) => (
                    <tr key={adv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono">{adv.advanceNo}</td>
                      <td className="px-4 py-3 text-sm font-medium">{adv.employeeName}</td>
                      <td className="px-4 py-3 text-sm text-right">{fmt(adv.requestedAmount)}</td>
                      <td className="px-4 py-3 text-sm text-right">{fmt(adv.approvedAmount)}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">
                        {Number(adv.balanceAmount) > 0 ? fmt(adv.balanceAmount) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[adv.status] || ''}`}>
                          {statusLabel(adv.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/c/${slug}/hr/employee-advances/${adv.id}`}
                          className="p-1 text-gray-400 hover:text-blue-600 inline-block"
                        >
                          <Eye className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={pagination.page}
                pageSize={pagination.pageSize}
                total={pagination.total}
                totalPages={pagination.totalPages}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                className="border-t px-4"
              />
            </>
          )}
        </div>
      </div>
    </PermissionGuard>
  )
}
