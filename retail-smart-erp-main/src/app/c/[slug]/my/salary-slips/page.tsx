'use client'

import { usePaginatedData } from '@/hooks'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Pagination } from '@/components/ui/pagination'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { Loader2, FileText, Eye } from 'lucide-react'
import Link from 'next/link'

interface MySalarySlip {
  id: string
  slipNo: string
  payrollMonth: number
  payrollYear: number
  grossPay: string
  totalDeductions: string
  netPay: string
  status: string
  paidAt: string | null
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function fmt(val: string | number | null) {
  if (val == null) return '—'
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(val))
}

export default function MySalarySlipsPage() {
  const { tenantSlug: slug } = useCompany()

  const {
    data: slips,
    pagination,
    loading,
    setPage,
    setPageSize,
  } = usePaginatedData<MySalarySlip>({
    endpoint: '/api/my/salary-slips',
    entityType: 'salary-slip',
    storageKey: 'my-salary-slips-page-size',
  })

  return (
    <PermissionGuard permission="viewOwnPaySlips">
      <div className="p-6 space-y-6">
        <Breadcrumb items={[
          { label: 'My Portal', href: `/c/${slug}/my` },
          { label: 'Salary Slips' },
        ]} />

        <h2 className="text-lg font-semibold">My Salary Slips</h2>

        <div className="bg-white rounded border">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : slips.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No salary slips found</p>
              <p className="text-sm mt-1">Your salary slips will appear here once submitted</p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="table-sticky-header">
                  <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Slip No</th>
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
                      <td className="px-4 py-3 text-sm">{MONTHS[slip.payrollMonth]} {slip.payrollYear}</td>
                      <td className="px-4 py-3 text-sm text-right">{fmt(slip.grossPay)}</td>
                      <td className="px-4 py-3 text-sm text-right text-red-600">{fmt(slip.totalDeductions)}</td>
                      <td className="px-4 py-3 text-sm text-right font-semibold">{fmt(slip.netPay)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800">
                          {slip.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/c/${slug}/my/salary-slips/${slip.id}`}
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
