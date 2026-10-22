'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Download, FileText, RefreshCw } from 'lucide-react'
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
  Select,
  buttonClass,
  fmtDateTime,
  timeAgo,
  type AdminColumn,
  type Tone,
} from '@/components/admin/kit'
import { AdminDrawer, CodeBlock, Pager, adminFetch } from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'

interface AuditRow {
  id: string
  action: string
  resource: string
  resourceId: string | null
  details: Record<string, unknown> | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  adminId: string | null
  adminName: string | null
  adminEmail: string | null
  accountName: string | null
  accountEmail: string | null
  vendorId: string | null
  vendorName: string | null
  vendorBusinessId: string | null
}

interface ListResponse {
  logs: AuditRow[]
  pagination: { page: number; pageSize: number; total: number }
  admins?: Array<{ id: string; fullName: string; email: string }>
  resources?: string[]
}

const PAGE_SIZE = 25
const ACTIONS = ['login', 'logout', 'view', 'create', 'update', 'delete', 'approve', 'reject', 'extend'] as const

const ACTION_TONE: Record<string, Tone> = {
  create: 'success', approve: 'success', extend: 'info', update: 'primary', delete: 'danger', reject: 'danger',
  login: 'neutral', logout: 'neutral', view: 'neutral',
}

const words = (s: string) => s.replace(/[_-]+/g, ' ')

/** "update · vendor" plus the operation recorded in details (e.g. suspend, reset_password). */
function describe(r: AuditRow): string {
  const op = typeof r.details?.op === 'string' ? r.details.op : typeof r.details?.action === 'string' ? r.details.action : null
  return op ? `${words(r.resource)} · ${words(op)}` : words(r.resource)
}

