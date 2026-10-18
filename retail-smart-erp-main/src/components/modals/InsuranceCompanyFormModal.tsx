'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Building2, Phone, Mail, AlertTriangle, Shield, DollarSign } from 'lucide-react'

type TabType = 'basic' | 'contact' | 'settings'

interface InsuranceCompany {
  id: string
  name: string
  shortName: string | null
  phone: string | null
  email: string | null
  claimHotline: string | null
  isPartnerGarage: boolean
  estimateThreshold: string | null
  isActive: boolean
}

interface InsuranceCompanyFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: (company: InsuranceCompany) => void
  editCompany?: InsuranceCompany | null
  initialName?: string
}

export function InsuranceCompanyFormModal({
  isOpen,
  onClose,
  onSaved,
  editCompany = null,
  initialName = '',
}: InsuranceCompanyFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('basic')
  const [formData, setFormData] = useState({
    name: '',
    shortName: '',
    phone: '',
    email: '',
    claimHotline: '',
    isPartnerGarage: false,
    estimateThreshold: '',
    isActive: true,
  })

  const tabs: { key: TabType; label: string; icon: React.ReactNode }[] = [
    { key: 'basic', label: 'Company Info', icon: <Building2 size={16} /> },
    { key: 'contact', label: 'Contact', icon: <Phone size={16} /> },
    { key: 'settings', label: 'Settings', icon: <Shield size={16} /> },
  ]

  // Initialize form when modal opens
  useEffect(() => {
    if (isOpen) {
      if (editCompany) {
        setFormData({
          name: editCompany.name,
          shortName: editCompany.shortName || '',
          phone: editCompany.phone || '',
          email: editCompany.email || '',
          claimHotline: editCompany.claimHotline || '',
          isPartnerGarage: editCompany.isPartnerGarage,
          estimateThreshold: editCompany.estimateThreshold || '',
          isActive: editCompany.isActive,
        })
      } else {
        setFormData({
          name: initialName,
          shortName: '',
          phone: '',
          email: '',
          claimHotline: '',
          isPartnerGarage: false,
          estimateThreshold: '',
          isActive: true,
        })
      }
      setError('')
    }
  }, [isOpen, editCompany, initialName])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.name.trim()) {
      setError('Company name is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const url = editCompany ? `/api/insurance-companies/${editCompany.id}` : '/api/insurance-companies'
      const method = editCompany ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          estimateThreshold: formData.estimateThreshold ? parseFloat(formData.estimateThreshold) : null,
        }),
      })

      if (res.ok) {
        const company = await res.json()
        toast.success(editCompany ? 'Insurance company updated successfully' : 'Insurance company created successfully')
        onSaved(company)
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || `Failed to ${editCompany ? 'update' : 'create'} insurance company`)
      }
    } catch (err) {
      console.error('Error saving insurance company:', err)
      setError(`Failed to ${editCompany ? 'update' : 'create'} insurance company`)
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setFormData({
      name: '',
      shortName: '',
      phone: '',
      email: '',
      claimHotline: '',
      isPartnerGarage: false,
      estimateThreshold: '',
      isActive: true,
    })
    setActiveTab('basic')
    setError('')
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={editCompany ? 'Edit Insurance Company' : 'New Insurance Company'}
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
          {/* Company Info Tab */}
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-200">
                    Company Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="e.g., Sri Lanka Insurance Corporation General"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1 dark:text-gray-200">
                    Short Name / Abbreviation
                  </label>
                  <input
                    type="text"
                    value={formData.shortName}
                    onChange={(e) => setFormData(prev => ({ ...prev, shortName: e.target.value }))}
                    className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                    placeholder="e.g., SLIC"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Used in dropdowns and tables for quick identification
                  </p>
                </div>
              </div>

              {/* Status (only in edit mode) */}
              {editCompany && (
                <div className="flex items-center justify-between p-4 border dark:border-gray-700 rounded">
                  <div>
                    <label className="block text-sm font-medium dark:text-gray-200">Company Status</label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Inactive companies will not appear in insurance dropdowns
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
            </div>
          )}

          {/* Contact Tab */}
          {activeTab === 'contact' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">
                  <Phone size={14} className="inline mr-1" />
                  Main Phone
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="011-XXXXXXX"
                />
              </div>

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
                  placeholder="claims@insurance.com"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">
                  <Phone size={14} className="inline mr-1" />
                  Claim Hotline
                </label>
                <input
                  type="tel"
                  value={formData.claimHotline}
                  onChange={(e) => setFormData(prev => ({ ...prev, claimHotline: e.target.value }))}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="1-800-CLAIMS or 011-XXXXXXX"
                />
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 dark:text-gray-200">
                  <DollarSign size={14} className="inline mr-1" />
                  Estimate Threshold (LKR)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={formData.estimateThreshold}
                  onChange={(e) => setFormData(prev => ({ ...prev, estimateThreshold: e.target.value }))}
                  className="w-full px-3 py-2 border dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                  placeholder="e.g., 50000"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Estimates below this amount may be auto-approved
                </p>
              </div>

              <div className="flex items-start">
                <label className="flex items-center gap-3 cursor-pointer p-4 border dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 w-full">
                  <input
                    type="checkbox"
                    checked={formData.isPartnerGarage}
                    onChange={(e) => setFormData(prev => ({ ...prev, isPartnerGarage: e.target.checked }))}
                    className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-sm font-medium dark:text-gray-200">Partner Garage</span>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Your garage is a partner of this insurance company
                    </p>
                  </div>
                </label>
              </div>

              {formData.isPartnerGarage && (
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded">
                  <p className="text-sm text-green-700 dark:text-green-300">
                    As a partner garage, claims from this company may have expedited processing and direct billing.
                  </p>
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
            {saving ? 'Saving...' : editCompany ? 'Update Company' : 'Create Company'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
