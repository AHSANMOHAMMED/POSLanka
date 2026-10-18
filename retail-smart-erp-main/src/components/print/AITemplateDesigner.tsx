'use client'

import { useState } from 'react'
import { Sparkles, Loader2, Check, Palette } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { Modal } from '@/components/ui/modal'
import { sanitizeHtml } from '@/lib/utils/sanitize-html'

interface LetterheadDesign {
  name: string
  headerHtml: string
  footerHtml: string
  headerHeight: number
  footerHeight: number
}

interface PrintTemplateDesign {
  name: string
  customCss: string
  description: string
}

interface AITemplateDesignerProps {
  mode: 'letterhead' | 'print-template'
  companyName: string
  documentType?: string
  onApplyLetterhead?: (design: LetterheadDesign) => void
  onApplyTemplate?: (design: PrintTemplateDesign) => void
  isOpen: boolean
  onClose: () => void
}

const STYLE_OPTIONS = [
  { value: 'modern', label: 'Modern', description: 'Clean lines, sans-serif' },
  { value: 'classic', label: 'Classic', description: 'Elegant, serif fonts' },
  { value: 'minimal', label: 'Minimal', description: 'Maximum whitespace' },
  { value: 'corporate', label: 'Corporate', description: 'Bold, professional' },
]

const COLOR_PRESETS = [
  '#2563eb', // Blue
  '#059669', // Green
  '#dc2626', // Red
  '#7c3aed', // Purple
  '#ea580c', // Orange
  '#0891b2', // Teal
  '#4f46e5', // Indigo
  '#1f2937', // Dark Gray
]

export function AITemplateDesigner({
  mode,
  companyName,
  documentType,
  onApplyLetterhead,
  onApplyTemplate,
  isOpen,
  onClose,
}: AITemplateDesignerProps) {
  const [style, setStyle] = useState('modern')
  const [primaryColor, setPrimaryColor] = useState('#2563eb')
  const [industry, setIndustry] = useState('')
  const [generating, setGenerating] = useState(false)
  const [letterheadDesigns, setLetterheadDesigns] = useState<LetterheadDesign[]>([])
  const [templateDesigns, setTemplateDesigns] = useState<PrintTemplateDesign[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setSelectedIndex(null)

    try {
      if (mode === 'letterhead') {
        const res = await fetch('/api/ai/generate-letterhead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyName, primaryColor, style, industry }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Generation failed')
        }

        const data = await res.json()
        setLetterheadDesigns(data.designs || [])
      } else {
        const res = await fetch('/api/ai/generate-print-template', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentType, style, primaryColor, companyName }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Generation failed')
        }

        const data = await res.json()
        setTemplateDesigns(data.templates || [])
      }

      toast.success('Designs generated!')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate designs')
    } finally {
      setGenerating(false)
    }
  }

  function handleApply() {
    if (selectedIndex === null) return

    if (mode === 'letterhead' && onApplyLetterhead) {
      onApplyLetterhead(letterheadDesigns[selectedIndex])
      toast.success('Design applied!')
      onClose()
    } else if (mode === 'print-template' && onApplyTemplate) {
      onApplyTemplate(templateDesigns[selectedIndex])
      toast.success('Template applied!')
      onClose()
    }
  }

  const designs = mode === 'letterhead' ? letterheadDesigns : templateDesigns
  const hasDesigns = designs.length > 0

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'letterhead' ? 'AI Letterhead Designer' : 'AI Template Designer'}
      size="lg"
    >
      <div className="space-y-6">
        {/* Configuration */}
        <div className="space-y-4">
          {/* Style Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Style</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STYLE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStyle(opt.value)}
                  className={`px-3 py-2 rounded border text-sm text-left transition-colors ${
                    style === opt.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                  }`}
                >
                  <span className="font-medium block">{opt.label}</span>
                  <span className="text-xs text-gray-500">{opt.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Color Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              <Palette size={14} className="inline mr-1" />
              Brand Color
            </label>
            <div className="flex items-center gap-2">
              {COLOR_PRESETS.map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setPrimaryColor(color)}
                  className={`w-8 h-8 rounded-full border-2 transition-transform ${
                    primaryColor === color ? 'border-gray-900 dark:border-white scale-110' : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
              <input
                type="color"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-8 h-8 rounded cursor-pointer"
              />
            </div>
          </div>

          {/* Industry */}
          {mode === 'letterhead' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Industry (optional)</label>
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-slate-700 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="e.g. Auto repair, Restaurant, Retail store..."
              />
            </div>
          )}

          {/* Generate Button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="w-full py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 flex items-center justify-center gap-2 font-medium transition-all"
          >
            {generating ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {generating ? 'Generating Designs...' : 'Generate Designs'}
          </button>
        </div>

        {/* Design Previews */}
        {hasDesigns && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Choose a design ({designs.length} generated)
            </h3>
            <div className="grid gap-3">
              {mode === 'letterhead'
                ? letterheadDesigns.map((design, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedIndex(i)}
                      className={`text-left border rounded overflow-hidden transition-all ${
                        selectedIndex === i
                          ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-slate-700/50">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{design.name}</span>
                        {selectedIndex === i && <Check size={16} className="text-blue-600" />}
                      </div>
                      {/* Live preview */}
                      <div className="bg-white p-4 space-y-4 border-t border-gray-100 dark:border-gray-700">
                        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(design.headerHtml) }} />
                        <div className="h-12 flex items-center justify-center">
                          <span className="text-xs text-gray-300 italic">Document content area</span>
                        </div>
                        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(design.footerHtml) }} />
                      </div>
                    </button>
                  ))
                : templateDesigns.map((design, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedIndex(i)}
                      className={`text-left border rounded p-4 transition-all ${
                        selectedIndex === i
                          ? 'border-blue-500 ring-2 ring-blue-200 dark:ring-blue-800'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{design.name}</span>
                        {selectedIndex === i && <Check size={16} className="text-blue-600" />}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{design.description}</p>
                      {/* CSS preview */}
                      <pre className="mt-2 p-2 bg-gray-50 dark:bg-slate-800 rounded text-xs text-gray-600 dark:text-gray-400 overflow-x-auto max-h-24">
                        {design.customCss.substring(0, 200)}...
                      </pre>
                    </button>
                  ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t dark:border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={selectedIndex === null}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm flex items-center gap-2"
          >
            <Check size={14} />
            Use This Design
          </button>
        </div>
      </div>
    </Modal>
  )
}
