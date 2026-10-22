'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Plus, RefreshCw, Store } from 'lucide-react'
import {
  AdminCard,
  AdminPage,
  AdminTable,
  AdminToolbar,
  Alert,
  Badge,
  Button,
  EmptyState,
  LinkButton,
  SearchInput,
  SegmentedControl,
  Select,
  buttonClass,
  businessTypeLabel,
  statusTone,
  timeAgo,
  BUSINESS_TYPE_LABELS,
  type AdminColumn,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import {
  Pager,
  SUBSCRIPTION_STATUS_LABEL,
  VENDOR_STATUS_LABEL,
  adminFetch,
  daysUntil,
  fmtDate,
  isNeverEnding,
  labelFor,
} from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'

interface VendorRow {
  id: string
  name: string
  legalName: string | null
  slug: string
  businessId: string
  email: string
  businessType: string
  status: string
  lockedReason: string | null
  createdAt: string
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  tierDisplayName: string | null
  tierMaxUsers: number | null
  owner: { name: string; email: string } | null
  userCount: number
  activeUserCount: number
  lastActivityAt: string | null
}

interface ListResponse {
  vendors: VendorRow[]
  pagination: { page: number; pageSize: number; total: number }
  statusCounts: Record<string, number>
  tiers: Array<{ id: string; displayName: string; isActive: boolean }>
}

type StatusFilter = 'all' | 'active' | 'suspended' | 'locked' | 'cancelled'
const PAGE_SIZE = 25

const IMPERSONATE_ERRORS: Record<string, string> = {
  missing_token: 'The sign-in link was incomplete. Try “Open as owner” again.',
  impersonate_failed: 'Could not open the vendor app as its owner. Each link works once and expires after 2 minutes — try again.',
}

/** Plan + subscription state, e.g. "Starter · Active · renews 3 Nov" */
function PlanCell({ v }: { v: VendorRow }) {
  if (!v.subscriptionStatus) return <span className="text-adm-subtle">No subscription</span>
  const ends = v.subscriptionStatus === 'trial' ? v.trialEndsAt : v.currentPeriodEnd
  const days = daysUntil(ends)
  const never = !ends || isNeverEnding(ends) || (v.subscriptionStatus === 'trial' && !v.trialEndsAt)
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-adm-fg">{v.tierDisplayName ?? '—'}</span>
        <Badge tone={statusTone(v.subscriptionStatus)}>{labelFor(SUBSCRIPTION_STATUS_LABEL, v.subscriptionStatus)}</Badge>
      </div>
      <p className={`text-[12.5px] ${days !== null && days <= 7 && !never ? 'text-adm-warning' : 'text-adm-subtle'}`}>
        {never ? 'Does not expire' : days !== null && days < 0 ? `Ended ${fmtDate(ends)}` : `Ends ${fmtDate(ends)}`}
      </p>
    </div>
  )
}

