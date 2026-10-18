'use client'

import { useState, useEffect, useCallback } from 'react'
import { Printer, Minus, Plus, X, Search, Tag } from 'lucide-react'
import { AsyncCreatableSelect } from '@/components/ui/async-creatable-select'
import { LabelPreview } from '@/components/labels/LabelPreview'
import { printLabels } from '@/lib/labels/label-print'
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
  const [config, setConfig] = useState<PrintLabelConfig>({
    labelsPerRow: 3,
    gapMm: 3,
    pageSize: 'Label',
  })

  const { symbol: currencySymbol } = useTenantCurrency()
  const company = useCompanyOptional()

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
          disabled={!selectedTemplate || items.length === 0}
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
            {config.pageSize !== 'Label' && (
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
          <div className="bg-white rounded-lg border p-4">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Preview</h3>
            {selectedTemplate && items.length > 0 ? (
              <LabelPreview
                template={selectedTemplate}
                item={items[0]?.item}
                currencySymbol={currencySymbol}
                tenantName={company?.tenantName}
                codeWord={codeWord}
                maxWidth={350}
              />
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">
                {!selectedTemplate
                  ? 'Select a template to see preview'
                  : 'Add items to see preview'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
