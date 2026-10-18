'use client'

import { useState, useCallback, use } from 'react'
import { useRealtimeDocument } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { CancellationReasonModal } from '@/components/modals'
import { Loader2, ArrowLeft, Play, XCircle, Eye } from 'lucide-react'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import Link from 'next/link'

interface PayrollRunDetail {
  id: string
  runNo: string
  payrollMonth: number
  payrollYear: number
  totalEmployees: number
  totalGrossPay: string
  totalDeductions: string
  totalEmployerContributions: string
  totalNetPay: string
  totalCommissions: string
  status: string
  cancellationReason: string | null
  notes: string | null
  salarySlips: Array<{
    id: string
    slipNo: string
    employeeName: string
    grossPay: string
    totalDeductions: string
    netPay: string
    status: string
  }>
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function fmt(val: string | number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(val))
}

const statusColors: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-600',
  submitted: 'bg-green-100 text-green-800',
}

export default function PayrollRunDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = use(params)
  const [run, setRun] = useState<PayrollRunDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)

  const fetchRun = useCallback(async () => {
    try {
      const res = await fetch(`/api/payroll-runs/${id}`)
      if (res.ok) setRun(await res.json())
    } catch {
      toast.error('Failed to load payroll run')
    } finally {
      setLoading(false)
    }
  }, [id])

  useRealtimeDocument('payroll-run', id, fetchRun)

  async function handleProcess() {
    const res = await fetch(`/api/payroll-runs/${id}/process`, { method: 'POST' })
    if (res.ok) {
      toast.success('Payroll run processed successfully')
      fetchRun()
    } else {
      const err = await res.json()
      toast.error(err.error || 'Failed to process')
    }
  }

  async function handleCancel(reason: string) {
    setProcessing(true)
    try {
      const res = await fetch(`/api/payroll-runs/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancellationReason: reason }),
      })
      if (res.ok) {
        toast.success('Payroll run cancelled')
        setShowCancelModal(false)
        fetchRun()
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
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!run) {
    return <div className="p-6 text-center text-gray-500">Payroll run not found</div>
  }

  return (
    <PermissionGuard permission="processPayroll">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <div className="flex items-center gap-4">
          <Link href={`/c/${slug}/hr/payroll-runs`} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Breadcrumb items={[
            { label: 'HR' },
            { label: 'Payroll Runs', href: `/c/${slug}/hr/payroll-runs` },
            { label: run.runNo },
          ]} />
        </div>

        {/* Header */}
        <div className="bg-white rounded border p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">{run.runNo}</h1>
              <p className="text-gray-600 mt-1">{MONTHS[run.payrollMonth]} {run.payrollYear}</p>
              <p className="text-sm text-gray-500 mt-1">{run.totalEmployees} employees</p>
            </div>
            <span className={`px-3 py-1 text-sm font-medium rounded-full ${statusColors[run.status] || ''}`}>
              {run.status}
            </span>
          </div>


          {run.cancellationReason && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              <strong>Cancelled:</strong> {run.cancellationReason}
            </div>
          )}
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Total Gross</p>
            <p className="text-lg font-semibold mt-1">{fmt(run.totalGrossPay)}</p>
          </div>
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Total Deductions</p>
            <p className="text-lg font-semibold mt-1 text-red-600">{fmt(run.totalDeductions)}</p>
          </div>
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Employer Contributions</p>
            <p className="text-lg font-semibold mt-1 text-purple-600">{fmt(run.totalEmployerContributions)}</p>
          </div>
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Total Net Pay</p>
            <p className="text-lg font-bold mt-1">{fmt(run.totalNetPay)}</p>
          </div>
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Commissions</p>
            <p className="text-lg font-semibold mt-1 text-blue-600">{fmt(run.totalCommissions)}</p>
          </div>
        </div>

        {/* Salary Slips Table */}
        <div className="bg-white rounded border">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Salary Slips</h3>
          </div>
          <table className="w-full">
            <thead className="table-sticky-header">
              <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-4 py-3">Slip No</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3 text-right">Gross Pay</th>
                <th className="px-4 py-3 text-right">Deductions</th>
                <th className="px-4 py-3 text-right">Net Pay</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(run.salarySlips || []).map((slip) => (
                <tr key={slip.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono">{slip.slipNo}</td>
                  <td className="px-4 py-3 text-sm font-medium">{slip.employeeName}</td>
                  <td className="px-4 py-3 text-sm text-right">{fmt(slip.grossPay)}</td>
                  <td className="px-4 py-3 text-sm text-right text-red-600">{fmt(slip.totalDeductions)}</td>
                  <td className="px-4 py-3 text-sm text-right font-medium">{fmt(slip.netPay)}</td>
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
        </div>

        {/* Comments & Activity */}
        <DocumentCommentsAndActivity
          documentType="payroll_run"
          documentId={id}
          entityType="payroll-run"
        />

        {/* Action Bar */}
        <DetailPageActions actions={(() => {
          const a: ActionConfig[] = []
          if (run.status === 'draft') {
            a.push({
              key: 'cancel',
              label: 'Cancel',
              icon: <XCircle className="w-4 h-4" />,
              variant: 'danger',
              position: 'left',
              onClick: () => setShowCancelModal(true),
            })
            a.push({
              key: 'process',
              label: 'Process Payroll',
              icon: <Play className="w-4 h-4" />,
              variant: 'success',
              onClick: handleProcess,
              confirmation: {
                title: 'Process Payroll Run',
                message: `Process ${run.runNo}? This will submit all ${run.totalEmployees} draft salary slips.`,
                variant: 'success',
                confirmText: 'Process',
              },
            })
          }
          return a
        })()} />

        <CancellationReasonModal
          isOpen={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          onConfirm={handleCancel}
          title="Cancel Payroll Run"
          itemName={`Payroll run ${run.runNo}`}
          processing={processing}
        />
      </div>
    </PermissionGuard>
  )
}
