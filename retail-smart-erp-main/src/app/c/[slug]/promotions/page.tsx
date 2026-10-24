'use client'

// H5: promotions — % / amount off items, categories or the bill, buy X get Y, bundles, spend & save.
import { useState } from 'react'
import { Plus, Pencil, Trash2, BadgePercent } from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import { Pagination, StatusBadge, EmptyState, Button, ConfirmModal } from '@/components/ui'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { PromotionFormModal, PROMOTION_TYPES, type PromotionRow } from '@/components/pricing/PromotionFormModal'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function scheduleText(p: PromotionRow) {
  const parts: string[] = []
  if (p.startsOn || p.endsOn) parts.push(`${p.startsOn || '…'} → ${p.endsOn || '…'}`)
  if (p.daysOfWeek.length) parts.push(p.daysOfWeek.map((d) => DAYS[d]).join(' '))
  if (p.timeFrom && p.timeTo) parts.push(`${p.timeFrom.slice(0, 5)}–${p.timeTo.slice(0, 5)}`)
  return parts.join(' · ') || 'Always'
}

export default function PromotionsPage() {
  const [editing, setEditing] = useState<PromotionRow | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const { data, pagination, loading, search, setSearch, setPage, setPageSize, refresh } = usePaginatedData<PromotionRow>({
    endpoint: '/api/promotions',
    entityType: 'item',
    realtimeEnabled: false,
    storageKey: 'promotions-page-size',
    additionalParams: { includeInactive: 'true' },
  })

  async function handleDelete() {
    if (!deleteConfirm) return
    const res = await fetch(`/api/promotions/${deleteConfirm.id}`, { method: 'DELETE' })
    const body = await res.json().catch(() => ({}))
    if (res.ok) { toast.success('Promotion moved to recycle bin'); refresh() }
    else toast.error(body.error || 'Failed to delete promotion')
    setDeleteConfirm(null)
  }

  if (loading && data.length === 0) return <PageLoading text="Loading promotions..." />

  return (
    <ListPageLayout
      module="Selling"
      moduleHref="/selling"
      title="Promotions"
      actionContent={
        <button onClick={() => { setEditing(null); setShowModal(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700">
          <Plus size={16} /> New Promotion
        </button>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search promotions or coupon codes..."
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl">
        <table className="w-full">
          <caption className="sr-only">Promotions</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              {['Name', 'Offer', 'Schedule', 'Priority', 'Used', 'Status', ''].map((h, i) => (
                <th key={i} scope="col" className={`px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${i >= 3 && i <= 5 ? 'text-center' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {data.length === 0 ? (
              <tr><td colSpan={7}>
                <EmptyState icon={<BadgePercent size={24} />} title={search ? 'No promotions found' : 'No promotions yet'}
                  description="Run BOGO, bundle, happy-hour and spend-and-save offers at the POS."
                  action={!search && <Button size="sm" onClick={() => setShowModal(true)}><Plus size={16} className="mr-1" />New Promotion</Button>} />
              </td></tr>
            ) : data.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900 dark:text-white">{p.name}</div>
                  <div className="text-xs text-gray-500">
                    {PROMOTION_TYPES[p.type]}{p.couponCode ? ` · coupon ${p.couponCode}` : ''}{p.stackable ? ' · combinable' : ''}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{p.label}</td>
                <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">{scheduleText(p)}</td>
                <td className="px-4 py-3 text-center text-sm">{p.priority}</td>
                <td className="px-4 py-3 text-center text-sm">{p.usageCount}{p.usageLimit ? ` / ${p.usageLimit}` : ''}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={p.isActive ? 'active' : 'inactive'} size="sm" /></td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button aria-label={`Edit ${p.name}`} onClick={() => { setEditing(p); setShowModal(true) }}
                    className="p-1.5 text-gray-500 hover:text-blue-600 rounded"><Pencil size={16} /></button>
                  <button aria-label={`Move ${p.name} to recycle bin`} onClick={() => setDeleteConfirm({ id: p.id, name: p.name })}
                    className="p-1.5 text-gray-500 hover:text-red-600 rounded ml-1"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages}
          onPageChange={setPage} onPageSizeChange={setPageSize} className="border-t dark:border-gray-700 px-4 pagination-sticky" />
      </div>

      <PromotionFormModal isOpen={showModal} edit={editing} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); refresh() }} />
      <ConfirmModal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} onConfirm={handleDelete} title="Move promotion to Recycle Bin"
        message={`Move "${deleteConfirm?.name}" to the recycle bin? Its usage history is kept. Only the platform administrator can restore it.`} confirmText="Move to recycle bin" variant="danger" />
    </ListPageLayout>
  )
}
