'use client'

// H5: product price lists (wholesale / VIP / counter prices, quantity tiers).
import { useState } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Trash2, Tags } from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import { Pagination, StatusBadge, EmptyState, Button, ConfirmModal } from '@/components/ui'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { PriceListFormModal, type PriceListRow } from '@/components/pricing/PriceListFormModal'

function scopeText(l: PriceListRow) {
  if (l.appliesTo === 'customer_group') return `Group: ${l.customerTypes.join(', ')}`
  if (l.appliesTo === 'customers') return `${l.customerIds.length} customer(s)`
  if (l.appliesTo === 'pos_profiles') return `${l.posProfileIds.length} POS profile(s)`
  return 'Everyone'
}

export default function PriceListsPage() {
  const { tenantSlug } = useCompany()
  const [editing, setEditing] = useState<PriceListRow | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
  const { data, pagination, loading, search, setSearch, setPage, setPageSize, refresh } = usePaginatedData<PriceListRow>({
    endpoint: '/api/price-lists',
    entityType: 'item',
    realtimeEnabled: false,
    storageKey: 'price-lists-page-size',
    additionalParams: { includeInactive: 'true' },
  })

  async function handleDelete() {
    if (!deleteConfirm) return
    const res = await fetch(`/api/price-lists/${deleteConfirm.id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Price list moved to recycle bin'); refresh() } else toast.error('Failed to delete price list')
    setDeleteConfirm(null)
  }

  if (loading && data.length === 0) return <PageLoading text="Loading price lists..." />

  return (
    <ListPageLayout
      module="Selling"
      moduleHref="/selling"
      title="Price Lists"
      actionContent={
        <button onClick={() => { setEditing(null); setShowModal(true) }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700">
          <Plus size={16} /> New Price List
        </button>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search price lists..."
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl">
        <table className="w-full">
          <caption className="sr-only">Price lists</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              {['Name', 'Applies to', 'Priority', 'Valid', 'Items', 'Status', ''].map((h, i) => (
                <th key={i} scope="col" className={`px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider ${i >= 2 && i <= 5 ? 'text-center' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {data.length === 0 ? (
              <tr><td colSpan={7}>
                <EmptyState icon={<Tags size={24} />} title={search ? 'No price lists found' : 'No price lists yet'}
                  description="Give wholesale, VIP or counter-specific prices and quantity breaks."
                  action={!search && <Button size="sm" onClick={() => setShowModal(true)}><Plus size={16} className="mr-1" />New Price List</Button>} />
              </td></tr>
            ) : data.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3">
                  <Link href={`/c/${tenantSlug}/price-lists/${l.id}`} className="font-medium text-blue-600 hover:underline">{l.name}</Link>
                  <div className="text-xs text-gray-500">{l.currency}</div>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{scopeText(l)}</td>
                <td className="px-4 py-3 text-center text-sm">{l.priority}</td>
                <td className="px-4 py-3 text-center text-xs text-gray-600 dark:text-gray-400">
                  {l.validFrom || l.validTo ? `${l.validFrom || '…'} → ${l.validTo || '…'}` : 'Always'}
                </td>
                <td className="px-4 py-3 text-center text-sm">{l.itemCount ?? 0}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={l.isActive ? 'active' : 'inactive'} size="sm" /></td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button aria-label={`Edit ${l.name}`} onClick={() => { setEditing(l); setShowModal(true) }}
                    className="p-1.5 text-gray-500 hover:text-blue-600 rounded"><Pencil size={16} /></button>
                  <button aria-label={`Move ${l.name} to recycle bin`} onClick={() => setDeleteConfirm({ id: l.id, name: l.name })}
                    className="p-1.5 text-gray-500 hover:text-red-600 rounded ml-1"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages}
          onPageChange={setPage} onPageSizeChange={setPageSize} className="border-t dark:border-gray-700 px-4 pagination-sticky" />
      </div>

      <PriceListFormModal isOpen={showModal} editList={editing} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); refresh() }} />
      <ConfirmModal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} onConfirm={handleDelete} title="Move price list to Recycle Bin"
        message={`Move "${deleteConfirm?.name}" to the recycle bin? Past sales keep their prices. Only the platform administrator can restore it.`} confirmText="Move to recycle bin" variant="danger" />
    </ListPageLayout>
  )
}
