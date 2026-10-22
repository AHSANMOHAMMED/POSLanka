'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare, Plus, RefreshCw } from 'lucide-react'
import {
  AdminCard,
  AdminModal,
  AdminPage,
  AdminTable,
  AdminToolbar,
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  SearchInput,
  SegmentedControl,
  Select,
  StatusDot,
  Textarea,
  fmtDateTime,
  timeAgo,
  type AdminColumn,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { Pager, adminFetch } from '@/components/admin/console-helpers'
import { CATEGORY_LABEL, PRIORITY_TONE } from './labels'

interface ConversationRow {
  id: string
  subject: string
  status: 'open' | 'closed' | 'archived'
  priority: string
  category: string | null
  lastMessageAt: string | null
  lastMessagePreview: string | null
  unreadByAdmin: boolean
  unreadByAccount: boolean
  createdAt: string
  account: { id: string; email: string; fullName: string }
}

interface Counts { open: number; unread: number; closed: number; archived: number; all: number }

type Tab = 'unread' | 'open' | 'closed' | 'archived' | 'all'
const PAGE_SIZE = 25

export default function MessagesPage() {
  const canWrite = useAdminCan('messages')
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('open')
  const [priority, setPriority] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ data: ConversationRow[]; counts: Counts; pagination: { total: number } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])
  useEffect(() => { setPage(1) }, [tab, priority, debouncedQ])

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (tab === 'unread') p.set('unread', '1')
    else if (tab !== 'all') p.set('status', tab)
    if (priority) p.set('priority', priority)
    if (debouncedQ) p.set('search', debouncedQ)
    return p.toString()
  }, [tab, priority, debouncedQ, page])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    setError(null)
    try {
      setData(await adminFetch(`/api/sys-control/messages?${params}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load conversations')
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])
  // New vendor messages show up without a manual refresh
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load(true) }, 30_000)
    return () => window.clearInterval(t)
  }, [load])

  const c = data?.counts
  const tabs: Array<{ value: Tab; label: string }> = [
    { value: 'unread', label: `Needs reply${c ? ` ${c.unread}` : ''}` },
    { value: 'open', label: `Open${c ? ` ${c.open}` : ''}` },
    { value: 'closed', label: `Closed${c ? ` ${c.closed}` : ''}` },
    { value: 'archived', label: `Archived${c ? ` ${c.archived}` : ''}` },
    { value: 'all', label: `All${c ? ` ${c.all}` : ''}` },
  ]

  const columns: AdminColumn<ConversationRow>[] = [
    {
      key: 'subject',
      header: 'Conversation',
      primary: true,
      cell: (r) => (
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-1.5 w-2 shrink-0">{r.unreadByAdmin && <StatusDot tone="primary" />}</span>
          <div className="min-w-0 max-w-[480px]">
            <p className={r.unreadByAdmin ? 'truncate font-semibold text-adm-fg' : 'truncate font-medium text-adm-fg'}>{r.subject}</p>
            <p className="truncate text-[12.5px] text-adm-subtle">{r.lastMessagePreview || 'No messages'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'account',
      header: 'Vendor account',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-adm-fg">{r.account.fullName}</p>
          <p className="truncate text-[12.5px] text-adm-subtle">{r.account.email}</p>
        </div>
      ),
    },
    {
      key: 'state',
      header: 'Status',
      hideBelow: 'md',
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={r.status === 'open' ? 'success' : 'neutral'}>{r.status}</Badge>
          {r.priority !== 'normal' && <Badge tone={PRIORITY_TONE[r.priority] ?? 'neutral'}>{r.priority}</Badge>}
        </div>
      ),
    },
    { key: 'cat', header: 'Category', hideBelow: 'xl', cell: (r) => <span className="text-adm-muted">{CATEGORY_LABEL[r.category ?? 'general'] ?? r.category}</span> },
    {
      key: 'last',
      header: 'Last message',
      cell: (r) => <span className="whitespace-nowrap text-adm-muted" title={r.lastMessageAt ? fmtDateTime(r.lastMessageAt) : undefined}>{timeAgo(r.lastMessageAt)}</span>,
    },
  ]

  const filtered = !!(priority || debouncedQ)

  return (
    <AdminPage
      title="Messages"
      description="Support conversations with vendors. Vendors write from their account portal; replies appear there straight away."
      actions={
        <>
          <Button variant="ghost" icon={RefreshCw} onClick={() => load()} loading={loading && !!data}>Refresh</Button>
          {canWrite && <Button variant="primary" icon={Plus} onClick={() => setComposing(true)}>New message</Button>}
        </>
      }
    >
      <AdminCard flush>
        <div className="space-y-3 border-b border-adm-border p-4 sm:p-5">
          <SegmentedControl ariaLabel="Conversation status" size="sm" value={tab} onChange={setTab} options={tabs} />
          <AdminToolbar>
            <SearchInput size="sm" wrapperClassName="w-full sm:w-80" placeholder="Subject, message, name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search conversations" />
            <Select size="sm" className="w-full min-[480px]:w-auto" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
              <option value="">Any priority</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </Select>
          </AdminToolbar>
        </div>
        {error ? (
          <div className="p-4 sm:p-5">
            <Alert tone="danger" title="Could not load conversations" action={<Button size="sm" onClick={() => load()}>Retry</Button>}>{error}</Alert>
          </div>
        ) : (
          <AdminTable
            columns={columns}
            rows={data?.data ?? []}
            rowKey={(r) => r.id}
            rowHref={(r) => `/sys-control/messages/${r.id}`}
            loading={loading}
            minWidth={720}
            empty={
              <EmptyState
                icon={MessageSquare}
                title={filtered ? 'No conversations match' : tab === 'unread' ? 'Nothing waiting for a reply' : 'No conversations here'}
                description={!filtered && tab === 'unread' ? 'New messages from vendors appear here.' : undefined}
                action={filtered ? <Button size="sm" onClick={() => { setQ(''); setPriority('') }}>Clear filters</Button> : undefined}
              />
            }
          />
        )}
        {data && data.pagination.total > 0 && (
          <div className="border-t border-adm-border px-4 py-3 sm:px-5">
            <Pager page={page} pageSize={PAGE_SIZE} total={data.pagination.total} onPage={setPage} />
          </div>
        )}
      </AdminCard>

      {composing && <NewConversationDialog onClose={() => setComposing(false)} onCreated={(id) => router.push(`/sys-control/messages/${id}`)} />}
    </AdminPage>
  )
}

function NewConversationDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [businessId, setBusinessId] = useState('')
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('general')
  const [priority, setPriority] = useState('normal')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = businessId.trim().length >= 4 && subject.trim().length >= 3 && message.trim().length > 0

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await adminFetch<{ conversation: { id: string } }>('/api/sys-control/messages', {
        method: 'POST',
        json: { businessId: businessId.trim(), subject: subject.trim(), category, priority, message: message.trim() },
      })
      onCreated(res.conversation.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the conversation')
      setBusy(false)
    }
  }

  return (
    <AdminModal
      open
      onClose={onClose}
      title="New message to a vendor"
      description="Goes to the owner’s account portal, where they can reply."
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ok} onClick={submit}>Send</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Business ID" htmlFor="nc-bid" required hint="For example PL-123456">
          <Input id="nc-bid" value={businessId} onChange={(e) => setBusinessId(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Subject" htmlFor="nc-subject" required>
          <Input id="nc-subject" value={subject} maxLength={255} onChange={(e) => setSubject(e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Category" htmlFor="nc-cat">
            <Select id="nc-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {Object.entries(CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Priority" htmlFor="nc-pri">
            <Select id="nc-pri" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </Field>
        </div>
        <Field label="Message" htmlFor="nc-msg" required>
          <Textarea id="nc-msg" rows={5} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />
        </Field>
      </div>
    </AdminModal>
  )
}
