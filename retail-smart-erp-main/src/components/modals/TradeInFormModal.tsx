'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/modal'
import { FormInput, FormSelect, FormLabel } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'

interface TradeIn {
  id: string
  make: string
  model: string
  year: number | null
  vin: string | null
  mileage: number | null
  condition: string
  color: string | null
  appraisalValue: string | null
  tradeInAllowance: string | null
  status: string
  conditionNotes: string | null
}

interface TradeInFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  editItem?: TradeIn | null
}

const initialFormData = {
  make: '',
  model: '',
  year: '',
  vin: '',
  mileage: '',
  condition: 'good',
  color: '',
  appraisalValue: '',
  tradeInAllowance: '',
  status: 'pending',
  conditionNotes: '',
}

export function TradeInFormModal({ isOpen, onClose, onSuccess, editItem }: TradeInFormModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState(initialFormData)

  useEffect(() => {
    if (isOpen) {
      if (editItem) {
        setFormData({
          make: editItem.make || '',
          model: editItem.model || '',
          year: editItem.year != null ? String(editItem.year) : '',
          vin: editItem.vin || '',
          mileage: editItem.mileage != null ? String(editItem.mileage) : '',
          condition: editItem.condition || 'good',
          color: editItem.color || '',
          appraisalValue: editItem.appraisalValue || '',
          tradeInAllowance: editItem.tradeInAllowance || '',
          status: editItem.status || 'pending',
          conditionNotes: editItem.conditionNotes || '',
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

    if (!formData.make.trim()) {
      setError('Make is required')
      return
    }
    if (!formData.model.trim()) {
      setError('Model is required')
      return
    }

    setSaving(true)
    setError('')

    try {
      const isEdit = editItem?.id
      const url = isEdit ? `/api/trade-ins/${editItem.id}` : '/api/trade-ins'
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          make: formData.make.trim(),
          model: formData.model.trim(),
          year: formData.year ? parseInt(formData.year) : null,
          vin: formData.vin || null,
          mileage: formData.mileage ? parseInt(formData.mileage) : null,
          condition: formData.condition,
          color: formData.color || null,
          appraisalValue: formData.appraisalValue ? parseFloat(formData.appraisalValue) : null,
          tradeInAllowance: formData.tradeInAllowance ? parseFloat(formData.tradeInAllowance) : null,
          status: formData.status,
          conditionNotes: formData.conditionNotes || null,
        }),
      })

      if (res.ok) {
        toast.success(isEdit ? 'Valuation updated' : 'Trade-in valuation created')
        onSuccess()
        handleClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to save trade-in valuation')
      }
    } catch {
      setError('Failed to save trade-in valuation')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={editItem ? 'Edit Trade-In Valuation' : 'New Trade-In Valuation'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-600 rounded text-sm dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Vehicle Info */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <FormLabel htmlFor="tradeInMake">Make *</FormLabel>
            <FormInput
              id="tradeInMake"
              value={formData.make}
              onChange={(e) => setFormData(prev => ({ ...prev, make: e.target.value }))}
              placeholder="e.g., Toyota"
              required
            />
          </div>
          <div>
            <FormLabel htmlFor="tradeInModel">Model *</FormLabel>
            <FormInput
              id="tradeInModel"
              value={formData.model}
              onChange={(e) => setFormData(prev => ({ ...prev, model: e.target.value }))}
              placeholder="e.g., Camry"
              required
            />
          </div>
          <div>
            <FormLabel htmlFor="tradeInYear">Year</FormLabel>
            <FormInput
              id="tradeInYear"
              type="number"
              value={formData.year}
              onChange={(e) => setFormData(prev => ({ ...prev, year: e.target.value }))}
              placeholder="e.g., 2020"
              min="1900"
              max="2100"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <FormLabel htmlFor="tradeInVin">VIN</FormLabel>
            <FormInput
              id="tradeInVin"
              value={formData.vin}
              onChange={(e) => setFormData(prev => ({ ...prev, vin: e.target.value.toUpperCase() }))}
              placeholder="17-character VIN"
              maxLength={17}
            />
          </div>
          <div>
            <FormLabel htmlFor="tradeInColor">Color</FormLabel>
            <FormInput
              id="tradeInColor"
              value={formData.color}
              onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
              placeholder="e.g., Silver"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <FormLabel htmlFor="tradeInMileage">Mileage</FormLabel>
            <FormInput
              id="tradeInMileage"
              type="number"
              value={formData.mileage}
              onChange={(e) => setFormData(prev => ({ ...prev, mileage: e.target.value }))}
              placeholder="e.g., 50000"
              min="0"
            />
          </div>
          <div>
            <FormLabel htmlFor="tradeInCondition">Condition</FormLabel>
            <FormSelect
              id="tradeInCondition"
              value={formData.condition}
              onChange={(e) => setFormData(prev => ({ ...prev, condition: e.target.value }))}
            >
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </FormSelect>
          </div>
        </div>

        {/* Valuation */}
        <div className="border-t dark:border-gray-700 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Valuation</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <FormLabel htmlFor="appraisalValue">Appraisal Value</FormLabel>
              <FormInput
                id="appraisalValue"
                type="number"
                value={formData.appraisalValue}
                onChange={(e) => setFormData(prev => ({ ...prev, appraisalValue: e.target.value }))}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <FormLabel htmlFor="tradeInAllowance">Trade-In Allowance</FormLabel>
              <FormInput
                id="tradeInAllowance"
                type="number"
                value={formData.tradeInAllowance}
                onChange={(e) => setFormData(prev => ({ ...prev, tradeInAllowance: e.target.value }))}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <FormLabel htmlFor="tradeInStatus">Status</FormLabel>
              <FormSelect
                id="tradeInStatus"
                value={formData.status}
                onChange={(e) => setFormData(prev => ({ ...prev, status: e.target.value }))}
              >
                <option value="pending">Pending</option>
                <option value="appraised">Appraised</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
                <option value="completed">Completed</option>
              </FormSelect>
            </div>
          </div>
        </div>

        {/* Condition Notes */}
        <div>
          <FormLabel htmlFor="conditionNotes">Condition Notes</FormLabel>
          <textarea
            id="conditionNotes"
            value={formData.conditionNotes}
            onChange={(e) => setFormData(prev => ({ ...prev, conditionNotes: e.target.value }))}
            placeholder="Describe the vehicle's condition, damage, wear, etc."
            rows={4}
            className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
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
            {saving ? 'Saving...' : editItem ? 'Update Valuation' : 'Create Valuation'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
