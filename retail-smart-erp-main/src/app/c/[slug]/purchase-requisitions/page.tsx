'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Home, ChevronRight, Plus, FileText, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils/date-format'
import { formatCurrency } from '@/lib/utils/currency'

interface Requisition {
  id: string
  requisitionNo: string
  status: string
  requestedByName: string | null
  department: string | null
  requiredByDate: string | null
  purpose: string | null
  estimatedTotal: string
  createdAt: string
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-gray-700' },
  pending_approval: { label: 'Pending Approval', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  approved: { label: 'Approved', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
  partially_ordered: { label: 'Partially Ordered', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  ordered: { label: 'Ordered', color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  rejected: { label: 'Rejected', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-700' },
}

const statusTabs = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'partially_ordered', label: 'Partial' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'rejected', label: 'Rejected' },
]

export default function PurchaseRequisitionsPage() {
  const router = useRouter()
  const { tenantSlug, currency } = useCompany()
  const [statusFilter, setStatusFilter] = useState('')
  const [creating, setCreating] = useState(false)

  const {
    data: requisitions,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: _refresh,
  } = usePaginatedData<Requisition>({
    endpoint: '/api/purchase-requisitions',
    entityType: 'purchase-requisition',
    storageKey: 'purchase-requisitions-page-size',
    additionalParams: statusFilter ? { status: statusFilter } : undefined,
  })

  async function handleCreate() {
    setCreating(true)
    try {
      const res = await fetch('/api/purchase-requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purpose: '' }),
      })
      if (!res.ok) throw new Error('Failed to create requisition')
      const data = await res.json()
      toast.success('Requisition created')
      router.push(`/c/${tenantSlug}/purchase-requisitions/${data.id}`)
    } catch {
      toast.error('Failed to create requisition')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-foreground"><Home className="h-4 w-4" /></Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground font-medium">Purchase Requisitions</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Purchase Requisitions</h1>
          <p className="text-sm text-muted-foreground mt-1">Request and track purchase approvals</p>
        </div>
        <button
          onClick={handleCreate}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          New Requisition
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b overflow-x-auto">
        {statusTabs.map(tab => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              statusFilter === tab.value
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search by requisition no, purpose, department..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full max-w-md px-3 py-2 border rounded text-sm bg-background text-foreground"
        />
      </div>

      {/* Table */}
      <div className="bg-card rounded border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-sticky-header">
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Requisition No</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Requested By</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Department</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Required By</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Est. Total</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && requisitions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading...
                  </td>
                </tr>
              ) : requisitions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No purchase requisitions found</p>
                  </td>
                </tr>
              ) : (
                requisitions.map(req => {
                  const status = statusConfig[req.status] || statusConfig.draft
                  return (
                    <tr
                      key={req.id}
                      onClick={() => router.push(`/c/${tenantSlug}/purchase-requisitions/${req.id}`)}
                      className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{req.requisitionNo}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.color} ${status.bg}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{req.requestedByName || '-'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{req.department || '-'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{req.requiredByDate ? formatDate(req.requiredByDate) : '-'}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(parseFloat(req.estimatedTotal), currency)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(req.createdAt)}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t px-4"
        />
      </div>
    </div>
  )
}
