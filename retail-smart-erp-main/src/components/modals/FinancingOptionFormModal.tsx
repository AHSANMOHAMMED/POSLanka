'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { FormInput, FormSelect, FormLabel } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'

interface FinancingOption {
  id: string
  lenderName: string
  contactInfo: string | null
  loanType: string
  minAmount: string | null
  maxAmount: string | null
  minTermMonths: number | null
  maxTermMonths: number | null
  minInterestRate: string | null
  maxInterestRate: string | null
  isActive: boolean
  notes: string | null
}

interface FinancingOptionFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  editItem?: FinancingOption | null
}

const initialFormData = {
  lenderName: '',
  contactInfo: '',
  loanType: 'new_vehicle',
  minAmount: '',
  maxAmount: '',
  minTermMonths: '',
  maxTermMonths: '',
  minInterestRate: '',
  maxInterestRate: '',
  isActive: true,
  notes: '',
}

export function FinancingOptionFormModal({ isOpen, onClose, onSuccess, editItem }: FinancingOptionFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState(initialFormData)

  useEffect(() => {
    if (isOpen) {
      if (editItem) {
        setFormData({
          lenderName: editItem.lenderName || '',
          contactInfo: editItem.contactInfo || '',
          loanType: editItem.loanType || 'new_vehicle',
          minAmount: editItem.minAmount || '',
          maxAmount: editItem.maxAmount || '',
          minTermMonths: editItem.minTermMonths != null ? String(editItem.minTermMonths) : '',
          maxTermMonths: editItem.maxTermMonths != null ? String(editItem.maxTermMonths) : '',
          minInterestRate: editItem.minInterestRate || '',
          maxInterestRate: editItem.maxInterestRate || '',
          isActive: editItem.isActive,
          notes: editItem.notes || '',
        })
      } else {
        resetForm()
      }
    }
  }, [isOpen, editItem])

  function resetForm() {
    setFormData(initialFormData)
    setError('')
  }

  function handleClose() {
    resetForm()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.lenderName.trim()) {
      setError('Lender name is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const isEdit = editItem?.id
      const url = isEdit ? `/api/financing-options/${editItem.id}` : '/api/financing-options'
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lenderName: formData.lenderName.trim(),
          contactInfo: formData.contactInfo || null,
          loanType: formData.loanType,
          minAmount: formData.minAmount ? parseFloat(formData.minAmount) : null,
          maxAmount: formData.maxAmount ? parseFloat(formData.maxAmount) : null,
          minTermMonths: formData.minTermMonths ? parseInt(formData.minTermMonths) : null,
          maxTermMonths: formData.maxTermMonths ? parseInt(formData.maxTermMonths) : null,
          minInterestRate: formData.minInterestRate ? parseFloat(formData.minInterestRate) : null,
          maxInterestRate: formData.maxInterestRate ? parseFloat(formData.maxInterestRate) : null,
          isActive: formData.isActive,
          notes: formData.notes || null,
        }),
      })

      if (res.ok) {
        toast.success(isEdit ? 'Financing option updated' : 'Financing option added')
        onSuccess()
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save financing option')
      }
    } catch {
      setError('Failed to save financing option')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={editItem ? 'Edit Financing Option' : 'Add Financing Option'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Lender Info */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FormLabel htmlFor="lenderName">Lender Name *</FormLabel>
            <FormInput
              id="lenderName"
              value={formData.lenderName}
              onChange={(e) => setFormData(prev => ({ ...prev, lenderName: e.target.value }))}
              placeholder="e.g., First National Bank"
              required
            />
          </div>
          <div>
            <FormLabel htmlFor="loanType">Loan Type</FormLabel>
            <FormSelect
              id="loanType"
              value={formData.loanType}
              onChange={(e) => setFormData(prev => ({ ...prev, loanType: e.target.value }))}
            >
              <option value="new_vehicle">New Vehicle</option>
              <option value="used_vehicle">Used Vehicle</option>
              <option value="refinance">Refinance</option>
              <option value="lease">Lease</option>
              <option value="balloon">Balloon</option>
            </FormSelect>
          </div>
        </div>

        <div>
          <FormLabel htmlFor="contactInfo">Contact Information</FormLabel>
          <FormInput
            id="contactInfo"
            value={formData.contactInfo}
            onChange={(e) => setFormData(prev => ({ ...prev, contactInfo: e.target.value }))}
            placeholder="Phone, email, or contact person"
          />
        </div>

        {/* Rate Range */}
        <div className="border-t dark:border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Interest Rate</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FormLabel htmlFor="minInterestRate">Min Rate (%)</FormLabel>
              <FormInput
                id="minInterestRate"
                type="number"
                value={formData.minInterestRate}
                onChange={(e) => setFormData(prev => ({ ...prev, minInterestRate: e.target.value }))}
                placeholder="e.g., 3.5"
                min="0"
                max="100"
                step="0.01"
              />
            </div>
            <div>
              <FormLabel htmlFor="maxInterestRate">Max Rate (%)</FormLabel>
              <FormInput
                id="maxInterestRate"
                type="number"
                value={formData.maxInterestRate}
                onChange={(e) => setFormData(prev => ({ ...prev, maxInterestRate: e.target.value }))}
                placeholder="e.g., 8.0"
                min="0"
                max="100"
                step="0.01"
              />
            </div>
          </div>
        </div>

        {/* Term Range */}
        <div className="border-t dark:border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Loan Terms</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FormLabel htmlFor="minTermMonths">Min Term (months)</FormLabel>
              <FormInput
                id="minTermMonths"
                type="number"
                value={formData.minTermMonths}
                onChange={(e) => setFormData(prev => ({ ...prev, minTermMonths: e.target.value }))}
                placeholder="e.g., 12"
                min="1"
              />
            </div>
            <div>
              <FormLabel htmlFor="maxTermMonths">Max Term (months)</FormLabel>
              <FormInput
                id="maxTermMonths"
                type="number"
                value={formData.maxTermMonths}
                onChange={(e) => setFormData(prev => ({ ...prev, maxTermMonths: e.target.value }))}
                placeholder="e.g., 84"
                min="1"
              />
            </div>
          </div>
        </div>

        {/* Amount Range */}
        <div className="border-t dark:border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Loan Amount</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FormLabel htmlFor="minAmount">Min Amount</FormLabel>
              <FormInput
                id="minAmount"
                type="number"
                value={formData.minAmount}
                onChange={(e) => setFormData(prev => ({ ...prev, minAmount: e.target.value }))}
                placeholder="e.g., 5000"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <FormLabel htmlFor="maxAmount">Max Amount</FormLabel>
              <FormInput
                id="maxAmount"
                type="number"
                value={formData.maxAmount}
                onChange={(e) => setFormData(prev => ({ ...prev, maxAmount: e.target.value }))}
                placeholder="e.g., 100000"
                min="0"
                step="0.01"
              />
            </div>
          </div>
        </div>

        {/* Status & Notes */}
        <div className="border-t dark:border-gray-700 pt-4">
          <div className="flex items-center gap-2 mb-4">
            <input
              type="checkbox"
              id="isActive"
              checked={formData.isActive}
              onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
            />
            <FormLabel htmlFor="isActive" className="mb-0">Active</FormLabel>
          </div>

          <div>
            <FormLabel htmlFor="financingNotes">Notes</FormLabel>
            <textarea
              id="financingNotes"
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Additional details about this financing option..."
              rows={3}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : editItem ? 'Update' : 'Add Lender'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
