'use client'

import { useState, useEffect, useCallback } from 'react'
import { Printer, Minus, Plus } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { LabelPreview } from './LabelPreview'
import { isRawLabelPrinter, printLabels, printLabelsOnRoll, printLabelsRaw } from '@/lib/labels/label-print'
import { toast } from '@/components/ui/toast'
import { useTenantCurrency } from '@/hooks'
import { usePrinters } from '@/hooks/usePrinter'
import { defaultStickerSetup, sanitizeStickerSetups, type StickerSetup } from '@/lib/labels/sticker-stock'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import type { LabelTemplate, LabelItemData, PrintLabelConfig } from '@/lib/labels/types'

interface PrintLabelsModalProps {
  isOpen: boolean
  onClose: () => void
  selectedItemIds: string[]
}

interface ItemWithQty {
  item: LabelItemData
  quantity: number
}

export function PrintLabelsModal({ isOpen, onClose, selectedItemIds }: PrintLabelsModalProps) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [items, setItems] = useState<ItemWithQty[]>([])
  const [loading, setLoading] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [codeWord, setCodeWord] = useState<string>('')
  const [setups, setSetups] = useState<StickerSetup[]>([])
  const [config, setConfig] = useState<PrintLabelConfig>({
    labelsPerRow: 3,
    gapMm: 3,
    pageSize: 'Label',
  })

  const { symbol: currencySymbol } = useTenantCurrency()
  const company = useCompanyOptional()
  const { printers } = usePrinters()
  const labelPrinter = printers.find((printer) => printer.role === 'label') || null

  // Fetch templates and label settings on open, reset state on close
  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes to avoid stale data
      setTemplates([])
      setSelectedTemplateId('')
      setItems([])
      setCodeWord('')
      setSetups([])
      return
    }
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
      .then(data => {
        setCodeWord(data.codeWord || '')
        setSetups(sanitizeStickerSetups(data.stickerSetups))
      })
      .catch(() => {})
  }, [isOpen])

  // Fetch items and transform API shape to LabelItemData
  const fetchItems = useCallback(async () => {
    if (!isOpen || selectedItemIds.length === 0) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ ids: selectedItemIds.join(',') })
      const res = await fetch(`/api/items?${params}`)
      if (res.ok) {
        const data = await res.json()
        const itemsList = Array.isArray(data) ? data : data.data || []
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setItems(itemsList.map((raw: any) => ({
          item: {
            id: raw.id,
            name: raw.name || '',
            sku: raw.sku || null,
            barcode: raw.barcode || null,
            sellingPrice: String(raw.sellingPrice ?? '0'),
            costPrice: String(raw.costPrice ?? '0'),
            brand: raw.brand || null,
            oemPartNumber: raw.oemPartNumber || null,
            pluCode: raw.pluCode || null,
            category: raw.category?.name || null,
            unit: raw.unit || 'pcs',
            weight: raw.weight ? String(raw.weight) : null,
            dimensions: raw.dimensions || null,
            imageUrl: raw.imageUrl || null,
          } as LabelItemData,
          quantity: 1,
        })))
      }
    } catch {
      toast.error('Failed to load items')
    } finally {
      setLoading(false)
    }
  }, [isOpen, selectedItemIds])

  useEffect(() => { fetchItems() }, [fetchItems])

  const selectedTemplate = templates.find(t => t.id === selectedTemplateId)
  const totalLabels = items.reduce((sum, i) => sum + i.quantity, 0)

  // Sticker-roll setup: the printer's linked setup, else the tenant default.
  // Drives multi-across roll placement for raw (TSPL/ZPL) and browser printing.
  const linkedSetupId = labelPrinter?.label?.stickerSetupId || null
  const activeSetup: StickerSetup | null =
    (linkedSetupId ? setups.find(s => s.id === linkedSetupId) || null : null) || defaultStickerSetup(setups)

  function updateQuantity(index: number, qty: number) {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, quantity: Math.max(1, Math.min(999, qty)) } : item))
  }

  async function handlePrint() {
    if (!selectedTemplate) {
      toast.error('Please select a template')
      return
    }
    if (items.length === 0) {
      toast.error('Please add items to print')
      return
    }
    const template = selectedTemplate

    setPrinting(true)
    try {
      if (labelPrinter && isRawLabelPrinter(labelPrinter)) {
        try {
          const result = await printLabelsRaw(labelPrinter, template, items, {
            currencySymbol,
            tenantName: company?.tenantName,
            codeWord,
            ...(activeSetup ? { setup: activeSetup } : {}),
          })
          if (result.warnings.length) {
            toast.warning(result.warnings.slice(0, 3).join('; '))
          }
          if (result.ok) {
            toast.success(`Sent ${totalLabels} label${totalLabels !== 1 ? 's' : ''} to ${labelPrinter.name}`)
            return
          }
          toast.warning(`USB printer: ${result.error || 'held by OS'}. Opening OS Print Dialog...`)
        } catch {
          toast.warning('USB connection issue. Opening OS Print Dialog...')
        }
        // Seamless fallback to the OS / browser print dialog (same as the barcode page)
        const fallback = await printViaDialog()
        if (!fallback) toast.error('Failed to open print dialog')
        return
      }

      const success = await printViaDialog()
      if (!success) {
        toast.error('Failed to open print dialog')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to generate labels')
    } finally {
      setPrinting(false)
    }

    async function printViaDialog(): Promise<boolean> {
      if (config.pageSize === 'Label' && activeSetup) {
        return printLabelsOnRoll(template, items, activeSetup, currencySymbol, company?.tenantName, codeWord)
      }
      return printLabels(
        template,
        items,
        config,
        currencySymbol,
        company?.tenantName,
        codeWord
      )
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Print Barcode Labels"
      size="3xl"
    >
      <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
        {/* Template selector */}
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="text-sm font-medium text-gray-700 mb-1 block">Template</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              className="px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="Label">
                Label{selectedTemplate ? ` (${parseFloat(String(selectedTemplate.widthMm))} x ${parseFloat(String(selectedTemplate.heightMm))} mm)` : ''}
              </option>
              <option value="A4">A4 (Sheet)</option>
              <option value="Letter">Letter (Sheet)</option>
            </select>
          </div>
          {config.pageSize !== 'Label' && (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">Gap (mm)</label>
              <input
                type="number"
                value={config.gapMm}
                onChange={(e) => setConfig({ ...config, gapMm: Math.max(0, Math.min(20, Number(e.target.value))) })}
                className="w-20 px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                min={0}
                max={20}
              />
            </div>
          )}
        </div>

        {/* Items table */}
        <div className="border rounded">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-sm font-medium text-gray-600">Item</th>
                <th className="px-3 py-2 text-left text-sm font-medium text-gray-600">Barcode</th>
                <th className="px-3 py-2 text-right text-sm font-medium text-gray-600">Price</th>
                <th className="px-3 py-2 text-center text-sm font-medium text-gray-600 w-32">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-gray-500">Loading items...</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-gray-500">No items selected</td>
                </tr>
              ) : (
                items.map((row, idx) => (
                  <tr key={row.item.id} className="border-t">
                    <td className="px-3 py-2">
                      <div className="font-medium text-sm">{row.item.name}</div>
                      {row.item.sku && <div className="text-xs text-gray-500">SKU: {row.item.sku}</div>}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-600 font-mono">
                      {row.item.barcode || '-'}
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-medium">
                      {currencySymbol}{parseFloat(row.item.sellingPrice).toFixed(2)}
                    </td>
                    <td className="px-3 py-2">
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Preview */}
        {selectedTemplate && items.length > 0 && (
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Preview (first item)</h4>
            <LabelPreview
              template={selectedTemplate}
              item={items[0]?.item}
              currencySymbol={currencySymbol}
              tenantName={company?.tenantName}
              codeWord={codeWord}
              maxWidth={350}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t">
        <span className="text-sm text-gray-500">
          Total: {totalLabels} label{totalLabels !== 1 ? 's' : ''} for {items.length} item{items.length !== 1 ? 's' : ''}
        </span>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 bg-white border rounded hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handlePrint}
            disabled={!selectedTemplate || items.length === 0 || printing}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 font-medium"
          >
            <Printer size={16} />
            {printing ? 'Sending...' : 'Print Labels'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
