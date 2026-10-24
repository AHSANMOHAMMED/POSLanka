'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Eye, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
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
  SearchInput,
  SegmentedControl,
  Select,
  Skeleton,
  fmtDateTime,
  type AdminColumn,
  type Tone,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { adminFetch } from '@/components/admin/console-helpers'
import { formatBusinessId } from '@/lib/tenant/business-id-format'

type Status = 'open' | 'restored' | 'purged' | 'all'
interface Entry {
  id: string
  entity_type: string
  entity_table: string
  entity_id: string
  display_name: string | null
  mode: 'archive' | 'delete'
  label: string
  status: 'open' | 'restored' | 'purged'
  deleted_by_name: string | null
  deleted_at: string
  restored_at: string | null
  purged_at: string | null
}
interface EntryDetail extends Entry {
  snapshot: Record<string, unknown> | null
  children: Record<string, unknown[]> | null
}
interface ListResponse {
  vendor: { id: string; name: string; businessId: string }
  rows: Entry[]
  total: number
  page: number
  pageSize: number
  openByType: Array<{ type: string; label: string; count: number }>
  types: Array<{ type: string; label: string; mode: string }>
}

const PAGE_SIZE = 25
const STATUS_TONE: Record<Entry['status'], Tone> = { open: 'warning', restored: 'success', purged: 'neutral' }

export default function VendorRecycleBinPage() {
  return (
    <Suspense fallback={<AdminPage title="Recycle bin"><Skeleton className="h-96" /></AdminPage>}>
      <RecycleBin />
    </Suspense>
  )
}

