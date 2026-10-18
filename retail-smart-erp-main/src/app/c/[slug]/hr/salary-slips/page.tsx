'use client'

import { useState } from 'react'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { FileText, Loader2, Search, Eye } from 'lucide-react'
import Link from 'next/link'

interface SalarySlip {
  id: string
  slipNo: string
  employeeName: string
  payrollMonth: number
  payrollYear: number
  baseSalary: string
  grossPay: string
  totalDeductions: string
  netPay: string
  status: 'draft' | 'submitted' | 'cancelled'
  createdAt: string
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const statusColors: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  submitted: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

function formatCurrency(val: string | number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(val))
}

export default function SalarySlipsPage() {
  const { tenantSlug: slug } = useCompany()
  const currentYear = new Date().getFullYear()
  const [yearFilter, setYearFilter] = useState(String(currentYear))
  const [monthFilter, setMonthFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const additionalParams: Record<string, string> = {}
  if (yearFilter) additionalParams.year = yearFilter
  if (monthFilter) additionalParams.month = monthFilter
  if (statusFilter) additionalParams.status = statusFilter

  const {
    data: slips,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
  } = usePaginatedData<SalarySlip>({
    endpoint: '/api/salary-slips',
    entityType: 'salary-slip',
    storageKey: 'salary-slips-page-size',
    additionalParams,
  })

  return (
    <PermissionGuard permission="viewPayroll">
      <div className="p-6 space-y-6">
        <Breadcrumb items={[{ label: 'HR' }, { label: 'Salary Slips' }]} />

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by employee name..."
              className="w-full pl-10 pr-4 py-2 border rounded text-sm"
            />
          </div>
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="px-3 py-2 border rounded text-sm"
          >
            {[currentYear, currentYear - 1, currentYear - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="px-3 py-2 border rounded text-sm"
          >
            <option value="">All Months</option>
            {MONTHS.slice(1).map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border rounded text-sm"
          >
            <option value="">All Status</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div className="bg-white rounded border">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : slips.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No salary slips found</p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="table-sticky-header">
                  <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Slip No</th>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3 text-right">Gross Pay</th>
                    <th className="px-4 py-3 text-right">Deductions</th>
                    <th className="px-4 py-3 text-right">Net Pay</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {slips.map((slip) => (
                    <tr key={slip.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono">{slip.slipNo}</td>
                      <td className="px-4 py-3 text-sm font-medium">{slip.employeeName}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {MONTHS[slip.payrollMonth]} {slip.payrollYear}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">{formatCurrency(slip.grossPay)}</td>
                      <td className="px-4 py-3 text-sm text-right text-red-600">{formatCurrency(slip.totalDeductions)}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(slip.netPay)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[slip.status] || ''}`}>
                          {slip.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/c/${slug}/hr/salary-slips/${slip.id}`}
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
