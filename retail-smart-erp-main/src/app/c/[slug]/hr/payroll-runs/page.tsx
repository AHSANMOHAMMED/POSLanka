'use client'

import { useState } from 'react'
import { usePaginatedData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { Pagination } from '@/components/ui/pagination'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormLabel, FormSelect } from '@/components/ui/form-elements'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { Play, Loader2, Eye, Plus } from 'lucide-react'
import Link from 'next/link'

interface PayrollRun {
  id: string
  runNo: string
  payrollMonth: number
  payrollYear: number
  totalEmployees: number
  totalGrossPay: string
  totalNetPay: string
  status: string
  createdAt: string
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const statusColors: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-600',
}

function fmt(val: string | number) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(val))
}

export default function PayrollRunsPage() {
  const { tenantSlug: slug } = useCompany()
  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth() + 1

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createForm, setCreateForm] = useState({
    payrollMonth: currentMonth,
    payrollYear: currentYear,
    totalWorkingDays: 30,
  })

  const {
    data: runs,
    pagination,
    loading,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<PayrollRun>({
    endpoint: '/api/payroll-runs',
    entityType: 'payroll-run',
    storageKey: 'payroll-runs-page-size',
  })

  async function handleCreate() {
    setCreating(true)
    try {
      const res = await fetch('/api/payroll-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      })
      if (res.ok) {
        toast.success('Payroll run created with salary slips')
        setShowCreateModal(false)
        refresh()
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to create')
      }
    } catch {
      toast.error('Failed to create payroll run')
    } finally {
      setCreating(false)
    }
  }

  return (
    <PermissionGuard permission="processPayroll">
      <div className="p-6 space-y-6">
        <Breadcrumb items={[{ label: 'HR' }, { label: 'Payroll Runs' }]} />

        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">Payroll Runs</h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            New Payroll Run
          </button>
        </div>

        <div className="bg-white rounded border">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : runs.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Play className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No payroll runs yet</p>
              <p className="text-sm mt-1">Create your first payroll run to generate salary slips</p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="table-sticky-header">
                  <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Run No</th>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3 text-right">Employees</th>
                    <th className="px-4 py-3 text-right">Total Gross</th>
                    <th className="px-4 py-3 text-right">Total Net</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {runs.map((run) => (
                    <tr key={run.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono">{run.runNo}</td>
                      <td className="px-4 py-3 text-sm">{MONTHS[run.payrollMonth]} {run.payrollYear}</td>
                      <td className="px-4 py-3 text-sm text-right">{run.totalEmployees}</td>
                      <td className="px-4 py-3 text-sm text-right">{fmt(run.totalGrossPay)}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">{fmt(run.totalNetPay)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[run.status] || ''}`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/c/${slug}/hr/payroll-runs/${run.id}`}
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

        <Modal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          title="Create Payroll Run"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField>
                <FormLabel required>Month</FormLabel>
                <FormSelect
                  value={createForm.payrollMonth}
                  onChange={(e) => setCreateForm((p) => ({ ...p, payrollMonth: parseInt(e.target.value) }))}
                >
                  {MONTHS.slice(1).map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}</option>
                  ))}
                </FormSelect>
              </FormField>
              <FormField>
                <FormLabel required>Year</FormLabel>
                <FormInput
                  type="number"
                  value={createForm.payrollYear}
                  onChange={(e) => setCreateForm((p) => ({ ...p, payrollYear: parseInt(e.target.value) }))}
                />
              </FormField>
            </div>
            <FormField>
              <FormLabel>Total Working Days</FormLabel>
              <FormInput
                type="number"
                value={createForm.totalWorkingDays}
                onChange={(e) => setCreateForm((p) => ({ ...p, totalWorkingDays: parseInt(e.target.value) }))}
              />
            </FormField>
            <p className="text-sm text-gray-500">
              This will generate salary slips for all active employees with salary structures assigned.
            </p>
          </div>
          <ModalFooter>
            <button
              onClick={() => setShowCreateModal(false)}
              className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {creating && <Loader2 className="w-4 h-4 animate-spin" />}
              Create & Generate Slips
            </button>
          </ModalFooter>
        </Modal>
      </div>
    </PermissionGuard>
  )
}
