'use client'

import { usePaginatedData } from '@/hooks'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Pagination } from '@/components/ui/pagination'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { Loader2, DollarSign } from 'lucide-react'

interface MyCommission {
  id: string
  saleId: string | null
  workOrderId: string | null
  amount: string
  status: string
  createdAt: string
  description: string | null
}

function fmt(val: string | number | null) {
  if (val == null) return '—'
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(val))
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
}

export default function MyCommissionsPage() {
  const { tenantSlug: slug } = useCompany()

  const {
    data: commissions,
    pagination,
    loading,
    setPage,
    setPageSize,
  } = usePaginatedData<MyCommission>({
    endpoint: '/api/my/commissions',
    entityType: 'commission',
    storageKey: 'my-commissions-page-size',
  })

  return (
    <PermissionGuard permission="viewOwnCommissions">
      <div className="p-6 space-y-6">
        <Breadcrumb items={[
          { label: 'My Portal', href: `/c/${slug}/my` },
          { label: 'Commissions' },
        ]} />

        <h2 className="text-lg font-semibold">My Commissions</h2>

        <div className="bg-white rounded border">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : commissions.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <DollarSign className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No commissions found</p>
              <p className="text-sm mt-1">Your commission earnings will appear here</p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="table-sticky-header">
                  <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {commissions.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm">{new Date(c.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-sm">{c.description || (c.saleId ? 'Sale Commission' : c.workOrderId ? 'Service Commission' : 'Commission')}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">{fmt(c.amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[c.status] || 'bg-gray-100 text-gray-800'}`}>
                          {c.status}
                        </span>
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
