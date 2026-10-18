'use client'

import { useState, useCallback, use } from 'react'
import { useRealtimeDocument } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { CancellationReasonModal } from '@/components/modals'
import { Loader2, ArrowLeft, CheckCircle, XCircle, Printer } from 'lucide-react'
import { DetailPageActions, type ActionConfig } from '@/components/ui/detail-page-actions'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import Link from 'next/link'

interface SlipComponent {
  id: string
  componentName: string
  componentType: 'earning' | 'deduction'
  abbreviation: string
  formulaUsed: string | null
  amount: string
  isStatutory: boolean
  doNotIncludeInTotal: boolean
  isPayableByEmployer: boolean
  sortOrder: number
}

interface SalarySlipDetail {
  id: string
  slipNo: string
  employeeName: string
  payrollMonth: number
  payrollYear: number
  startDate: string
  endDate: string
  totalWorkingDays: string
  paymentDays: string
  baseSalary: string
  grossPay: string
  totalDeductions: string
  totalEmployerContributions: string
  netPay: string
  commissionAmount: string
  advanceDeduction: string
  salaryStructureName: string | null
  status: 'draft' | 'submitted' | 'cancelled'
  cancellationReason: string | null
  components: SlipComponent[]
  employeeProfile?: { user?: { fullName: string; email: string } }
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function fmt(val: string | number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(val))
}

