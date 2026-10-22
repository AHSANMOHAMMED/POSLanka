'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bug, CheckCircle2, Layers, MessageSquareWarning, RefreshCw, X } from 'lucide-react'
import {
  AdminCard,
  AdminPage,
  AdminTable,
  AdminToolbar,
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  KeyValueList,
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  StatCard,
  StatGrid,
  Textarea,
  fmtDateTime,
  fmtNumber,
  timeAgo,
  type AdminColumn,
  type Tone,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { AdminDrawer, CodeBlock, Pager, adminFetch } from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'

type Status = 'open' | 'investigating' | 'resolved' | 'wont_fix'

interface EntryRow {
  id: string
  tenantId: string | null
  tenantName: string | null
  tenantBusinessId: string | null
  level: string
  source: string
  message: string
  groupHash: string | null
  errorSource: string | null
  resolutionStatus: Status
  occurrenceCount: number | null
  createdAt: string
  lastOccurredAt: string | null
  reportedByName: string | null
}

interface GroupRow {
  groupKey: string
  groupHash: string | null
  entries: number
  occurrences: number
  openEntries: number
  vendors: number
  firstSeen: string
  lastSeen: string
  latestId: string
  message: string
  source: string
  level: string
}

interface Stats { last24h: number; unresolved: number; userReports: number; occurrences24h: number }

interface Detail {
  id: string
  level: string
  source: string
  message: string
  stack: string | null
  context: unknown
  browserInfo: unknown
  userAgent: string | null
  aiAnalysis: string | null
  aiSuggestion: string | null
  groupHash: string | null
  groupEntries: number
  errorSource: string
  resolutionStatus: Status
  resolutionNotes: string | null
  resolvedAt: string | null
  occurrenceCount: number
  createdAt: string
  lastOccurredAt: string | null
  reportedUrl: string | null
  userDescription: string | null
  tenantId: string | null
  tenantName: string | null
  tenantBusinessId: string | null
  reportedByName: string | null
  reportedByEmail: string | null
}

const PAGE_SIZE = 25

const STATUS_LABEL: Record<Status, string> = { open: 'Open', investigating: 'Investigating', resolved: 'Resolved', wont_fix: 'Ignored' }
const STATUS_TONE: Record<Status, Tone> = { open: 'danger', investigating: 'warning', resolved: 'success', wont_fix: 'neutral' }
const LEVEL_TONE: Record<string, Tone> = { error: 'danger', warning: 'warning', info: 'info' }
const SOURCE_LABEL: Record<string, string> = { system: 'Server', user_report: 'User report', frontend: 'Browser' }

const lastSeen = (r: { lastOccurredAt: string | null; createdAt: string }) => r.lastOccurredAt ?? r.createdAt

export default function ErrorLogsPage() {
  const canTriage = useAdminCan('error_logs')
  const [view, setView] = useState<'list' | 'groups'>('list')
  const [status, setStatus] = useState<'unresolved' | 'closed' | 'all'>('unresolved')
  const [level, setLevel] = useState('')
  const [source, setSource] = useState('')
  const [vendor, setVendor] = useState('')
  const [days, setDays] = useState('')
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState({ q: '', vendor: '' })
  const [groupHash, setGroupHash] = useState<{ hash: string; label: string } | null>(null)
  const [page, setPage] = useState(1)

  const [entries, setEntries] = useState<EntryRow[] | null>(null)
  const [groups, setGroups] = useState<GroupRow[] | null>(null)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [groupBusy, setGroupBusy] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced({ q: q.trim(), vendor: vendor.trim() }), 350)
    return () => window.clearTimeout(t)
  }, [q, vendor])
  useEffect(() => { setPage(1) }, [view, status, level, source, days, debounced, groupHash])

  const params = useMemo(() => {
    const p = new URLSearchParams({ view: groupHash ? 'list' : view, page: String(page), pageSize: String(PAGE_SIZE), includeStats: '1' })
    if (status !== 'all') p.set('status', status)
    if (level) p.set('level', level)
    if (source) p.set('source', source)
    if (days) p.set('days', days)
    if (debounced.q) p.set('q', debounced.q)
    if (debounced.vendor) p.set('vendor', debounced.vendor)
    if (groupHash) p.set('groupHash', groupHash.hash)
    return p.toString()
  }, [view, status, level, source, days, debounced, groupHash, page])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminFetch<{ data?: EntryRow[]; groups?: GroupRow[]; pagination: { total: number }; stats?: Stats }>(`/api/sys-control/error-logs?${params}`)
      setEntries(res.data ?? null)
      setGroups(res.groups ?? null)
      setTotal(res.pagination.total)
      if (res.stats) setStats(res.stats)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the error log')
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])

  async function updateGroup(next: Status) {
    if (!groupHash) return
    setGroupBusy(true)
    try {
      const res = await adminFetch<{ updated: number }>('/api/sys-control/error-logs', { method: 'PUT', json: { groupHash: groupHash.hash, resolutionStatus: next } })
      setFlash({ tone: 'success', text: `${res.updated} entr${res.updated === 1 ? 'y' : 'ies'} marked ${STATUS_LABEL[next].toLowerCase()}.` })
      load()
    } catch (e) {
      setFlash({ tone: 'danger', text: e instanceof Error ? e.message : 'Update failed' })
    } finally {
      setGroupBusy(false)
    }
  }

  const filtersActive = !!(level || source || days || debounced.q || debounced.vendor || status !== 'unresolved')
  const clear = () => { setLevel(''); setSource(''); setDays(''); setQ(''); setVendor(''); setStatus('unresolved') }
  const showingGroups = view === 'groups' && !groupHash

  const entryColumns: AdminColumn<EntryRow>[] = [
    {
      key: 'message',
      header: 'Error',
      primary: true,
      cell: (r) => (
        <div className="min-w-0 max-w-[560px]">
          <p className="line-clamp-2 break-words font-medium text-adm-fg">{r.message}</p>
          <p className="truncate font-mono text-[12px] text-adm-subtle">{r.source}</p>
        </div>
      ),
    },
    { key: 'level', header: 'Severity', cell: (r) => <Badge tone={LEVEL_TONE[r.level] ?? 'neutral'}>{r.level}</Badge> },
    { key: 'status', header: 'Status', cell: (r) => <Badge tone={STATUS_TONE[r.resolutionStatus]} dot>{STATUS_LABEL[r.resolutionStatus]}</Badge> },
    {
      key: 'vendor',
      header: 'Vendor',
      hideBelow: 'lg',
      cell: (r) => r.tenantName ? (
        <div className="min-w-0">
          <p className="truncate text-adm-fg">{r.tenantName}</p>
          {r.tenantBusinessId && <p className="adm-num text-[12px] text-adm-subtle">{formatBusinessId(r.tenantBusinessId)}</p>}
        </div>
      ) : <span className="text-adm-subtle">Platform</span>,
    },
    { key: 'kind', header: 'Origin', hideBelow: 'xl', cell: (r) => <span className="text-adm-muted">{SOURCE_LABEL[r.errorSource ?? 'system'] ?? r.errorSource}</span> },
    { key: 'count', header: 'Times', align: 'right', hideBelow: 'md', cell: (r) => <span className="adm-num">{fmtNumber(r.occurrenceCount ?? 1)}</span> },
    { key: 'seen', header: 'Last seen', cell: (r) => <span className="whitespace-nowrap text-adm-muted" title={fmtDateTime(lastSeen(r))}>{timeAgo(lastSeen(r))}</span> },
  ]

  const groupColumns: AdminColumn<GroupRow>[] = [
    {
      key: 'message',
      header: 'Error group',
      primary: true,
      cell: (g) => (
        <div className="min-w-0 max-w-[560px]">
          <p className="line-clamp-2 break-words font-medium text-adm-fg">{g.message}</p>
          <p className="truncate font-mono text-[12px] text-adm-subtle">{g.source}</p>
        </div>
      ),
    },
    { key: 'level', header: 'Severity', cell: (g) => <Badge tone={LEVEL_TONE[g.level] ?? 'neutral'}>{g.level}</Badge> },
    {
      key: 'open',
      header: 'Open',
      align: 'right',
      cell: (g) => <span className={g.openEntries > 0 ? 'adm-num font-medium text-adm-danger' : 'adm-num text-adm-subtle'}>{g.openEntries} / {g.entries}</span>,
    },
    { key: 'occ', header: 'Times', align: 'right', hideBelow: 'md', cell: (g) => <span className="adm-num">{fmtNumber(g.occurrences)}</span> },
    { key: 'vendors', header: 'Vendors', align: 'right', hideBelow: 'lg', cell: (g) => <span className="adm-num">{g.vendors}</span> },
    { key: 'first', header: 'First seen', hideBelow: 'xl', cell: (g) => <span className="text-adm-muted">{timeAgo(g.firstSeen)}</span> },
    { key: 'seen', header: 'Last seen', cell: (g) => <span className="whitespace-nowrap text-adm-muted">{timeAgo(g.lastSeen)}</span> },
  ]

  return (
    <AdminPage
      title="Error log"
      description="Server, browser and user-reported errors from every vendor. Repeats of the same error within a day are counted on one entry."
      actions={<Button variant="ghost" icon={RefreshCw} onClick={load} loading={loading && (entries !== null || groups !== null)}>Refresh</Button>}
    >
      <StatGrid>
        <StatCard label="Seen in the last 24 hours" value={stats ? fmtNumber(stats.last24h) : '—'} hint={stats ? `${fmtNumber(stats.occurrences24h)} occurrences` : undefined} icon={Bug} tone="danger" loading={!stats} />
        <StatCard label="Unresolved" value={stats ? fmtNumber(stats.unresolved) : '—'} hint="Open or investigating" icon={AlertTriangle} tone="warning" loading={!stats} />
        <StatCard label="Open user reports" value={stats ? fmtNumber(stats.userReports) : '—'} hint="Sent from the vendor app" icon={MessageSquareWarning} tone="info" loading={!stats} />
        <StatCard label="Showing" value={fmtNumber(total)} hint={showingGroups ? 'groups match the filters' : 'entries match the filters'} icon={Layers} tone="primary" loading={loading && entries === null && groups === null} />
      </StatGrid>

      {flash && <Alert tone={flash.tone} action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash.text}</Alert>}

      <AdminCard flush>
        <div className="space-y-3 border-b border-adm-border p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl ariaLabel="View" size="sm" value={view} onChange={(v) => { setView(v); setGroupHash(null) }} options={[{ value: 'list', label: 'Entries' }, { value: 'groups', label: 'Grouped' }]} />
            <SegmentedControl ariaLabel="Status" size="sm" value={status} onChange={setStatus} options={[{ value: 'unresolved', label: 'Unresolved' }, { value: 'closed', label: 'Resolved / ignored' }, { value: 'all', label: 'All' }]} />
          </div>
          <AdminToolbar>
            <SearchInput size="sm" wrapperClassName="w-full sm:w-72" placeholder="Message, route or page" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search errors" />
            <Input size="sm" wrapperClassName="w-full sm:w-52" placeholder="Vendor PL-123456 or “system”" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor" />
            <Select size="sm" className="w-full min-[480px]:w-auto" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Severity">
              <option value="">All severities</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </Select>
            <Select size="sm" className="w-full min-[480px]:w-auto" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Origin">
              <option value="">All origins</option>
              <option value="system">Server</option>
              <option value="frontend">Browser</option>
              <option value="user_report">User reports</option>
            </Select>
            <Select size="sm" className="w-full min-[480px]:w-auto" value={days} onChange={(e) => setDays(e.target.value)} aria-label="Period">
              <option value="">Any time</option>
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </Select>
            {filtersActive && <Button size="sm" variant="ghost" onClick={clear}>Reset</Button>}
          </AdminToolbar>
          {groupHash && (
            <div className="flex flex-col gap-2 rounded-lg border border-adm-border bg-adm-surface-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-[13px] text-adm-muted">
                Entries in group <span className="font-medium text-adm-fg">“{groupHash.label.slice(0, 90)}{groupHash.label.length > 90 ? '…' : ''}”</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {canTriage && (
                  <>
                    <Button size="sm" variant="primary" loading={groupBusy} onClick={() => updateGroup('resolved')}>Resolve all</Button>
                    <Button size="sm" disabled={groupBusy} onClick={() => updateGroup('wont_fix')}>Ignore all</Button>
                    <Button size="sm" disabled={groupBusy} onClick={() => updateGroup('open')}>Reopen all</Button>
                  </>
                )}
                <Button size="sm" variant="ghost" icon={X} onClick={() => setGroupHash(null)}>Back to groups</Button>
              </div>
            </div>
          )}
        </div>

        {error ? (
          <div className="p-4 sm:p-5">
            <Alert tone="danger" title="Could not load the error log" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>
          </div>
        ) : showingGroups ? (
          <AdminTable
            columns={groupColumns}
            rows={groups ?? []}
            rowKey={(g) => g.groupKey}
            onRowClick={(g) => (g.groupHash ? setGroupHash({ hash: g.groupHash, label: g.message }) : setOpenId(g.latestId))}
            loading={loading}
            minWidth={760}
            empty={<EmptyState icon={CheckCircle2} title={filtersActive ? 'No groups match these filters' : 'No unresolved errors'} action={filtersActive ? <Button size="sm" onClick={clear}>Reset filters</Button> : undefined} />}
          />
        ) : (
          <AdminTable
            columns={entryColumns}
            rows={entries ?? []}
            rowKey={(r) => r.id}
            onRowClick={(r) => setOpenId(r.id)}
            loading={loading}
            minWidth={820}
            empty={<EmptyState icon={CheckCircle2} title={filtersActive || groupHash ? 'No entries match these filters' : 'No unresolved errors'} description={!filtersActive && !groupHash ? 'New errors appear here as they happen.' : undefined} action={filtersActive ? <Button size="sm" onClick={clear}>Reset filters</Button> : undefined} />}
          />
        )}
        {total > 0 && (
          <div className="border-t border-adm-border px-4 py-3 sm:px-5">
            <Pager page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </div>
        )}
      </AdminCard>

      <ErrorDetailDrawer
        id={openId}
        onClose={() => setOpenId(null)}
        onChanged={(msg) => { setFlash({ tone: 'success', text: msg }); load() }}
        onShowGroup={(hash, label) => { setOpenId(null); setView('list'); setGroupHash({ hash, label }) }}
      />
    </AdminPage>
  )
}

