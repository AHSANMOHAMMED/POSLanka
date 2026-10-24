'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Receipt, Plus } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormLabel } from '@/components/ui/form-elements'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { useRealtimeData } from '@/hooks'

interface Claim {
  id: string
  expenseNo: string
  expenseDate: string
  amount: string
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'void'
  categoryName: string | null
  description: string | null
  rejectedReason: string | null
  paidFrom: string | null
}
interface Category { id: string; name: string; isActive: boolean }

const statusColors: Record<Claim['status'], string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-gray-100 text-gray-700',
  paid: 'bg-green-100 text-green-800',
  void: 'bg-red-100 text-red-700',
}
const statusLabel: Record<Claim['status'], string> = { pending: 'Awaiting approval', approved: 'Approved — to be paid', rejected: 'Rejected', paid: 'Paid', void: 'Void' }
const fmt = (v: string | number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(Number(v))

export default function MyExpenseClaimsPage() {
  const { tenantSlug: slug } = useCompany()
  const [claims, setClaims] = useState<Claim[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ amount: '', categoryId: '', description: '', receiptNo: '', expenseDate: new Date().toLocaleDateString('en-CA') })

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/expenses?kind=reimbursement&mine=true&pageSize=100')
      if (res.ok) setClaims((await res.json()).data || [])
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
    fetch('/api/expense-categories').then((r) => (r.ok ? r.json() : { data: [] })).then((d) => setCategories((d.data || []).filter((c: Category) => c.isActive))).catch(() => undefined)
  }, [load])
  useRealtimeData(load, { entityType: 'expense', refreshOnMount: false })

  async function submit() {
    const amount = parseFloat(form.amount)
    if (!(amount > 0)) { toast.error('Enter the amount'); return }
    if (!form.description.trim()) { toast.error('Describe what you paid for'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'reimbursement', amount, categoryId: form.categoryId || undefined, description: form.description.trim(),
          receiptNo: form.receiptNo.trim() || undefined, expenseDate: form.expenseDate,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Failed to submit the claim'); return }
      toast.success(`Claim ${data.expenseNo} submitted for approval`)
      setOpen(false)
      setForm({ amount: '', categoryId: '', description: '', receiptNo: '', expenseDate: new Date().toLocaleDateString('en-CA') })
      void load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <PermissionGuard permission="requestAdvance">
      <div className="p-6 space-y-6">
        <Breadcrumb items={[{ label: 'My Portal', href: `/c/${slug}/my` }, { label: 'Expense claims' }]} />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold dark:text-white">My Expense Claims</h2>
          <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" /> New claim
          </button>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          {loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : claims.length === 0 ? (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <Receipt className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No claims yet</p>
              <p className="text-sm mt-1">Spent your own money for the shop? Claim it back here.</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="table-sticky-header">
                <tr className="border-b dark:border-gray-700 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-3">Claim</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">For</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {claims.map((c) => (
                  <tr key={c.id} className="text-sm dark:text-gray-200">
                    <td className="px-4 py-3 font-mono">{c.expenseNo}</td>
                    <td className="px-4 py-3">{c.expenseDate}</td>
                    <td className="px-4 py-3">{c.categoryName ? `${c.categoryName} — ` : ''}{c.description || '—'}</td>
                    <td className="px-4 py-3 text-right">{fmt(c.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${statusColors[c.status]}`}>{statusLabel[c.status]}</span>
                      {c.rejectedReason && <div className="text-xs text-gray-500 mt-0.5">{c.rejectedReason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <Modal isOpen={open} onClose={() => setOpen(false)} title="New expense claim">
          <div className="space-y-4">
            <FormField>
              <FormLabel required>Amount</FormLabel>
              <FormInput type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
            </FormField>
            <FormField>
              <FormLabel required>What did you pay for?</FormLabel>
              <FormInput value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Fuel for the delivery run" maxLength={1000} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField>
                <FormLabel>Category</FormLabel>
                <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className="w-full px-3 py-2 border rounded text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white">
                  <option value="">— Choose —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </FormField>
              <FormField>
                <FormLabel>Date</FormLabel>
                <FormInput type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} />
              </FormField>
            </div>
            <FormField>
              <FormLabel>Receipt / bill no.</FormLabel>
              <FormInput value={form.receiptNo} onChange={(e) => setForm({ ...form, receiptNo: e.target.value })} maxLength={100} />
            </FormField>
            <p className="text-sm text-gray-500">Keep the receipt: your claim is approved by accounts and paid from a till or the bank.</p>
          </div>
          <ModalFooter>
            <button onClick={() => setOpen(false)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">Cancel</button>
            <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Submit claim
            </button>
          </ModalFooter>
        </Modal>
      </div>
    </PermissionGuard>
  )
}