export default function SalarySlipDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = use(params)
  const [slip, setSlip] = useState<SalarySlipDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [showCancelModal, setShowCancelModal] = useState(false)

  const fetchSlip = useCallback(async () => {
    try {
      const res = await fetch(`/api/salary-slips/${id}`)
      if (res.ok) {
        const data = await res.json()
        setSlip(data)
      }
    } catch {
      toast.error('Failed to load salary slip')
    } finally {
      setLoading(false)
    }
  }, [id])

  useRealtimeDocument('salary-slip', id, fetchSlip)

  async function handleSubmit() {
    const res = await fetch(`/api/salary-slips/${id}/submit`, { method: 'POST' })
    if (res.ok) {
      toast.success('Salary slip submitted')
      fetchSlip()
    } else {
      const err = await res.json()
      toast.error(err.error || 'Failed to submit')
    }
  }

  async function handleCancel(reason: string) {
    setProcessing(true)
    try {
      const res = await fetch(`/api/salary-slips/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cancellationReason: reason }),
      })
      if (res.ok) {
        toast.success('Salary slip cancelled')
        setShowCancelModal(false)
        fetchSlip()
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

  if (!slip) {
    return (
      <div className="p-6 text-center text-gray-500">
        Salary slip not found
      </div>
    )
  }

  const earnings = slip.components.filter((c) => c.componentType === 'earning')
  const deductions = slip.components.filter((c) => c.componentType === 'deduction' && !c.isPayableByEmployer)
  const employerContributions = slip.components.filter((c) => c.isPayableByEmployer)

  return (
    <PermissionGuard permission="viewPayroll">
      <div className="p-6 space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center gap-4">
          <Link href={`/c/${slug}/hr/salary-slips`} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Breadcrumb items={[{ label: 'HR' }, { label: 'Salary Slips', href: `/c/${slug}/hr/salary-slips` }, { label: slip.slipNo }]} />
        </div>

        {/* Header */}
        <div className="bg-white rounded border p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">{slip.slipNo}</h1>
              <p className="text-gray-600 mt-1">{slip.employeeName}</p>
              <p className="text-sm text-gray-500 mt-1">
                {MONTHS[slip.payrollMonth]} {slip.payrollYear}
                {slip.salaryStructureName && ` • ${slip.salaryStructureName}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 text-sm font-medium rounded-full ${
                slip.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                slip.status === 'submitted' ? 'bg-green-100 text-green-800' :
                'bg-red-100 text-red-800'
              }`}>
                {slip.status.charAt(0).toUpperCase() + slip.status.slice(1)}
              </span>
            </div>
          </div>


          {slip.cancellationReason && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              <strong>Cancelled:</strong> {slip.cancellationReason}
            </div>
          )}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Base Salary</p>
            <p className="text-lg font-semibold mt-1">{fmt(slip.baseSalary)}</p>
          </div>
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Gross Pay</p>
            <p className="text-lg font-semibold mt-1 text-green-600">{fmt(slip.grossPay)}</p>
          </div>
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Total Deductions</p>
            <p className="text-lg font-semibold mt-1 text-red-600">{fmt(slip.totalDeductions)}</p>
          </div>
          <div className="bg-white rounded border p-4">
            <p className="text-xs text-gray-500 uppercase">Net Pay</p>
            <p className="text-xl font-bold mt-1">{fmt(slip.netPay)}</p>
          </div>
        </div>

        {/* Working Days */}
        <div className="bg-white rounded border p-4">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Working Days:</span>{' '}
              <span className="font-medium">{slip.totalWorkingDays}</span>
            </div>
            <div>
              <span className="text-gray-500">Payment Days:</span>{' '}
              <span className="font-medium">{slip.paymentDays}</span>
            </div>
            <div>
              <span className="text-gray-500">Period:</span>{' '}
              <span className="font-medium">{slip.startDate} to {slip.endDate}</span>
            </div>
          </div>
        </div>

        {/* Earnings */}
        <div className="bg-white rounded border">
          <div className="px-4 py-3 border-b bg-green-50">
            <h3 className="text-sm font-semibold text-green-800">Earnings</h3>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-4 py-2">Component</th>
                <th className="px-4 py-2">Abbreviation</th>
                <th className="px-4 py-2">Formula</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {earnings.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-sm">{c.componentName}</td>
                  <td className="px-4 py-2 text-sm font-mono text-gray-500">{c.abbreviation}</td>
                  <td className="px-4 py-2 text-sm text-gray-500 font-mono">{c.formulaUsed || '—'}</td>
                  <td className="px-4 py-2 text-sm text-right font-medium">{fmt(c.amount)}</td>
                </tr>
              ))}
              {Number(slip.commissionAmount) > 0 && (
                <tr className="bg-blue-50">
                  <td className="px-4 py-2 text-sm">Commission</td>
                  <td className="px-4 py-2 text-sm font-mono text-gray-500">COMM</td>
                  <td className="px-4 py-2 text-sm text-gray-500">—</td>
                  <td className="px-4 py-2 text-sm text-right font-medium">{fmt(slip.commissionAmount)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t bg-green-50 font-semibold">
                <td className="px-4 py-2 text-sm" colSpan={3}>Total Earnings (Gross Pay)</td>
                <td className="px-4 py-2 text-sm text-right">{fmt(slip.grossPay)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Deductions */}
        <div className="bg-white rounded border">
          <div className="px-4 py-3 border-b bg-red-50">
            <h3 className="text-sm font-semibold text-red-800">Deductions</h3>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase">
                <th className="px-4 py-2">Component</th>
                <th className="px-4 py-2">Abbreviation</th>
                <th className="px-4 py-2">Formula</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {deductions.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2 text-sm">
                    {c.componentName}
                    {c.isStatutory && <span className="ml-1 text-xs text-orange-500">(Statutory)</span>}
                  </td>
                  <td className="px-4 py-2 text-sm font-mono text-gray-500">{c.abbreviation}</td>
                  <td className="px-4 py-2 text-sm text-gray-500 font-mono">{c.formulaUsed || '—'}</td>
                  <td className="px-4 py-2 text-sm text-right font-medium text-red-600">{fmt(c.amount)}</td>
                </tr>
              ))}
              {Number(slip.advanceDeduction) > 0 && (
                <tr className="bg-orange-50">
                  <td className="px-4 py-2 text-sm">Advance Recovery</td>
                  <td className="px-4 py-2 text-sm font-mono text-gray-500">ADV</td>
                  <td className="px-4 py-2 text-sm text-gray-500">—</td>
                  <td className="px-4 py-2 text-sm text-right font-medium text-red-600">{fmt(slip.advanceDeduction)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t bg-red-50 font-semibold">
                <td className="px-4 py-2 text-sm" colSpan={3}>Total Deductions</td>
                <td className="px-4 py-2 text-sm text-right text-red-600">{fmt(slip.totalDeductions)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Employer Contributions */}
        {employerContributions.length > 0 && (
          <div className="bg-white rounded border">
            <div className="px-4 py-3 border-b bg-purple-50">
              <h3 className="text-sm font-semibold text-purple-800">Employer Contributions (Not deducted from salary)</h3>
            </div>
            <table className="w-full">
              <tbody className="divide-y">
                {employerContributions.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 text-sm">{c.componentName}</td>
                    <td className="px-4 py-2 text-sm font-mono text-gray-500">{c.abbreviation}</td>
                    <td className="px-4 py-2 text-sm text-right font-medium text-purple-600">{fmt(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-purple-50 font-semibold">
                  <td className="px-4 py-2 text-sm" colSpan={2}>Total Employer Contributions</td>
                  <td className="px-4 py-2 text-sm text-right text-purple-600">{fmt(slip.totalEmployerContributions)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Net Pay */}
        <div className="bg-blue-50 rounded border border-blue-200 p-6 text-center">
          <p className="text-sm text-blue-600 font-medium">NET PAY</p>
          <p className="text-3xl font-bold text-blue-900 mt-1">{fmt(slip.netPay)}</p>
        </div>

        {/* Comments & Activity */}
        <DocumentCommentsAndActivity
          documentType="salary_slip"
          documentId={id}
          entityType="salary-slip"
        />

        <DetailPageActions actions={(() => {
          const a: ActionConfig[] = []
          if (slip.status === 'draft') {
            a.push({
              key: 'cancel',
              label: 'Cancel',
              icon: <XCircle className="w-4 h-4" />,
              variant: 'danger',
              position: 'left',
              onClick: () => setShowCancelModal(true),
            })
            a.push({
              key: 'submit',
              label: 'Submit',
              icon: <CheckCircle className="w-4 h-4" />,
              variant: 'success',
              onClick: handleSubmit,
              confirmation: {
                title: 'Submit Salary Slip',
                message: `Submit salary slip ${slip.slipNo} for ${slip.employeeName}? This will finalize the slip.`,
                variant: 'success',
                confirmText: 'Submit',
              },
            })
          }
          if (slip.status === 'submitted') {
            a.push({
              key: 'cancel',
              label: 'Cancel',
              icon: <XCircle className="w-4 h-4" />,
              variant: 'danger',
              position: 'left',
              onClick: () => setShowCancelModal(true),
            })
            a.push({
              key: 'print',
              label: 'Print',
              icon: <Printer className="w-4 h-4" />,
              variant: 'outline',
              onClick: () => window.print(),
            })
          }
          return a
        })()} />

        <CancellationReasonModal
          isOpen={showCancelModal}
          onClose={() => setShowCancelModal(false)}
          onConfirm={handleCancel}
          title="Cancel Salary Slip"
          itemName={`Salary slip ${slip.slipNo} for ${slip.employeeName}`}
          processing={processing}
        />
      </div>
    </PermissionGuard>
  )
}
