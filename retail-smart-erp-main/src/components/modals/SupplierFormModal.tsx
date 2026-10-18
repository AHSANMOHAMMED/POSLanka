'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Building2, Mail, Phone, MapPin, FileText, AlertTriangle } from 'lucide-react'

type TabType = 'basic' | 'contact' | 'billing'

interface Supplier {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  taxId: string | null
  balance: string
  taxInclusive: boolean
  isActive: boolean
}

interface SupplierFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: (supplier: Supplier) => void
  editSupplier?: Supplier | null
  initialName?: string
}

export function SupplierFormModal({
  isOpen,
  onClose,
  onSaved,
  editSupplier = null,
  initialName = '',
}: SupplierFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('basic')
  const [paymentTemplates, setPaymentTemplates] = useState<{ id: string; name: string }[]>([])
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    taxId: '',
    taxInclusive: false,
    isActive: true,
    paymentTermsTemplateId: '',
  })

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'basic', label: 'Basic Info', icon: <Building2 size={16} /> },
    { key: 'contact', label: 'Contact', icon: <Phone size={16} /> },
    { key: 'billing', label: 'Tax & Billing', icon: <FileText size={16} /> },
  ]

  // Fetch payment templates
  useEffect(() => {
    if (isOpen) {
      fetch('/api/accounting/payment-terms-templates?all=true')
        .then((r) => r.json())
        .then((data) => setPaymentTemplates(Array.isArray(data) ? data : data.data || []))
        .catch(() => {})
    }
  }, [isOpen])

  // Initialize form when modal opens or editSupplier changes
  useEffect(() => {
    if (isOpen) {
      if (editSupplier) {
        const sup = editSupplier as Supplier & { paymentTermsTemplateId?: string | null }
        setFormData({
          name: sup.name,
          email: sup.email || '',
          phone: sup.phone || '',
          address: sup.address || '',
          taxId: sup.taxId || '',
          taxInclusive: sup.taxInclusive,
          isActive: sup.isActive,
          paymentTermsTemplateId: sup.paymentTermsTemplateId || '',
        })
      } else {
        setFormData({
          name: initialName,
          email: '',
          phone: '',
          address: '',
          taxId: '',
          taxInclusive: false,
          isActive: true,
          paymentTermsTemplateId: '',
        })
      }
      setError('')
    }
  }, [isOpen, editSupplier, initialName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.name.trim()) {
      setError('Supplier name is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = editSupplier ? `/api/suppliers/${editSupplier.id}` : '/api/suppliers'
      const method = editSupplier ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email || null,
          phone: formData.phone || null,
          address: formData.address || null,
          taxId: formData.taxId || null,
          taxInclusive: formData.taxInclusive,
          isActive: formData.isActive,
          paymentTermsTemplateId: formData.paymentTermsTemplateId || null,
        }),
      })

      if (res.ok) {
        const supplier = await res.json()
        toast.success(editSupplier ? 'Supplier updated successfully' : 'Supplier created successfully')
        onSaved(supplier)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || `Failed to ${editSupplier ? 'update' : 'create'} supplier`)
      }
    } catch (err) {
      console.error('Error saving supplier:', err)
      setError(`Failed to ${editSupplier ? 'update' : 'create'} supplier`)
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setFormData({
      name: '',
      email: '',
      phone: '',
      address: '',
      taxId: '',
      taxInclusive: false,
      isActive: true,
      paymentTermsTemplateId: '',
    })
    setActiveTab('basic')
    setError('')
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={editSupplier ? 'Edit Supplier' : 'New Supplier'}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="flex flex-col h-full">
        {error && (
          <div className="p-3 mb-4 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded text-sm flex items-center gap-2">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b dark:border-gray-700">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto min-h-[200px] space-y-4">
          {/* Basic Info Tab */}
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">
                  Supplier Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="e.g., ABC Trading, XYZ Supplies"
                  autoFocus
                />
              </div>

              {/* Status (only in edit mode) */}
              {editSupplier && (
                <div className="flex items-center justify-between p-4 border dark:border-gray-700 rounded">
                  <div>
                    <label className="block text-sm font-medium dark:text-gray-200">Supplier Status</label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Inactive suppliers will not appear in supplier dropdowns
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.isActive}
                      onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                    <span className="ml-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                      {formData.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </label>
                </div>
              )}

              {/* Balance info (only in edit mode, read-only) */}
              {editSupplier && (
                <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Current Balance</span>
                    <span className={`text-lg font-semibold ${
                      parseFloat(editSupplier.balance) < 0
                        ? 'text-red-600 dark:text-red-400'
                        : parseFloat(editSupplier.balance) > 0
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-gray-600 dark:text-gray-400'
                    }`}>
                      LKR {parseFloat(editSupplier.balance).toLocaleString()}
                    </span>
                  </div>
                  {parseFloat(editSupplier.balance) < 0 && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      You owe this supplier
                    </p>
                  )}
                  {parseFloat(editSupplier.balance) > 0 && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                      Credit balance with this supplier
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Contact Tab */}
          {activeTab === 'contact' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-200">
                    <Mail size={14} className="inline mr-1" />
                    Email
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="supplier@example.com"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-200">
                    <Phone size={14} className="inline mr-1" />
                    Phone
                  </label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                    className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="+94 77 123 4567"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">
                  <MapPin size={14} className="inline mr-1" />
                  Address
                </label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Full supplier address"
                />
              </div>
            </div>
          )}

          {/* Tax & Billing Tab */}
          {activeTab === 'billing' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">Tax ID / VAT Number</label>
                <input
                  type="text"
                  value={formData.taxId}
                  onChange={(e) => setFormData(prev => ({ ...prev, taxId: e.target.value }))}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="Tax registration number"
                />
              </div>

              <div className="flex items-center p-4 border dark:border-gray-700 rounded">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.taxInclusive}
                    onChange={(e) => setFormData(prev => ({ ...prev, taxInclusive: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm dark:text-gray-200">Tax Inclusive Pricing</span>
                </label>
              </div>

              {formData.taxInclusive && (
                <p className="text-xs text-gray-500 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/20 p-3 rounded">
                  Prices from this supplier include tax. The system will calculate the tax component automatically.
                </p>
              )}

              {paymentTemplates.length > 0 && (
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-200">Payment Terms Template</label>
                  <select
                    value={formData.paymentTermsTemplateId}
                    onChange={(e) => setFormData(prev => ({ ...prev, paymentTermsTemplateId: e.target.value }))}
                    className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Select...</option>
                    {paymentTemplates.map((tpl) => (
                      <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 pt-4 mt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="px-4 py-2 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : editSupplier ? 'Update Supplier' : 'Create Supplier'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
