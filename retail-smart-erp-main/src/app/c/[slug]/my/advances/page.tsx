'use client'

import { useState } from 'react'
import { usePaginatedData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Pagination } from '@/components/ui/pagination'
import { Breadcrumb } from '@/components/ui/page-header'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormLabel } from '@/components/ui/form-elements'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { Loader2, Banknote, Plus } from 'lucide-react'

interface MyAdvance {
  id: string
  advanceNo: string
  requestedAmount: string
  approvedAmount: string | null
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

export default function MyAdvancesPage() {
  const { tenantSlug: slug } = useCompany()
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [requestForm, setRequestForm] = useState({
    requestedAmount: '',
    purpose: '',
    reason: '',
  })

  const {
    data: advances,
    pagination,
    loading,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<MyAdvance>({
    endpoint: '/api/my/advances',
    entityType: 'employee-advance',
    storageKey: 'my-advances-page-size',
  })

  async function handleRequest() {
    if (!requestForm.requestedAmount) {
      toast.error('Amount is required')
      return
    }
    setRequesting(true)
    try {
      const res = await fetch('/api/my/advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedAmount: Number(requestForm.requestedAmount),
          purpose: requestForm.purpose || null,
          reason: requestForm.reason || null,
        }),
      })
      if (res.ok) {
        toast.success('Advance request submitted')
        setShowRequestModal(false)
        setRequestForm({ requestedAmount: '', purpose: '', reason: '' })
        refresh()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to submit request')
      }
    } catch {
      toast.error('Failed to submit request')
    } finally {
      setRequesting(false)
    }
  }

  return (
    <PermissionGuard permission="requestAdvance">
      <div className="p-6 space-y-6">
        <Breadcrumb items={[
          { label: 'My Portal', href: `/c/${slug}/my` },
          { label: 'Advances' },
        ]} />

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">My Advances</h2>
          <button
            onClick={() => setShowRequestModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Request Advance
          </button>
        </div>

        <div className="bg-white rounded border">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : advances.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Banknote className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No advances found</p>
              <p className="text-sm mt-1">Request an advance to get started</p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="table-sticky-header">
                  <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Advance No</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Requested</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {advances.map((adv) => (
                    <tr key={adv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono">{adv.advanceNo}</td>
                      <td className="px-4 py-3 text-sm">{new Date(adv.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-sm text-right">{fmt(adv.requestedAmount)}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">
                        {Number(adv.balanceAmount) > 0 ? fmt(adv.balanceAmount) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[adv.status] || ''}`}>
                          {statusLabel(adv.status)}
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

        <Modal
          isOpen={showRequestModal}
          onClose={() => setShowRequestModal(false)}
          title="Request Advance"
        >
          <div className="space-y-4">
            <FormField>
              <FormLabel required>Amount</FormLabel>
              <FormInput
                type="number"
                step="0.01"
                value={requestForm.requestedAmount}
                onChange={(e) => setRequestForm((p) => ({ ...p, requestedAmount: e.target.value }))}
                placeholder="0.00"
              />
            </FormField>
            <FormField>
              <FormLabel>Purpose</FormLabel>
              <FormInput
                value={requestForm.purpose}
                onChange={(e) => setRequestForm((p) => ({ ...p, purpose: e.target.value }))}
                placeholder="e.g. Medical, Housing, Education"
              />
            </FormField>
            <FormField>
              <FormLabel>Reason</FormLabel>
              <textarea
                value={requestForm.reason}
                onChange={(e) => setRequestForm((p) => ({ ...p, reason: e.target.value }))}
                className="w-full px-3 py-2 border rounded text-sm"
                rows={3}
                placeholder="Reason for requesting the advance..."
              />
            </FormField>
            <p className="text-sm text-gray-500">
              Your request will be submitted for approval.
            </p>
          </div>
          <ModalFooter>
            <button
              onClick={() => setShowRequestModal(false)}
              className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleRequest}
              disabled={requesting}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {requesting && <Loader2 className="w-4 h-4 animate-spin" />}
              Submit Request
            </button>
          </ModalFooter>
        </Modal>
      </div>
    </PermissionGuard>
  )
}