function ErrorDetailDrawer({
  id,
  onClose,
  onChanged,
  onShowGroup,
}: {
  id: string | null
  onClose: () => void
  onChanged: (msg: string) => void
  onShowGroup: (hash: string, label: string) => void
}) {
  const canTriage = useAdminCan('error_logs')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    setDetail(null)
    setError(null)
    setActionError(null)
    adminFetch<Detail>(`/api/sys-control/error-logs/${id}`)
      .then((d) => { setDetail(d); setNotes(d.resolutionNotes ?? '') })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this entry'))
  }, [id])

  async function update(body: { resolutionStatus?: Status; resolutionNotes?: string }, key: string, msg: string) {
    if (!detail) return
    setBusy(key)
    setActionError(null)
    try {
      await adminFetch('/api/sys-control/error-logs', { method: 'PUT', json: { id: detail.id, ...body } })
      setDetail({ ...detail, ...(body.resolutionStatus ? { resolutionStatus: body.resolutionStatus } : {}), ...(body.resolutionNotes !== undefined ? { resolutionNotes: body.resolutionNotes } : {}) })
      onChanged(msg)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(null)
    }
  }

  const closed = detail && (detail.resolutionStatus === 'resolved' || detail.resolutionStatus === 'wont_fix')
  const notesChanged = detail && notes !== (detail.resolutionNotes ?? '')

  return (
    <AdminDrawer
      open={!!id}
      onClose={onClose}
      title="Error details"
      description={detail ? `${detail.source} · ${fmtDateTime(detail.lastOccurredAt ?? detail.createdAt)}` : undefined}
      footer={detail && canTriage ? (
        closed ? (
          <Button variant="primary" loading={busy === 'open'} onClick={() => update({ resolutionStatus: 'open' }, 'open', 'Entry reopened.')}>Reopen</Button>
        ) : (
          <>
            {detail.resolutionStatus !== 'investigating' && (
              <Button loading={busy === 'investigating'} disabled={!!busy} onClick={() => update({ resolutionStatus: 'investigating' }, 'investigating', 'Marked as investigating.')}>Investigating</Button>
            )}
            <Button loading={busy === 'wont_fix'} disabled={!!busy} onClick={() => update({ resolutionStatus: 'wont_fix', ...(notesChanged ? { resolutionNotes: notes } : {}) }, 'wont_fix', 'Entry ignored.')}>Ignore</Button>
            <Button variant="primary" loading={busy === 'resolved'} disabled={!!busy} onClick={() => update({ resolutionStatus: 'resolved', ...(notesChanged ? { resolutionNotes: notes } : {}) }, 'resolved', 'Entry resolved.')}>Resolve</Button>
          </>
        )
      ) : undefined}
    >
      {error ? (
        <Alert tone="danger">{error}</Alert>
      ) : !detail ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          {actionError && <Alert tone="danger">{actionError}</Alert>}
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={LEVEL_TONE[detail.level] ?? 'neutral'}>{detail.level}</Badge>
              <Badge tone={STATUS_TONE[detail.resolutionStatus]} dot>{STATUS_LABEL[detail.resolutionStatus]}</Badge>
              <Badge>{SOURCE_LABEL[detail.errorSource] ?? detail.errorSource}</Badge>
            </div>
            <p className="break-words text-[14px] font-medium text-adm-fg">{detail.message}</p>
          </div>

          <KeyValueList
            items={[
              { label: 'Route / component', value: <span className="break-all font-mono text-[12.5px]">{detail.source}</span> },
              {
                label: 'Vendor',
                value: detail.tenantId ? (
                  <Link href={`/sys-control/vendors/${detail.tenantId}`} className="text-adm-primary hover:underline">
                    {detail.tenantName ?? 'Vendor'}{detail.tenantBusinessId ? ` · ${formatBusinessId(detail.tenantBusinessId)}` : ''}
                  </Link>
                ) : 'Platform',
              },
              { label: 'Times seen', value: fmtNumber(detail.occurrenceCount) },
              { label: 'First seen', value: fmtDateTime(detail.createdAt) },
              ...(detail.lastOccurredAt ? [{ label: 'Last seen', value: fmtDateTime(detail.lastOccurredAt) }] : []),
              ...(detail.reportedByName ? [{ label: 'Reported by', value: `${detail.reportedByName}${detail.reportedByEmail ? ` · ${detail.reportedByEmail}` : ''}` }] : []),
              ...(detail.reportedUrl ? [{ label: 'Page', value: <span className="break-all">{detail.reportedUrl}</span> }] : []),
              ...(detail.resolvedAt ? [{ label: 'Closed', value: fmtDateTime(detail.resolvedAt) }] : []),
            ]}
          />

          {detail.groupHash && detail.groupEntries > 1 && (
            <Button size="sm" variant="secondary" icon={Layers} onClick={() => onShowGroup(detail.groupHash!, detail.message)}>
              Show all {detail.groupEntries} entries in this group
            </Button>
          )}

          {detail.userDescription && (
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold text-adm-fg">What the user said</h3>
              <p className="whitespace-pre-wrap break-words text-[13.5px] text-adm-muted">{detail.userDescription}</p>
            </section>
          )}

          <section className="space-y-1.5">
            <h3 className="text-[13px] font-semibold text-adm-fg">Stack trace</h3>
            {detail.stack ? <CodeBlock>{detail.stack}</CodeBlock> : <p className="text-[13px] text-adm-subtle">No stack trace was recorded.</p>}
            <p className="text-[12px] text-adm-subtle">Passwords, tokens, connection strings and server paths are hidden.</p>
          </section>

          {detail.context != null && (
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold text-adm-fg">Request context</h3>
              <CodeBlock maxHeight={240}>{JSON.stringify(detail.context, null, 2)}</CodeBlock>
            </section>
          )}

          {(detail.aiAnalysis || detail.aiSuggestion) && (
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold text-adm-fg">Automatic analysis</h3>
              {detail.aiAnalysis && <p className="whitespace-pre-wrap text-[13.5px] text-adm-muted">{detail.aiAnalysis}</p>}
              {detail.aiSuggestion && <p className="whitespace-pre-wrap text-[13.5px] text-adm-muted"><span className="font-medium text-adm-fg">Suggested fix: </span>{detail.aiSuggestion}</p>}
            </section>
          )}

          <section className="space-y-2">
            <Field label="Notes" htmlFor="err-notes" hint="Visible to other admins. Saved with the status change, or on its own.">
              <Textarea id="err-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
            </Field>
            <Button size="sm" disabled={!notesChanged || !!busy || !canTriage} loading={busy === 'notes'} onClick={() => update({ resolutionNotes: notes }, 'notes', 'Notes saved.')}>Save notes</Button>
          </section>
        </div>
      )}
    </AdminDrawer>
  )
}