export default function VendorsPage() {
  const canCreate = useAdminCan('vendors.manage')
  const [data, setData] = useState<ListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [businessType, setBusinessType] = useState('')
  const [tierId, setTierId] = useState('')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)

  // Error passed back by the impersonation redirect (/api/auth/impersonate)
  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error')
    if (err) setNotice(IMPERSONATE_ERRORS[err] ?? 'Something went wrong. Try again.')
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => window.clearTimeout(t)
  }, [q])

  // Any filter change goes back to page 1
  useEffect(() => { setPage(1) }, [debouncedQ, status, businessType, tierId, sort])

  const filterParams = useMemo(() => {
    const p = new URLSearchParams()
    if (debouncedQ) p.set('q', debouncedQ)
    if (status !== 'all') p.set('status', status)
    if (businessType) p.set('businessType', businessType)
    if (tierId) p.set('tierId', tierId)
    if (sort !== 'newest') p.set('sort', sort)
    return p
  }, [debouncedQ, status, businessType, tierId, sort])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams(filterParams)
      p.set('page', String(page))
      p.set('pageSize', String(PAGE_SIZE))
      setData(await adminFetch<ListResponse>(`/api/sys-control/vendors?${p.toString()}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load vendors')
    } finally {
      setLoading(false)
    }
  }, [filterParams, page])

  useEffect(() => { load() }, [load])

  const counts = data?.statusCounts ?? {}
  const allCount = Object.values(counts).reduce((a, b) => a + b, 0)
  const statusOptions: Array<{ value: StatusFilter; label: string }> = [
    { value: 'all', label: `All ${data ? allCount : ''}`.trim() },
    { value: 'active', label: `Active ${counts.active ?? 0}` },
    { value: 'suspended', label: `Suspended ${counts.suspended ?? 0}` },
    { value: 'locked', label: `Locked ${counts.locked ?? 0}` },
    { value: 'cancelled', label: `Archived ${counts.cancelled ?? 0}` },
  ]
  const filtersActive = !!(debouncedQ || status !== 'all' || businessType || tierId)

  const columns: AdminColumn<VendorRow>[] = [
    {
      key: 'business',
      header: 'Business',
      primary: true,
      cell: (v) => (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-medium text-adm-fg">{v.name}</span>
            {v.status !== 'active' && (
              <Badge tone={statusTone(v.status)} dot>{labelFor(VENDOR_STATUS_LABEL, v.status)}</Badge>
            )}
          </div>
          <p className="text-[12.5px] text-adm-subtle">
            <span className="adm-num font-medium text-adm-muted">{formatBusinessId(v.businessId)}</span>
            <span aria-hidden> · </span>
            {v.slug}
          </p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', hideBelow: 'lg', cell: (v) => <span className="text-adm-muted">{businessTypeLabel(v.businessType)}</span> },
    {
      key: 'owner',
      header: 'Owner',
      hideBelow: 'xl',
      cell: (v) =>
        v.owner ? (
          <div className="min-w-0">
            <p className="truncate text-adm-fg">{v.owner.name}</p>
            <p className="truncate text-[12.5px] text-adm-subtle">{v.owner.email}</p>
          </div>
        ) : (
          <span className="text-adm-subtle">No owner</span>
        ),
    },
    { key: 'plan', header: 'Plan', cell: (v) => <PlanCell v={v} /> },
    {
      key: 'users',
      header: 'Users',
      align: 'right',
      hideBelow: 'md',
      cell: (v) => (
        <span className="adm-num">
          {v.activeUserCount}
          {v.tierMaxUsers ? <span className="text-adm-subtle"> / {v.tierMaxUsers}</span> : null}
        </span>
      ),
    },
    { key: 'created', header: 'Created', hideBelow: 'xl', cell: (v) => <span className="text-adm-muted">{fmtDate(v.createdAt)}</span> },
    {
      key: 'activity',
      header: 'Last activity',
      hideBelow: 'lg',
      cell: (v) => <span className="text-adm-muted">{v.lastActivityAt ? timeAgo(v.lastActivityAt) : 'Never'}</span>,
    },
  ]

  const exportHref = `/api/sys-control/vendors/export${filterParams.toString() ? `?${filterParams.toString()}` : ''}`

  return (
    <AdminPage
      title="Vendors"
      description="Every business on POSLanka. Search by name, web address, email or Business ID."
      actions={
        <>
          <Button variant="ghost" icon={RefreshCw} onClick={load} loading={loading && !!data}>Refresh</Button>
          <a href={exportHref} className={buttonClass('secondary', 'md')} download>
            <Download size={16} aria-hidden />
            Export CSV
          </a>
          {canCreate && <LinkButton href="/sys-control/vendors/create" variant="primary" icon={Plus}>New vendor</LinkButton>}
        </>
      }
    >
      {notice && <Alert tone="warning" action={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>}>{notice}</Alert>}

      <AdminCard flush>
        <div className="space-y-3 border-b border-adm-border p-4 sm:p-5">
          <SegmentedControl ariaLabel="Vendor status" value={status} onChange={setStatus} options={statusOptions} size="sm" />
          <AdminToolbar>
            <SearchInput
              size="sm"
              wrapperClassName="w-full sm:w-80"
              placeholder="Name, PL-123456, web address or email"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search vendors"
            />
            <Select size="sm" className="w-full min-[480px]:w-auto" value={businessType} onChange={(e) => setBusinessType(e.target.value)} aria-label="Business type">
              <option value="">All business types</option>
              {Object.entries(BUSINESS_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Select size="sm" className="w-full min-[480px]:w-auto" value={tierId} onChange={(e) => setTierId(e.target.value)} aria-label="Plan">
              <option value="">All plans</option>
              {(data?.tiers ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.displayName}{t.isActive ? '' : ' (retired)'}</option>
              ))}
            </Select>
            <Select size="sm" className="w-full min-[480px]:w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="name">Name A–Z</option>
            </Select>
          </AdminToolbar>
        </div>

        {error ? (
          <div className="p-4 sm:p-5">
            <Alert tone="danger" title="Could not load vendors" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>
          </div>
        ) : (
          <AdminTable
            columns={columns}
            rows={data?.vendors ?? []}
            rowKey={(v) => v.id}
            rowHref={(v) => `/sys-control/vendors/${v.id}`}
            loading={loading}
            minWidth={720}
            empty={
              <EmptyState
                icon={Store}
                title={filtersActive ? 'No vendors match these filters' : 'No vendors yet'}
                description={filtersActive ? 'Try a different search or clear the filters.' : 'Create the first business to get started.'}
                action={
                  filtersActive ? (
                    <Button size="sm" onClick={() => { setQ(''); setStatus('all'); setBusinessType(''); setTierId('') }}>Clear filters</Button>
                  ) : (
                    canCreate ? <LinkButton href="/sys-control/vendors/create" size="sm" variant="primary" icon={Plus}>New vendor</LinkButton> : undefined
                  )
                }
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
    </AdminPage>
  )
}
