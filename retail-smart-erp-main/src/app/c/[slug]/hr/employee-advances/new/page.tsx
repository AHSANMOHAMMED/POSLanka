'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/components/ui/toast'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { FormField, FormInput, FormSelect, FormLabel } from '@/components/ui/form-elements'
import { Loader2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

interface EmployeeOption {
  id: string
  fullName: string
  employeeCode: string | null
}

export default function NewAdvancePage() {
  const { tenantSlug: slug } = useCompany()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [employees, setEmployees] = useState<EmployeeOption[]>([])

  const [form, setForm] = useState({
    employeeProfileId: '',
    requestedAmount: '',
    recoveryMethod: 'salary_deduction',
    recoveryInstallments: '1',
    purpose: '',
    reason: '',
    notes: '',
  })

  useEffect(() => {
    fetch('/api/employee-profiles?all=true&status=active')
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : data.data || []
        setEmployees(list.map((e: { id: string; fullName?: string; employeeName?: string; employeeCode: string }) => ({
          id: e.id,
          fullName: e.fullName || e.employeeName || 'Unknown',
          employeeCode: e.employeeCode,
        })))
      })
      .catch(() => {})
  }, [])

  async function handleSave() {
    if (!form.employeeProfileId || !form.requestedAmount) {
      toast.error('Employee and requested amount are required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/employee-advances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeProfileId: form.employeeProfileId,
          requestedAmount: Number(form.requestedAmount),
          recoveryMethod: form.recoveryMethod,
          recoveryInstallments: Number(form.recoveryInstallments) || 1,
          purpose: form.purpose || null,
          reason: form.reason || null,
          notes: form.notes || null,
        }),
      })
      if (res.ok) {
        const advance = await res.json()
        toast.success('Advance created')
        router.push(`/c/${slug}/hr/employee-advances/${advance.id}`)
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to create')
      }
    } catch {
      toast.error('Failed to create advance')
    } finally {
      setSaving(false)
    }
  }

  const installmentAmount = form.requestedAmount && form.recoveryInstallments
    ? (Number(form.requestedAmount) / (Number(form.recoveryInstallments) || 1)).toFixed(2)
    : '0.00'

  return (
    <PermissionGuard permission="approveAdvances">
      <div className="p-6 space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center gap-4">
          <Link href={`/c/${slug}/hr/employee-advances`} className="text-gray-400 hover:text-gray-600">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <Breadcrumb items={[
            { label: 'HR' },
            { label: 'Employee Advances', href: `/c/${slug}/hr/employee-advances` },
            { label: 'New Advance' },
          ]} />
        </div>

        <div className="bg-white rounded border p-6 space-y-4">
          <h2 className="text-lg font-semibold">New Employee Advance</h2>

          <FormField>
            <FormLabel required>Employee</FormLabel>
            <FormSelect
              value={form.employeeProfileId}
              onChange={(e) => setForm((p) => ({ ...p, employeeProfileId: e.target.value }))}
            >
              <option value="">Select employee...</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName} {e.employeeCode ? `(${e.employeeCode})` : ''}
                </option>
              ))}
            </FormSelect>
          </FormField>

          <FormField>
            <FormLabel required>Requested Amount</FormLabel>
            <FormInput
              type="number"
              step="0.01"
              value={form.requestedAmount}
              onChange={(e) => setForm((p) => ({ ...p, requestedAmount: e.target.value }))}
              placeholder="0.00"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-4">
            <FormField>
              <FormLabel>Recovery Method</FormLabel>
              <FormSelect
                value={form.recoveryMethod}
                onChange={(e) => setForm((p) => ({ ...p, recoveryMethod: e.target.value }))}
              >
                <option value="salary_deduction">Salary Deduction</option>
                <option value="lump_sum">Lump Sum</option>
              </FormSelect>
            </FormField>
            <FormField>
              <FormLabel>Recovery Installments</FormLabel>
              <FormInput
                type="number"
                min="1"
                value={form.recoveryInstallments}
                onChange={(e) => setForm((p) => ({ ...p, recoveryInstallments: e.target.value }))}
              />
            </FormField>
          </div>

          {Number(form.requestedAmount) > 0 && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm">
              <strong>Recovery per installment:</strong> {installmentAmount}
            </div>
          )}

          <FormField>
            <FormLabel>Purpose</FormLabel>
            <FormInput
              value={form.purpose}
              onChange={(e) => setForm((p) => ({ ...p, purpose: e.target.value }))}
              placeholder="e.g. Medical, Housing, Education"
            />
          </FormField>

          <FormField>
            <FormLabel>Reason</FormLabel>
            <textarea
              value={form.reason}
              onChange={(e) => setForm((p) => ({ ...p, reason: e.target.value }))}
              className="w-full px-3 py-2 border rounded text-sm"
              rows={3}
              placeholder="Detailed reason for the advance..."
            />
          </FormField>

          <FormField>
            <FormLabel>Notes</FormLabel>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              className="w-full px-3 py-2 border rounded text-sm"
              rows={2}
              placeholder="Internal notes..."
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Link
              href={`/c/${slug}/hr/employee-advances`}
              className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
            >
              Cancel
            </Link>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Advance
            </button>
          </div>
        </div>
      </div>
    </PermissionGuard>
  )
}
