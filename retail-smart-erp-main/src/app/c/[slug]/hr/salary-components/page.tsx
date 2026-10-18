'use client'

import { useState, useCallback } from 'react'
import { usePaginatedData } from '@/hooks'
import { toast } from '@/components/ui/toast'
import { Pagination } from '@/components/ui/pagination'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormField, FormInput, FormSelect, FormLabel } from '@/components/ui/form-elements'
import { PermissionGuard } from '@/components/auth/PermissionGuard'
import { Breadcrumb } from '@/components/ui/page-header'
import { Calculator, Plus, Edit2, Loader2, Search, Eye, AlertCircle, Check } from 'lucide-react'

interface SalaryComponent {
  id: string
  name: string
  abbreviation: string
  componentType: 'earning' | 'deduction'
  formulaExpression: string | null
  defaultAmount: string | null
  isStatutory: boolean
  isFlexibleBenefit: boolean
  dependsOnPaymentDays: boolean
  doNotIncludeInTotal: boolean
  isPayableByEmployer: boolean
  description: string | null
  sortOrder: number
  isActive: boolean
  createdAt: string
}

const emptyForm = {
  name: '',
  abbreviation: '',
  componentType: 'earning' as 'earning' | 'deduction',
  formulaExpression: '',
  defaultAmount: '',
  isStatutory: false,
  isFlexibleBenefit: false,
  dependsOnPaymentDays: true,
  doNotIncludeInTotal: false,
  isPayableByEmployer: false,
  description: '',
  sortOrder: 0,
}

