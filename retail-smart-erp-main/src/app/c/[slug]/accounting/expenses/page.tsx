'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Receipt, Loader2, Tags } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { Pagination } from '@/components/ui'
import { toast } from '@/components/ui/toast'
import { useCurrency, useRealtimeData } from '@/hooks'
import { formatCurrency } from '@/lib/utils/currency'

type Kind = 'expense' | 'reimbursement'
type Status = 'pending' | 'approved' | 'rejected' | 'paid' | 'void'
interface Expense {
  id: string
  expenseNo: string
  kind: Kind
  status: Status
  expenseDate: string
  amount: string
  categoryName: string | null
  paymentMethod: string | null
  paidFrom: string | null
  payee: string | null
  receiptNo: string | null
  description: string | null
  warehouseName: string | null
  createdByName: string | null
  claimantName: string | null
  rejectedReason: string | null
  voidReason: string | null
}
interface Totals { count: number; paid: number; pending: number; approved: number; fromDrawer: number; byCategory: Array<{ categoryId: string | null; name: string; amount: number }> }
interface Category { id: string; name: string; accountId: string | null; isActive: boolean }
interface Account { id: string; name: string; accountNumber: string; rootType: string; isGroup: boolean }
interface Branch { id: string; name: string }

const STATUS_CLS: Record<Status, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  rejected: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  paid: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  void: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}
const PAID_FROM: Record<string, string> = { drawer: 'POS drawer', cash: 'Office cash', bank: 'Bank' }
const METHOD: Record<string, string> = { cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque' }
const SELECT = 'border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
const INPUT = 'w-full px-3 py-2 border rounded text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white'

const monthStart = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('en-CA') }
const todayStr = () => new Date().toLocaleDateString('en-CA')
const emptyCheque = () => ({ chequeNo: '', bankName: '', branchName: '', chequeDate: todayStr() })

function PaymentFields({ form, setForm }: {
  form: { paidFrom: string; paymentMethod: string; cheque: ReturnType<typeof emptyCheque> }
  setForm: (f: { paidFrom: string; paymentMethod: string; cheque: ReturnType<typeof emptyCheque> }) => void
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1 dark:text-gray-300">Paid from</label>
          <select value={form.paidFrom} onChange={(e) => setForm({ ...form, paidFrom: e.target.value, paymentMethod: e.target.value === 'cash' ? 'cash' : 'bank_transfer' })} className={INPUT}>
            <option value="cash">Office cash</option>
            <option value="bank">Bank</option>
          </select>
        </div>
        {form.paidFrom === 'bank' && (
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-gray-300">Method</label>
            <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className={INPUT}>
              <option value="bank_transfer">Bank transfer</option>
              <option value="card">Card</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>
        )}
      </div>
      {form.paidFrom === 'bank' && form.paymentMethod === 'cheque' && (
        <div className="grid grid-cols-2 gap-3 p-3 rounded border border-indigo-200 bg-indigo-50 dark:bg-indigo-900/10 dark:border-indigo-800">
          <input value={form.cheque.chequeNo} onChange={(e) => setForm({ ...form, cheque: { ...form.cheque, chequeNo: e.target.value } })} className={INPUT} placeholder="Cheque no. *" maxLength={50} />
          <input type="date" value={form.cheque.chequeDate} onChange={(e) => setForm({ ...form, cheque: { ...form.cheque, chequeDate: e.target.value } })} className={INPUT} aria-label="Cheque date" />
          <input value={form.cheque.bankName} onChange={(e) => setForm({ ...form, cheque: { ...form.cheque, bankName: e.target.value } })} className={INPUT} placeholder="Our bank *" maxLength={100} />
          <input value={form.cheque.branchName} onChange={(e) => setForm({ ...form, cheque: { ...form.cheque, branchName: e.target.value } })} className={INPUT} placeholder="Branch" maxLength={100} />
        </div>
      )}
    </>
  )
}

