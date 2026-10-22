'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, CreditCard, ExternalLink, Landmark, RefreshCw, X } from 'lucide-react'
import {
  AdminCard,
  AdminModal,
  AdminPage,
  AdminTable,
  AdminToolbar,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  KeyValueList,
  SearchInput,
  SegmentedControl,
  StatCard,
  StatGrid,
  Textarea,
  fmtDateTime,
  fmtLKR,
  fmtNumber,
  statusTone,
  type AdminColumn,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { Pager, adminFetch, fmtDate } from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'

interface Deposit {
  id: string
  amount: string
  currency: string
  bankReference: string | null
  depositDate: string
  receiptUrl: string | null
  notes: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewedAt: string | null
  reviewNotes: string | null
  periodMonths: number
  isWalletDeposit: boolean
  couponCode: string | null
  listAmount: string | null
  discountAmount: string
  pendingCompanyId: string | null
  createdAt: string
  account: { id: string; email: string; fullName: string; phone: string }
  tenant: { id: string; name: string; slug: string; businessId: string } | null
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
  pendingCompany: { name: string; status: string; tierName: string | null } | null
}

interface DepositList {
  payments: Deposit[]
  pagination: { page: number; pageSize: number; total: number }
  statusCounts: Record<string, number>
}

interface PayhereTx {
  id: string
  orderId: string
  payherePaymentId: string | null
  amount: string
  currency: string
  status: string
  paymentMethod: string | null
  description: string | null
  periodMonths: number
  billingCycle: string | null
  statusMessage: string | null
  cardNo: string | null
  paidAt: string | null
  createdAt: string
  account: { email: string; fullName: string }
  tenant: { id: string; name: string; businessId: string } | null
  newTierName: string | null
  walletCreditApplied: string | null
  subscriptionId: string | null
  couponCode: string | null
  listAmount: string | null
  discountAmount: string
  refundStatus: 'processing' | 'refunded' | 'failed' | null
  refundedAmount: string | null
  refundReference: string | null
  refundReason: string | null
  refundError: string | null
  refundedAt: string | null
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
}

interface PayhereList {
  transactions: PayhereTx[]
  pagination: { page: number; pageSize: number; total: number }
  statusTotals: Record<string, { count: number; amount: number }>
  refundsConfigured: boolean
}

interface RefundOutcome {
  amount: number
  reference: string | null
  message: string
  subscription: { id: string; tenantName: string | null; status: string; currentPeriodEnd: string | null; periodMonths: number; wasUpgrade: boolean } | null
}

type Source = 'bank' | 'payhere'
const PAGE_SIZE = 25

function purpose(d: Deposit): { title: string; detail: string } {
  if (d.isWalletDeposit) return { title: 'Wallet top-up', detail: d.account.email }
  if (d.pendingCompany) return { title: `New business: ${d.pendingCompany.name}`, detail: d.pendingCompany.tierName ? `${d.pendingCompany.tierName} plan` : 'Awaiting activation' }
  if (d.tenant) return { title: d.tenant.name, detail: `${formatBusinessId(d.tenant.businessId)} · ${d.periodMonths} month${d.periodMonths === 1 ? '' : 's'}` }
  return { title: 'Subscription payment', detail: d.account.email }
}

export default function PaymentsPage() {
  const [source, setSource] = useState<Source>('bank')
  return (
    <AdminPage
      title="Payments"
      description="Review bank-transfer slips and see card payments received through PayHere."
    >
      <SegmentedControl
        ariaLabel="Payment source"
        value={source}
        onChange={setSource}
        options={[
          { value: 'bank', label: <span className="inline-flex items-center gap-1.5"><Landmark size={14} aria-hidden /> Bank transfers</span> },
          { value: 'payhere', label: <span className="inline-flex items-center gap-1.5"><CreditCard size={14} aria-hidden /> Card payments</span> },
        ]}
      />
      {source === 'bank' ? <BankTransfers /> : <CardPayments />}
    </AdminPage>
  )
}

/* ------------------------------------------------------------------ bank transfers */

function BankTransfers() {
  const [status, setStatus] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<DepositList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState<Deposit | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])
  useEffect(() => { setPage(1) }, [status, debouncedQ])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) })
      if (debouncedQ) p.set('q', debouncedQ)
      setData(await adminFetch<DepositList>(`/api/sys-control/payments?${p.toString()}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payments')
    } finally {
      setLoading(false)
    }
  }, [status, page, debouncedQ])

  useEffect(() => { load() }, [load])

  const c = data?.statusCounts ?? {}
  const columns: AdminColumn<Deposit>[] = [
    {
      key: 'for',
      header: 'Paid for',
      primary: true,
      cell: (d) => {
        const p = purpose(d)
        return (
          <div className="min-w-0">
            <p className="font-medium text-adm-fg">{p.title}</p>
            <p className="truncate text-[12.5px] text-adm-subtle">{p.detail}</p>
          </div>
        )
      },
    },
    {
      key: 'payer',
      header: 'Payer',
      hideBelow: 'lg',
      cell: (d) => (
        <div className="min-w-0">
          <p className="truncate text-adm-fg">{d.account.fullName}</p>
          <p className="truncate text-[12.5px] text-adm-subtle">{d.account.email}</p>
        </div>
      ),
    },
    { key: 'ref', header: 'Bank reference', hideBelow: 'md', cell: (d) => <span className="adm-num text-adm-muted">{d.bankReference || '—'}</span> },
    { key: 'date', header: 'Deposited', cell: (d) => fmtDate(d.depositDate) },
    { key: 'amount', header: 'Amount', align: 'right', cell: (d) => <span className="adm-num font-medium">{fmtLKR(Number(d.amount), 2)}</span> },
    { key: 'status', header: 'Status', cell: (d) => <Badge tone={statusTone(d.status)}>{d.status}</Badge> },
  ]

  return (
    <>
      {flash && <Alert tone="success" action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash}</Alert>}
      <AdminCard flush>
        <div className="space-y-3 border-b border-adm-border p-4 sm:p-5">
          <AdminToolbar end={<Button variant="ghost" size="sm" icon={RefreshCw} onClick={load} loading={loading && !!data}>Refresh</Button>}>
            <SegmentedControl
              ariaLabel="Slip status"
              size="sm"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'pending', label: `To review ${c.pending ?? 0}` },
                { value: 'approved', label: `Approved ${c.approved ?? 0}` },
                { value: 'rejected', label: `Rejected ${c.rejected ?? 0}` },
                { value: 'all', label: 'All' },
              ]}
            />
            <SearchInput size="sm" wrapperClassName="w-full sm:w-72" placeholder="Vendor, PL-123456, payer or reference" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search slips" />
          </AdminToolbar>
        </div>
        {error ? (
          <div className="p-4 sm:p-5"><Alert tone="danger" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert></div>
        ) : (
          <AdminTable
            columns={columns}
            rows={data?.payments ?? []}
            rowKey={(d) => d.id}
            onRowClick={setReviewing}
            loading={loading}
            minWidth={720}
            empty={<EmptyState icon={Landmark} title={status === 'pending' ? 'No slips waiting for review' : 'No bank transfers here'} description={status === 'pending' ? 'New bank-transfer slips appear here when vendors upload them.' : undefined} />}
          />
        )}
        {data && data.pagination.total > 0 && (
          <div className="border-t border-adm-border px-4 py-3 sm:px-5">
            <Pager page={page} pageSize={PAGE_SIZE} total={data.pagination.total} onPage={setPage} />
          </div>
        )}
      </AdminCard>
      {reviewing && (
        <ReviewDialog
          deposit={reviewing}
          onClose={() => setReviewing(null)}
          onDone={(msg) => { setReviewing(null); setFlash(msg); load() }}
        />
      )}
    </>
  )
}

function ReviewDialog({ deposit: d, onClose, onDone }: { deposit: Deposit; onClose: () => void; onDone: (msg: string) => void }) {
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canBill = useAdminCan('billing')
  const pending = d.status === 'pending' && canBill
  const p = purpose(d)

  const effect = d.isWalletDeposit
    ? `Adds ${fmtLKR(Number(d.amount), 2)} to the payer’s wallet.`
    : d.pendingCompany
      ? `Creates the business “${d.pendingCompany.name}” and its owner, and starts its plan.`
      : d.tenant
        ? (() => {
            const now = new Date()
            const end = d.currentPeriodEnd ? new Date(d.currentPeriodEnd) : null
            const base = d.subscriptionStatus !== 'trial' && end && end > now ? end : now
            const next = new Date(base)
            next.setMonth(next.getMonth() + d.periodMonths)
            return `Extends ${d.tenant.name}’s subscription by ${d.periodMonths} month${d.periodMonths === 1 ? '' : 's'}, to ${fmtDate(next)}. If the vendor was locked for non-payment it is unlocked.`
          })()
        : 'Marks the slip as approved.'

  async function decide(status: 'approved' | 'rejected') {
    setBusy(status)
    setError(null)
    try {
      await adminFetch(`/api/sys-control/payments/${d.id}`, { method: 'PUT', json: { status, reviewNotes: notes.trim() || undefined } })
      onDone(status === 'approved' ? `Approved ${fmtLKR(Number(d.amount), 2)} — ${p.title}.` : `Rejected the slip from ${d.account.fullName}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update the slip')
    } finally {
      setBusy(null)
    }
  }

  // Only http(s) or same-origin links are rendered (never javascript:/data: URLs)
  const receiptUrl = d.receiptUrl && /^(https?:\/\/|\/(?!\/))/i.test(d.receiptUrl) ? d.receiptUrl : null
  const isImage = !!receiptUrl && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(receiptUrl)

  return (
    <AdminModal
      open
      onClose={onClose}
      size="lg"
      title={`${fmtLKR(Number(d.amount), 2)} bank transfer`}
      description={p.title}
      footer={
        pending ? (
          <>
            <Button onClick={onClose} disabled={!!busy}>Close</Button>
            <Button variant="danger-soft" icon={X} loading={busy === 'rejected'} disabled={!!busy || notes.trim().length < 3} onClick={() => decide('rejected')}>Reject</Button>
            <Button variant="primary" icon={Check} loading={busy === 'approved'} disabled={!!busy} onClick={() => decide('approved')}>Approve</Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          <KeyValueList
            items={[
              { label: 'Payer', value: d.account.fullName },
              { label: 'Email', value: <span className="break-all">{d.account.email}</span> },
              { label: 'Phone', value: d.account.phone?.startsWith('unset-') ? '—' : d.account.phone },
              { label: 'Business', value: d.tenant ? <Link className="text-adm-primary hover:underline" href={`/sys-control/vendors/${d.tenant.id}`}>{d.tenant.name}</Link> : d.pendingCompany?.name ?? '—' },
            ]}
          />
          <KeyValueList
            items={[
              { label: 'Deposit date', value: fmtDate(d.depositDate) },
              { label: 'Bank reference', value: d.bankReference || '—' },
              { label: 'Covers', value: d.isWalletDeposit ? 'Wallet credit' : `${d.periodMonths} month${d.periodMonths === 1 ? '' : 's'}` },
              ...(d.couponCode ? [{
                label: 'Promo code',
                value: `${d.couponCode} · −${fmtLKR(Number(d.discountAmount), 2)}${d.listAmount ? ` (expected ${fmtLKR(Number(d.listAmount) - Number(d.discountAmount), 2)} of ${fmtLKR(Number(d.listAmount), 2)})` : ''}`,
              }] : []),
              { label: 'Submitted', value: fmtDateTime(d.createdAt) },
            ]}
          />
        </div>
        {d.notes && <Alert tone="neutral" title="Note from the payer">{d.notes}</Alert>}
        {receiptUrl ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-adm-fg">Slip</p>
              <a href={receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-adm-primary hover:underline">
                Open <ExternalLink size={13} aria-hidden />
              </a>
            </div>
            {isImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={receiptUrl} alt="Bank slip" className="max-h-[420px] w-full rounded-lg border border-adm-border object-contain" />
            )}
          </div>
        ) : (
          <Alert tone="warning">No slip image was uploaded. Check the reference against the bank statement.</Alert>
        )}
        {pending ? (
          <>
            <Alert tone="info" title="On approval">{effect}</Alert>
            <Field label="Review note" htmlFor="rv-notes" hint="Required to reject — the payer sees it. Optional when approving.">
              <Textarea id="rv-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </>
        ) : (
          <Alert tone={d.status === 'approved' ? 'success' : 'danger'} title={`${d.status === 'approved' ? 'Approved' : 'Rejected'} ${d.reviewedAt ? fmtDateTime(d.reviewedAt) : ''}`}>
            {d.reviewNotes || 'No note.'}
          </Alert>
        )}
      </div>
    </AdminModal>
  )
}

