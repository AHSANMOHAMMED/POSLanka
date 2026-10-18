'use client'

import { useState } from 'react'
import { Plus, Pencil, Trash2, FolderTree, Download, Upload } from 'lucide-react'
import { usePaginatedData, useTerminology } from '@/hooks'
import { CategoryFormModal } from '@/components/modals'
import { ExportDialog } from '@/components/import-export/ExportDialog'
import { ImportWizard } from '@/components/import-export/ImportWizard'
import { useExport } from '@/hooks/useExport'
import { useImport } from '@/hooks/useImport'
import {
  Pagination,
  StatusBadge,
  EmptyState,
  Button,
  ConfirmModal,
} from '@/components/ui'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface Category {
  id: string
  name: string
  parentId: string | null
  isActive: boolean
  parent?: { id: string; name: string } | null
  createdAt: string
}

export default function CategoriesPage() {
  const t = useTerminology()
  const { showExportDialog, openExport, closeExport } = useExport()
  const { showImportWizard, openImport, closeImport } = useImport()
  const [showModal, setShowModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; name: string }>({ open: false, id: null, name: '' })

  const {
    data: categories,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh: fetchCategories,
  } = usePaginatedData<Category>({
    endpoint: '/api/categories',
    entityType: 'category',
    storageKey: 'categories-page-size',
  })

  async function handleDelete() {
    if (!deleteConfirm.id) return

    try {
      const res = await fetch(`/api/categories/${deleteConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        fetchCategories()
        toast.success('Category deleted')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete category')
      }
    } catch (error) {
      console.error('Error deleting category:', error)
      toast.error('Failed to delete category')
    } finally {
      setDeleteConfirm({ open: false, id: null, name: '' })
    }
  }

  function handleEdit(category: Category) {
    setEditingCategory(category)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditingCategory(null)
  }

  if (loading && categories.length === 0) {
    return <PageLoading text="Loading categories..." />
  }

  return (
    <ListPageLayout
      module={t.stockModule}
      moduleHref="/stock"
      title={t.category}
      actionContent={
        <div className="flex items-center gap-2">
          <button
            onClick={openImport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Upload size={16} />
            Import
          </button>
          <button
            onClick={openExport}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Download size={16} />
            Export
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} />
            {t.addCategory}
          </button>
        </div>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={fetchCategories}
      searchPlaceholder="Search categories..."
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl">
        <table className="w-full">
          <caption className="sr-only">List of categories</caption>
          <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Parent</th>
              <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {categories.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    icon={<FolderTree size={24} />}
                    title={search ? `No ${t.categories.toLowerCase()} found` : `No ${t.categories.toLowerCase()} yet`}
                    description={search ? 'Try adjusting your search terms' : 'Add your first category to organize your items'}
                    action={
                      !search && (
                        <Button onClick={() => setShowModal(true)} size="sm">
                          <Plus size={16} className="mr-1" />
                          {t.addCategory}
                        </Button>
                      )
                    }
                  />
                </td>
              </tr>
            ) : (
              categories.map((category) => (
                <tr key={category.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900 dark:text-white">{category.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    {category.parent ? (
                      <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                        <FolderTree size={14} className="text-gray-400" />
                        {category.parent.name}
                      </div>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={category.isActive ? 'active' : 'inactive'} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleEdit(category)}
                      aria-label={`Edit ${category.name}`}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/50 rounded transition-colors"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm({ open: true, id: category.id, name: category.name })}
                      aria-label={`Delete ${category.name}`}
                      className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded ml-1 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          totalPages={pagination.totalPages}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          className="border-t dark:border-gray-700 px-4 pagination-sticky"
        />
      </div>

      <CategoryFormModal
        isOpen={showModal}
        onClose={handleCloseModal}
        onSaved={() => {
          fetchCategories()
          handleCloseModal()
        }}
        editCategory={editingCategory}
      />

      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleDelete}
        title={`Delete ${t.category}`}
        message={`Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />

      <ExportDialog
        isOpen={showExportDialog}
        onClose={closeExport}
        entity="categories"
        currentFilters={{ search }}
      />

      <ImportWizard
        isOpen={showImportWizard}
        onClose={closeImport}
        defaultEntity="categories"
        onComplete={() => fetchCategories()}
      />
    </ListPageLayout>
  )
}
