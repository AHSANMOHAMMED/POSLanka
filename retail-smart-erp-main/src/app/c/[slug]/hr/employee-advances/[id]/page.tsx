'use client'

import { useState, useCallback, use } from 'react'
import { useRealtimeDocument } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { CancellationReasonModal } from '@/components/modals'
import { Loader2, ArrowLeft, CheckCircle, XCircle, DollarSign } from 'lucide-react'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import Link from 'next/link'

interface RecoveryRecord {
  id: string
  amount: string
  balanceAfter: string
  createdAt: string
}

interface AdvanceDetail {
  id: string
  advanceNo: string
  employeeName: string
  requestedAmount: string
  approvedAmount: string | null
  disbursedAmount: string | null
  recoveredAmount: string
  balanceAmount: string
  recoveryMethod: string
  recoveryInstallments: number | null
  recoveryAmountPerInstallment: string | null
  purpose: string | null
  reason: string | null
  status: string
  requestedAt: string | null
  approvedAt: string | null
  approvalNotes: string | null
  disbursedAt: string | null
  disbursementMethod: string | null
  disbursementReference: string | null
  cancelledAt: string | null
  cancellationReason: string | null
  notes: string | null
  recoveryRecords: RecoveryRecord[]
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

export default function AdvanceDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = use(params)
  const [advance, setAdvance] = useState<AdvanceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [approvalNotes, setApprovalNotes] = useState('')
  const [showApproveModal, setShowApproveModal] = useState(false)

  const fetchAdvance = useCallback(async () => {
    try {
      const res = await fetch(`/api/employee-advances/${id}`)
      if (res.ok) setAdvance(await res.json())
    } catch {
      toast.error('Failed to load advance')
    } finally {
      setLoading(false)
    }
  }, [id])

  useRealtimeDocument('employee-advance', id, fetchAdvance)

