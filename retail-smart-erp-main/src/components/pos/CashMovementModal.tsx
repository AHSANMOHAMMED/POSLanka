'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { formatCurrency } from '@/lib/utils/currency'
import { SupervisorAuthModal } from './SupervisorAuthModal'

/** H1: paid-in / paid-out categories (mirror of CASH_MOVEMENT_CATEGORIES in validation/schemas/pos) */
const CATEGORIES = {
  paid_out: [
    { value: 'petty_expense', label: 'Petty expense' },
    { value: 'supplier_payment', label: 'Supplier payment' },
    { value: 'bank_drop', label: 'Bank drop / safe drop' },
    { value: 'other', label: 'Other' },
  ],
  paid_in: [
    { value: 'float_top_up', label: 'Float top-up' },
    { value: 'other', label: 'Other' },
  ],
} as const

type MovementType = keyof typeof CATEGORIES

interface CashMovement {
  id: string
  movementNo: string
  type: MovementType
  category: string
  amount: string
  note: string | null
  status: 'posted' | 'voided'
  createdByName?: string | null
  approvedBy?: string | null
  voidReason?: string | null
  createdAt: string
}

interface ExpenseCategory { id: string; name: string; isActive: boolean }
interface ApprovedClaim { id: string; expenseNo: string; amount: string; description: string | null; claimantName: string | null }

interface PendingApproval {
  scopes: string[]
  message: string
  amount?: number
  retry: (token: string) => Promise<void>
}

interface CashMovementModalProps {
  isOpen: boolean
  onClose: () => void
  shift: { id: string; entryNumber: string } | null
  cashierName?: string
  onChanged?: () => void
}

