'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Database, Download, LayoutGrid, Lock, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import {
  AdminCard,
  AdminModal,
  AdminPage,
  Alert,
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  SearchInput,
  Select,
  Skeleton,
  Switch,
  Textarea,
  buttonClass,
  fmtNumber,
} from '@/components/admin/kit'
import { useAdminCan } from '@/components/admin/AdminRoleContext'
import { adminFetch } from '@/components/admin/console-helpers'
import { groupIcon, tableIcon } from '@/lib/admin/vendor-data-icons'
import { formatBusinessId } from '@/lib/tenant/business-id-format'
import { cn } from '@/lib/utils'

type Kind = 'text' | 'number' | 'decimal' | 'boolean' | 'datetime' | 'date' | 'json' | 'uuid' | 'enum' | 'array'
interface Column { name: string; kind: Kind; required: boolean; hasDefault: boolean; secret: boolean; readOnly: boolean; enumValues?: string[]; references?: string }
interface TableInfo { name: string; label: string; group: string; canCreate: boolean; canEdit: boolean; canDelete: boolean; readOnlyReason?: string; rows: number }
type Row = Record<string, unknown>
interface RowsResponse { table: Omit<TableInfo, 'rows'>; columns: Column[]; rows: Row[]; total: number; page: number; pageSize: number }

const PAGE_SIZE = 50

/** Shown first: what is opened most */
const MAIN_TABLES = ['business_profile', 'items', 'warehouse_stock', 'sales', 'sale_items', 'customers', 'suppliers', 'purchases', 'payments', 'expenses', 'users', 'warehouses']

export default function VendorDataPage() {
  return (
    <Suspense fallback={<AdminPage title="Vendor data"><Skeleton className="h-96" /></AdminPage>}>
      <VendorData />
    </Suspense>
  )
}

/* ------------------------------------------------------------------ helpers */

