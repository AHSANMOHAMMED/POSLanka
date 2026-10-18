'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Clock, Car, X } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { usePaginatedData } from '@/hooks'
import { Pagination } from '@/components/ui/pagination'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Modal } from '@/components/ui/modal'
import { ListPageLayout } from '@/components/layout/ListPageLayout'

interface ServiceType {
  id: string
  name: string
}

interface VehicleMake {
  id: string
  name: string
}

interface VehicleModel {
  id: string
  name: string
  makeId: string
}

interface LaborGuide {
  id: string
  tenantId: string
  serviceTypeId: string
  makeId: string | null
  modelId: string | null
  yearFrom: number | null
  yearTo: number | null
  hours: string
  serviceType: { id: string; name: string } | null
  make: { id: string; name: string } | null
  model: { id: string; name: string } | null
}

const emptyFormData = {
  serviceTypeId: '',
  makeId: '',
  modelId: '',
  yearFrom: '',
  yearTo: '',
  hours: '',
}

export default function LaborGuidesPage() {
  // Reference data
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])
  const [makes, setMakes] = useState<VehicleMake[]>([])
  const [models, setModels] = useState<VehicleModel[]>([])
  const [filteredModels, setFilteredModels] = useState<VehicleModel[]>([])

  // Modal states
  const [showFormModal, setShowFormModal] = useState(false)
  const [editingGuide, setEditingGuide] = useState<LaborGuide | null>(null)
  const [formData, setFormData] = useState(emptyFormData)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Delete confirm modal
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; name: string }>({
    open: false,
    id: null,
    name: '',
  })

  // Filter state
  const [filterServiceTypeId, setFilterServiceTypeId] = useState('')
  const [filterMakeId, setFilterMakeId] = useState('')

  // Paginated labor guides
  const {
    data: laborGuides,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    setAdditionalParams,
    refresh,
  } = usePaginatedData<LaborGuide>({
    endpoint: '/api/labor-guides',
    entityType: 'labor-guide',
    storageKey: 'labor-guides-page-size',
  })

  // Fetch reference data
  const fetchServiceTypes = useCallback(async () => {
    try {
      const res = await fetch('/api/service-types?all=true')
      if (res.ok) {
        const data = await res.json()
        setServiceTypes(data)
      }
    } catch (error) {
      console.error('Error fetching service types:', error)
    }
  }, [])

  const fetchMakes = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-makes')
      if (res.ok) {
        const data = await res.json()
        setMakes(data)
      }
    } catch (error) {
      console.error('Error fetching vehicle makes:', error)
    }
  }, [])

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicle-models')
      if (res.ok) {
        const data = await res.json()
        setModels(data)
      }
    } catch (error) {
      console.error('Error fetching vehicle models:', error)
    }
  }, [])

  useEffect(() => {
    fetchServiceTypes()
    fetchMakes()
    fetchModels()
  }, [fetchServiceTypes, fetchMakes, fetchModels])

  // Filter models when make changes in form
  useEffect(() => {
    if (formData.makeId) {
      setFilteredModels(models.filter(m => m.makeId === formData.makeId))
    } else {
      setFilteredModels([])
    }
  }, [formData.makeId, models])

  // Apply filters
  useEffect(() => {
    const params: Record<string, string> = {}
    if (filterServiceTypeId) params.serviceTypeId = filterServiceTypeId
    if (filterMakeId) params.makeId = filterMakeId
    setAdditionalParams(params)
  }, [filterServiceTypeId, filterMakeId, setAdditionalParams])

  function handleAdd() {
    setEditingGuide(null)
    setFormData(emptyFormData)
    setFormError('')
    setShowFormModal(true)
  }

  function handleEdit(guide: LaborGuide) {
    setEditingGuide(guide)
    setFormData({
      serviceTypeId: guide.serviceTypeId,
      makeId: guide.makeId || '',
      modelId: guide.modelId || '',
      yearFrom: guide.yearFrom ? String(guide.yearFrom) : '',
      yearTo: guide.yearTo ? String(guide.yearTo) : '',
      hours: guide.hours,
    })
    setFormError('')
    setShowFormModal(true)
  }

  function closeFormModal() {
    setShowFormModal(false)
    setEditingGuide(null)
    setFormData(emptyFormData)
    setFormError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')

    if (!formData.serviceTypeId) {
      setFormError('Service type is required')
      return
    }
    if (!formData.hours || parseFloat(formData.hours) <= 0) {
      setFormError('Hours must be a positive number')
      return
    }
    if (formData.yearFrom && formData.yearTo && parseInt(formData.yearFrom) > parseInt(formData.yearTo)) {
      setFormError('Year From cannot be greater than Year To')
      return
    }

    setSaving(true)

    try {
      const url = editingGuide ? `/api/labor-guides/${editingGuide.id}` : '/api/labor-guides'
      const method = editingGuide ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceTypeId: formData.serviceTypeId,
          makeId: formData.makeId || null,
          modelId: formData.modelId || null,
          yearFrom: formData.yearFrom || null,
          yearTo: formData.yearTo || null,
          hours: parseFloat(formData.hours),
        }),
      })

      if (res.ok) {
        toast.success(editingGuide ? 'Labor guide updated' : 'Labor guide created')
        closeFormModal()
        refresh()
      } else {
        const data = await res.json()
        setFormError(data.error || 'Failed to save labor guide')
      }
    } catch {
      setFormError('Failed to save labor guide')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteConfirm.id) return

    try {
      const res = await fetch(`/api/labor-guides/${deleteConfirm.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Labor guide deleted')
        refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete labor guide')
      }
    } catch (error) {
      console.error('Error deleting labor guide:', error)
      toast.error('Failed to delete labor guide')
    } finally {
      setDeleteConfirm({ open: false, id: null, name: '' })
    }
  }

  function getGuideDescription(guide: LaborGuide): string {
    const parts: string[] = []
    if (guide.serviceType) parts.push(guide.serviceType.name)
    if (guide.make) parts.push(guide.make.name)
    if (guide.model) parts.push(guide.model.name)
    if (guide.yearFrom || guide.yearTo) {
      parts.push(`(${guide.yearFrom || '...'}-${guide.yearTo || '...'})`)
    }
    return parts.join(' - ')
  }

  function formatYearRange(yearFrom: number | null, yearTo: number | null): string {
    if (yearFrom && yearTo) return `${yearFrom} - ${yearTo}`
    if (yearFrom) return `${yearFrom}+`
    if (yearTo) return `Up to ${yearTo}`
    return 'All Years'
  }

  if (loading && laborGuides.length === 0) {
    return <PageLoading text="Loading labor guides..." />
  }

  return (
    <ListPageLayout
      module="Settings"
      moduleHref="/settings"
      title="Labor Guides"
      actionContent={
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Labor Guide
        </button>
      }
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search by service type, make, model..."
      filterContent={
        <>
          <select
            value={filterServiceTypeId}
            onChange={(e) => setFilterServiceTypeId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Service Types</option>
            {serviceTypes.map(st => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </select>
          <select
            value={filterMakeId}
            onChange={(e) => setFilterMakeId(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All Makes</option>
            {makes.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {(filterServiceTypeId || filterMakeId) && (
            <button
              onClick={() => { setFilterServiceTypeId(''); setFilterMakeId('') }}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 px-2 py-1.5"
            >
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 m-4 flex flex-col overflow-hidden">
        <table className="w-full">
          <caption className="sr-only">Labor guides list</caption>
          <thead className="table-sticky-header bg-gray-50 dark:bg-gray-900 border-b dark:border-gray-700">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Service Type
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Vehicle Make
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Model
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Year Range
              </th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Hours
              </th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {laborGuides.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">
                  <div className="flex flex-col items-center gap-2">
                    <Clock size={32} className="text-gray-300 dark:text-gray-600" />
                    <p>No labor guides yet</p>
                    <p className="text-sm">Add labor guides to define standard hours for services by vehicle.</p>
                  </div>
                </td>
              </tr>
            ) : (
              laborGuides.map((guide) => (
                <tr key={guide.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="text-blue-500 flex-shrink-0" />
                      <span className="font-medium text-gray-900 dark:text-white">
                        {guide.serviceType?.name || 'Unknown'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {guide.make ? (
                      <div className="flex items-center gap-1.5">
                        <Car size={14} className="text-gray-400" />
                        {guide.make.name}
                      </div>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">All Makes</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {guide.model?.name || (
                      <span className="text-gray-400 dark:text-gray-500">All Models</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                    {formatYearRange(guide.yearFrom, guide.yearTo)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-sm font-medium">
                      <Clock size={12} />
                      {parseFloat(guide.hours).toFixed(2)} hrs
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleEdit(guide)}
                      aria-label={`Edit labor guide for ${guide.serviceType?.name || 'Unknown'}`}
                      className="p-1 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() =>
                        setDeleteConfirm({
                          open: true,
                          id: guide.id,
                          name: getGuideDescription(guide),
                        })
                      }
                      aria-label={`Delete labor guide for ${guide.serviceType?.name || 'Unknown'}`}
                      className="p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded ml-1"
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
          className="border-t dark:border-gray-700 px-4"
        />
      </div>

      {/* Add/Edit Labor Guide Modal */}
      <Modal
        isOpen={showFormModal}
        onClose={closeFormModal}
        title={editingGuide ? 'Edit Labor Guide' : 'New Labor Guide'}
        size="xl"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          {formError && (
            <div className="p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Service Type */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Service Type *</label>
              <select
                value={formData.serviceTypeId}
                onChange={(e) => setFormData({ ...formData, serviceTypeId: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
                required
              >
                <option value="">Select a service type</option>
                {serviceTypes.map(st => (
                  <option key={st.id} value={st.id}>{st.name}</option>
                ))}
              </select>
            </div>

            {/* Vehicle Make */}
            <div>
              <label className="block text-sm font-medium mb-1">Vehicle Make</label>
              <select
                value={formData.makeId}
                onChange={(e) => {
                  setFormData({
                    ...formData,
                    makeId: e.target.value,
                    modelId: '', // Reset model when make changes
                  })
                }}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
              >
                <option value="">All Makes</option>
                {makes.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Leave empty to apply to all makes
              </p>
            </div>

            {/* Vehicle Model */}
            <div>
              <label className="block text-sm font-medium mb-1">Vehicle Model</label>
              <select
                value={formData.modelId}
                onChange={(e) => setFormData({ ...formData, modelId: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700 disabled:opacity-50 disabled:bg-gray-100 dark:disabled:bg-gray-900"
                disabled={!formData.makeId}
              >
                <option value="">All Models</option>
                {filteredModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {formData.makeId ? 'Leave empty to apply to all models' : 'Select a make first'}
              </p>
            </div>

            {/* Year From */}
            <div>
              <label className="block text-sm font-medium mb-1">Year From</label>
              <input
                type="number"
                min="1900"
                max="2100"
                value={formData.yearFrom}
                onChange={(e) => setFormData({ ...formData, yearFrom: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
                placeholder="e.g., 2018"
              />
            </div>

            {/* Year To */}
            <div>
              <label className="block text-sm font-medium mb-1">Year To</label>
              <input
                type="number"
                min="1900"
                max="2100"
                value={formData.yearTo}
                onChange={(e) => setFormData({ ...formData, yearTo: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
                placeholder="e.g., 2024"
              />
            </div>

            {/* Hours */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Labor Hours *</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                value={formData.hours}
                onChange={(e) => setFormData({ ...formData, hours: e.target.value })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-700"
                placeholder="e.g., 2.5"
                required
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Standard labor hours for this service on the specified vehicle
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
            <button
              type="button"
              onClick={closeFormModal}
              className="px-4 py-2 border rounded hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : editingGuide ? 'Update Guide' : 'Create Guide'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleDelete}
        title="Delete Labor Guide"
        message={`Are you sure you want to delete the labor guide for "${deleteConfirm.name}"? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
      />
    </ListPageLayout>
  )
}