export default function SalaryComponentsPage() {
  const [typeFilter, setTypeFilter] = useState('')
  const additionalParams: Record<string, string> = {}
  if (typeFilter) additionalParams.componentType = typeFilter

  const {
    data: components,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<SalaryComponent>({
    endpoint: '/api/salary-components',
    entityType: 'salary-component',
    storageKey: 'salary-components-page-size',
    additionalParams,
  })

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<SalaryComponent | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [previewResult, setPreviewResult] = useState<string | null>(null)
  const [viewComponent, setViewComponent] = useState<SalaryComponent | null>(null)

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm })
    setPreviewResult(null)
    setShowModal(true)
  }

  function openEdit(component: SalaryComponent) {
    setEditing(component)
    setForm({
      name: component.name,
      abbreviation: component.abbreviation,
      componentType: component.componentType,
      formulaExpression: component.formulaExpression || '',
      defaultAmount: component.defaultAmount || '',
      isStatutory: component.isStatutory,
      isFlexibleBenefit: component.isFlexibleBenefit,
      dependsOnPaymentDays: component.dependsOnPaymentDays,
      doNotIncludeInTotal: component.doNotIncludeInTotal,
      isPayableByEmployer: component.isPayableByEmployer,
      description: component.description || '',
      sortOrder: component.sortOrder,
    })
    setPreviewResult(null)
    setShowModal(true)
  }

  function handleCloseModal() {
    setShowModal(false)
    setEditing(null)
    setForm({ ...emptyForm })
    setPreviewResult(null)
  }

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value
    setForm((prev) => {
      // Auto-generate abbreviation from name if user hasn't manually edited it
      // or if abbreviation is currently empty
      const autoAbbr = name
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 10)
      return { ...prev, name, abbreviation: autoAbbr }
    })
  }, [])

  function previewFormula() {
    if (!form.formulaExpression.trim()) {
      setPreviewResult(null)
      return
    }
    try {
      const expression = form.formulaExpression.trim()
      const preview = expression
        .replace(/\bbase\b/g, '50,000')
        .replace(/\bgross\b/g, '65,000')
        .replace(/\bnet\b/g, '55,000')
        .replace(/\bamount\b/g, '10,000')
      setPreviewResult(`With base=50,000, gross=65,000, net=55,000: ${preview}`)
    } catch {
      setPreviewResult('Could not preview formula')
    }
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!form.abbreviation.trim()) {
      toast.error('Abbreviation is required')
      return
    }

    setSaving(true)
    try {
      const url = editing
        ? `/api/salary-components/${editing.id}`
        : '/api/salary-components'
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          abbreviation: form.abbreviation.trim().toUpperCase(),
          componentType: form.componentType,
          formulaExpression: form.formulaExpression.trim() || null,
          defaultAmount: form.defaultAmount ? parseFloat(form.defaultAmount) : null,
          isStatutory: form.isStatutory,
          isFlexibleBenefit: form.isFlexibleBenefit,
          dependsOnPaymentDays: form.dependsOnPaymentDays,
          doNotIncludeInTotal: form.doNotIncludeInTotal,
          isPayableByEmployer: form.isPayableByEmployer,
          description: form.description.trim() || null,
          sortOrder: form.sortOrder,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to save component')
        return
      }

      toast.success(editing ? 'Component updated' : 'Component created')
      handleCloseModal()
      refresh()
    } catch {
      toast.error('Failed to save component')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(component: SalaryComponent) {
    try {
      const res = await fetch(`/api/salary-components/${component.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !component.isActive }),
      })
      if (!res.ok) {
        const err = await res.json()
        toast.error(err.error || 'Failed to update status')
        return
      }
      toast.success(component.isActive ? 'Component deactivated' : 'Component activated')
      refresh()
    } catch {
      toast.error('Failed to update status')
    }
  }

  return (
    <PermissionGuard permission="manageSalaryComponents">
      <div className="p-6 space-y-6">
        <Breadcrumb items={[{ label: 'HR' }, { label: 'Salary Components' }]} />

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search components..."
              className="w-full pl-10 pr-4 py-2 border rounded text-sm"
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 border rounded text-sm"
          >
            <option value="">All Types</option>
            <option value="earning">Earning</option>
            <option value="deduction">Deduction</option>
          </select>
          <div className="flex-1" />
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Component
          </button>
        </div>

        {/* Table */}
        <div className="bg-white rounded border">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : components.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Calculator className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>No salary components found</p>
              <p className="text-xs mt-1">Create your first salary component to get started.</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="table-sticky-header">
                    <tr className="border-b text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Abbr</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Formula / Amount</th>
                      <th className="px-4 py-3">Flags</th>
                      <th className="px-4 py-3 text-center">Sort</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {components.map((comp) => (
                      <tr key={comp.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {comp.name}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                          {comp.abbreviation}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                              comp.componentType === 'earning'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {comp.componentType}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {comp.formulaExpression ? (
                            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                              {comp.formulaExpression}
                            </span>
                          ) : comp.defaultAmount ? (
                            <span>
                              {new Intl.NumberFormat('en-US', {
                                minimumFractionDigits: 2,
                              }).format(Number(comp.defaultAmount))}
                            </span>
                          ) : (
                            <span className="text-gray-400">--</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {comp.isStatutory && (
                              <span
                                title="Statutory"
                                className="inline-flex items-center justify-center w-5 h-5 rounded bg-purple-100 text-purple-700 text-[10px] font-bold"
                              >
                                S
                              </span>
                            )}
                            {comp.isPayableByEmployer && (
                              <span
                                title="Payable by Employer"
                                className="inline-flex items-center justify-center w-5 h-5 rounded bg-orange-100 text-orange-700 text-[10px] font-bold"
                              >
                                E
                              </span>
                            )}
                            {!comp.isStatutory && !comp.isPayableByEmployer && (
                              <span className="text-gray-400 text-xs">--</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-center text-gray-500">
                          {comp.sortOrder}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                              comp.isActive
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            {comp.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setViewComponent(comp)}
                              className="p-1 text-gray-400 hover:text-blue-600"
                              title="View details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openEdit(comp)}
                              className="p-1 text-gray-400 hover:text-blue-600"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleToggleActive(comp)}
                              className={`p-1 ${
                                comp.isActive
                                  ? 'text-gray-400 hover:text-red-600'
                                  : 'text-gray-400 hover:text-green-600'
                              }`}
                              title={comp.isActive ? 'Deactivate' : 'Activate'}
                            >
                              {comp.isActive ? (
                                <AlertCircle className="w-4 h-4" />
                              ) : (
                                <Check className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

        {/* Create/Edit Modal */}
        <Modal
          isOpen={showModal}
          onClose={handleCloseModal}
          title={editing ? 'Edit Salary Component' : 'Create Salary Component'}
          size="lg"
        >
          <div className="space-y-4">
            {/* Name and Abbreviation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField label="Name" required>
                <FormInput
                  value={form.name}
                  onChange={handleNameChange}
                  placeholder="e.g. Basic Salary"
                />
              </FormField>
              <FormField label="Abbreviation" required hint="Auto-generated, editable">
                <FormInput
                  value={form.abbreviation}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      abbreviation: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="e.g. BS"
                  maxLength={10}
                  className="font-mono uppercase"
                />
              </FormField>
            </div>

            {/* Component Type */}
            <FormField label="Component Type" required>
              <FormSelect
                value={form.componentType}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    componentType: e.target.value as 'earning' | 'deduction',
                  }))
                }
              >
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
              </FormSelect>
            </FormField>

            {/* Formula Expression */}
            <FormField
              label="Formula Expression"
              hint="Variables: base, gross, net, amount, {ABBREVIATION}. E.g.: base * 0.08"
            >
              <div className="flex gap-2">
                <FormInput
                  value={form.formulaExpression}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      formulaExpression: e.target.value,
                    }))
                  }
                  placeholder="e.g. base * 0.08"
                  className="flex-1 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={previewFormula}
                  disabled={!form.formulaExpression.trim()}
                  className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  Preview
                </button>
              </div>
              {previewResult && (
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800 font-mono">
                  {previewResult}
                </div>
              )}
            </FormField>

            {/* Default Amount */}
            <FormField
              label="Default Amount"
              hint="Used when no formula is defined"
            >
              <FormInput
                type="number"
                step="0.01"
                min="0"
                value={form.defaultAmount}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, defaultAmount: e.target.value }))
                }
                placeholder="0.00"
              />
            </FormField>

            {/* Checkboxes */}
            <div className="border-t pt-4 mt-4">
              <FormLabel className="mb-3">Options</FormLabel>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isStatutory}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, isStatutory: e.target.checked }))
                    }
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Is Statutory</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isFlexibleBenefit}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        isFlexibleBenefit: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Is Flexible Benefit</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.dependsOnPaymentDays}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        dependsOnPaymentDays: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Depends on Payment Days</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.doNotIncludeInTotal}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        doNotIncludeInTotal: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Do Not Include in Total</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.isPayableByEmployer}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        isPayableByEmployer: e.target.checked,
                      }))
                    }
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Is Payable by Employer</span>
                </label>
              </div>
            </div>

            {/* Description */}
            <FormField label="Description">
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, description: e.target.value }))
                }
                className="w-full px-3 py-2 border rounded text-sm resize-y min-h-[60px]"
                rows={2}
                placeholder="Optional description"
              />
            </FormField>

            {/* Sort Order */}
            <FormField label="Sort Order" hint="Controls display order in salary slips">
              <FormInput
                type="number"
                min="0"
                value={form.sortOrder}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    sortOrder: parseInt(e.target.value) || 0,
                  }))
                }
                placeholder="0"
                className="w-32"
              />
            </FormField>
          </div>

          <ModalFooter>
            <button
              onClick={handleCloseModal}
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

        {/* View Detail Modal */}
        <Modal
          isOpen={!!viewComponent}
          onClose={() => setViewComponent(null)}
          title={viewComponent ? `${viewComponent.name} (${viewComponent.abbreviation})` : ''}
          size="md"
        >
          {viewComponent && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-gray-500 block text-xs mb-0.5">Component Type</span>
                  <span
                    className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                      viewComponent.componentType === 'earning'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {viewComponent.componentType}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs mb-0.5">Status</span>
                  <span
                    className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                      viewComponent.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {viewComponent.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              {viewComponent.formulaExpression && (
                <div>
                  <span className="text-gray-500 block text-xs mb-0.5">Formula</span>
                  <code className="block bg-gray-100 px-2 py-1.5 rounded text-xs font-mono">
                    {viewComponent.formulaExpression}
                  </code>
                </div>
              )}

              {viewComponent.defaultAmount && (
                <div>
                  <span className="text-gray-500 block text-xs mb-0.5">Default Amount</span>
                  <span>
                    {new Intl.NumberFormat('en-US', {
                      minimumFractionDigits: 2,
                    }).format(Number(viewComponent.defaultAmount))}
                  </span>
                </div>
              )}

              <div>
                <span className="text-gray-500 block text-xs mb-1">Properties</span>
                <div className="flex flex-wrap gap-2">
                  {viewComponent.isStatutory && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-700">
                      Statutory
                    </span>
                  )}
                  {viewComponent.isFlexibleBenefit && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-cyan-100 text-cyan-700">
                      Flexible Benefit
                    </span>
                  )}
                  {viewComponent.dependsOnPaymentDays && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-700">
                      Depends on Payment Days
                    </span>
                  )}
                  {viewComponent.doNotIncludeInTotal && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-700">
                      Not Included in Total
                    </span>
                  )}
                  {viewComponent.isPayableByEmployer && (
                    <span className="px-2 py-0.5 text-xs rounded-full bg-orange-100 text-orange-700">
                      Payable by Employer
                    </span>
                  )}
                  {!viewComponent.isStatutory &&
                    !viewComponent.isFlexibleBenefit &&
                    !viewComponent.dependsOnPaymentDays &&
                    !viewComponent.doNotIncludeInTotal &&
                    !viewComponent.isPayableByEmployer && (
                      <span className="text-xs text-gray-400">No special properties</span>
                    )}
                </div>
              </div>

              {viewComponent.description && (
                <div>
                  <span className="text-gray-500 block text-xs mb-0.5">Description</span>
                  <p className="text-gray-700">{viewComponent.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2 border-t">
                <div>
                  <span className="text-gray-500 block text-xs mb-0.5">Sort Order</span>
                  <span>{viewComponent.sortOrder}</span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs mb-0.5">Created</span>
                  <span>{new Date(viewComponent.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          )}

          <ModalFooter>
            <button
              onClick={() => setViewComponent(null)}
              className="px-4 py-2 text-sm border rounded hover:bg-gray-50"
            >
              Close
            </button>
            <button
              onClick={() => {
                if (viewComponent) {
                  setViewComponent(null)
                  openEdit(viewComponent)
                }
              }}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
            >
              <Edit2 className="w-4 h-4" />
              Edit
            </button>
          </ModalFooter>
        </Modal>
      </div>
    </PermissionGuard>
  )
}