function display(v: unknown, c: Column): string {
  if (v === null || v === undefined) return ''
  if (c.kind === 'boolean') return v ? 'Yes' : 'No'
  if (c.kind === 'datetime' && typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Value → form text (what the inputs edit) */
function toForm(v: unknown, c: Column): string | boolean {
  if (c.kind === 'boolean') return v === true
  if (v === null || v === undefined) return ''
  if (c.kind === 'datetime' && typeof v === 'string') {
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return v
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  if (c.kind === 'json' || c.kind === 'array') return JSON.stringify(v, null, 2)
  return String(v)
}

/** Form text → API value ('' = null for non-text) */
function fromForm(v: string | boolean, c: Column): unknown {
  if (c.kind === 'boolean') return v === true
  const s = String(v)
  if (c.kind === 'text') return s
  if (s.trim() === '') return null
  if (c.kind === 'datetime') return new Date(s).toISOString()
  return s
}

/* ------------------------------------------------------------------ page */

function VendorData() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const sp = useSearchParams()
  const canEdit = useAdminCan('vendors.manage')
  const canExportAll = canEdit

  // No table chosen: the page shows every table as a tile
  const table = sp.get('table') || ''
  const q = sp.get('q') || ''
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const filterColumn = sp.get('column') || ''
  const filterValue = sp.get('value') || ''

  const [vendor, setVendor] = useState<{ name: string; businessId: string } | null>(null)
  const [tables, setTables] = useState<TableInfo[] | null>(null)
  const [tablesError, setTablesError] = useState<string | null>(null)
  const [tableFilter, setTableFilter] = useState('')
  const [data, setData] = useState<RowsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(q)
  const [editing, setEditing] = useState<{ row: Row | null } | null>(null)
  const [deleting, setDeleting] = useState<Row | null>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [showEmpty, setShowEmpty] = useState(false)
  const [exporting, setExporting] = useState(sp.get('export') === '1')

  const go = useCallback((next: Record<string, string | number | null>) => {
    const p = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '') p.delete(k)
      else p.set(k, String(v))
    }
    router.replace(`/sys-control/vendors/${id}/data?${p.toString()}`, { scroll: false })
  }, [id, router, sp])

  const loadTables = useCallback(async () => {
    try {
      const r = await adminFetch<{ vendor: { name: string; businessId: string }; tables: TableInfo[] }>(`/api/sys-control/vendors/${id}/data`)
      setVendor(r.vendor)
      setTables(r.tables)
    } catch (e) {
      setTablesError(e instanceof Error ? e.message : 'Could not load the tables')
    }
  }, [id])

  const loadRows = useCallback(async () => {
    if (!table) { setData(null); setLoading(false); return }
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (q) p.set('q', q)
      if (filterColumn) { p.set('column', filterColumn); p.set('value', filterValue) }
      setData(await adminFetch<RowsResponse>(`/api/sys-control/vendors/${id}/data/${table}?${p.toString()}`))
    } catch (e) {
      setData(null)
      setError(e instanceof Error ? e.message : 'Could not load the rows')
    } finally {
      setLoading(false)
    }
  }, [id, table, q, page, filterColumn, filterValue])

  useEffect(() => { loadTables() }, [loadTables])
  useEffect(() => { loadRows() }, [loadRows])
  useEffect(() => { setSearch(q) }, [q])

  const groups = useMemo(() => {
    const f = tableFilter.trim().toLowerCase()
    const out = new Map<string, TableInfo[]>()
    for (const t of tables ?? []) {
      if (f && !t.label.toLowerCase().includes(f) && !t.name.includes(f)) continue
      const list = out.get(t.group) ?? []
      list.push(t)
      out.set(t.group, list)
    }
    return Array.from(out.entries())
  }, [tables, tableFilter])

  const current = tables?.find((t) => t.name === table)
  const open = (name: string) => go({ table: name, page: null, q: null, column: null, value: null, export: null })
  const info = data?.table
  const TitleIcon = tableIcon(table, current?.group ?? '')
  // Columns shown in the grid: secrets hidden, the rest in schema order
  const gridColumns = (data?.columns ?? []).filter((c) => !c.secret && c.name !== 'tenant_id')

  async function remove() {
    if (!deleting) return
    setBusy(true)
    try {
      await adminFetch(`/api/sys-control/vendors/${id}/data/${table}/${deleting.id}`, { method: 'DELETE' })
      setDeleting(null)
      setFlash('Row deleted.')
      loadRows()
      loadTables()
    } catch (e) {
      setDeleting(null)
      setError(e instanceof Error ? e.message : 'Could not delete the row')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminPage
      title="Vendor data"
      description={vendor ? `${vendor.name} · ${formatBusinessId(vendor.businessId)} — every table of this business. Changes are checked against the table’s rules and written to the audit log.` : 'Every table of this business.'}
      breadcrumbs={[{ label: 'Vendors', href: '/sys-control/vendors' }, { label: vendor?.name ?? 'Vendor', href: `/sys-control/vendors/${id}` }, { label: 'Data' }]}
      actions={
        <>
          <Button variant="ghost" icon={RefreshCw} onClick={() => { loadTables(); loadRows() }} loading={loading}>Refresh</Button>
          {canExportAll && <Button icon={Download} onClick={() => setExporting(true)}>Export data</Button>}
        </>
      }
    >
      {flash && <Alert tone="success" action={<Button size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</Button>}>{flash}</Alert>}
      {!canEdit && <Alert tone="info">You can view this vendor’s data. Changing it needs an owner admin.</Alert>}

      {!table && (
        <TableTiles
          tables={tables}
          error={tablesError}
          filter={tableFilter}
          onFilter={setTableFilter}
          showEmpty={showEmpty}
          onShowEmpty={setShowEmpty}
          onOpen={open}
        />
      )}

      {table && <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Table picker */}
        <AdminCard flush className="lg:sticky lg:top-20 lg:self-start">
          <div className="space-y-2 border-b border-adm-border p-3">
            <Button size="sm" variant="ghost" icon={LayoutGrid} className="w-full justify-start" onClick={() => go({ table: null, page: null, q: null, column: null, value: null })}>All tables</Button>
            <SearchInput size="sm" value={tableFilter} onChange={(e) => setTableFilter(e.target.value)} placeholder="Find a table" aria-label="Find a table" />
          </div>
          {/* Phones: a select; larger screens: the grouped list */}
          <div className="p-3 lg:hidden">
            <Select size="sm" aria-label="Table" value={table} onChange={(e) => open(e.target.value)}>
              {groups.map(([g, list]) => (
                <optgroup key={g} label={g}>
                  {list.map((t) => <option key={t.name} value={t.name}>{t.label} ({t.rows})</option>)}
                </optgroup>
              ))}
            </Select>
          </div>
          <nav className="adm-scroll hidden max-h-[calc(100vh-220px)] overflow-y-auto py-2 lg:block" aria-label="Tables">
            {tablesError && <p className="px-3 text-[13px] text-adm-danger">{tablesError}</p>}
            {!tables && !tablesError && <div className="space-y-2 px-3">{Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>}
            {groups.map(([g, list]) => (
              <div key={g} className="mb-2">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-adm-subtle">{g}</p>
                {list.map((t) => {
                  const Icon = tableIcon(t.name, t.group)
                  return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => open(t.name)}
                    aria-current={t.name === table ? 'page' : undefined}
                    className={cn(
                      'adm-focus flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px]',
                      t.name === table ? 'bg-adm-primary-soft font-medium text-adm-primary-soft-fg' : 'text-adm-muted hover:bg-adm-surface-2 hover:text-adm-fg',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 truncate">
                      <Icon size={14} aria-hidden className="shrink-0" />
                      <span className="truncate">{t.label}</span>
                      {!t.canEdit && <Lock size={11} aria-label="view only" className="shrink-0 text-adm-subtle" />}
                    </span>
                    <span className="adm-num shrink-0 text-[11.5px] text-adm-subtle">{t.rows}</span>
                  </button>
                  )
                })}
              </div>
            ))}
          </nav>
        </AdminCard>

        {/* Rows */}
        <div className="min-w-0 space-y-3">
          <AdminCard
            title={<span className="flex items-center gap-2"><TitleIcon size={16} aria-hidden /> {info?.label ?? current?.label ?? table}</span>}
            description={info?.readOnlyReason ?? (data ? `${data.total.toLocaleString()} row${data.total === 1 ? '' : 's'}${q ? ` matching “${q}”` : ''}` : undefined)}
            actions={
              <>
                <a href={`/api/sys-control/vendors/${id}/data/${table}/export`} className={buttonClass('secondary', 'sm')} download>
                  <Download size={14} aria-hidden /> Export CSV
                </a>
                {canEdit && info?.canCreate && <Button size="sm" variant="primary" icon={Plus} onClick={() => setEditing({ row: null })}>Add row</Button>}
              </>
            }
            flush
          >
            <div className="flex flex-col gap-2 border-b border-adm-border p-3 sm:flex-row sm:items-center">
              <form className="flex-1" onSubmit={(e) => { e.preventDefault(); go({ q: search.trim() || null, page: null }) }}>
                <SearchInput size="sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search this table (any text, number or id) and press Enter" aria-label="Search rows" />
              </form>
              {filterColumn && (
                <Badge tone="info">
                  <span className="inline-flex items-center gap-1">
                    {filterColumn} = <span className="adm-num max-w-[160px] truncate">{filterValue}</span>
                    <button type="button" aria-label="Clear filter" onClick={() => go({ column: null, value: null, page: null })}><X size={12} /></button>
                  </span>
                </Badge>
              )}
            </div>

            {error && <div className="p-3"><Alert tone="danger">{error}</Alert></div>}
            {loading && !data ? (
              <div className="space-y-2 p-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
            ) : data && data.rows.length === 0 ? (
              <EmptyState icon={Database} title={q || filterColumn ? 'No matching rows' : 'No rows yet'} compact />
            ) : data ? (
              <div className="adm-scroll overflow-x-auto">
                <table className="w-full min-w-max border-collapse text-[13px]">
                  <thead>
                    <tr className="bg-adm-surface-2 text-left">
                      <th className="sticky left-0 z-[1] bg-adm-surface-2 px-3 py-2" />
                      {gridColumns.map((c) => (
                        <th key={c.name} className="whitespace-nowrap px-3 py-2 font-medium text-adm-muted">{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r, i) => (
                      <tr key={String(r.id ?? i)} className="border-t border-adm-border hover:bg-adm-surface-2/60">
                        <td className="sticky left-0 z-[1] bg-adm-surface px-2 py-1.5">
                          <div className="flex gap-1">
                            <Button size="icon-sm" variant="ghost" icon={Pencil} aria-label={info?.canEdit && canEdit ? 'Edit row' : 'View row'} onClick={() => setEditing({ row: r })} />
                            {canEdit && info?.canDelete && <Button size="icon-sm" variant="ghost" icon={Trash2} aria-label="Delete row" className="text-adm-danger" onClick={() => setDeleting(r)} />}
                          </div>
                        </td>
                        {gridColumns.map((c) => {
                          const v = r[c.name]
                          const text = display(v, c)
                          return (
                            <td key={c.name} className={cn('max-w-[260px] truncate whitespace-nowrap px-3 py-1.5', (c.kind === 'uuid' || c.kind === 'number' || c.kind === 'decimal') && 'adm-num', v === null && 'text-adm-subtle')} title={text}>
                              {c.references && typeof v === 'string' ? (
                                <button type="button" className="adm-focus text-adm-primary underline-offset-2 hover:underline" onClick={() => go({ table: c.references!, column: 'id', value: v, q: null, page: null })} title={`Open in ${c.references}`}>
                                  {v.slice(0, 8)}…
                                </button>
                              ) : v === null ? '—' : text}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {data && data.total > data.pageSize && (
              <div className="flex items-center justify-between gap-2 border-t border-adm-border p-3 text-[13px] text-adm-muted">
                <span>Page {data.page} of {Math.ceil(data.total / data.pageSize)}</span>
                <div className="flex gap-2">
                  <Button size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => go({ page: page - 1 })}>Previous</Button>
                  <Button size="sm" iconRight={ChevronRight} disabled={page * data.pageSize >= data.total} onClick={() => go({ page: page + 1 })}>Next</Button>
                </div>
              </div>
            )}
          </AdminCard>
        </div>
      </div>}

      {exporting && canExportAll && <ExportDialog vendorId={id} tables={tables} onClose={() => { setExporting(false); go({ export: null }) }} />}

      {editing && data && (
        <RowDialog
          key={String(editing.row?.id ?? 'new')}
          vendorId={id}
          table={table}
          tableLabel={data.table.label}
          columns={data.columns}
          row={editing.row}
          editable={canEdit && (editing.row ? data.table.canEdit : data.table.canCreate)}
          onClose={() => setEditing(null)}
          onSaved={(text) => { setEditing(null); setFlash(text); loadRows(); loadTables() }}
          onOpenReference={(t, v) => { setEditing(null); go({ table: t, column: 'id', value: v, q: null, page: null }) }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onCancel={() => setDeleting(null)}
        onConfirm={remove}
        loading={busy}
        title="Delete this row?"
        description="It is removed from the vendor’s data now; the audit log keeps a copy of what it held. Rows other records still use cannot be deleted."
        confirmLabel="Delete"
        confirmVariant="danger"
      />
    </AdminPage>
  )
}

/* ------------------------------------------------------------------ tiles */

function TableTiles({ tables, error, filter, onFilter, showEmpty, onShowEmpty, onOpen }: {
  tables: TableInfo[] | null
  error: string | null
  filter: string
  onFilter: (v: string) => void
  showEmpty: boolean
  onShowEmpty: (v: boolean) => void
  onOpen: (name: string) => void
}) {
  const f = filter.trim().toLowerCase()
  const visible = (tables ?? []).filter((t) => (showEmpty || t.rows > 0 || f) && (!f || t.label.toLowerCase().includes(f) || t.name.includes(f)))
  const withData = (tables ?? []).filter((t) => t.rows > 0)
  const totalRows = withData.reduce((s, t) => s + t.rows, 0)
  const main = f ? [] : MAIN_TABLES.map((n) => visible.find((t) => t.name === n)).filter((t): t is TableInfo => !!t)
  const groups = new Map<string, TableInfo[]>()
  for (const t of visible) {
    if (main.includes(t)) continue
    groups.set(t.group, [...(groups.get(t.group) ?? []), t])
  }

  return (
    <div className="space-y-5">
      <AdminCard flush>
        <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput size="sm" wrapperClassName="sm:w-80" value={filter} onChange={(e) => onFilter(e.target.value)} placeholder="Find a table" aria-label="Find a table" />
          <div className="flex items-center gap-4">
            {tables && <span className="text-[13px] text-adm-muted">{fmtNumber(withData.length)} tables with {fmtNumber(totalRows)} rows</span>}
            <Switch checked={showEmpty} onChange={onShowEmpty} label="Show empty tables" />
          </div>
        </div>
      </AdminCard>

      {error && <Alert tone="danger">{error}</Alert>}
      {!tables && !error && <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{Array.from({ length: 15 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>}
      {tables && visible.length === 0 && <EmptyState icon={Database} title="No tables match" compact />}

      {main.length > 0 && <TileSection title="Main tables" icon={LayoutGrid} list={main} onOpen={onOpen} />}
      {Array.from(groups.entries()).map(([g, list]) => <TileSection key={g} title={g} icon={groupIcon(g)} list={list} onOpen={onOpen} />)}
    </div>
  )
}

function TileSection({ title, icon: Icon, list, onOpen }: { title: string; icon: ReturnType<typeof groupIcon>; list: TableInfo[]; onOpen: (name: string) => void }) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-adm-muted">
        <Icon size={15} aria-hidden /> {title}
      </h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {list.map((t) => {
          const TileIcon = tableIcon(t.name, t.group)
          return (
            <button
              key={t.name}
              type="button"
              onClick={() => onOpen(t.name)}
              className="adm-focus flex min-w-0 flex-col gap-2 rounded-xl border border-adm-border bg-adm-surface p-3 text-left transition-colors hover:border-adm-primary hover:bg-adm-surface-2"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-adm-primary-soft text-adm-primary-soft-fg"><TileIcon size={18} aria-hidden /></span>
                {!t.canEdit && <Lock size={12} aria-label="view only" className="text-adm-subtle" />}
              </span>
              <span className="truncate text-[13.5px] font-medium text-adm-fg" title={t.label}>{t.label}</span>
              <span className="adm-num text-[12.5px] text-adm-subtle">{fmtNumber(t.rows)} row{t.rows === 1 ? '' : 's'}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ bulk export */

function ExportDialog({ vendorId, tables, onClose }: { vendorId: string; tables: TableInfo[] | null; onClose: () => void }) {
  const sections = useMemo(() => {
    const out = new Map<string, { tables: number; rows: number }>()
    for (const t of tables ?? []) {
      if (t.rows === 0) continue
      const s = out.get(t.group) ?? { tables: 0, rows: 0 }
      out.set(t.group, { tables: s.tables + 1, rows: s.rows + t.rows })
    }
    return Array.from(out.entries())
  }, [tables])
  // Ticked by default: an untouched dialog exports everything
  const [unticked, setUnticked] = useState<Set<string>>(() => new Set())
  const chosen = sections.filter(([g]) => !unticked.has(g))
  const all = chosen.length === sections.length
  const href = `/api/sys-control/vendors/${vendorId}/export${all ? '' : `?groups=${encodeURIComponent(chosen.map(([g]) => g).join(','))}`}`

  return (
    <AdminModal
      open
      onClose={onClose}
      title="Export this vendor’s data"
      description="One ZIP of Excel-ready CSV files: all-time totals, every item with its stock, cost and profit, and each ticked section table by table. Big vendors can take a few minutes."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {chosen.length > 0 ? (
            <a href={href} className={buttonClass('primary', 'md')} download>
              <Download size={16} aria-hidden /> Download ZIP
            </a>
          ) : <Button variant="primary" disabled icon={Download}>Download ZIP</Button>}
        </>
      }
    >
      <div className="mb-3 flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => setUnticked(new Set())}>Tick all</Button>
        <Button size="sm" variant="ghost" onClick={() => setUnticked(new Set(sections.map(([g]) => g)))}>Untick all</Button>
      </div>
      {!tables && <Skeleton className="h-40" />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {sections.map(([g, s]) => (
          <Checkbox
            key={g}
            label={g}
            description={`${fmtNumber(s.tables)} table${s.tables === 1 ? '' : 's'} · ${fmtNumber(s.rows)} row${s.rows === 1 ? '' : 's'}`}
            checked={!unticked.has(g)}
            onChange={(e) => setUnticked((u) => {
              const next = new Set(u)
              if (e.target.checked) next.delete(g)
              else next.add(g)
              return next
            })}
          />
        ))}
      </div>
      <p className="mt-3 text-[12.5px] text-adm-subtle">Passwords, PINs, keys and sign-in sessions are never exported, and uploaded files stay in file storage. Each export is written to the audit log.</p>
    </AdminModal>
  )
}

/* ------------------------------------------------------------------ row form */

function RowDialog({ vendorId, table, tableLabel, columns, row, editable, onClose, onSaved, onOpenReference }: {
  vendorId: string
  table: string
  tableLabel: string
  columns: Column[]
  row: Row | null
  editable: boolean
  onClose: () => void
  onSaved: (text: string) => void
  onOpenReference: (table: string, id: string) => void
}) {
  const initial = useMemo(() => Object.fromEntries(columns.map((c) => [c.name, row ? toForm(row[c.name], c) : c.kind === 'boolean' ? false : ''])), [columns, row])
  const [form, setFormState] = useState<Record<string, string | boolean>>(initial)
  // New rows send only what was filled in, so database defaults (e.g. is_active = true) apply
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const setForm = (fn: (f: Record<string, string | boolean>) => Record<string, string | boolean>) => {
    setFormState((prev) => {
      const next = fn(prev)
      setTouched((t) => new Set([...t, ...Object.keys(next).filter((k) => next[k] !== prev[k])]))
      return next
    })
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; field?: string } | null>(null)
  // New rows: only columns that can be written; existing rows: everything, read-only ones disabled
  const shown = row ? columns : columns.filter((c) => !c.readOnly)

  async function save() {
    setBusy(true)
    setError(null)
    const values: Record<string, unknown> = {}
    for (const c of columns) {
      if (c.readOnly) continue
      if (row && form[c.name] === initial[c.name]) continue
      if (!row && !touched.has(c.name)) continue
      values[c.name] = fromForm(form[c.name], c)
    }
    if (row && Object.keys(values).length === 0) { setBusy(false); onClose(); return }
    try {
      if (row) {
        await adminFetch(`/api/sys-control/vendors/${vendorId}/data/${table}/${row.id}`, { method: 'PATCH', json: { values } })
        onSaved('Row saved.')
      } else {
        await adminFetch(`/api/sys-control/vendors/${vendorId}/data/${table}`, { method: 'POST', json: { values } })
        onSaved('Row added.')
      }
    } catch (e) {
      const err = e as Error & { body?: { field?: string } }
      setError({ text: err.message || 'Could not save', field: err.body?.field })
    } finally {
      setBusy(false)
    }
  }

  return (
    <AdminModal
      open
      onClose={onClose}
      size="lg"
      title={row ? `${tableLabel}: ${String(row.name ?? row.full_name ?? row.invoice_no ?? row.id ?? '')}`.slice(0, 80) : `Add to ${tableLabel}`}
      description={editable ? 'Only changed fields are saved. Empty = no value.' : 'View only.'}
      footer={editable
        ? <><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" onClick={save} loading={busy}>{row ? 'Save changes' : 'Add row'}</Button></>
        : <Button onClick={onClose}>Close</Button>}
    >
      {error && <Alert tone="danger" className="mb-3">{error.text}</Alert>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {shown.map((c) => {
          const disabled = !editable || c.readOnly
          const idAttr = `col-${c.name}`
          const v = form[c.name]
          const hint = c.secret ? 'Hidden' : c.readOnly ? 'Set by the system' : c.references ? `Id of a row in ${c.references}` : c.kind === 'json' || c.kind === 'array' ? 'JSON' : undefined
          const wide = c.kind === 'json' || c.kind === 'array' || (c.kind === 'text' && /(address|notes?|description|terms|message|body|content)$/.test(c.name))
          return (
            <Field
              key={c.name}
              label={c.name}
              htmlFor={idAttr}
              required={c.required && !disabled}
              error={error?.field === c.name ? error.text : undefined}
              hint={hint}
              labelAside={c.references && typeof v === 'string' && v ? (
                <button type="button" className="text-[12px] text-adm-primary hover:underline" onClick={() => onOpenReference(c.references!, v)}>Open</button>
              ) : undefined}
              className={wide ? 'sm:col-span-2' : undefined}
            >
              {c.secret ? (
                <Input id={idAttr} value="••••••" disabled />
              ) : c.kind === 'boolean' ? (
                <Switch checked={v === true} onChange={(b) => setForm((f) => ({ ...f, [c.name]: b }))} disabled={disabled} label={v === true ? 'Yes' : 'No'} />
              ) : c.kind === 'enum' ? (
                <Select id={idAttr} value={String(v)} disabled={disabled} onChange={(e) => setForm((f) => ({ ...f, [c.name]: e.target.value }))}>
                  {!c.required && <option value="">—</option>}
                  {(c.enumValues ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              ) : wide ? (
                <Textarea id={idAttr} rows={c.kind === 'json' || c.kind === 'array' ? 5 : 2} value={String(v)} disabled={disabled} className={c.kind === 'json' || c.kind === 'array' ? 'font-mono text-[12.5px]' : undefined} onChange={(e) => setForm((f) => ({ ...f, [c.name]: e.target.value }))} />
              ) : (
                <Input
                  id={idAttr}
                  type={c.kind === 'datetime' ? 'datetime-local' : c.kind === 'date' ? 'date' : 'text'}
                  inputMode={c.kind === 'number' || c.kind === 'decimal' ? 'decimal' : undefined}
                  value={String(v)}
                  disabled={disabled}
                  className={c.kind === 'uuid' || c.kind === 'number' || c.kind === 'decimal' ? 'adm-num' : undefined}
                  onChange={(e) => setForm((f) => ({ ...f, [c.name]: e.target.value }))}
                />
              )}
            </Field>
          )
        })}
      </div>
    </AdminModal>
  )
}