function RecycleBin() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const sp = useSearchParams()
  const canManage = useAdminCan('vendors.manage')

  const status = (sp.get('status') as Status) || 'open'
  const type = sp.get('type') || ''
  const q = sp.get('q') || ''
  const page = Math.max(1, Number(sp.get('page')) || 1)

  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [search, setSearch] = useState(q)
  const [confirm, setConfirm] = useState<{ entry: Entry; action: 'restore' | 'purge' } | null>(null)
  const [viewing, setViewing] = useState<EntryDetail | null>(null)
  const [busy, setBusy] = useState(false)

  const go = useCallback((next: Record<string, string | number | null>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') p.delete(k)
      else p.set(k, String(v))
    }
    router.replace(`/sys-control/vendors/${id}/recycle-bin?${p.toString()}`, { scroll: false })
  }, [id, router, sp])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE_SIZE) })
      if (type) p.set('type', type)
      if (q) p.set('q', q)
      setData(await adminFetch<ListResponse>(`/api/sys-control/vendors/${id}/recycle-bin?${p.toString()}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the recycle bin')
    } finally {
      setLoading(false)
    }
  }, [id, status, type, q, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setSearch(q) }, [q])

  async function act() {
    if (!confirm) return
    setBusy(true)
    try {
      const { entry, action } = confirm
      if (action === 'restore') {
        await adminFetch(`/api/sys-control/vendors/${id}/recycle-bin/${entry.id}/restore`, { method: 'POST' })
        setFlash(`${entry.label} “${entry.display_name ?? entry.entity_id}” restored. The vendor sees it again.`)
      } else {
        await adminFetch(`/api/sys-control/vendors/${id}/recycle-bin/${entry.id}`, { method: 'DELETE' })
        setFlash(`${entry.label} “${entry.display_name ?? entry.entity_id}” permanently deleted.`)
      }
      setError(null)
      setConfirm(null)
      load()
    } catch (e) {
      setConfirm(null)
      setError(e instanceof Error ? e.message : 'The action failed')
    } finally {
      setBusy(false)
    }
  }

  async function view(entry: Entry) {
    try {
      const r = await adminFetch<{ entry: EntryDetail }>(`/api/sys-control/vendors/${id}/recycle-bin/${entry.id}`)
      setViewing(r.entry)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the entry')
    }
  }

  const columns: AdminColumn<Entry>[] = [
    {
      key: 'name', header: 'Record', primary: true,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-adm-text">{r.display_name || r.entity_id}</div>
          <div className="text-[12px] text-adm-muted">{r.label}{r.mode === 'delete' ? ' · deleted, copy kept' : ' · archived (hidden)'}</div>
        </div>
      ),
    },
    { key: 'by', header: 'Deleted by', cell: (r) => r.deleted_by_name || '—', hideBelow: 'md' },
    { key: 'at', header: 'Deleted', cell: (r) => fmtDateTime(r.deleted_at), hideBelow: 'md' },
    {
      key: 'status', header: 'Status',
      cell: (r) => (
        <Badge tone={STATUS_TONE[r.status]} dot>
          {r.status === 'open' ? 'In bin' : r.status === 'restored' ? `Restored ${fmtDateTime(r.restored_at)}` : `Purged ${fmtDateTime(r.purged_at)}`}
        </Badge>
      ),
    },
    {
      key: 'actions', header: '', align: 'right',
      cell: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="ghost" icon={Eye} onClick={() => view(r)}>View</Button>
          {canManage && r.status === 'open' && (
            <>
              <Button size="sm" variant="secondary" icon={RotateCcw} onClick={() => setConfirm({ entry: r, action: 'restore' })}>Restore</Button>
              <Button size="sm" variant="danger" icon={Trash2} onClick={() => setConfirm({ entry: r, action: 'purge' })}>Purge</Button>
            </>
          )}
        </div>
      ),
    },
  ]

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const vendor = data?.vendor

  return (
    <AdminPage
      title="Recycle bin"
      description={vendor
        ? `${vendor.name} · ${formatBusinessId(vendor.businessId)} — records the vendor deleted. Master data is archived (hidden from the vendor); drafts are deleted with a copy kept. Restore undoes the delete; purge removes it for good.`
        : 'Records this vendor deleted.'}
      breadcrumbs={[{ label: 'Vendors', href: '/sys-control/vendors' }, { label: vendor?.name ?? 'Vendor', href: `/sys-control/vendors/${id}` }, { label: 'Recycle bin' }]}
      actions={<Button variant="ghost" icon={RefreshCw} onClick={load} loading={loading}>Refresh</Button>}
    >
      {flash && <Alert tone="success" action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash}</Alert>}
      {error && <Alert tone="danger" action={<Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>{error}</Alert>}
      {!canManage && <Alert tone="info">You can view the recycle bin. Restoring or purging needs an owner admin.</Alert>}

      <AdminCard flush>
        <div className="border-b border-adm-border p-3">
          <AdminToolbar
            end={
              <SegmentedControl<Status>
                size="sm"
                ariaLabel="Status"
                value={status}
                onChange={(v) => go({ status: v === 'open' ? null : v, page: null })}
                options={[{ value: 'open', label: 'In bin' }, { value: 'restored', label: 'Restored' }, { value: 'purged', label: 'Purged' }, { value: 'all', label: 'All' }]}
              />
            }
          >
            <form
              className="w-full sm:w-64"
              onSubmit={(e) => { e.preventDefault(); go({ q: search.trim() || null, page: null }) }}
            >
              <SearchInput size="sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or deleted by" aria-label="Search the recycle bin" />
            </form>
            <Select size="sm" aria-label="Record type" className="w-full sm:w-56" value={type} onChange={(e) => go({ type: e.target.value || null, page: null })}>
              <option value="">All record types</option>
              {(data?.types ?? []).map((t) => {
                const open = data?.openByType.find((o) => o.type === t.type)?.count
                return <option key={t.type} value={t.type}>{t.label}{open ? ` (${open})` : ''}</option>
              })}
            </Select>
          </AdminToolbar>
        </div>
        <AdminTable
          columns={columns}
          rows={data?.rows ?? []}
          rowKey={(r) => r.id}
          loading={loading && !data}
          minWidth={720}
          empty={<EmptyState icon={Trash2} title={status === 'open' ? 'The recycle bin is empty' : 'Nothing here'} description={q || type ? 'Try another search or record type.' : undefined} compact />}
        />
        {data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-adm-border px-3 py-2 text-[13px] text-adm-muted">
            <span>{data.total} entries · page {page} of {totalPages}</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => go({ page: page - 1 })}>Previous</Button>
              <Button size="sm" variant="ghost" icon={ChevronRight} disabled={page >= totalPages} onClick={() => go({ page: page + 1 })}>Next</Button>
            </div>
          </div>
        )}
      </AdminCard>

      <ConfirmDialog
        open={!!confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={act}
        loading={busy}
        title={confirm?.action === 'restore' ? 'Restore this record?' : 'Permanently delete this record?'}
        confirmLabel={confirm?.action === 'restore' ? 'Restore' : 'Purge for good'}
        confirmVariant={confirm?.action === 'restore' ? 'primary' : 'danger'}
        description={confirm && (confirm.action === 'restore'
          ? `${confirm.entry.label} “${confirm.entry.display_name ?? confirm.entry.entity_id}” comes back for the vendor${confirm.entry.mode === 'delete' ? ' (re-created from the saved copy)' : ''}.`
          : confirm.entry.mode === 'archive'
            ? `${confirm.entry.label} “${confirm.entry.display_name ?? confirm.entry.entity_id}” is deleted from the database. This cannot be undone. It is refused while other records (sales, stock, documents) still use it.`
            : `The saved copy of ${confirm.entry.label.toLowerCase()} “${confirm.entry.display_name ?? confirm.entry.entity_id}” is dropped. It can no longer be restored.`)}
      />

      <AdminModal
        open={!!viewing}
        onClose={() => setViewing(null)}
        size="lg"
        title={viewing ? `${viewing.label}: ${viewing.display_name ?? viewing.entity_id}` : ''}
        description={viewing ? `Saved when it was deleted · ${fmtDateTime(viewing.deleted_at)}${viewing.deleted_by_name ? ` by ${viewing.deleted_by_name}` : ''}` : undefined}
        footer={<Button variant="ghost" onClick={() => setViewing(null)}>Close</Button>}
      >
        {viewing?.snapshot ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[180px_minmax(0,1fr)]">
            {Object.entries(viewing.snapshot).filter(([k]) => k !== 'tenant_id').map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-adm-muted">{k.replace(/_/g, ' ')}</dt>
                <dd className="break-words font-mono text-adm-text">{v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[13px] text-adm-muted">No saved copy (purged).</p>
        )}
        {viewing?.children && Object.entries(viewing.children).map(([table, rows]) => (
          <p key={table} className="mt-3 text-[13px] text-adm-muted">{table.replace(/_/g, ' ')}: {rows.length} line(s) saved with it.</p>
        ))}
      </AdminModal>
    </AdminPage>
  )
}