  async function handleApprove() {
    setProcessing(true)
    try {
      const res = await fetch(`/api/employee-advances/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedAmount: advance?.requestedAmount,
          approvalNotes: approvalNotes || null,
        }),
      })
      if (res.ok) {
        toast.success('Advance approved')
        setShowApproveModal(false)
        fetchAdvance()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to approve')
      }
    } catch {
      toast.error('Failed to approve')
    } finally {
      setProcessing(false)
    }
  }

  async function handleDisburse() {
    const res = await fetch(`/api/employee-advances/${id}/disburse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (res.ok) {
      toast.success('Advance disbursed')
      fetchAdvance()
    } else {
      const err = await res.json()
      toast.error(err.error || 'Failed to disburse')
    }
  }

  async function handleCancel(reason: string) {
    setProcessing(true)
    try {
      const res = await fetch(`/api/employee-advances/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancellationReason: reason }),
      })
      if (res.ok) {
        toast.success('Advance cancelled')
        setShowCancelModal(false)
        fetchAdvance()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to cancel')
      }
    } catch {
      toast.error('Failed to cancel')
    } finally {
      setProcessing(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
  }
  if (!advance) {
    return <div className="p-6 text-center text-gray-500">Advance not found</div>
  }

  const canApprove = advance.status === 'draft' || advance.status === 'pending_approval'
  const canDisburse = advance.status === 'approved'
  const canCancel = !['cancelled', 'fully_recovered'].includes(advance.status)

  return (
    <PermissionGuard permission="approveAdvances">
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center gap-4">
          <Link href={`/c/${slug}/hr/employee-advances`} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Breadcrumb items={[
            { label: 'HR' },
            { label: 'Employee Advances', href: `/c/${slug}/hr/employee-advances` },
            { label: advance.advanceNo },
          ]} />
        </div>

        <div className="bg-white rounded border p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">{advance.advanceNo}</h1>
              <p className="text-gray-600 mt-1">{advance.employeeName}</p>
            </div>
            <span className={`px-3 py-1 text-sm font-medium rounded-full ${statusColors[advance.status] || ''}`}>
              {statusLabel(advance.status)}
            </span>
          </div>


          {advance.cancellationReason && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              <strong>Cancelled:</strong> {advance.cancellationReason}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Requested</p>
            <p className="text-lg font-semibold mt-1">{fmt(advance.requestedAmount)}</p>
          </div>
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Approved</p>
            <p className="text-lg font-semibold mt-1">{fmt(advance.approvedAmount)}</p>
          </div>
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Recovered</p>
            <p className="text-lg font-semibold mt-1 text-green-600">{fmt(advance.recoveredAmount)}</p>
          </div>
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Balance</p>
            <p className="text-lg font-bold mt-1 text-orange-600">{fmt(advance.balanceAmount)}</p>
          </div>
        </div>

        <div className="bg-white rounded border p-4 space-y-3">
          <h3 className="text-sm font-semibold">Details</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">Recovery Method:</span> <span className="font-medium">{advance.recoveryMethod?.replace(/_/g, ' ')}</span></div>
            <div><span className="text-gray-500">Installments:</span> <span className="font-medium">{advance.recoveryInstallments || '—'}</span></div>
            <div><span className="text-gray-500">Per Installment:</span> <span className="font-medium">{fmt(advance.recoveryAmountPerInstallment)}</span></div>
            <div><span className="text-gray-500">Purpose:</span> <span className="font-medium">{advance.purpose || '—'}</span></div>
          </div>
          {advance.reason && (
            <div className="text-sm"><span className="text-gray-500">Reason:</span> <span className="font-medium">{advance.reason}</span></div>
          )}
          {advance.approvalNotes && (
            <div className="text-sm"><span className="text-gray-500">Approval Notes:</span> <span className="font-medium">{advance.approvalNotes}</span></div>
          )}
        </div>

        {advance.recoveryRecords && advance.recoveryRecords.length > 0 && (
          <div className="bg-white rounded border">
            <div className="px-4 py-3 border-b"><h3 className="text-sm font-semibold">Recovery Records</h3></div>
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-right">Balance After</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {advance.recoveryRecords.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-sm">{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-2 text-sm text-right">{fmt(r.amount)}</td>
                    <td className="px-4 py-2 text-sm text-right">{fmt(r.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Comments & Activity */}
        <DocumentCommentsAndActivity
          documentType="employee_advance"
          documentId={id}
          entityType="employee-advance"
        />

        {/* Approve Modal */}
        {showApproveModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded shadow-lg max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-semibold">Approve Advance</h3>
              <p className="text-sm text-gray-600">Approving {advance.advanceNo} for {advance.employeeName}</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Approval Notes (optional)</label>
                <textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  className="w-full px-3 py-2 border rounded text-sm"
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowApproveModal(false)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Cancel</button>
                <button onClick={handleApprove} disabled={processing}
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
                  {processing && <Loader2 className="w-4 h-4 animate-spin" />} Approve
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Action Bar */}
        <DetailPageActions actions={(() => {
          const a: ActionConfig[] = []
          if (canCancel) {
            a.push({
              key: 'cancel',
              label: 'Cancel',
              icon: <XCircle className="w-4 h-4" />,
              variant: 'danger',
              position: 'left',
              onClick: () => setShowCancelModal(true),
            })
          }
          if (canApprove) {
            a.push({
              key: 'approve',
              label: 'Approve',
              icon: <CheckCircle className="w-4 h-4" />,
              variant: 'success',
              onClick: () => setShowApproveModal(true),
            })
          }
          if (canDisburse) {
            a.push({
              key: 'disburse',
              label: 'Disburse',
              icon: <DollarSign className="w-4 h-4" />,
              variant: 'primary',
              onClick: handleDisburse,
              confirmation: {
                title: 'Disburse Advance',
                message: `Disburse ${advance.advanceNo} (${fmt(advance.approvedAmount)}) to ${advance.employeeName}?`,
                variant: 'success',
                confirmText: 'Disburse',
              },
            })
          }
          return a
        })()} />

        <CancellationReasonModal
          isOpen={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          onConfirm={handleCancel}
          title="Cancel Advance"
          itemName={`Advance ${advance.advanceNo}`}
          processing={processing}
        />
      </div>
    </PermissionGuard>
  )
}
