'use client'

import { FileText, Hash, Type, FileSignature, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react'
import type { SetupWizardData } from '@/lib/setup/create-seed-data'
import { useStepSuggestions } from './useStepSuggestions'
import { useState } from 'react'

interface StepDocumentsProps {
  data: SetupWizardData
  companySlug: string
  businessType: string
  country: string
  countryName: string
  currency: string
  companyName: string
  onChange: (updates: Partial<SetupWizardData>) => void
  onNext: () => void
  onBack: () => void
}

interface DocumentSuggestion {
  invoicePrefix?: string
  invoiceStartNumber?: number
  quotationPrefix?: string
  quotationStartNumber?: number
  defaultTerms?: string
  defaultNotes?: string
  suggestionNote?: string
}

// Default prefixes by business type
const getDefaultPrefixes = (businessType: string) => {
  switch (businessType) {
    case 'restaurant':
      return { invoice: 'REST-', quotation: 'RQ-' }
    case 'auto_service':
      return { invoice: 'AS-', quotation: 'ASQ-' }
    case 'supermarket':
      return { invoice: 'SM-', quotation: 'SMQ-' }
    case 'retail':
    default:
      return { invoice: 'INV-', quotation: 'QUO-' }
  }
}

export function StepDocuments({ 
  data, 
  companySlug, 
  businessType, 
  country, 
  countryName, 
  currency, 
  companyName, 
  onChange, 
  onNext, 
  onBack 
}: StepDocumentsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  
  const { suggestions, loading, dismissed, dismiss } = useStepSuggestions<DocumentSuggestion>({
    step: 'documents',
    context: { businessType, country, countryName, currency, companyName },
    companySlug,
  })

  const handleApplyAllSuggestions = () => {
    if (!suggestions) return
    
    const updates: Partial<SetupWizardData> = {}
    if (suggestions.invoicePrefix !== undefined) updates.invoicePrefix = suggestions.invoicePrefix
    if (suggestions.invoiceStartNumber !== undefined) updates.invoiceStartNumber = suggestions.invoiceStartNumber
    if (suggestions.quotationPrefix !== undefined) updates.quotationPrefix = suggestions.quotationPrefix
    if (suggestions.quotationStartNumber !== undefined) updates.quotationStartNumber = suggestions.quotationStartNumber
    if (suggestions.defaultTerms !== undefined) updates.defaultTerms = suggestions.defaultTerms
    if (suggestions.defaultNotes !== undefined) updates.defaultNotes = suggestions.defaultNotes
    
    if (Object.keys(updates).length > 0) {
      onChange(updates)
    }
  }

  const defaultPrefixes = getDefaultPrefixes(businessType)

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <FileText size={24} className="text-blue-600" />
          Document Settings
        </h2>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Configure default settings for invoices, quotations, and other business documents.
        </p>
      </div>

      {/* AI Suggestion Banner */}
      {!dismissed.has('documents') && suggestions && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-1">
                AI Suggestions for Document Settings
              </p>
              {suggestions.suggestionNote && (
                <p className="text-xs text-blue-700 dark:text-blue-400 mb-2">
                  {suggestions.suggestionNote}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {suggestions.invoicePrefix && (
                  <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-800/40 text-blue-700 dark:text-blue-300 rounded">
                    Invoice: {suggestions.invoicePrefix}{suggestions.invoiceStartNumber || 'XXXX'}
                  </span>
                )}
                {suggestions.quotationPrefix && (
                  <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-800/40 text-blue-700 dark:text-blue-300 rounded">
                    Quotation: {suggestions.quotationPrefix}{suggestions.quotationStartNumber || 'XXXX'}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleApplyAllSuggestions}
                disabled={loading}
                className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                Apply All
              </button>
              <button
                onClick={() => dismiss('documents')}
                className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Invoice Settings */}
        <div className="border border-gray-200 dark:border-gray-600 rounded p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <FileSignature size={20} className="text-blue-600" />
            Invoice Settings
          </h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Invoice Prefix
              </label>
              <div className="relative">
                <Type className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                <input
                  type="text"
                  value={data.invoicePrefix || defaultPrefixes.invoice}
                  onChange={(e) => onChange({ invoicePrefix: e.target.value })}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., INV-"
                  maxLength={10}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Prefix for invoice numbers (e.g., INV-2024-001)
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Starting Number
              </label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={data.invoiceStartNumber || 1001}
                  onChange={(e) => onChange({ invoiceStartNumber: parseInt(e.target.value) || 1001 })}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                First invoice number (e.g., 1001)
              </p>
            </div>
          </div>
        </div>

        {/* Quotation Settings */}
        <div className="border border-gray-200 dark:border-gray-600 rounded p-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
            <FileText size={20} className="text-blue-600" />
            Quotation Settings
          </h3>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Quotation Prefix
              </label>
              <div className="relative">
                <Type className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                <input
                  type="text"
                  value={data.quotationPrefix || defaultPrefixes.quotation}
                  onChange={(e) => onChange({ quotationPrefix: e.target.value })}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="e.g., QUO-"
                  maxLength={10}
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Prefix for quotation numbers
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Starting Number
              </label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" size={18} />
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={data.quotationStartNumber || 2001}
                  onChange={(e) => onChange({ quotationStartNumber: parseInt(e.target.value) || 2001 })}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                First quotation number (e.g., 2001)
              </p>
            </div>
          </div>
        </div>

        {/* Advanced Settings Toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          {showAdvanced ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          Advanced Document Settings
        </button>

        {showAdvanced && (
          <div className="space-y-4 border border-gray-200 dark:border-gray-600 rounded p-4">
            {/* Default Terms & Conditions */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 flex items-center gap-2">
                <MessageSquare size={16} className="text-blue-600" />
                Default Terms & Conditions
              </label>
              <textarea
                value={data.defaultTerms || ''}
                onChange={(e) => onChange({ defaultTerms: e.target.value })}
                rows={4}
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                placeholder="Enter default terms and conditions that will appear on all documents..."
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                This text will appear at the bottom of invoices and quotations
              </p>
            </div>

            {/* Default Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Default Notes
              </label>
              <textarea
                value={data.defaultNotes || ''}
                onChange={(e) => onChange({ defaultNotes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                placeholder="Enter default notes that will appear on all documents..."
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Additional notes or instructions for customers
              </p>
            </div>
          </div>
        )}

        {/* Validation and Tips */}
        <div className="bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-gray-600 rounded p-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <strong>Tip:</strong> These settings can be changed later from the Settings → Documents section.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Document numbers will auto-increment from the starting numbers you set here.
          </p>
        </div>
      </div>

      <div className="mt-8 flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium"
        >
          Back
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