function chequePayload(f: { paidFrom: string; paymentMethod: string; cheque: ReturnType<typeof emptyCheque> }) {
  if (f.paidFrom !== 'bank' || f.paymentMethod !== 'cheque') return undefined
  return { chequeNo: f.cheque.chequeNo.trim(), bankName: f.cheque.bankName.trim(), branchName: f.cheque.branchName.trim() || undefined, chequeDate: f.cheque.chequeDate }
}

export default function ExpensesPage() {
  const { currency } = useCurrency()
  const [kind, setKind] = useState<Kind>('expense')
  const [rows, setRows] = useState<Expense[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [branch, setBranch] = useState('')
  const [paidFrom, setPaidFrom] = useState('')
  const [fromDate, setFromDate] = useState(monthStart())
  const [toDate, setToDate] = useState(todayStr())
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [categories, setCategories] = useState<Category[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [saving, setSaving] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showCats, setShowCats] = useState(false)
  const [newCat, setNewCat] = useState({ name: '', accountId: '' })
  const blankForm = () => ({
    kind: 'expense' as Kind, expenseDate: todayStr(), categoryId: '', amount: '', payee: '', receiptNo: '', description: '',
    warehouseId: '', paidFrom: 'cash', paymentMethod: 'cash', cheque: emptyCheque(),
  })
  const [form, setForm] = useState(blankForm)
  const [paying, setPaying] = useState<Expense | null>(null)
  const [payForm, setPayForm] = useState({ paidFrom: 'cash', paymentMethod: 'cash', cheque: emptyCheque() })

  const load = useCallback(async () => {
    const p = new URLSearchParams({ kind, page: String(page), pageSize: String(pageSize) })
    if (search) p.set('search', search)
    if (status) p.set('status', status)
    if (categoryId) p.set('categoryId', categoryId)
    if (branch) p.set('warehouseId', branch)
    if (paidFrom) p.set('paidFrom', paidFrom)
    if (fromDate) p.set('fromDate', fromDate)
    if (toDate) p.set('toDate', toDate)
    try {
      const res = await fetch(`/api/expenses?${p}`)
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to load'); return }
      setRows(data.data || [])
      setTotals(data.totals || null)
      setPagination(data.pagination)
    } finally {
      setLoading(false)
    }
  }, [kind, page, pageSize, search, status, categoryId, branch, paidFrom, fromDate, toDate])

  const loadCategories = useCallback(async () => {
    const res = await fetch('/api/expense-categories')
    if (res.ok) setCategories((await res.json()).data || [])
  }, [])

  useEffect(() => { void load() }, [load])
  useRealtimeData(load, { entityType: 'expense', refreshOnMount: false })
  useEffect(() => {
    void loadCategories()
    fetch('/api/warehouses?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setBranches(Array.isArray(d) ? d : d.data || [])).catch(() => undefined)
    fetch('/api/accounting/accounts?all=true').then((r) => (r.ok ? r.json() : [])).then((d: Account[]) => {
      setAccounts((Array.isArray(d) ? d : []).filter((a) => !a.isGroup && a.rootType === 'expense'))
    }).catch(() => undefined)
  }, [loadCategories])

  const activeCategories = useMemo(() => categories.filter((c) => c.isActive), [categories])
  const reset = (fn: () => void) => { fn(); setPage(1) }

  async function saveNew() {
    const amount = parseFloat(form.amount)
    if (!(amount > 0)) { toast.error('Enter the amount'); return }
    if (!form.categoryId && !form.description.trim()) { toast.error('Choose a category or describe the expense'); return }
    const cheque = chequePayload(form)
    if (cheque && (!cheque.chequeNo || !cheque.bankName)) { toast.error('Enter the cheque number and bank'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: form.kind, expenseDate: form.expenseDate, categoryId: form.categoryId || undefined, amount,
          payee: form.payee.trim() || undefined, receiptNo: form.receiptNo.trim() || undefined, description: form.description.trim() || undefined,
          warehouseId: form.warehouseId || undefined,
          ...(form.kind === 'expense' ? { paidFrom: form.paidFrom, paymentMethod: form.paidFrom === 'cash' ? 'cash' : form.paymentMethod, cheque } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Failed to save'); return }
      toast.success(`${data.expenseNo} saved`)
      setShowNew(false)
      setForm(blankForm())
      void load()
    } finally {
      setSaving(false)
    }
  }

  async function act(e: Expense, action: 'approve' | 'reject' | 'void', extra: Record<string, unknown> = {}) {
    let reason: string | undefined
    if (action !== 'approve') {
      reason = window.prompt(action === 'reject' ? `Reason for rejecting ${e.expenseNo}` : `Reason for voiding ${e.expenseNo}`)?.trim()
      if (!reason) return
    }
    const res = await fetch(`/api/expenses/${e.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason, ...extra }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(data.error || 'Failed'); return }
    toast.success(`${e.expenseNo}: ${data.status}`)
    void load()
  }

  async function pay() {
    if (!paying) return
    const cheque = chequePayload(payForm)
    if (cheque && (!cheque.chequeNo || !cheque.bankName)) { toast.error('Enter the cheque number and bank'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/expenses/${paying.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay', paidFrom: payForm.paidFrom, paymentMethod: payForm.paidFrom === 'cash' ? 'cash' : payForm.paymentMethod, cheque }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Failed to pay'); return }
      toast.success(`${paying.expenseNo} paid`)
      setPaying(null)
      void load()
    } finally {
      setSaving(false)
    }
  }

  async function addCategory() {
    if (!newCat.name.trim()) return
    const res = await fetch('/api/expense-categories', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCat.name.trim(), accountId: newCat.accountId || undefined }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(data.error || 'Failed'); return }
    setNewCat({ name: '', accountId: '' })
    void loadCategories()
  }
  async function updateCategory(c: Category, patch: Partial<Category>) {
    const res = await fetch('/api/expense-categories', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, ...patch }),
    })
    if (!res.ok) { toast.error('Failed to update the category'); return }
    void loadCategories()
  }

  return (
    <PermissionGuard permission="manageAccounting">
      <ListPageLayout
        module="Accounting"
        moduleHref="/accounting"
        title="Expenses & Claims"
        search={search}
        setSearch={(v) => reset(() => setSearch(v))}
        onRefresh={load}
        searchPlaceholder="No., payee, description…"
        actionContent={
          <div className="flex gap-2">
            <button onClick={() => setShowCats(true)} className="flex items-center gap-1.5 px-3 py-1.5 border text-sm rounded hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200">
              <Tags size={16} /> Categories
            </button>
            <button onClick={() => { setForm({ ...blankForm(), kind }); setShowNew(true) }} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700">
              <Plus size={16} /> {kind === 'expense' ? 'New expense' : 'New claim'}
            </button>
          </div>
        }
      >
        <div className="flex gap-1 px-4 pt-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700" role="tablist">
          {(['expense', 'reimbursement'] as Kind[]).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} onClick={() => reset(() => { setKind(k); setStatus('') })}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${kind === k ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-gray-500 dark:text-gray-400'}`}>
              {k === 'expense' ? 'Expenses' : 'Reimbursement claims'}
            </button>
          ))}
        </div>
        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div><p className="text-xs text-gray-500 dark:text-gray-400">Paid</p><p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(totals.paid, currency)}</p></div>
            <div><p className="text-xs text-gray-500 dark:text-gray-400">From POS drawers</p><p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(totals.fromDrawer, currency)}</p></div>
            <div><p className="text-xs text-gray-500 dark:text-gray-400">Awaiting approval</p><p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(totals.pending, currency)}</p></div>
            <div><p className="text-xs text-gray-500 dark:text-gray-400">Approved, unpaid</p><p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(totals.approved, currency)}</p></div>
            {totals.byCategory.length > 0 && (
              <div className="col-span-2 md:col-span-4 flex flex-wrap gap-2 text-xs">
                {totals.byCategory.map((c) => (
                  <span key={c.categoryId || 'none'} className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200">{c.name}: {formatCurrency(c.amount, currency)}</span>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <select value={status} onChange={(e) => reset(() => setStatus(e.target.value))} className={SELECT} aria-label="Status">
            <option value="">All statuses</option>
            {kind === 'reimbursement' && <option value="pending">Awaiting approval</option>}
            {kind === 'reimbursement' && <option value="approved">Approved (to pay)</option>}
            {kind === 'expense' && <option value="approved">Unpaid (bounced cheque)</option>}
            <option value="paid">Paid</option>
            {kind === 'reimbursement' && <option value="rejected">Rejected</option>}
            <option value="void">Void</option>
          </select>
          <select value={categoryId} onChange={(e) => reset(() => setCategoryId(e.target.value))} className={SELECT} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={paidFrom} onChange={(e) => reset(() => setPaidFrom(e.target.value))} className={SELECT} aria-label="Paid from">
            <option value="">Any source</option>
            <option value="drawer">POS drawer</option>
            <option value="cash">Office cash</option>
            <option value="bank">Bank</option>
          </select>
          {branches.length > 1 && (
            <select value={branch} onChange={(e) => reset(() => setBranch(e.target.value))} className={SELECT} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
            <span>From</span>
            <input type="date" value={fromDate} onChange={(e) => reset(() => setFromDate(e.target.value))} className={SELECT} />
            <span>To</span>
            <input type="date" value={toDate} onChange={(e) => reset(() => setToDate(e.target.value))} className={SELECT} />
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">{kind === 'expense' ? 'Expenses' : 'Reimbursement claims'}</caption>
            <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
              <tr className="text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                <th scope="col" className="px-4 py-3">No.</th>
                <th scope="col" className="px-4 py-3">Date</th>
                <th scope="col" className="px-4 py-3">Category</th>
                <th scope="col" className="px-4 py-3">{kind === 'expense' ? 'Paid to' : 'Claimant'}</th>
                <th scope="col" className="px-4 py-3">Paid from</th>
                <th scope="col" className="px-4 py-3 text-right">Amount</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr><td colSpan={8} className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400 mx-auto" /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <Receipt size={32} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />Nothing for this period.
                </td></tr>
              ) : rows.map((e) => (
                <tr key={e.id} className="text-sm">
                  <td className="px-4 py-3 font-mono text-gray-900 dark:text-white">{e.expenseNo}{e.receiptNo ? <div className="text-xs text-gray-500">Rcpt {e.receiptNo}</div> : null}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{e.expenseDate}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-white">{e.categoryName || '—'}{e.description ? <div className="text-xs text-gray-500 truncate max-w-xs">{e.description}</div> : null}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{kind === 'expense' ? (e.payee || '—') : (e.claimantName || '—')}<div className="text-xs text-gray-500">by {e.createdByName || '—'}{e.warehouseName ? ` · ${e.warehouseName}` : ''}</div></td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{e.paidFrom ? `${PAID_FROM[e.paidFrom] || e.paidFrom}${e.paymentMethod && e.paidFrom === 'bank' ? ` · ${METHOD[e.paymentMethod] || e.paymentMethod}` : ''}` : '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(Number(e.amount), currency)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_CLS[e.status]}`}>{e.status}</span>
                    {(e.rejectedReason || e.voidReason) && <div className="text-xs text-gray-500 mt-0.5">{e.rejectedReason || e.voidReason}</div>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                    {e.status === 'pending' && <button onClick={() => act(e, 'approve')} className="text-xs px-2 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-300">Approve</button>}
                    {(e.status === 'pending' || (e.status === 'approved' && e.kind === 'reimbursement')) && <button onClick={() => act(e, 'reject')} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200">Reject</button>}
                    {e.status === 'approved' && e.kind === 'reimbursement' && <button onClick={() => { setPaying(e); setPayForm({ paidFrom: 'cash', paymentMethod: 'cash', cheque: emptyCheque() }) }} className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Pay</button>}
                    {(e.status === 'paid' || (e.status === 'approved' && e.kind === 'expense') || e.status === 'pending') && <button onClick={() => act(e, 'void')} className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300">Void</button>}
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
            onPageSizeChange={(n) => { setPageSize(n); setPage(1) }}
            className="border-t dark:border-gray-700 px-4 pagination-sticky"
          />
        </div>

        <Modal isOpen={showNew} onClose={() => setShowNew(false)} title={form.kind === 'expense' ? 'New expense' : 'New reimbursement claim'} size="lg">
          <div className="space-y-3">
            {form.kind === 'expense' && (
              <p className="text-xs text-gray-500 dark:text-gray-400">Cash paid from a till is recorded by the cashier at the POS (Cash In / Out → Petty expense).</p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Date</label>
                <input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} className={INPUT} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Amount *</label>
                <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={INPUT} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Category</label>
                <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} className={INPUT}>
                  <option value="">— Choose —</option>
                  {activeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-300">Branch</label>
                <select value={form.warehouseId} onChange={(e) => setForm({ ...form, warehouseId: e.target.value })} className={INPUT}>
                  <option value="">— None —</option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <input value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} className={INPUT} placeholder="Paid to (payee)" maxLength={255} />
              <input value={form.receiptNo} onChange={(e) => setForm({ ...form, receiptNo: e.target.value })} className={INPUT} placeholder="Receipt / bill no." maxLength={100} />
            </div>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={INPUT} placeholder="Description" maxLength={1000} />
            {form.kind === 'expense' && <PaymentFields form={form} setForm={(f) => setForm({ ...form, ...f })} />}
          </div>
          <ModalFooter>
            <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200">Cancel</button>
            <button onClick={saveNew} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
            </button>
          </ModalFooter>
        </Modal>

        <Modal isOpen={!!paying} onClose={() => setPaying(null)} title={paying ? `Pay ${paying.expenseNo} — ${formatCurrency(Number(paying.amount), currency)}` : ''}>
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">To {paying?.claimantName || 'the claimant'}{paying?.description ? ` for ${paying.description}` : ''}. A cashier can also pay it from the till (Cash In / Out).</p>
            <PaymentFields form={payForm} setForm={setPayForm} />
          </div>
          <ModalFooter>
            <button onClick={() => setPaying(null)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200">Cancel</button>
            <button onClick={pay} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Pay
            </button>
          </ModalFooter>
        </Modal>

        <Modal isOpen={showCats} onClose={() => setShowCats(false)} title="Expense categories" size="lg">
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Each category can post to its own expense account; without one the default expense account (Accounting → Settings) is used.</p>
            <ul className="divide-y dark:divide-gray-700 max-h-80 overflow-y-auto">
              {categories.map((c) => (
                <li key={c.id} className="py-2 flex items-center gap-2 text-sm">
                  <span className={`flex-1 ${c.isActive ? 'dark:text-gray-200' : 'line-through text-gray-400'}`}>{c.name}</span>
                  <select value={c.accountId || ''} onChange={(e) => updateCategory(c, { accountId: e.target.value || null })} className={SELECT} aria-label={`Account for ${c.name}`}>
                    <option value="">Default expense account</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountNumber} {a.name}</option>)}
                  </select>
                  <button onClick={() => updateCategory(c, { isActive: !c.isActive })} className="text-xs text-gray-500 hover:text-blue-600">{c.isActive ? 'Hide' : 'Show'}</button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} className={INPUT} placeholder="New category" maxLength={100} />
              <select value={newCat.accountId} onChange={(e) => setNewCat({ ...newCat, accountId: e.target.value })} className={INPUT} aria-label="Account">
                <option value="">Default expense account</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountNumber} {a.name}</option>)}
              </select>
              <button onClick={addCategory} className="px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">Add</button>
            </div>
          </div>
        </Modal>
      </ListPageLayout>
    </PermissionGuard>
  )
}
