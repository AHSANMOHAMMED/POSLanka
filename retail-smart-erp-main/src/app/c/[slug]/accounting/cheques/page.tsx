'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, FileText, Loader2, AlertTriangle, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { Pagination } from '@/components/ui'
import { toast } from '@/components/ui/toast'
import { useCurrency, useRealtimeData } from '@/hooks'
import { formatCurrency } from '@/lib/utils/currency'

type Direction = 'received' | 'issued'
type Action = 'deposit' | 'clear' | 'bounce' | 'cancel' | 'return'

interface Cheque {
  id: string
  direction: Direction
  chequeNo: string
  bankName: string
  branchName: string | null
  chequeDate: string
  amount: string
  status: 'pending' | 'deposited' | 'cleared' | 'bounced' | 'cancelled' | 'returned'
  partyDisplay: string | null
  invoiceNo: string | null
  purchaseNo: string | null
  warehouseName: string | null
  bounceReason: string | null
  daysToDue: number | null
  overdue: boolean
  actions: Action[]
}
interface Totals { count: number; amount: number; receivedOpen: number; issuedOpen: number; overdue: number; bounced: number }
interface Account { id: string; name: string; accountNumber: string; accountType: string; isGroup: boolean }
interface Branch { id: string; name: string }

const STATUS_STYLE: Record<Cheque['status'], { label: string; cls: string }> = {
  pending: { label: 'In hand', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  deposited: { label: 'Deposited', cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300' },
  cleared: { label: 'Cleared', cls: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  bounced: { label: 'Bounced', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  returned: { label: 'Returned', cls: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
}
const ACTION_LABEL: Record<Action, string> = { deposit: 'Deposit', clear: 'Cleared', bounce: 'Bounced', cancel: 'Cancel', return: 'Returned to party' }
const SELECT = 'border border-gray-300 dark:border-gray-600 rounded px-2 py-1 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
const INPUT = 'w-full px-3 py-2 border rounded text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white'

function dueBadge(c: Cheque) {
  if (c.daysToDue === null) return null
  if (c.daysToDue < 0) return <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">{-c.daysToDue}d overdue</span>
  if (c.daysToDue === 0) return <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Due today</span>
  if (c.daysToDue <= 3) return <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">in {c.daysToDue}d</span>
  if (c.daysToDue <= 7) return <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-300">in {c.daysToDue}d</span>
  return <span className="text-xs text-gray-500 dark:text-gray-400">PDC · {c.daysToDue}d</span>
}

export default function ChequesPage() {
  const { currency } = useCurrency()
  const [rows, setRows] = useState<Cheque[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState('')
  const [status, setStatus] = useState('open')
  const [due, setDue] = useState('')
  const [branch, setBranch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [branches, setBranches] = useState<Branch[]>([])
  const [banks, setBanks] = useState<Account[]>([])
  const [acting, setActing] = useState<{ cheque: Cheque; action: Action } | null>(null)
  const [actionForm, setActionForm] = useState({ depositAccountId: '', reason: '', date: '' })
  const [saving, setSaving] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ direction: 'received' as Direction, chequeNo: '', bankName: '', branchName: '', chequeDate: '', amount: '', partyName: '', warehouseId: '', notes: '' })

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (search) p.set('search', search)
    if (direction) p.set('direction', direction)
    if (status) p.set('status', status)
    if (due) p.set('dueWithinDays', due)
    if (branch) p.set('warehouseId', branch)
    try {
      const res = await fetch(`/api/cheques?${p}`)
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Failed to load cheques'); return }
      setRows(data.data || [])
      setTotals(data.totals || null)
      setPagination(data.pagination)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, search, direction, status, due, branch])

  useEffect(() => { void load() }, [load])
  useRealtimeData(load, { entityType: 'cheque', refreshOnMount: false })

  useEffect(() => {
    fetch('/api/warehouses?all=true').then((r) => (r.ok ? r.json() : [])).then((d) => setBranches(Array.isArray(d) ? d : d.data || [])).catch(() => undefined)
    fetch('/api/accounting/accounts?all=true').then((r) => (r.ok ? r.json() : [])).then((d: Account[]) => {
      setBanks((Array.isArray(d) ? d : []).filter((a) => !a.isGroup && (a.accountType === 'bank' || a.accountType === 'cash')))
    }).catch(() => undefined)
  }, [])

  function openAction(cheque: Cheque, action: Action) {
    setActing({ cheque, action })
    setActionForm({ depositAccountId: '', reason: '', date: '' })
  }

  async function submitAction() {
    if (!acting) return
    const { cheque, action } = acting
    if ((action === 'bounce' || action === 'cancel') && !actionForm.reason.trim()) {
      toast.error('Enter a reason')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/cheques/${cheque.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          depositAccountId: actionForm.depositAccountId || undefined,
          reason: actionForm.reason.trim() || undefined,
          date: actionForm.date || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Failed to update the cheque'); return }
      const reopened = data.reopened?.saleId ? ' The invoice is open again.' : data.reopened?.purchaseId ? ' The purchase is unpaid again.' : data.reopened?.expenseId ? ' The expense is unpaid again.' : ''
      toast.success(`Cheque ${cheque.chequeNo}: ${STATUS_STYLE[data.status as Cheque['status']]?.label || data.status}.${reopened}`)
      setActing(null)
      void load()
    } finally {
      setSaving(false)
    }
  }

  async function submitNew() {
    const amount = parseFloat(newForm.amount)
    if (!newForm.chequeNo.trim() || !newForm.bankName.trim() || !newForm.chequeDate || !(amount > 0) || !newForm.partyName.trim()) {
      toast.error('Cheque no., bank, date, amount and party are required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/cheques', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: newForm.direction, chequeNo: newForm.chequeNo.trim(), bankName: newForm.bankName.trim(),
          branchName: newForm.branchName.trim() || undefined, chequeDate: newForm.chequeDate, amount,
          partyName: newForm.partyName.trim(), warehouseId: newForm.warehouseId || undefined, notes: newForm.notes.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Failed to record the cheque'); return }
      toast.success(`Cheque ${data.chequeNo} recorded`)
      setShowNew(false)
      setNewForm({ direction: 'received', chequeNo: '', bankName: '', branchName: '', chequeDate: '', amount: '', partyName: '', warehouseId: '', notes: '' })
      void load()
    } finally {
      setSaving(false)
    }
  }

  const reset = (fn: () => void) => { fn(); setPage(1) }

  return (
    <PermissionGuard permission="viewAccounting">
      <ListPageLayout
        module="Accounting"
        moduleHref="/accounting"
        title="Cheques"
        search={search}
        setSearch={(v) => reset(() => setSearch(v))}
        onRefresh={load}
        searchPlaceholder="Cheque no., bank, party…"
        actionContent={
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700">
            <Plus size={16} /> Record cheque
          </button>
        }
      >
        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div><p className="text-xs text-gray-500 dark:text-gray-400">Received, not yet cleared</p><p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(totals.receivedOpen, currency)}</p></div>
            <div><p className="text-xs text-gray-500 dark:text-gray-400">Issued, not yet presented</p><p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(totals.issuedOpen, currency)}</p></div>
            <div><p className="text-xs text-gray-500 dark:text-gray-400">Overdue (not banked)</p><p className={`text-lg font-semibold ${totals.overdue ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{totals.overdue}</p></div>
            <div><p className="text-xs text-gray-500 dark:text-gray-400">Bounced</p><p className={`text-lg font-semibold ${totals.bounced ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{totals.bounced}</p></div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <select value={direction} onChange={(e) => reset(() => setDirection(e.target.value))} className={SELECT} aria-label="Direction">
            <option value="">Received & issued</option>
            <option value="received">Received</option>
            <option value="issued">Issued</option>
          </select>
          <select value={status} onChange={(e) => reset(() => setStatus(e.target.value))} className={SELECT} aria-label="Status">
            <option value="open">Open (in hand / deposited)</option>
            <option value="">All statuses</option>
            <option value="pending">In hand</option>
            <option value="deposited">Deposited</option>
            <option value="cleared">Cleared</option>
            <option value="bounced">Bounced</option>
            <option value="cancelled,returned">Cancelled / returned</option>
          </select>
          <select value={due} onChange={(e) => reset(() => setDue(e.target.value))} className={SELECT} aria-label="Due">
            <option value="">Any date</option>
            <option value="0">Due today & overdue</option>
            <option value="7">Due within 7 days</option>
            <option value="30">Due within 30 days</option>
          </select>
          {branches.length > 1 && (
            <select value={branch} onChange={(e) => reset(() => setBranch(e.target.value))} className={SELECT} aria-label="Branch">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl overflow-x-auto">
          <table className="w-full">
            <caption className="sr-only">Cheques</caption>
            <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
              <tr className="text-left text-sm font-medium text-gray-600 dark:text-gray-400">
                <th scope="col" className="px-4 py-3">Cheque date</th>
                <th scope="col" className="px-4 py-3">Cheque no.</th>
                <th scope="col" className="px-4 py-3">Bank</th>
                <th scope="col" className="px-4 py-3">From / to</th>
                <th scope="col" className="px-4 py-3">For</th>
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
                  <FileText size={32} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />No cheques found.
                </td></tr>
              ) : rows.map((c) => (
                <tr key={c.id} className={`text-sm ${c.overdue ? 'bg-red-50/60 dark:bg-red-900/10' : c.daysToDue !== null && c.daysToDue <= 3 ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}`}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-gray-900 dark:text-white">{c.chequeDate}</div>
                    {dueBadge(c)}
                  </td>
                  <td className="px-4 py-3 font-mono text-gray-900 dark:text-white">
                    <span className="inline-flex items-center gap-1">
                      {c.direction === 'received'
                        ? <ArrowDownLeft size={14} className="text-green-600" aria-label="Received" />
                        : <ArrowUpRight size={14} className="text-red-600" aria-label="Issued" />}
                      {c.chequeNo}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{c.bankName}{c.branchName ? <span className="text-gray-500"> · {c.branchName}</span> : null}</td>
                  <td className="px-4 py-3 text-gray-900 dark:text-white">{c.partyDisplay || '—'}{c.warehouseName ? <div className="text-xs text-gray-500">{c.warehouseName}</div> : null}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.invoiceNo || c.purchaseNo || '—'}</td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(Number(c.amount), currency)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_STYLE[c.status].cls}`}>{STATUS_STYLE[c.status].label}</span>
                    {c.status === 'bounced' && c.bounceReason ? <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">{c.bounceReason}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                    {c.actions.map((a) => (
                      <button
                        key={a}
                        onClick={() => openAction(c, a)}
                        className={`text-xs px-2 py-1 rounded border ${a === 'bounce' || a === 'cancel'
                          ? 'border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300'
                          : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200'}`}
                      >
                        {ACTION_LABEL[a]}
                      </button>
                    ))}
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

        <Modal isOpen={!!acting} onClose={() => setActing(null)} title={acting ? `${ACTION_LABEL[acting.action]} — cheque ${acting.cheque.chequeNo}` : ''}>
          {acting && (
            <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {acting.cheque.bankName} · {acting.cheque.partyDisplay || '—'} · <strong>{formatCurrency(Number(acting.cheque.amount), currency)}</strong> · dated {acting.cheque.chequeDate}
              </p>
              {(acting.action === 'deposit' || acting.action === 'clear') && acting.cheque.direction === 'received' && (
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Bank account</label>
                  <select value={actionForm.depositAccountId} onChange={(e) => setActionForm({ ...actionForm, depositAccountId: e.target.value })} className={INPUT}>
                    <option value="">— Same as the cheque account —</option>
                    {banks.map((b) => <option key={b.id} value={b.id}>{b.accountNumber} {b.name}</option>)}
                  </select>
                </div>
              )}
              {(acting.action === 'bounce' || acting.action === 'cancel') && (
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Reason *</label>
                  <input value={actionForm.reason} onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })} className={INPUT} maxLength={1000}
                    placeholder={acting.action === 'bounce' ? 'e.g. Insufficient funds / Refer to drawer' : 'e.g. Replaced by cash'} />
                  {(acting.cheque.invoiceNo || acting.cheque.purchaseNo) && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                      <AlertTriangle size={12} /> {acting.cheque.invoiceNo ? `Invoice ${acting.cheque.invoiceNo}` : `Purchase ${acting.cheque.purchaseNo}`} will be unpaid again by this amount.
                    </p>
                  )}
                </div>
              )}
              {acting.action !== 'return' && (
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-300">Date</label>
                  <input type="date" value={actionForm.date} onChange={(e) => setActionForm({ ...actionForm, date: e.target.value })} className={INPUT} />
                  <p className="text-xs text-gray-500 mt-1">Empty = today. A post-dated cheque cannot be banked before its date.</p>
                </div>
              )}
            </div>
          )}
          <ModalFooter>
            <button onClick={() => setActing(null)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200">Close</button>
            <button onClick={submitAction} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Confirm
            </button>
          </ModalFooter>
        </Modal>

        <Modal isOpen={showNew} onClose={() => setShowNew(false)} title="Record a cheque">
          <div className="space-y-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              For the register only. A cheque that pays an invoice is taken at the POS, on the invoice (Receive payment) or on the purchase (Pay), so the invoice is settled and re-opened if it bounces.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <select value={newForm.direction} onChange={(e) => setNewForm({ ...newForm, direction: e.target.value as Direction })} className={INPUT} aria-label="Direction">
                <option value="received">Received (from customer)</option>
                <option value="issued">Issued (to supplier / payee)</option>
              </select>
              <input value={newForm.partyName} onChange={(e) => setNewForm({ ...newForm, partyName: e.target.value })} className={INPUT} placeholder={newForm.direction === 'received' ? 'Drawer (from) *' : 'Payee (to) *'} maxLength={255} />
              <input value={newForm.chequeNo} onChange={(e) => setNewForm({ ...newForm, chequeNo: e.target.value })} className={INPUT} placeholder="Cheque no. *" maxLength={50} />
              <input type="date" value={newForm.chequeDate} onChange={(e) => setNewForm({ ...newForm, chequeDate: e.target.value })} className={INPUT} aria-label="Cheque date" />
              <input value={newForm.bankName} onChange={(e) => setNewForm({ ...newForm, bankName: e.target.value })} className={INPUT} placeholder="Bank *" maxLength={100} />
              <input value={newForm.branchName} onChange={(e) => setNewForm({ ...newForm, branchName: e.target.value })} className={INPUT} placeholder="Branch" maxLength={100} />
              <input type="number" min="0" step="0.01" value={newForm.amount} onChange={(e) => setNewForm({ ...newForm, amount: e.target.value })} className={INPUT} placeholder="Amount *" />
              <select value={newForm.warehouseId} onChange={(e) => setNewForm({ ...newForm, warehouseId: e.target.value })} className={INPUT} aria-label="Branch">
                <option value="">— Branch —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <input value={newForm.notes} onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })} className={INPUT} placeholder="Notes" maxLength={1000} />
          </div>
          <ModalFooter>
            <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm border rounded hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200">Cancel</button>
            <button onClick={submitNew} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
            </button>
          </ModalFooter>
        </Modal>
      </ListPageLayout>
    </PermissionGuard>
  )
}
