'use client'

import { useState, useCallback, useRef, use } from 'react'
import { useRealtimeDocument } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { Loader2, ArrowLeft, Printer } from 'lucide-react'
import Link from 'next/link'

interface SlipComponent {
  componentName: string
  componentType: string
  abbreviation: string
  amount: string
  isPayableByEmployer: boolean
  doNotIncludeInTotal: boolean
}

interface SlipDetail {
  id: string
  slipNo: string
  employeeName: string
  payrollMonth: number
  payrollYear: number
  baseSalary: string
  grossPay: string
  totalDeductions: string
  totalEmployerContributions: string
  netPay: string
  commissionAmount: string | null
  advanceDeduction: string | null
  totalWorkingDays: number
  paymentDays: number
  status: string
  paidAt: string | null
  components: SlipComponent[]
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function fmt(val: string | number | null) {
  if (val == null) return '—'
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(val))
}

export default function MySalarySlipDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { id } = use(params)
  const { tenantSlug: slug } = useCompany()
  const [slip, setSlip] = useState<SlipDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const printRef = useRef<HTMLDivElement>(null)

  function handlePrint() {
    window.print()
  }

  const fetchSlip = useCallback(async () => {
    try {
      const res = await fetch(`/api/my/salary-slips/${id}`)
      if (res.ok) setSlip(await res.json())
    } catch {
      toast.error('Failed to load salary slip')
    } finally {
      setLoading(false)
    }
  }, [id])

  useRealtimeDocument('salary-slip', id, fetchSlip)

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
  }
  if (!slip) {
    return <div className="p-6 text-center text-gray-500">Salary slip not found</div>
  }

  const earnings = slip.components.filter((c) => c.componentType === 'earning' && !c.doNotIncludeInTotal)
  const deductions = slip.components.filter((c) => c.componentType === 'deduction' && !c.isPayableByEmployer)
  const employerContributions = slip.components.filter((c) => c.isPayableByEmployer)

  return (
    <PermissionGuard permission="viewOwnPaySlips">
      <div className="p-6 space-y-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href={`/c/${slug}/my/salary-slips`} className="text-gray-400 hover:text-gray-600">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <Breadcrumb items={[
              { label: 'My Portal', href: `/c/${slug}/my` },
              { label: 'Salary Slips', href: `/c/${slug}/my/salary-slips` },
              { label: slip.slipNo },
            ]} />
          </div>
          <button onClick={handlePrint} className="flex items-center gap-2 px-3 py-2 text-sm border rounded hover:bg-gray-50">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>

        <div ref={printRef} className="space-y-4">
          <div className="bg-white rounded border p-6">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-xl font-bold">{slip.slipNo}</h1>
                <p className="text-gray-600">{slip.employeeName}</p>
                <p className="text-sm text-gray-500 mt-1">{MONTHS[slip.payrollMonth]} {slip.payrollYear}</p>
              </div>
              <div className="text-right text-sm text-gray-500">
                <p>Working Days: {slip.paymentDays}/{slip.totalWorkingDays}</p>
                <p>Base Salary: {fmt(slip.baseSalary)}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded border">
              <div className="px-4 py-3 border-b bg-green-50">
                <h3 className="text-sm font-semibold text-green-800">Earnings</h3>
              </div>
              <table className="w-full">
                <tbody className="divide-y">
                  {earnings.map((c, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-sm">{c.componentName}</td>
                      <td className="px-4 py-2 text-sm text-right font-medium">{fmt(c.amount)}</td>
                    </tr>
                  ))}
                  {slip.commissionAmount && Number(slip.commissionAmount) > 0 && (
                    <tr>
                      <td className="px-4 py-2 text-sm">Commission</td>
                      <td className="px-4 py-2 text-sm text-right font-medium">{fmt(slip.commissionAmount)}</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-green-50">
                    <td className="px-4 py-2 text-sm font-semibold">Total Earnings</td>
                    <td className="px-4 py-2 text-sm text-right font-bold">{fmt(slip.grossPay)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="bg-white rounded border">
              <div className="px-4 py-3 border-b bg-red-50">
                <h3 className="text-sm font-semibold text-red-800">Deductions</h3>
              </div>
              <table className="w-full">
                <tbody className="divide-y">
                  {deductions.map((c, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-sm">{c.componentName}</td>
                      <td className="px-4 py-2 text-sm text-right font-medium">{fmt(c.amount)}</td>
                    </tr>
                  ))}
                  {slip.advanceDeduction && Number(slip.advanceDeduction) > 0 && (
                    <tr>
                      <td className="px-4 py-2 text-sm">Advance Recovery</td>
                      <td className="px-4 py-2 text-sm text-right font-medium">{fmt(slip.advanceDeduction)}</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-red-50">
                    <td className="px-4 py-2 text-sm font-semibold">Total Deductions</td>
                    <td className="px-4 py-2 text-sm text-right font-bold">{fmt(slip.totalDeductions)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {employerContributions.length > 0 && (
            <div className="bg-white rounded border">
              <div className="px-4 py-3 border-b bg-purple-50">
                <h3 className="text-sm font-semibold text-purple-800">Employer Contributions</h3>
              </div>
              <table className="w-full">
                <tbody className="divide-y">
                  {employerContributions.map((c, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-sm">{c.componentName}</td>
                      <td className="px-4 py-2 text-sm text-right font-medium">{fmt(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-purple-50">
                    <td className="px-4 py-2 text-sm font-semibold">Total Employer Contributions</td>
                    <td className="px-4 py-2 text-sm text-right font-bold">{fmt(slip.totalEmployerContributions)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="bg-white rounded border p-4">
            <div className="flex justify-between items-center">
              <span className="text-lg font-bold">Net Pay</span>
              <span className="text-2xl font-bold text-green-700">{fmt(slip.netPay)}</span>
            </div>
          </div>
        </div>
      </div>
    </PermissionGuard>
  )
}