/* ------------------------------------------------------------------ card payments */

function CardPayments() {
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PayhereList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<PayhereTx | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])
  useEffect(() => { setPage(1) }, [status, debouncedQ])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) })
      if (debouncedQ) p.set('q', debouncedQ)
      setData(await adminFetch<PayhereList>(`/api/sys-control/payhere-transactions?${p.toString()}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load card payments')
    } finally {
      setLoading(false)
    }
  }, [status, page, debouncedQ])

  useEffect(() => { load() }, [load])

  const t = data?.statusTotals ?? {}
  const columns: AdminColumn<PayhereTx>[] = [
    {
      key: 'for',
      header: 'Paid for',
      primary: true,
      cell: (x) => (
        <div className="min-w-0">
          <p className="font-medium text-adm-fg">{x.tenant?.name ?? x.description ?? 'Payment'}</p>
          <p className="truncate text-[12.5px] text-adm-subtle">
            {x.tenant ? `${formatBusinessId(x.tenant.businessId)} · ` : ''}
            {x.newTierName ? `Upgrade to ${x.newTierName}` : `${x.periodMonths} month${x.periodMonths === 1 ? '' : 's'}`}
          </p>
        </div>
      ),
    },
    { key: 'payer', header: 'Payer', hideBelow: 'lg', cell: (x) => <span className="text-adm-muted">{x.account.email}</span> },
    { key: 'order', header: 'Order', hideBelow: 'xl', cell: (x) => <span className="adm-num text-[12.5px] text-adm-muted">{x.orderId}</span> },
    { key: 'method', header: 'Method', hideBelow: 'md', cell: (x) => <span className="text-adm-muted">{[x.paymentMethod, x.cardNo].filter(Boolean).join(' ') || '—'}</span> },
    { key: 'date', header: 'Date', cell: (x) => fmtDate(x.paidAt ?? x.createdAt) },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      cell: (x) => (
        <div>
          <span className="adm-num font-medium">{fmtLKR(Number(x.amount), 2)}</span>
          {x.couponCode && <p className="text-[12px] text-adm-subtle">{x.couponCode} −{fmtLKR(Number(x.discountAmount), 2)}</p>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (x) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={statusTone(x.status)}>{x.status.replace(/_/g, ' ')}</Badge>
          {x.refundStatus === 'processing' && <Badge tone="warning">refund in progress</Badge>}
          {x.refundStatus === 'failed' && <Badge tone="danger">refund failed</Badge>}
        </div>
      ),
    },
  ]

  return (
    <>
      {flash && <Alert tone="success" action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash}</Alert>}
      {viewing && (
        <CardPaymentDialog
          tx={viewing}
          refundsConfigured={data?.refundsConfigured ?? false}
          onClose={() => setViewing(null)}
          onChanged={(msg) => { setFlash(msg); load() }}
        />
      )}
      <StatGrid cols={3}>
        <StatCard label="Received" icon={CreditCard} tone="success" loading={!data} value={fmtLKR(t.success?.amount ?? 0)} hint={`${fmtNumber(t.success?.count ?? 0)} successful payments`} />
        <StatCard label="Pending" icon={CreditCard} tone="warning" loading={!data} value={fmtNumber(t.pending?.count ?? 0)} hint="Started, not confirmed by PayHere" />
        <StatCard label="Failed or cancelled" icon={CreditCard} tone="danger" loading={!data} value={fmtNumber((t.failed?.count ?? 0) + (t.cancelled?.count ?? 0))} hint={`${fmtNumber((t.refunded?.count ?? 0) + (t.charged_back?.count ?? 0))} refunded or charged back`} />
      </StatGrid>
      <AdminCard flush>
        <div className="space-y-3 border-b border-adm-border p-4 sm:p-5">
          <AdminToolbar end={<Button variant="ghost" size="sm" icon={RefreshCw} onClick={load} loading={loading && !!data}>Refresh</Button>}>
            <SegmentedControl
              ariaLabel="Payment status"
              size="sm"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'success', label: 'Successful' },
                { value: 'pending', label: 'Pending' },
                { value: 'failed', label: 'Failed' },
                { value: 'refunded', label: 'Refunded' },
              ]}
            />
            <SearchInput size="sm" wrapperClassName="w-full sm:w-72" placeholder="Order no., vendor, PL-123456 or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search card payments" />
          </AdminToolbar>
          <p className="text-[12.5px] text-adm-subtle">
            Card payments are confirmed by PayHere automatically. Select a payment to see its details{data?.refundsConfigured === false ? '; refunds from here need PAYHERE_APP_ID and PAYHERE_APP_SECRET on the server' : ' or refund it'}.
          </p>
        </div>
        {error ? (
          <div className="p-4 sm:p-5"><Alert tone="danger" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert></div>
        ) : (
          <AdminTable columns={columns} rows={data?.transactions ?? []} rowKey={(x) => x.id} onRowClick={setViewing} loading={loading} minWidth={760} empty={<EmptyState icon={CreditCard} title="No card payments here" />} />
        )}
        {data && data.pagination.total > 0 && (
          <div className="border-t border-adm-border px-4 py-3 sm:px-5">
            <Pager page={page} pageSize={PAGE_SIZE} total={data.pagination.total} onPage={setPage} />
          </div>
        )}
      </AdminCard>
    </>
  )
}

/* ------------------------------------------------------------------ card payment detail + refund */

function CardPaymentDialog({ tx: x, refundsConfigured, onClose, onChanged }: {
  tx: PayhereTx
  refundsConfigured: boolean
  onClose: () => void
  onChanged: (msg: string) => void
}) {
  const canBill = useAdminCan('billing')
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<RefundOutcome | null>(null)
  const [subBusy, setSubBusy] = useState<'remove' | 'end' | null>(null)
  const [subDone, setSubDone] = useState<string | null>(null)

  const refundable = x.status === 'success' && !!x.payherePaymentId && x.refundStatus !== 'refunded' && x.refundStatus !== 'processing'

  async function refund() {
    setBusy(true)
    setError(null)
    try {
      const res = await adminFetch<RefundOutcome>(`/api/sys-control/payhere-transactions/${x.id}/refund`, { method: 'POST', json: { reason: reason.trim() } })
      setConfirming(false)
      setOutcome(res)
      onChanged(`Refunded ${fmtLKR(res.amount, 2)} for order ${x.orderId}.`)
    } catch (e) {
      setConfirming(false)
      setError(e instanceof Error ? e.message : 'The refund failed')
    } finally {
      setBusy(false)
    }
  }

  async function adjustSubscription(kind: 'remove' | 'end') {
    const sub = outcome?.subscription
    if (!sub) return
    setSubBusy(kind)
    setError(null)
    try {
      const json = kind === 'remove'
        ? { adjustMonths: -Math.max(1, sub.periodMonths), reason: `Refunded PayHere payment ${x.orderId}` }
        : { setEndDate: new Date(Date.now() + 60_000).toISOString(), reason: `Refunded PayHere payment ${x.orderId}` }
      await adminFetch(`/api/sys-control/subscriptions/${sub.id}`, { method: 'PUT', json })
      setSubDone(kind === 'remove' ? `Removed ${sub.periodMonths} paid month${sub.periodMonths === 1 ? '' : 's'} from the subscription.` : 'The paid period now ends today.')
      onChanged(`Subscription of ${sub.tenantName ?? 'the vendor'} updated after the refund.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the subscription')
    } finally {
      setSubBusy(null)
    }
  }

  return (
    <>
      <AdminModal
        open={!confirming}
        onClose={onClose}
        size="lg"
        title={`${fmtLKR(Number(x.amount), 2)} card payment`}
        description={`Order ${x.orderId}`}
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            {canBill && !outcome && x.status === 'success' && (
              <Button variant="danger" disabled={!refundable || !refundsConfigured}
                title={!refundsConfigured ? 'PAYHERE_APP_ID / PAYHERE_APP_SECRET are not set on the server' : undefined}
                onClick={() => { setReason(''); setConfirming(true) }}>
                Refund…
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
            <KeyValueList
              items={[
                { label: 'Payer', value: `${x.account.fullName} · ${x.account.email}` },
                { label: 'Business', value: x.tenant ? <Link className="text-adm-primary hover:underline" href={`/sys-control/vendors/${x.tenant.id}`}>{x.tenant.name}</Link> : '—' },
                { label: 'Paid for', value: x.newTierName ? `Upgrade to ${x.newTierName}` : `${x.periodMonths} month${x.periodMonths === 1 ? '' : 's'}` },
                { label: 'Status', value: <Badge tone={statusTone(x.status)}>{x.status.replace(/_/g, ' ')}</Badge> },
              ]}
            />
            <KeyValueList
              items={[
                { label: 'PayHere payment id', value: x.payherePaymentId || '—' },
                { label: 'Method', value: [x.paymentMethod, x.cardNo].filter(Boolean).join(' ') || '—' },
                { label: 'Paid', value: x.paidAt ? fmtDateTime(x.paidAt) : '—' },
                ...(Number(x.walletCreditApplied || 0) > 0 ? [{ label: 'Wallet part', value: fmtLKR(Number(x.walletCreditApplied), 2) }] : []),
                ...(x.couponCode ? [{ label: 'Promo code', value: `${x.couponCode} · −${fmtLKR(Number(x.discountAmount), 2)}${x.listAmount ? ` of ${fmtLKR(Number(x.listAmount), 2)}` : ''}` }] : []),
              ]}
            />
          </div>
          {x.refundStatus === 'refunded' && (
            <Alert tone="info" title={`Refunded ${x.refundedAmount ? fmtLKR(Number(x.refundedAmount), 2) : ''} ${x.refundedAt ? fmtDateTime(x.refundedAt) : ''}`}>
              {x.refundReason || 'No reason recorded.'}{x.refundReference ? ` · PayHere reference ${x.refundReference}` : ''}
            </Alert>
          )}
          {x.refundStatus === 'failed' && !outcome && <Alert tone="danger" title="Last refund attempt failed">{x.refundError || 'Unknown error'}</Alert>}
          {x.refundStatus === 'processing' && <Alert tone="warning">A refund request is in progress. Refresh in a moment.</Alert>}
          {!refundsConfigured && canBill && x.status === 'success' && (
            <Alert tone="warning">Refunds from the console need PAYHERE_APP_ID and PAYHERE_APP_SECRET (a PayHere Business App with refund permission) on the server. Until then refund in the PayHere merchant portal.</Alert>
          )}

          {outcome && (
            <div className="space-y-3">
              <Alert tone="success" title={`Refund of ${fmtLKR(outcome.amount, 2)} submitted to PayHere`}>
                {outcome.message}{outcome.reference ? ` · Reference ${outcome.reference}` : ''}
              </Alert>
              {outcome.subscription ? (
                <AdminCard title="What about the subscription?" description="The refund did not change the subscription. Decide what the vendor keeps.">
                  <KeyValueList
                    items={[
                      { label: 'Vendor', value: outcome.subscription.tenantName ?? '—' },
                      { label: 'Status', value: outcome.subscription.status },
                      { label: 'Paid until', value: outcome.subscription.currentPeriodEnd ? fmtDate(outcome.subscription.currentPeriodEnd) : '—' },
                      { label: 'This payment bought', value: outcome.subscription.wasUpgrade ? 'A plan upgrade (the plan stays until you change it on the vendor page)' : `${outcome.subscription.periodMonths} month${outcome.subscription.periodMonths === 1 ? '' : 's'}` },
                    ]}
                  />
                  {subDone ? (
                    <Alert tone="success" className="mt-3">{subDone}</Alert>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" onClick={onClose}>Leave it as it is</Button>
                      {!outcome.subscription.wasUpgrade && (
                        <Button size="sm" loading={subBusy === 'remove'} disabled={!!subBusy} onClick={() => adjustSubscription('remove')}>
                          Remove the {outcome.subscription.periodMonths} paid month{outcome.subscription.periodMonths === 1 ? '' : 's'}
                        </Button>
                      )}
                      <Button size="sm" variant="danger-soft" loading={subBusy === 'end'} disabled={!!subBusy} onClick={() => adjustSubscription('end')}>End the paid period today</Button>
                    </div>
                  )}
                </AdminCard>
              ) : (
                <Alert tone="info">This payment created a new business. Its subscription was not changed — review it on the vendor page if needed.</Alert>
              )}
            </div>
          )}
        </div>
      </AdminModal>

      {confirming && (
        <ConfirmDialog
          open
          onCancel={() => setConfirming(false)}
          onConfirm={refund}
          loading={busy}
          title={`Refund ${fmtLKR(Number(x.amount), 2)}?`}
          description={`PayHere returns the full amount of order ${x.orderId} to ${x.account.fullName}'s card. This cannot be undone. The subscription is not changed automatically — you choose next.`}
          confirmLabel="Refund payment"
          confirmVariant="danger"
        >
          <Field label="Reason" htmlFor="rf-reason" required hint="Recorded on the payment and in the audit log.">
            <Textarea id="rf-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {reason.trim().length > 0 && reason.trim().length < 3 && <p className="text-[12.5px] text-adm-danger">Give a short reason (3+ characters).</p>}
        </ConfirmDialog>
      )}
    </>
  )
}
