'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Home, ChevronRight, Plus, FileText, Loader2 } from 'lucide-react'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils/date-format'
import { formatCurrency } from '@/lib/utils/currency'

interface Quotation {
  id: string
  quotationNo: string
  supplierName: string | null
  status: string
  validUntil: string | null
  deliveryDays: number | null
  total: string
  supplierReference: string | null
  createdByName: string | null
  createdAt: string
}

interface Supplier {
  id: string
  name: string
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-gray-600', bg: 'bg-gray-100 dark:bg-gray-700' },
  submitted: { label: 'Submitted', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  received: { label: 'Received', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
  awarded: { label: 'Awarded', color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-900/20' },
  rejected: { label: 'Rejected', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
  expired: { label: 'Expired', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  cancelled: { label: 'Cancelled', color: 'text-gray-500', bg: 'bg-gray-100 dark:bg-gray-700' },
}

const statusTabs = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'received', label: 'Received' },
  { value: 'awarded', label: 'Awarded' },
]

export default function SupplierQuotationsPage() {
  const router = useRouter()
  const { tenantSlug, currency } = useCompany()
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [newSupplierId, setNewSupplierId] = useState('')

  const {
    data: quotations,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: _refresh,
  } = usePaginatedData<Quotation>({
    endpoint: '/api/supplier-quotations',
    entityType: 'supplier-quotation',
    storageKey: 'supplier-quotations-page-size',
    additionalParams: statusFilter ? { status: statusFilter } : undefined,
  })

  useEffect(() => {
    fetch('/api/suppliers?all=true').then(r => r.json()).then(data => {
      setSuppliers(Array.isArray(data) ? data : data.data || [])
    }).catch(() => {})
  }, [])

  async function handleCreate() {
    if (!newSupplierId) return
    setCreating(true)
    try {
      const res = await fetch('/api/supplier-quotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierId: newSupplierId }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      toast.success('Quotation created')
      router.push(`/c/${tenantSlug}/supplier-quotations/${data.id}`)
    } catch {
      toast.error('Failed to create quotation')
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
        <span className="text-foreground font-medium">Supplier Quotations</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Supplier Quotations</h1>
          <p className="text-sm text-muted-foreground mt-1">Request and compare quotes from suppliers</p>
        </div>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New Quotation
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="bg-card rounded border p-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Supplier *</label>
            <select
              value={newSupplierId}
              onChange={e => setNewSupplierId(e.target.value)}
              className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background text-foreground"
            >
              <option value="">Select supplier...</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleCreate}
            disabled={!newSupplierId || creating}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </button>
          <button onClick={() => setShowCreateForm(false)} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            Cancel
          </button>
        </div>
      )}

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
          placeholder="Search by quotation no, supplier..."
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
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Quotation No</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Supplier</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Valid Until</th>
                <th className="text-center px-4 py-3 font-medium text-muted-foreground">Lead Time</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Total</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Created</th>
              </tr>
            </thead>
            <tbody>
              {loading && quotations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                    Loading...
                  </td>
                </tr>
              ) : quotations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No supplier quotations found</p>
                  </td>
                </tr>
              ) : (
                quotations.map(q => {
                  const status = statusConfig[q.status] || statusConfig.draft
                  return (
                    <tr
                      key={q.id}
                      onClick={() => router.push(`/c/${tenantSlug}/supplier-quotations/${q.id}`)}
                      className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{q.quotationNo}</td>
                      <td className="px-4 py-3 text-muted-foreground">{q.supplierName || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${status.color} ${status.bg}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{q.validUntil ? formatDate(q.validUntil) : '-'}</td>
                      <td className="px-4 py-3 text-center text-muted-foreground">{q.deliveryDays ? `${q.deliveryDays} days` : '-'}</td>
                      <td className="px-4 py-3 text-right font-medium">{formatCurrency(parseFloat(q.total), currency)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(q.createdAt)}</td>
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