function isoDay(offsetDays = 0): string {
  const d = new Date(Date.now() - offsetDays * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function AuditLogsPage() {
  const [data, setData] = useState<ListResponse | null>(null)
  const [admins, setAdmins] = useState<ListResponse['admins']>([])
  const [resources, setResources] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<AuditRow | null>(null)

  const [adminId, setAdminId] = useState('')
  const [action, setAction] = useState('')
  const [resource, setResource] = useState('')
  const [vendor, setVendor] = useState('')
  const [q, setQ] = useState('')
  const [from, setFrom] = useState(isoDay(30))
  const [to, setTo] = useState('')
  const [debounced, setDebounced] = useState({ vendor: '', q: '' })
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced({ vendor: vendor.trim(), q: q.trim() }), 350)
    return () => window.clearTimeout(t)
  }, [vendor, q])
  useEffect(() => { setPage(1) }, [adminId, action, resource, debounced, from, to])

  const dateError = from && to && from > to ? 'The start date is after the end date.' : null

  const filterParams = useMemo(() => {
    const p = new URLSearchParams()
    if (adminId) p.set('adminId', adminId)
    if (action) p.set('action', action)
    if (resource) p.set('resource', resource)
    if (debounced.vendor) p.set('vendor', debounced.vendor)
    if (debounced.q) p.set('q', debounced.q)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    return p
  }, [adminId, action, resource, debounced, from, to])

  const needMeta = admins?.length === 0 && resources.length === 0

  const load = useCallback(async () => {
    if (dateError) return
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams(filterParams)
      p.set('page', String(page))
      p.set('pageSize', String(PAGE_SIZE))
      if (needMeta) p.set('meta', '1')
      const res = await adminFetch<ListResponse>(`/api/sys-control/audit-logs?${p.toString()}`)
      setData(res)
      if (res.admins) setAdmins(res.admins)
      if (res.resources) setResources(res.resources)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the audit log')
    } finally {
      setLoading(false)
    }
    // needMeta is only read for the first request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterParams, page, dateError])

  useEffect(() => { load() }, [load])

  const filtersActive = !!(adminId || action || resource || debounced.vendor || debounced.q || to || from !== isoDay(30))
  const clear = () => { setAdminId(''); setAction(''); setResource(''); setVendor(''); setQ(''); setFrom(isoDay(30)); setTo('') }

  const columns: AdminColumn<AuditRow>[] = [
    {
      key: 'time',
      header: 'Time',
      width: '150px',
      cell: (r) => (
        <div>
          <p className="text-adm-fg" title={fmtDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</p>
          <p className="text-[12px] text-adm-subtle">{fmtDateTime(r.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'what',
      header: 'Action',
      primary: true,
      cell: (r) => (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Badge tone={ACTION_TONE[r.action] ?? 'neutral'}>{r.action}</Badge>
          <span className="text-adm-fg first-letter:uppercase">{describe(r)}</span>
        </div>
      ),
    },
    {
      key: 'admin',
      header: 'By',
      cell: (r) => (
        <div className="min-w-0">
          <p className="truncate text-adm-fg">{r.adminName ?? r.accountName ?? 'System'}</p>
          {(r.adminEmail ?? r.accountEmail) && <p className="truncate text-[12px] text-adm-subtle">{r.adminEmail ?? r.accountEmail}</p>}
        </div>
      ),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      hideBelow: 'lg',
      cell: (r) => r.vendorName ? (
        <div className="min-w-0">
          <p className="truncate text-adm-fg">{r.vendorName}</p>
          {r.vendorBusinessId && <p className="adm-num text-[12px] text-adm-subtle">{formatBusinessId(r.vendorBusinessId)}</p>}
        </div>
      ) : <span className="text-adm-subtle">—</span>,
    },
    { key: 'ip', header: 'IP address', hideBelow: 'xl', cell: (r) => <span className="font-mono text-[12.5px] text-adm-muted">{r.ipAddress || '—'}</span> },
  ]

  const exportHref = `/api/sys-control/audit-logs/export${filterParams.toString() ? `?${filterParams.toString()}` : ''}`

  return (
    <AdminPage
      title="Audit log"
      description="Every change made from this console: who did it, when, from where and to which vendor."
      actions={
        <>
          <Button variant="ghost" icon={RefreshCw} onClick={load} loading={loading && !!data}>Refresh</Button>
          <a href={exportHref} className={buttonClass('secondary', 'md', dateError ? 'pointer-events-none opacity-55' : '')} download aria-disabled={!!dateError}>
            <Download size={16} aria-hidden />
            Export CSV
          </a>
        </>
      }
    >
      <AdminCard flush>
        <div className="space-y-3 border-b border-adm-border p-4 sm:p-5">
          <AdminToolbar>
            <SearchInput size="sm" wrapperClassName="w-full sm:w-72" placeholder="Search details, IDs or IP" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the audit log" />
            <Input size="sm" wrapperClassName="w-full sm:w-56" placeholder="Vendor: PL-123456 or name" value={vendor} onChange={(e) => setVendor(e.target.value)} aria-label="Vendor" />
            <Select size="sm" className="w-full min-[480px]:w-auto" value={adminId} onChange={(e) => setAdminId(e.target.value)} aria-label="Admin">
              <option value="">All admins</option>
              {(admins ?? []).map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
            </Select>
            <Select size="sm" className="w-full min-[480px]:w-auto" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
              <option value="">All actions</option>
              {ACTIONS.map((a) => <option key={a} value={a}>{a[0].toUpperCase() + a.slice(1)}</option>)}
            </Select>
            <Select size="sm" className="w-full min-[480px]:w-auto" value={resource} onChange={(e) => setResource(e.target.value)} aria-label="Resource">
              <option value="">All resources</option>
              {resources.map((r) => <option key={r} value={r}>{words(r)}</option>)}
            </Select>
          </AdminToolbar>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From" htmlFor="al-from" className="w-full min-[480px]:w-44">
              <Input id="al-from" size="sm" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To" htmlFor="al-to" className="w-full min-[480px]:w-44">
              <Input id="al-to" size="sm" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </Field>
            {filtersActive && <Button size="sm" variant="ghost" onClick={clear}>Reset filters</Button>}
          </div>
          {dateError && <Alert tone="warning">{dateError}</Alert>}
        </div>

        {error ? (
          <div className="p-4 sm:p-5">
            <Alert tone="danger" title="Could not load the audit log" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>
          </div>
        ) : (
          <AdminTable
            columns={columns}
            rows={data?.logs ?? []}
            rowKey={(r) => r.id}
            onRowClick={setSelected}
            loading={loading}
            minWidth={760}
            empty={
              <EmptyState
                icon={FileText}
                title={filtersActive ? 'No entries match these filters' : 'No admin actions in the last 30 days'}
                description={filtersActive ? 'Widen the date range or clear the filters.' : undefined}
                action={filtersActive ? <Button size="sm" onClick={clear}>Reset filters</Button> : undefined}
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

      <AdminDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? <span className="first-letter:uppercase">{describe(selected)}</span> : ''}
        description={selected ? fmtDateTime(selected.createdAt) : undefined}
      >
        {selected && (
          <div className="space-y-5">
            <KeyValueList
              items={[
                { label: 'Action', value: <Badge tone={ACTION_TONE[selected.action] ?? 'neutral'}>{selected.action}</Badge> },
                { label: 'Resource', value: words(selected.resource) },
                { label: 'Resource ID', value: selected.resourceId ? <span className="break-all font-mono text-[12.5px]">{selected.resourceId}</span> : '—' },
                { label: 'By', value: selected.adminName ? `${selected.adminName} · ${selected.adminEmail}` : selected.accountName ? `${selected.accountName} · ${selected.accountEmail}` : 'System' },
                {
                  label: 'Vendor',
                  value: selected.vendorId ? (
                    <Link href={`/sys-control/vendors/${selected.vendorId}`} className="text-adm-primary hover:underline">
                      {selected.vendorName}{selected.vendorBusinessId ? ` · ${formatBusinessId(selected.vendorBusinessId)}` : ''}
                    </Link>
                  ) : '—',
                },
                { label: 'IP address', value: <span className="font-mono text-[12.5px]">{selected.ipAddress || '—'}</span> },
              ]}
            />
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold text-adm-fg">Details</h3>
              {selected.details && Object.keys(selected.details).length > 0
                ? <CodeBlock>{JSON.stringify(selected.details, null, 2)}</CodeBlock>
                : <p className="text-[13px] text-adm-subtle">No extra details were recorded.</p>}
            </section>
            {selected.userAgent && (
              <section className="space-y-2">
                <h3 className="text-[13px] font-semibold text-adm-fg">Browser</h3>
                <p className="break-words text-[12.5px] text-adm-muted">{selected.userAgent}</p>
              </section>
            )}
          </div>
        )}
      </AdminDrawer>
    </AdminPage>
  )
}
