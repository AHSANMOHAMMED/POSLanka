'use client'

import { useState, useEffect, useRef, ReactNode, useCallback } from 'react'
import { X, Printer, Settings2, FileText, Minus, Plus } from 'lucide-react'
import { DocumentType, PaperSize, PrintSettings, PAPER_SIZES, DEFAULT_PRINT_SETTINGS, MAX_MARGIN, MAX_COPIES } from '@/lib/print/types'
import { executePrint, buildPrintStyles } from '@/lib/print/print-executor'
import { toast } from '@/components/ui/toast'

interface PrintPreviewProps {
  isOpen: boolean
  onClose: () => void
  documentType: DocumentType
  title: string
  children: ReactNode
  onPrint?: () => void
}

export function PrintPreview({
  isOpen,
  onClose,
  documentType,
  title,
  children,
  onPrint
}: PrintPreviewProps) {
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS[documentType])
  const [showSettings, setShowSettings] = useState(false)
  const [loading, setLoading] = useState(true)
  const contentRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/print-settings')
      if (res.ok) {
        const allSettings = await res.json()
        if (allSettings[documentType]) {
          setSettings(allSettings[documentType])
        }
      }
    } catch (error) {
      console.error('Failed to load print settings:', error)
    } finally {
      setLoading(false)
    }
  }, [documentType])

  useEffect(() => {
    if (isOpen) {
      loadSettings()
    }
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [isOpen, loadSettings])

  // Keyboard: Escape to close
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Debounced save (500ms)
  function debouncedSave(newSettings: PrintSettings) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => saveSettings(newSettings), 500)
  }

  async function saveSettings(newSettings: PrintSettings) {
    try {
      const res = await fetch('/api/print-settings')
      const allSettings = res.ok ? await res.json() : DEFAULT_PRINT_SETTINGS

      const saveRes = await fetch('/api/print-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...allSettings,
          [documentType]: newSettings
        })
      })
      if (!saveRes.ok) {
        toast.error('Failed to save print settings')
      }
    } catch (error) {
      console.error('Failed to save print settings:', error)
      toast.error('Failed to save print settings')
    }
  }

  function updateSettings(updates: Partial<PrintSettings>) {
    const newSettings = { ...settings, ...updates }
    setSettings(newSettings)
    debouncedSave(newSettings)
  }

  function updateMargin(side: 'top' | 'right' | 'bottom' | 'left', value: number) {
    const clamped = Math.max(0, Math.min(MAX_MARGIN, value))
    const newSettings = {
      ...settings,
      margins: { ...settings.margins, [side]: clamped }
    }
    setSettings(newSettings)
    debouncedSave(newSettings)
  }

  async function handlePrint() {
    if (!contentRef.current) return

    try {
      const paperSize = PAPER_SIZES[settings.paperSize]
      const isLandscape = settings.orientation === 'landscape'
      const width = isLandscape ? paperSize.height : paperSize.width
      const height = isLandscape ? paperSize.width : paperSize.height
      const printStyles = buildPrintStyles(settings, width, height)

      const success = await executePrint(title, printStyles, contentRef.current.innerHTML)
      if (!success) {
        toast.error('Print failed. Please allow popups and try again.')
      }
      onPrint?.()
    } catch {
      toast.error('An error occurred while printing')
    }
  }

  if (!isOpen) return null

  const paperSize = PAPER_SIZES[settings.paperSize]
  const isLandscape = settings.orientation === 'landscape'
  const previewWidth = isLandscape ? paperSize.height : paperSize.width
  const previewHeight = isLandscape ? paperSize.width : paperSize.height

  // Scale preview to fit
  const maxPreviewWidth = 500
  const scale = Math.min(1, maxPreviewWidth / previewWidth)

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2 md:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Print preview for ${title}`}
    >
      <div className="bg-white rounded-md shadow-2xl max-w-6xl w-full max-h-[100dvh] md:max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="w-5 h-5 text-gray-600 shrink-0" />
            <h2 className="text-base md:text-lg font-semibold truncate">Print Preview - {title}</h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`p-2 rounded transition-colors ${
                showSettings ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'
              }`}
              aria-label="Toggle print settings"
              title="Print Settings"
            >
              <Settings2 className="w-5 h-5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded transition-colors"
              aria-label="Close print preview"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          {/* Preview Area */}
          <div className="flex-1 bg-gray-100 p-2 md:p-6 overflow-auto flex items-start justify-center">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            ) : (
              <div
                className="bg-white shadow-lg"
                style={{
                  width: `${previewWidth}mm`,
                  minHeight: `${previewHeight}mm`,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top center',
                  padding: `${settings.margins.top}mm ${settings.margins.right}mm ${settings.margins.bottom}mm ${settings.margins.left}mm`
                }}
              >
                <div ref={contentRef}>
                  {children}
                </div>
              </div>
            )}
          </div>

          {/* Settings Panel */}
          {showSettings && (
            <div className="w-full md:w-72 border-t md:border-t-0 md:border-l bg-white p-4 overflow-y-auto max-h-60 md:max-h-none">
              <h3 className="font-semibold mb-4">Print Settings</h3>

              {/* Paper Size */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="print-paper-size">
                  Paper Size
                </label>
                <select
                  id="print-paper-size"
                  value={settings.paperSize}
                  onChange={(e) => updateSettings({ paperSize: e.target.value as PaperSize })}
                  className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {Object.entries(PAPER_SIZES).map(([key, { label }]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>

              {/* Orientation */}
              <div className="mb-4">
                <span className="block text-sm font-medium text-gray-700 mb-1">
                  Orientation
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateSettings({ orientation: 'portrait' })}
                    className={`flex-1 px-3 py-2 border rounded text-sm font-medium transition-colors ${
                      settings.orientation === 'portrait'
                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'hover:bg-gray-50'
                    }`}
                    aria-pressed={settings.orientation === 'portrait'}
                  >
                    Portrait
                  </button>
                  <button
                    onClick={() => updateSettings({ orientation: 'landscape' })}
                    className={`flex-1 px-3 py-2 border rounded text-sm font-medium transition-colors ${
                      settings.orientation === 'landscape'
                        ? 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'hover:bg-gray-50'
                    }`}
                    aria-pressed={settings.orientation === 'landscape'}
                  >
                    Landscape
                  </button>
                </div>
              </div>

              {/* Copies */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="print-copies">
                  Copies
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => updateSettings({ copies: Math.max(1, settings.copies - 1) })}
                    className="p-2 border rounded hover:bg-gray-50"
                    aria-label="Decrease copies"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <input
                    id="print-copies"
                    type="number"
                    value={settings.copies}
                    onChange={(e) => updateSettings({ copies: Math.max(1, Math.min(MAX_COPIES, parseInt(e.target.value) || 1)) })}
                    className="w-16 px-3 py-2 border rounded text-center"
                    min={1}
                    max={MAX_COPIES}
                  />
                  <button
                    onClick={() => updateSettings({ copies: Math.min(MAX_COPIES, settings.copies + 1) })}
                    className="p-2 border rounded hover:bg-gray-50"
                    aria-label="Increase copies"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Margins */}
              <div className="mb-4">
                <span className="block text-sm font-medium text-gray-700 mb-2">
                  Margins (mm)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                    <div key={side}>
                      <label className="block text-xs text-gray-500 mb-1 capitalize" htmlFor={`margin-${side}`}>
                        {side}
                      </label>
                      <input
                        id={`margin-${side}`}
                        type="number"
                        value={settings.margins[side]}
                        onChange={(e) => updateMargin(side, parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-1 border rounded text-sm"
                        min={0}
                        max={MAX_MARGIN}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Display Options */}
              <div className="mb-4">
                <span className="block text-sm font-medium text-gray-700 mb-2">
                  Display Options
                </span>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.showHeader}
                      onChange={(e) => updateSettings({ showHeader: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Show Header</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.showFooter}
                      onChange={(e) => updateSettings({ showFooter: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Show Footer</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.showLogo}
                      onChange={(e) => updateSettings({ showLogo: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Show Logo</span>
                  </label>
                </div>
              </div>

              {/* Watermark */}
              <div className="mb-4">
                <span className="block text-sm font-medium text-gray-700 mb-2">
                  Watermark
                </span>
                <div className="space-y-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!settings.watermark?.text}
                      onChange={(e) => {
                        if (e.target.checked) {
                          updateSettings({ watermark: { text: 'DRAFT', opacity: 0.08, rotation: -45 } })
                        } else {
                          updateSettings({ watermark: null })
                        }
                      }}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Enable Watermark</span>
                  </label>
                  {settings.watermark?.text && (
                    <>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1" htmlFor="watermark-text">
                          Text
                        </label>
                        <input
                          id="watermark-text"
                          type="text"
                          value={settings.watermark.text}
                          onChange={(e) => {
                            const text = e.target.value.slice(0, 20)
                            updateSettings({ watermark: { ...settings.watermark!, text } })
                          }}
                          className="w-full px-2 py-1 border rounded text-sm"
                          maxLength={20}
                          placeholder="DRAFT"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1" htmlFor="watermark-opacity">
                          Opacity ({Math.round((settings.watermark.opacity || 0.08) * 100)}%)
                        </label>
                        <input
                          id="watermark-opacity"
                          type="range"
                          min={5}
                          max={30}
                          value={Math.round((settings.watermark.opacity || 0.08) * 100)}
                          onChange={(e) => {
                            updateSettings({ watermark: { ...settings.watermark!, opacity: parseInt(e.target.value) / 100 } })
                          }}
                          className="w-full"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-4 md:px-6 py-3 md:py-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handlePrint}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
            aria-label="Print document"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>
        </div>
      </div>
    </div>
  )
}
