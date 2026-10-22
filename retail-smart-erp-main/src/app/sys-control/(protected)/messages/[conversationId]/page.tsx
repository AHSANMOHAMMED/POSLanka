'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Archive, Lock, MessageSquare, RotateCcw, Send } from 'lucide-react'
import {
  AdminCard,
  AdminPage,
  Alert,
  Badge,
  Button,
  EmptyState,
  KeyValueList,
  Select,
  Skeleton,
  Textarea,
  fmtDateTime,
  statusTone,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { adminFetch } from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'
import { cn } from '@/lib/utils'
import { CATEGORY_LABEL, PRIORITY_TONE } from '../labels'

interface Message {
  id: string
  senderType: 'admin' | 'account' | string
  senderName: string | null
  content: string
  isSystemMessage: boolean
  metadata: { adminName?: string | null } | null
  createdAt: string
}

interface Detail {
  conversation: {
    id: string
    subject: string
    status: 'open' | 'closed' | 'archived'
    priority: string
    category: string | null
    createdAt: string
    closedAt: string | null
    unreadByAccount: boolean
  }
  account: { id: string; email: string; fullName: string; phone: string | null }
  vendors: Array<{ id: string; name: string; businessId: string; status: string; isOwner: boolean }>
  messages: Message[]
}

export default function ConversationPage() {
  const canReply = useAdminCan('messages')
  const { conversationId } = useParams<{ conversationId: string }>()
  const [data, setData] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  const load = useCallback(async () => {
    try {
      const d = await adminFetch<Detail>(`/api/sys-control/messages/${conversationId}`)
      setData(d)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the conversation')
    }
  }, [conversationId])

  useEffect(() => { load() }, [load])
  // Pick up vendor replies while the page is open
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') load() }, 15_000)
    return () => window.clearInterval(t)
  }, [load])
  useEffect(() => {
    const n = data?.messages.length ?? 0
    if (n !== lastCount.current) {
      lastCount.current = n
      endRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [data])

  async function send() {
    const content = reply.trim()
    if (!content) return
    setSending(true)
    setActionError(null)
    try {
      await adminFetch(`/api/sys-control/messages/${conversationId}`, { method: 'POST', json: { content } })
      setReply('')
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'The reply was not sent')
    } finally {
      setSending(false)
    }
  }

  async function update(body: Record<string, unknown>, key: string) {
    setBusy(key)
    setActionError(null)
    try {
      await adminFetch(`/api/sys-control/messages/${conversationId}`, { method: 'PUT', json: body })
      await load()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  const c = data?.conversation
  const crumbs = [{ label: 'Messages', href: '/sys-control/messages' }, { label: c?.subject ?? 'Conversation' }]

  if (error && !data) {
    return (
      <AdminPage title="Conversation" breadcrumbs={crumbs}>
        <Alert tone="danger" title="Could not load the conversation" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>
      </AdminPage>
    )
  }

  return (
    <AdminPage
      title={c?.subject ?? <Skeleton className="h-7 w-64" />}
      breadcrumbs={crumbs}
      titleAside={c ? <Badge tone={c.status === 'open' ? 'success' : 'neutral'} dot>{c.status}</Badge> : undefined}
      actions={c ? (
        <>
          {canReply && c.status === 'open' && <Button icon={Lock} loading={busy === 'close'} onClick={() => update({ action: 'close' }, 'close')}>Close</Button>}
          {canReply && c.status !== 'open' && <Button icon={RotateCcw} loading={busy === 'reopen'} onClick={() => update({ action: 'reopen' }, 'reopen')}>Reopen</Button>}
          {canReply && c.status !== 'archived' && <Button variant="ghost" icon={Archive} loading={busy === 'archive'} onClick={() => update({ action: 'archive' }, 'archive')}>Archive</Button>}
        </>
      ) : undefined}
    >
      {actionError && <Alert tone="danger">{actionError}</Alert>}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <AdminCard flush className="flex min-h-[420px] flex-col">
          <div className="adm-scroll max-h-[60vh] min-h-[280px] flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
            {!data ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-2/3" />
                <Skeleton className="ml-auto h-16 w-1/2" />
                <Skeleton className="h-16 w-3/5" />
              </div>
            ) : data.messages.length === 0 ? (
              <EmptyState icon={MessageSquare} title="No messages yet" compact />
            ) : (
              data.messages.map((m) => {
                const mine = m.senderType === 'admin'
                if (m.isSystemMessage) {
                  return <p key={m.id} className="text-center text-[12.5px] text-adm-subtle">{m.content} · {fmtDateTime(m.createdAt)}</p>
                }
                return (
                  <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                    <div className={cn('max-w-[85%] sm:max-w-[75%]')}>
                      <div
                        className={cn(
                          'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[14px]',
                          mine ? 'rounded-br-md bg-adm-primary text-adm-primary-fg' : 'rounded-bl-md border border-adm-border bg-adm-surface-2 text-adm-fg',
                        )}
                      >
                        {m.content}
                      </div>
                      <p className={cn('mt-1 text-[12px] text-adm-subtle', mine && 'text-right')}>
                        {mine ? `${m.metadata?.adminName ?? m.senderName ?? 'Support'} (support)` : m.senderName ?? data.account.fullName} · {fmtDateTime(m.createdAt)}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
            <div ref={endRef} />
          </div>
          <div className="border-t border-adm-border p-3 sm:p-4">
            {!canReply ? (
              <p className="text-[13px] text-adm-muted">Your role can read conversations but not reply.</p>
            ) : c?.status === 'archived' ? (
              <p className="text-[13px] text-adm-muted">This conversation is archived. Reopen it to reply.</p>
            ) : (
              <form
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
                onSubmit={(e) => { e.preventDefault(); send() }}
              >
                <Textarea
                  rows={3}
                  value={reply}
                  maxLength={5000}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }}
                  placeholder={c?.status === 'closed' ? 'Replying reopens the conversation…' : 'Write a reply… (Ctrl+Enter to send)'}
                  aria-label="Reply"
                  className="min-h-[80px]"
                />
                <Button type="submit" variant="primary" icon={Send} loading={sending} disabled={!reply.trim() || !data}>Send</Button>
              </form>
            )}
          </div>
        </AdminCard>

        <div className="space-y-5">
          <AdminCard title="Vendor account">
            {!data ? <Skeleton className="h-24 w-full" /> : (
              <div className="space-y-3">
                <KeyValueList
                  items={[
                    { label: 'Name', value: data.account.fullName },
                    { label: 'Email', value: <a href={`mailto:${data.account.email}`} className="break-all text-adm-primary hover:underline">{data.account.email}</a> },
                    ...(data.account.phone ? [{ label: 'Phone', value: data.account.phone }] : []),
                  ]}
                />
                {data.vendors.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[12.5px] font-medium text-adm-muted">Businesses</p>
                    <ul className="space-y-1.5">
                      {data.vendors.map((v) => (
                        <li key={v.id} className="flex items-center justify-between gap-2 text-[13px]">
                          <Link href={`/sys-control/vendors/${v.id}`} className="min-w-0 truncate text-adm-primary hover:underline">{v.name}</Link>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <span className="adm-num text-adm-subtle">{formatBusinessId(v.businessId)}</span>
                            {v.status !== 'active' && <Badge tone={statusTone(v.status)}>{v.status}</Badge>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </AdminCard>
          <AdminCard title="Details">
            {!c ? <Skeleton className="h-24 w-full" /> : (
              <div className="space-y-3">
                <KeyValueList
                  items={[
                    { label: 'Category', value: CATEGORY_LABEL[c.category ?? 'general'] ?? c.category },
                    { label: 'Started', value: fmtDateTime(c.createdAt) },
                    ...(c.closedAt ? [{ label: 'Closed', value: fmtDateTime(c.closedAt) }] : []),
                    { label: 'Vendor has read the last reply', value: c.unreadByAccount ? 'Not yet' : 'Yes' },
                  ]}
                />
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="cv-priority" className="text-[13px] text-adm-muted">Priority</label>
                  <div className="flex items-center gap-2">
                    <Badge tone={PRIORITY_TONE[c.priority] ?? 'neutral'}>{c.priority}</Badge>
                    <Select id="cv-priority" size="sm" className="w-28" value={c.priority} disabled={busy === 'priority'} onChange={(e) => update({ priority: e.target.value }, 'priority')}>
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </AdminCard>
        </div>
      </div>
    </AdminPage>
  )
}
