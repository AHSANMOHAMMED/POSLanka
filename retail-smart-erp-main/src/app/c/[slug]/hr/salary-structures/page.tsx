'use client'

import { useState, useEffect } from 'react'
import { usePaginatedData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { Pagination } from '@/components/ui/pagination'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormLabel } from '@/components/ui/form-elements'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { Layers, Plus, Edit2, Loader2, Search, GripVertical, Trash2 } from 'lucide-react'

interface SalaryComponent {
  id: string
  name: string
  abbreviation: string
  componentType: 'earning' | 'deduction'
  formulaExpression: string | null
  defaultAmount: string | null
  isActive: boolean
}

interface StructureComponent {
  id?: string
  componentId: string
  overrideFormula?: string
  overrideAmount?: number | null
  sortOrder: number
  isActive?: boolean
  component?: SalaryComponent
}

interface SalaryStructure {
  id: string
  name: string
  description: string | null
  isActive: boolean
  components: StructureComponent[]
  createdAt: string
  updatedAt: string
}

export default function SalaryStructuresPage() {
  const {
    data: structures,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<SalaryStructure>({
    endpoint: '/api/salary-structures',
    entityType: 'salary-structure',
    storageKey: 'salary-structures-page-size',
  })

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<SalaryStructure | null>(null)
  const [saving, setSaving] = useState(false)
  const [allComponents, setAllComponents] = useState<SalaryComponent[]>([])

  const [form, setForm] = useState({
    name: '',
    description: '',
    components: [] as StructureComponent[],
  })

  useEffect(() => {
    fetch('/api/salary-components?all=true&active=true')
      .then((r) => r.json())
      .then((data) => setAllComponents(Array.isArray(data) ? data : data.data || []))
      .catch(() => {})
  }, [])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', description: '', components: [] })
    setShowModal(true)
  }

  function openEdit(structure: SalaryStructure) {
    setEditing(structure)
    setForm({
      name: structure.name,
      description: structure.description || '',
      components: (structure.components || []).map((c, i) => ({
        componentId: c.componentId,
        overrideFormula: c.overrideFormula || '',
        overrideAmount: c.overrideAmount ? Number(c.overrideAmount) : null,
        sortOrder: c.sortOrder ?? i,
      })),
    })
    setShowModal(true)
  }

  function addComponent(componentId: string) {
    if (form.components.some((c) => c.componentId === componentId)) {
      toast.error('Component already added')
      return
    }
    setForm((prev) => ({
      ...prev,
      components: [
        ...prev.components,
        { componentId, sortOrder: prev.components.length, overrideFormula: '' },
      ],
    }))
  }

  function removeComponent(idx: number) {
    setForm((prev) => ({
      ...prev,
      components: prev.components.filter((_, i) => i !== idx),
    }))
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    setSaving(true)
    try {
      const url = editing
        ? `/api/salary-structures/${editing.id}`
        : '/api/salary-structures'
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          components: form.components.map((c, i) => ({
            componentId: c.componentId,
            overrideFormula: c.overrideFormula || null,
            overrideAmount: c.overrideAmount,
            sortOrder: i,
          })),
          ...(editing ? { expectedUpdatedAt: editing.updatedAt } : {}),
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to save')
        return
      }
      toast.success(editing ? 'Structure updated' : 'Structure created')
      setShowModal(false)
      refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function getComponentName(componentId: string) {
    const comp = allComponents.find((c) => c.id === componentId)
    return comp ? `${comp.name} (${comp.abbreviation})` : componentId
  }

  function getComponentType(componentId: string) {
    return allComponents.find((c) => c.id === componentId)?.componentType
  }

  return (
    <PermissionGuard permission="manageSalaryComponents">
      <div className="p-6 space-y-6">
        <Breadcrumb items={[{ label: 'HR' }, { label: 'Salary Structures' }]} />

        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search structures..."
              className="w-full pl-10 pr-4 py-2 border rounded text-sm"
            />
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Structure
          </button>
        </div>

        <div className="bg-white rounded border">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : structures.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Layers className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No salary structures found</p>
            </div>
          ) : (
            <>
              <table className="w-full">
                <thead className="table-sticky-header">
                  <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Components</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 w-20">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {structures.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium">{s.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{s.description || '—'}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className="text-gray-600">{s.components?.length || 0} components</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                          s.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {s.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => openEdit(s)} className="p-1 text-gray-400 hover:text-blue-600">
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination
                page={pagination.page}
                pageSize={pagination.pageSize}
                total={pagination.total}
                totalPages={pagination.totalPages}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                className="border-t px-4"
              />
            </>
          )}
        </div>

        <Modal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          title={editing ? 'Edit Salary Structure' : 'Create Salary Structure'}
          size="lg"
        >
          <div className="space-y-4">
            <FormField>
              <FormLabel required>Name</FormLabel>
              <FormInput
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Standard Monthly Salary"
              />
            </FormField>

            <FormField>
              <FormLabel>Description</FormLabel>
              <textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="w-full px-3 py-2 border rounded text-sm"
                rows={2}
                placeholder="Optional description"
              />
            </FormField>

            <div>
              <FormLabel>Components</FormLabel>
              <div className="mt-2 space-y-2">
                {form.components.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2 border rounded bg-gray-50">
                    <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{getComponentName(c.componentId)}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          getComponentType(c.componentId) === 'earning'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {getComponentType(c.componentId)}
                        </span>
                      </div>
                      <input
                        type="text"
                        value={c.overrideFormula || ''}
                        onChange={(e) => {
                          const updated = [...form.components]
                          updated[idx] = { ...updated[idx], overrideFormula: e.target.value }
                          setForm((p) => ({ ...p, components: updated }))
                        }}
                        placeholder="Override formula (optional)"
                        className="mt-1 w-full px-2 py-1 border rounded text-xs"
                      />
                    </div>
                    <button
                      onClick={() => removeComponent(idx)}
                      className="p-1 text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>

              {allComponents.length > 0 && (
                <div className="mt-3">
                  <select
                    onChange={(e) => {
                      if (e.target.value) addComponent(e.target.value)
                      e.target.value = ''
                    }}
                    className="w-full px-3 py-2 border rounded text-sm text-gray-500"
                    defaultValue=""
                  >
                    <option value="">+ Add component...</option>
                    {allComponents
                      .filter((c) => !form.components.some((fc) => fc.componentId === c.id))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.abbreviation}) — {c.componentType}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          <ModalFooter>
            <button
              onClick={() => setShowModal(false)}
              className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? 'Update' : 'Create'}
            </button>
          </ModalFooter>
        </Modal>
      </div>
    </PermissionGuard>
  )
}
