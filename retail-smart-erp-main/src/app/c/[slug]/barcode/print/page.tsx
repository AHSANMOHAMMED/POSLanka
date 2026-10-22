'use client'

import { useState, useEffect, useCallback } from 'react'
import { Printer, Minus, Plus, X, Search, Tag, Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import { AsyncCreatableSelect } from '@/components/ui/async-creatable-select'
import { LabelPreview } from '@/components/labels/LabelPreview'
import { printLabels, printLabelsRaw, isRawLabelPrinter } from '@/lib/labels/label-print'
import { usePrinters } from '@/hooks/usePrinter'
import { LABEL_LANGUAGE_LABELS } from '@/lib/print/printer-profiles'
import { PrinterSettingsModal } from '@/components/pos/PrinterSettingsModal'
import { toast } from '@/components/ui/toast'
import { useTenantCurrency } from '@/hooks'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import type { LabelTemplate, LabelItemData, PrintLabelConfig } from '@/lib/labels/types'
import type { AsyncSelectOption } from '@/components/ui/async-creatable-select'

interface ItemWithQty {
  item: LabelItemData
  quantity: number
}

export default function BarcodePrintPage() {
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [items, setItems] = useState<ItemWithQty[]>([])
  const [searchValue, setSearchValue] = useState('')
  const [codeWord, setCodeWord] = useState<string>('')
  const [previewIndex, setPreviewIndex] = useState(0)
  const [showFullPreview, setShowFullPreview] = useState(false)
  const [config, setConfig] = useState<PrintLabelConfig>({
    labelsPerRow: 3,
    gapMm: 3,
    pageSize: 'Label',
  })

  const { symbol: currencySymbol } = useTenantCurrency()
  const company = useCompanyOptional()

  // Label printers configured on this terminal (W9). '' = browser print dialog.
  const { printers } = usePrinters()
  const labelPrinters = printers.filter((p) => p.role === 'label')
  const [printerChoice, setPrinterChoice] = useState<string | null>(null)
  const [showPrinterSettings, setShowPrinterSettings] = useState(false)
  const [printing, setPrinting] = useState(false)
  const defaultPrinterId = labelPrinters.find((p) => isRawLabelPrinter(p))?.id || ''
  const chosenPrinterId = printerChoice ?? defaultPrinterId
  const chosenPrinter = labelPrinters.find((p) => p.id === chosenPrinterId) || null

  // Fetch templates and label settings on mount
  useEffect(() => {
    fetch('/api/label-templates')
      .then(r => r.json())
      .then((data: LabelTemplate[]) => {
        setTemplates(data)
        const defaultTpl = data.find(t => t.isDefault) || data[0]
        if (defaultTpl) setSelectedTemplateId(defaultTpl.id)
      })
      .catch(() => toast.error('Failed to load templates'))

    fetch('/api/label-settings')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(data => setCodeWord(data.codeWord || ''))
      .catch(() => {})
  }, [])

  const searchItems = useCallback(async (search: string): Promise<AsyncSelectOption[]> => {
    const params = new URLSearchParams({ pageSize: '15' })
    if (search) params.set('search', search)
    const res = await fetch(`/api/items?${params}`)
    const result = await res.json()
    const data = result.data || result
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return data.map((item: any) => ({
      value: item.id,
      label: `${item.name}${item.sku ? ` (${item.sku})` : ''}${item.barcode ? ` [${item.barcode}]` : ''}`,
      data: {
        name: item.name || '',
        sku: item.sku || null,
        barcode: item.barcode || null,
        sellingPrice: String(item.sellingPrice ?? '0'),
        costPrice: String(item.costPrice ?? '0'),
        brand: item.brand || null,
        oemPartNumber: item.oemPartNumber || null,
        pluCode: item.pluCode || null,
        category: item.category?.name || null,
        unit: item.unit || 'pcs',
        weight: item.weight ? String(item.weight) : null,
        dimensions: item.dimensions || null,
        imageUrl: item.imageUrl || null,
      },
    }))
  }, [])

  function handleItemSelect(value: string, option: AsyncSelectOption | null) {
    if (!option || !value) return

    // Check if already in list
    const existing = items.find(i => i.item.id === value)
    if (existing) {
      setItems(prev => prev.map(i =>
        i.item.id === value ? { ...i, quantity: i.quantity + 1 } : i
      ))
    } else {
      const d = option.data || {}
      setItems(prev => [...prev, {
        item: {
          id: value,
          name: (d.name as string) || option.label,
          sku: (d.sku as string) || null,
          barcode: (d.barcode as string) || null,
          sellingPrice: (d.sellingPrice as string) || '0',
          costPrice: (d.costPrice as string) || '0',
          brand: (d.brand as string) || null,
          oemPartNumber: (d.oemPartNumber as string) || null,
          pluCode: (d.pluCode as string) || null,
          category: (d.category as string) || null,
          unit: (d.unit as string) || 'pcs',
          weight: (d.weight as string) || null,
          dimensions: (d.dimensions as string) || null,
          imageUrl: (d.imageUrl as string) || null,
        },
        quantity: 1,
      }])
    }

    // Clear search
    setSearchValue('')
  }

  function updateQuantity(index: number, qty: number) {
    setItems(prev => prev.map((item, i) =>
      i === index ? { ...item, quantity: Math.max(1, Math.min(999, qty)) } : item
    ))
  }

  function removeItem(index: number) {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)
  const totalLabels = items.reduce((sum, i) => sum + i.quantity, 0)

  async function handlePrint() {
    if (!selectedTemplate) {
      toast.error('Please select a template')
      return
    }
    if (items.length === 0) {
      toast.error('Please add items to print')
      return
    }
    if (isRawLabelPrinter(chosenPrinter)) {
      setPrinting(true)
      try {
        const res = await printLabelsRaw(chosenPrinter, selectedTemplate, items, {
          currencySymbol,
          tenantName: company?.tenantName,
          codeWord,
        })
        if (res.warnings.length) toast.warning(res.warnings.slice(0, 3).join('; '))
        if (res.ok) toast.success(`Sent ${totalLabels} label${totalLabels !== 1 ? 's' : ''} to ${chosenPrinter.name}`)
        else toast.error(`Label printer: ${res.error || 'failed'}`)
      } catch {
        toast.error('Failed to generate labels')
      } finally {
        setPrinting(false)
      }
      return
    }
    try {
      const success = await printLabels(
        selectedTemplate,
        items,
        config,
        currencySymbol,
        company?.tenantName,
        codeWord
      )
      if (!success) {
        toast.error('Failed to open print dialog')
      }
    } catch {
      toast.error('Failed to generate labels')
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Print Barcode Labels</h1>
          <p className="text-sm text-gray-500 mt-0.5">Search items, configure labels, and print</p>
        </div>
        <button
          onClick={handlePrint}
          disabled={!selectedTemplate || items.length === 0 || printing}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 font-medium"
        >
          <Printer size={16} />
          Print Labels
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Items List */}
        <div className="lg:col-span-2 space-y-3">
          {/* Item search */}
          <div className="bg-white rounded-lg border p-4">
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              <Search size={14} className="inline mr-1" />
              Search & Add Items
            </label>
            <AsyncCreatableSelect
              fetchOptions={searchItems}
              value={searchValue}
              onChange={handleItemSelect}
              placeholder="Search by name, SKU, or barcode..."
            />
          </div>

          {/* Items table */}
          <div className="bg-white rounded-lg border list-container-xl">
            <table className="w-full">
              <caption className="sr-only">Items to print barcode labels for</caption>
              <thead className="bg-gray-50 table-sticky-header">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Item</th>
                  <th scope="col" className="px-4 py-3 text-left text-sm font-medium text-gray-600">Barcode</th>
                  <th scope="col" className="px-4 py-3 text-right text-sm font-medium text-gray-600">Price</th>
                  <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-36">Quantity</th>
                  <th scope="col" className="px-4 py-3 text-center text-sm font-medium text-gray-600 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-gray-400">
                      <Tag size={32} className="mx-auto mb-2 opacity-40" />
                      <div>No items added yet</div>
                      <div className="text-xs mt-1">Search for items above to add them to the print list</div>
                    </td>
                  </tr>
                ) : (
                  items.map((row, idx) => (
                    <tr key={row.item.id} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-sm">{row.item.name}</div>
                        {row.item.sku && <div className="text-xs text-gray-500">SKU: {row.item.sku}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-sm text-gray-600 font-mono">
                        {row.item.barcode || <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-sm font-medium">
                        {currencySymbol}{parseFloat(row.item.sellingPrice).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => updateQuantity(idx, row.quantity - 1)}
                            className="p-1 text-gray-500 hover:text-gray-700 border rounded"
                            disabled={row.quantity <= 1}
                          >
                            <Minus size={12} />
                          </button>
                          <input
                            type="number"
                            value={row.quantity}
                            onChange={(e) => updateQuantity(idx, Number(e.target.value))}
                            className="w-14 px-2 py-1 text-sm text-center border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            min={1}
                            max={999}
                          />
                          <button
                            onClick={() => updateQuantity(idx, row.quantity + 1)}
                            className="p-1 text-gray-500 hover:text-gray-700 border rounded"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <button
                          onClick={() => removeItem(idx)}
                          className="p-1 text-gray-400 hover:text-red-600 rounded"
                          title="Remove item"
                        >
                          <X size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {items.length > 0 && (
              <div className="px-4 py-2 border-t bg-gray-50 text-sm text-gray-600">
                {items.length} item{items.length !== 1 ? 's' : ''} &middot; {totalLabels} label{totalLabels !== 1 ? 's' : ''} total
              </div>
            )}
          </div>
        </div>

        {/* Right: Template & Preview */}
        <div className="space-y-3">
          {/* Template selector */}
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Printer</label>
                <button
                  type="button"
                  onClick={() => setShowPrinterSettings(true)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Manage printers
                </button>
              </div>
              <select
                value={chosenPrinterId}
                onChange={(e) => setPrinterChoice(e.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
              >
                <option value="">Browser print dialog</option>
                {labelPrinters.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({LABEL_LANGUAGE_LABELS[p.label.language]}, {p.label.dpi} dpi)
                  </option>
                ))}
              </select>
              {chosenPrinter && !isRawLabelPrinter(chosenPrinter) && (
                <p className="text-xs text-gray-500 mt-1">This printer uses the browser print dialog.</p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Template</label>
              <select
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
              >
                <option value="">Select a template</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({parseFloat(String(t.widthMm))} x {parseFloat(String(t.heightMm))} mm)
                    {t.isDefault ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Page Size</label>
              <select
                value={config.pageSize}
                onChange={(e) => setConfig({ ...config, pageSize: e.target.value as 'Label' | 'A4' | 'Letter' })}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
              >
                <option value="Label">
                  Label{selectedTemplate ? ` (${parseFloat(String(selectedTemplate.widthMm))} x ${parseFloat(String(selectedTemplate.heightMm))} mm)` : ''}
                </option>
                <option value="A4">A4 (Sheet)</option>
                <option value="Letter">Letter (Sheet)</option>
              </select>
            </div>
            {config.pageSize !== 'Label' && !isRawLabelPrinter(chosenPrinter) && (
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">Gap (mm)</label>
                <input
                  type="number"
                  value={config.gapMm}
                  onChange={(e) => setConfig({ ...config, gapMm: Math.max(0, Math.min(20, Number(e.target.value))) })}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                  min={0}
                  max={20}
                />
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                <Eye size={15} className="text-blue-600" />
                Label Preview
              </h3>
              {selectedTemplate && (
                <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                  {parseFloat(String(selectedTemplate.widthMm))} × {parseFloat(String(selectedTemplate.heightMm))} mm
                </span>
              )}
            </div>

            {selectedTemplate ? (
              <div className="space-y-3">
                {items.length > 1 && (
                  <div className="flex items-center justify-between bg-slate-50 border rounded px-2.5 py-1.5 text-xs text-slate-700">
                    <button
                      type="button"
                      onClick={() => setPreviewIndex((prev) => Math.max(0, prev - 1))}
                      disabled={previewIndex <= 0}
                      className="p-1 hover:bg-slate-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="font-medium truncate max-w-[200px]">
                      {previewIndex + 1}/{items.length}: {items[previewIndex]?.item.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreviewIndex((prev) => Math.min(items.length - 1, prev + 1))}
                      disabled={previewIndex >= items.length - 1}
                      className="p-1 hover:bg-slate-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                )}

                <div className="p-4 bg-slate-100/70 dark:bg-slate-800/50 rounded-lg flex flex-col items-center justify-center border border-dashed border-gray-200 dark:border-gray-700 min-h-[160px]">
                  <LabelPreview
                    template={selectedTemplate}
                    item={items[previewIndex]?.item || null}
                    currencySymbol={currencySymbol}
                    tenantName={company?.tenantName}
                    codeWord={codeWord}
                    maxWidth={320}
                  />
                  {items.length === 0 && (
                    <p className="text-[11px] text-gray-400 mt-2 italic">Sample preview • Add items on left to preview actual products</p>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
                  <span>Target: <strong className="text-gray-700">{chosenPrinter ? chosenPrinter.name : 'Browser print'}</strong></span>
                  <button
                    type="button"
                    onClick={() => setShowFullPreview(true)}
                    className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    <Eye size={12} />
                    Enlarge preview
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">
                Select a template above to see preview
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Full Preview Modal */}
      {showFullPreview && selectedTemplate && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Label Preview (100% scale)</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {selectedTemplate.name} ({parseFloat(String(selectedTemplate.widthMm))} × {parseFloat(String(selectedTemplate.heightMm))} mm)
                </p>
              </div>
              <button
                onClick={() => setShowFullPreview(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center overflow-auto max-h-[60vh]">
              <div className="shadow-md bg-white p-2 rounded">
                <LabelPreview
                  template={selectedTemplate}
                  item={items[previewIndex]?.item || null}
                  currencySymbol={currencySymbol}
                  tenantName={company?.tenantName}
                  codeWord={codeWord}
                  maxWidth={450}
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-gray-500">
                {items[previewIndex] ? items[previewIndex].item.name : 'Sample product preview'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowFullPreview(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded border"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowFullPreview(false)
                    handlePrint()
                  }}
                  disabled={items.length === 0 || printing}
                  className="px-3 py-1.5 text-xs text-white bg-green-600 hover:bg-green-700 rounded font-medium flex items-center gap-1 disabled:opacity-50"
                >
                  <Printer size={13} />
                  Print Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PrinterSettingsModal isOpen={showPrinterSettings} onClose={() => setShowPrinterSettings(false)} />
    </div>
  )
}