export function CashMovementModal({ isOpen, onClose, shift, cashierName, onChanged }: CashMovementModalProps) {
  const [type, setType] = useState<MovementType>('paid_out')
  const [category, setCategory] = useState<string>('petty_expense')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [movements, setMovements] = useState<CashMovement[]>([])
  const [totals, setTotals] = useState<{ paidIn: number; paidOut: number; net: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<PendingApproval | null>(null)
  // K1: a petty expense is recorded as an expense (category, payee, receipt) paid from the drawer
  const [expenseCategories, setExpenseCategories] = useState<ExpenseCategory[]>([])
  const [expenseCategoryId, setExpenseCategoryId] = useState('')
  const [payee, setPayee] = useState('')
  const [receiptNo, setReceiptNo] = useState('')
  const [claims, setClaims] = useState<ApprovedClaim[]>([])
  const isExpense = type === 'paid_out' && category === 'petty_expense'

  const load = useCallback(async () => {
    if (!shift?.id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/pos-cash-movements?openingEntryId=${shift.id}`)
      if (res.ok) {
        const data = await res.json()
        setMovements(data.data || [])
        setTotals(data.totals || null)
      }
    } finally {
      setLoading(false)
    }
  }, [shift?.id])

  const loadExpenseData = useCallback(async () => {
    try {
      const [cats, approved] = await Promise.all([
        fetch('/api/expense-categories').then((r) => (r.ok ? r.json() : { data: [] })),
        fetch('/api/expenses?kind=reimbursement&status=approved&pageSize=20').then((r) => (r.ok ? r.json() : { data: [] })),
      ])
      setExpenseCategories((cats.data || []).filter((c: ExpenseCategory) => c.isActive))
      setClaims(approved.data || [])
    } catch {
      // expenses are optional here: the plain paid-out still works
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      load()
      loadExpenseData()
    }
  }, [isOpen, load, loadExpenseData])

  function reset() {
    setAmount('')
    setNote('')
    setPayee('')
    setReceiptNo('')
  }

  async function submitExpense(approvalToken?: string) {
    if (!shift) return
    const value = parseFloat(amount)
    if (!(value > 0)) {
      toast.error('Enter an amount greater than zero')
      return
    }
    if (!expenseCategoryId && !note.trim()) {
      toast.error('Choose a category or describe the expense')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'expense', paidFrom: 'drawer', openingEntryId: shift.id, amount: value,
          categoryId: expenseCategoryId || undefined, payee: payee.trim() || undefined, receiptNo: receiptNo.trim() || undefined,
          description: note.trim() || undefined, approvalToken,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 403 && data.code === 'APPROVAL_REQUIRED') {
        setPending({ scopes: data.scopes || ['cash_paid_out'], message: data.error, amount: value, retry: (token) => submitExpense(token) })
        return
      }
      if (!res.ok) {
        toast.error(data.error || 'Failed to record the expense')
        return
      }
      toast.success(`Expense ${data.expenseNo} paid from the drawer: ${formatCurrency(value)}`)
      reset()
      await load()
      onChanged?.()
    } finally {
      setSaving(false)
    }
  }

  async function payClaim(c: ApprovedClaim) {
    if (!shift) return
    if (!window.confirm(`Pay ${c.expenseNo} (${formatCurrency(parseFloat(c.amount))}) to ${c.claimantName || 'the claimant'} from the drawer?`)) return
    const res = await fetch(`/api/expenses/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pay', paidFrom: 'drawer', openingEntryId: shift.id }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast.error(data.error || 'Failed to pay the claim')
      return
    }
    toast.success(`${c.expenseNo} paid`)
    await Promise.all([load(), loadExpenseData()])
    onChanged?.()
  }

  async function submit(approvalToken?: string) {
    if (!shift) return
    const value = parseFloat(amount)
    if (!(value > 0)) {
      toast.error('Enter an amount greater than zero')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/pos-cash-movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openingEntryId: shift.id, type, category, amount: value, note: note.trim() || undefined, approvalToken }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 403 && data.code === 'APPROVAL_REQUIRED') {
        setPending({ scopes: data.scopes || [], message: data.error, amount: value, retry: (token) => submit(token) })
        return
      }
      if (!res.ok) {
        toast.error(data.error || 'Failed to record cash movement')
        return
      }
      toast.success(`${type === 'paid_out' ? 'Paid out' : 'Paid in'} ${formatCurrency(value)} (${data.movementNo})`)
      reset()
      await load()
      onChanged?.()
    } finally {
      setSaving(false)
    }
  }

  async function voidMovement(m: CashMovement, approvalToken?: string, reasonIn?: string) {
    const reason = reasonIn ?? window.prompt(`Reason for voiding ${m.movementNo}`)?.trim()
    if (!reason) return
    const res = await fetch(`/api/pos-cash-movements/${m.id}/void`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, approvalToken }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 403 && data.code === 'APPROVAL_REQUIRED') {
      setPending({ scopes: data.scopes || ['cash_movement_void'], message: data.error, amount: parseFloat(m.amount), retry: (token) => voidMovement(m, token, reason) })
      return
    }
    if (!res.ok) {
      toast.error(data.error || 'Failed to void cash movement')
      return
    }
    toast.success(`${m.movementNo} voided`)
    await load()
    onChanged?.()
  }

  async function authorize(pin: string, reason: string): Promise<boolean> {
    if (!pending) return false
    const res = await fetch('/api/auth/verify-pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin, scope: 'supervisor', permission: 'manageSales', reason,
        approvalScopes: pending.scopes, context: { posOpeningEntryId: shift?.id, amount: pending.amount, detail: pending.message },
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 429) throw new Error(data.error || 'Too many attempts')
    if (!res.ok || !data.ok || !data.approvalToken) return false
    const retry = pending.retry
    setPending(null)
    await retry(data.approvalToken)
    return true
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={`Cash In / Out${shift ? ` — ${shift.entryNumber}` : ''}`} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {(['paid_out', 'paid_in'] as MovementType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setType(t); setCategory(CATEGORIES[t][0].value) }}
                className={`py-2 rounded border text-sm font-medium ${type === t
                  ? (t === 'paid_out' ? 'bg-red-600 border-red-600 text-white' : 'bg-green-600 border-green-600 text-white')
                  : 'dark:border-gray-700 dark:text-gray-300'}`}
              >
                {t === 'paid_out' ? 'Paid Out' : 'Paid In'}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">Reason</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              >
                {CATEGORIES[type].map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-gray-300">Amount</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                placeholder="0.00"
              />
            </div>
          </div>
          {isExpense && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Expense type</label>
                <select
                  value={expenseCategoryId}
                  onChange={(e) => setExpenseCategoryId(e.target.value)}
                  className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                >
                  <option value="">— Choose —</option>
                  {expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Paid to</label>
                <input
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  maxLength={255}
                  className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  placeholder="Shop / person"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Receipt no.</label>
                <input
                  value={receiptNo}
                  onChange={(e) => setReceiptNo(e.target.value)}
                  maxLength={100}
                  className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 dark:text-white"
                  placeholder="Optional"
                />
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Note{category === 'other' ? ' (required)' : ''}</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              className="w-full px-3 py-2 border rounded dark:bg-gray-800 dark:border-gray-700 dark:text-white"
              placeholder={type === 'paid_out' ? 'e.g. Tea and sugar for staff' : 'e.g. Change from the safe'}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {isExpense
              ? 'Expenses up to this counter\'s limit are recorded without a supervisor; above it a supervisor PIN is needed. The amount is taken into account in the expected drawer cash at shift close.'
              : 'Paid-outs need a supervisor PIN. The amount is taken into account in the expected drawer cash at shift close.'}
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={saving || !shift}
              onClick={() => (isExpense ? submitExpense() : submit())}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 size={16} className="animate-spin" />}
              {isExpense ? 'Record Expense' : `Record ${type === 'paid_out' ? 'Paid Out' : 'Paid In'}`}
            </button>
          </div>

          {claims.length > 0 && (
            <div className="border-t pt-3 dark:border-gray-700">
              <p className="text-sm font-medium mb-2 dark:text-gray-300">Approved expense claims to pay</p>
              <ul className="divide-y dark:divide-gray-700 max-h-40 overflow-y-auto">
                {claims.map((c) => (
                  <li key={c.id} className="py-2 flex items-center gap-3 text-sm">
                    <span className="font-mono dark:text-gray-200">{c.expenseNo}</span>
                    <span className="flex-1 truncate text-gray-600 dark:text-gray-400">{c.claimantName || '—'}{c.description ? ` — ${c.description}` : ''}</span>
                    <span className="dark:text-gray-200">{formatCurrency(parseFloat(c.amount))}</span>
                    <button type="button" onClick={() => payClaim(c)} className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">
                      Pay from drawer
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t pt-3 dark:border-gray-700">
            <div className="flex justify-between text-sm mb-2 dark:text-gray-300">
              <span className="font-medium">This shift</span>
              {totals && (
                <span>
                  In {formatCurrency(totals.paidIn)} · Out {formatCurrency(totals.paidOut)}
                </span>
              )}
            </div>
            {loading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            ) : movements.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No cash movements yet.</p>
            ) : (
              <ul className="divide-y dark:divide-gray-700 max-h-60 overflow-y-auto">
                {movements.map((m) => (
                  <li key={m.id} className="py-2 flex items-center gap-3 text-sm">
                    <span className={`font-mono ${m.status === 'voided' ? 'line-through text-gray-400' : 'dark:text-gray-200'}`}>{m.movementNo}</span>
                    <span className="flex-1 truncate text-gray-600 dark:text-gray-400">
                      {m.category === 'void_refund' ? 'Refund of voided sale' : CATEGORIES[m.type]?.find((c) => c.value === m.category)?.label || m.category}
                      {m.note ? ` — ${m.note}` : ''}
                      {m.status === 'voided' && m.voidReason ? ` (voided: ${m.voidReason})` : ''}
                    </span>
                    <span className={m.type === 'paid_out' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}>
                      {m.type === 'paid_out' ? '−' : '+'}{formatCurrency(parseFloat(m.amount))}
                    </span>
                    {m.status === 'posted' && m.category !== 'void_refund' && (
                      <button type="button" onClick={() => voidMovement(m)} className="text-xs text-gray-500 hover:text-red-600">
                        Void
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
      <SupervisorAuthModal
        isOpen={!!pending}
        onClose={() => setPending(null)}
        onAuthorize={authorize}
        actionType={pending?.scopes.includes('cash_movement_void') ? 'cash_movement_void' : 'cash_movement'}
        title="Supervisor Approval Required"
        contextDetails={{ cashierName, ticketNumber: shift?.entryNumber, message: pending?.message, amount: pending?.amount }}
      />
    </>
  )
}
