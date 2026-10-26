'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Printer, Minus, Plus, X, Search, Tag, Eye, ChevronLeft, ChevronRight, Sliders, Edit3, Lock, Ruler, ArrowLeft, Layout, AlertTriangle } from 'lucide-react'
import { AsyncCreatableSelect } from '@/components/ui/async-creatable-select'
import { LabelPreview } from '@/components/labels/LabelPreview'
import { printLabels, printLabelsOnRoll, printLabelsRaw, isRawLabelPrinter } from '@/lib/labels/label-print'
import { StickerRollPreview } from '@/components/labels/StickerRollPreview'
import { useStickerSetups } from '@/hooks/useStickerSetups'
import { usePermission } from '@/hooks/usePermission'
import { defaultStickerSetup, setupsForBranch, STICKER_PRESETS, setupFromPreset } from '@/lib/labels/sticker-stock'
import { LABEL_PRESETS } from '@/lib/labels/presets'
import { usePrinters } from '@/hooks/usePrinter'
import { LABEL_LANGUAGE_LABELS } from '@/lib/print/printer-profiles'
import { PrinterSettingsModal } from '@/components/pos/PrinterSettingsModal'
import { toast } from '@/components/ui/toast'
import { useTenantCurrency } from '@/hooks'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import type { LabelTemplate, LabelItemData, PrintLabelConfig, LabelElement } from '@/lib/labels/types'
import type { AsyncSelectOption } from '@/components/ui/async-creatable-select'

interface ItemWithQty {
  item: LabelItemData
  quantity: number
}

interface VisibleBarcodeFields {
  showName: boolean
  showBarcode: boolean
  showPrice: boolean
  showSku: boolean
  showCompany: boolean
  showCategory: boolean
  showUnit: boolean
  showPriceCode: boolean
}

const DEFAULT_VISIBLE_FIELDS: VisibleBarcodeFields = {
  showName: true,
  showBarcode: true,
  showPrice: true,
  showSku: true,
  showCompany: false,
  showCategory: false,
  showUnit: false,
  showPriceCode: false,
}

export default function BarcodePrintPage() {
  const [templates, setTemplates] = useState<LabelTemplate[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [items, setItems] = useState<ItemWithQty[]>([])
  const [searchValue, setSearchValue] = useState('')
  const [codeWord, setCodeWord] = useState<string>('')
  const [previewIndex, setPreviewIndex] = useState(0)
  const [showFullPreview, setShowFullPreview] = useState(false)
  const [previewMode, setPreviewMode] = useState<'roll' | 'single'>('roll')
  const [visibleFields, setVisibleFields] = useState<VisibleBarcodeFields>(DEFAULT_VISIBLE_FIELDS)
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
  const otherPrinters = printers.filter((p) => p.role !== 'label')
  const [printerChoice, setPrinterChoice] = useState<string | null>(null)
  const [showPrinterSettings, setShowPrinterSettings] = useState(false)
  const [printing, setPrinting] = useState(false)
  const defaultPrinterId = labelPrinters.find((p) => isRawLabelPrinter(p))?.id || labelPrinters[0]?.id || ''
  const chosenPrinterId = printerChoice ?? defaultPrinterId
  const chosenPrinter = printers.find((p) => p.id === chosenPrinterId) || null

  const [isSecure, setIsSecure] = useState(true)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsSecure(window.isSecureContext)
      // Auto-jump to HTTPS if accessing via HTTP on production host
      if (window.location.protocol === 'http:' && (window.location.hostname === '168.144.216.104' || window.location.hostname.endsWith('.sslip.io'))) {
        window.location.href = `https://168-144-216-104.sslip.io${window.location.pathname}${window.location.search}`
      }
    }
  }, [])

  // Sticker stock / roll setup (columns, gaps, calibration). '' = template size, one across.
  const isAdmin = usePermission('manageSettings')
  const { setups: allSetups } = useStickerSetups()
  const [branchIds, setBranchIds] = useState<string[] | null>(null)
  useEffect(() => {
    fetch('/api/warehouses?all=true&userOnly=true')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d) ? d : d?.data
        if (Array.isArray(list)) setBranchIds(list.map((w: { id: string }) => w.id))
      })
      .catch(() => {})
  }, [])
  const setups = useMemo(() => setupsForBranch(allSetups, branchIds), [allSetups, branchIds])

  // Merge built-in presets (e.g. 38x25x2 twin stickers) so standard retail rolls are always available
  const availableSetups = useMemo(() => {
    const list = [...setups]
    for (const preset of STICKER_PRESETS) {
      if (!list.some(s => s.id === preset.id || (s.labelWidthMm === preset.labelWidthMm && s.labelHeightMm === preset.labelHeightMm && s.columns === preset.columns))) {
        list.push(setupFromPreset(preset, { id: preset.id }))
      }
    }
    return list
  }, [setups])

  const linkedSetup = availableSetups.find((s) => s.id === chosenPrinter?.label.stickerSetupId) || null
  const fallbackSetup = defaultStickerSetup(availableSetups)
  // A locked setup linked to the printer (or a locked default) cannot be switched by cashiers
  const forcedSetup = !isAdmin ? (linkedSetup?.locked ? linkedSetup : !linkedSetup && fallbackSetup?.locked ? fallbackSetup : null) : null
  const [setupChoice, setSetupChoice] = useState<string | null>(null)
  const activeSetup = forcedSetup
    ?? (setupChoice !== null ? availableSetups.find((s) => s.id === setupChoice) || null : linkedSetup || fallbackSetup)

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/label-templates')
      if (res.ok) {
        const data = await res.json()
        setTemplates(data)
        const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
        const reqTplId = params?.get('templateId')
        if (reqTplId) {
          setSelectedTemplateId(reqTplId)
        } else {
          const defaultTpl = data.find((t: LabelTemplate) => t.isDefault) || data[0]
          if (defaultTpl) setSelectedTemplateId((prev) => prev || defaultTpl.id)
        }
      }
    } catch {
      toast.error('Failed to load templates')
    }
  }, [])

  // Fetch templates and label settings on mount, and re-fetch on window focus
  useEffect(() => {
    fetchTemplates()

    fetch('/api/label-settings')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(data => setCodeWord(data.codeWord || ''))
      .catch(() => {})

    const onFocus = () => fetchTemplates()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [fetchTemplates])

  // Merge built-in presets if not yet saved in tenant database (e.g. 38x25 twin tag)
  const availableTemplates = useMemo(() => {
    const list = [...templates]
    for (const preset of LABEL_PRESETS) {
      if (!list.some(t => t.name === preset.name || (Math.abs(Number(t.widthMm) - preset.widthMm) <= 0.5 && Math.abs(Number(t.heightMm) - preset.heightMm) <= 0.5 && (t.columns ?? 1) === (preset.columns ?? 1)))) {
        list.push({
          id: `preset-${preset.id}`,
          name: `${preset.name}`,
          description: preset.description,
          widthMm: String(preset.widthMm),
          heightMm: String(preset.heightMm),
          columns: preset.columns ?? (preset.widthMm === 38 && preset.heightMm === 25 ? 2 : 1),
          labelShape: preset.labelShape,
          cornerRadius: preset.cornerRadius ?? null,
          elements: preset.elements,
          isDefault: false,
          isActive: true,
        } as unknown as LabelTemplate)
      }
    }
    return list
  }, [templates])

  const selectedTemplate = availableTemplates.find(t => t.id === selectedTemplateId) || availableTemplates[0] || null

  // Auto-sync roll when a 38x25 template is selected
  useEffect(() => {
    if (!selectedTemplate) return
    const w = Number(selectedTemplate.widthMm)
    const h = Number(selectedTemplate.heightMm)
    if (w === 38 && h === 25) {
      if (!activeSetup || activeSetup.labelWidthMm !== 38 || activeSetup.labelHeightMm !== 25) {
        const match = availableSetups.find(s => s.labelWidthMm === 38 && s.labelHeightMm === 25 && s.columns === 2)
        if (match) setSetupChoice(match.id)
      }
    }
  }, [selectedTemplate, availableSetups, activeSetup])

  // Handle switching roll layout: auto-switch template if dimension mismatches
  const handleSetupChange = (id: string) => {
    setSetupChoice(id)
    if (!id) return
    const chosen = availableSetups.find(s => s.id === id)
    if (chosen) {
      const currentMatches = selectedTemplate &&
        Math.abs(Number(selectedTemplate.widthMm) - chosen.labelWidthMm) <= 0.5 &&
        Math.abs(Number(selectedTemplate.heightMm) - chosen.labelHeightMm) <= 0.5

      if (!currentMatches) {
        const matchingTpl = availableTemplates.find(t =>
          Math.abs(Number(t.widthMm) - chosen.labelWidthMm) <= 0.5 &&
          Math.abs(Number(t.heightMm) - chosen.labelHeightMm) <= 0.5
        )
        if (matchingTpl) {
          setSelectedTemplateId(matchingTpl.id)
        }
      }
    }
  }

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

  const totalLabels = items.reduce((sum, i) => sum + i.quantity, 0)

  // Auto-sync toggles to match initial elements of the chosen template
  useEffect(() => {
    if (!selectedTemplate) return
    const elements = selectedTemplate.elements || []
    setVisibleFields({
      showName: elements.some(el => el.type === 'text' && el.dataField === 'item.name'),
      showBarcode: elements.some(el => el.type === 'barcode'),
      showPrice: elements.some(el => el.type === 'text' && el.dataField === 'item.sellingPrice'),
      showSku: elements.some(el => el.type === 'text' && el.dataField === 'item.sku'),
      showCompany: elements.some(el => el.type === 'text' && el.dataField === 'tenant.name'),
      showCategory: elements.some(el => el.type === 'text' && el.dataField === 'item.category'),
      showUnit: elements.some(el => el.type === 'text' && el.dataField === 'item.unit'),
      showPriceCode: elements.some(el => el.type === 'text' && el.dataField === 'item.priceCode'),
    })
  }, [selectedTemplate])

  // Dynamically compute activeTemplate based on enabled/disabled visibleFields
  const activeTemplate = useMemo<LabelTemplate | null>(() => {
    if (!selectedTemplate) return null

    // Filter elements
    const elements = (selectedTemplate.elements || []).filter((el) => {
      if (el.type === 'barcode') return visibleFields.showBarcode
      if (el.type === 'text') {
        if (el.dataField === 'item.name') return visibleFields.showName
        if (el.dataField === 'item.sellingPrice') return visibleFields.showPrice
        if (el.dataField === 'item.sku') return visibleFields.showSku
        if (el.dataField === 'tenant.name') return visibleFields.showCompany
        if (el.dataField === 'item.category') return visibleFields.showCategory
        if (el.dataField === 'item.unit') return visibleFields.showUnit
        if (el.dataField === 'item.priceCode') return visibleFields.showPriceCode
      }
      return true
    }).map((el) => {
      // Enforce single-line for item.name so it never spills over or overlaps the barcode below
      if (el.type === 'text' && el.dataField === 'item.name') {
        return { ...el, maxLines: 1 }
      }
      return el
    })

    const widthMm = Number(selectedTemplate.widthMm) || 50
    const heightMm = Number(selectedTemplate.heightMm) || 30
    const resultElements: LabelElement[] = [...elements]

    const hasCompany = visibleFields.showCompany
    const hasName = visibleFields.showName
    const hasPrice = visibleFields.showPrice
    const hasSku = visibleFields.showSku
    const hasBarcode = visibleFields.showBarcode

    // 1. Company Name (top banner)
    if (hasCompany && !resultElements.some(el => el.type === 'text' && el.dataField === 'tenant.name')) {
      resultElements.push({
        id: 'dyn-company',
        type: 'text',
        dataField: 'tenant.name',
        x: 1,
        y: 1,
        width: Math.max(10, widthMm - 2),
        height: 3,
        fontSize: widthMm <= 40 ? 6 : 7,
        fontWeight: 'bold',
        textAlign: 'center',
        maxLines: 1,
        rotation: 0,
        zIndex: 1,
      })
    }

    // 2. Product Name (initial name, single line)
    if (hasName && !resultElements.some(el => el.type === 'text' && el.dataField === 'item.name')) {
      const nameY = hasCompany ? 4.2 : 1
      const nameH = hasCompany ? 3.5 : 4.5
      resultElements.push({
        id: 'dyn-name',
        type: 'text',
        dataField: 'item.name',
        x: 1,
        y: nameY,
        width: Math.max(10, widthMm - 2),
        height: nameH,
        fontSize: widthMm <= 40 ? 6.5 : 8,
        fontWeight: 'bold',
        textAlign: 'center',
        maxLines: 1,
        rotation: 0,
        zIndex: 1,
      })
    }

    // 3. Barcode graphic
    if (hasBarcode && !resultElements.some(el => el.type === 'barcode')) {
      const topY = (hasCompany && hasName) ? 8 : (hasCompany || hasName) ? 5.8 : 1.5
      const botReserved = (hasPrice || hasSku) ? 6 : 1
      const barH = Math.max(6, Math.min(14, heightMm - topY - botReserved))
      resultElements.push({
        id: 'dyn-barcode',
        type: 'barcode',
        dataField: 'item.barcode',
        format: 'code128',
        barWidth: 2,
        showText: true,
        x: 2,
        y: topY,
        width: Math.max(10, widthMm - 4),
        height: barH,
        rotation: 0,
        zIndex: 1,
      })
    }

    // 4. Footer fields: Price & SKU (strictly non-overlapping)
    const footerY = Math.max(1, heightMm - 5)
    if (hasSku && !resultElements.some(el => el.type === 'text' && el.dataField === 'item.sku')) {
      resultElements.push({
        id: 'dyn-sku',
        type: 'text',
        dataField: 'item.sku',
        x: 1,
        y: footerY + 1,
        width: hasPrice ? Math.min(22, Math.floor(widthMm * 0.45)) : Math.max(10, widthMm - 2),
        height: 3.5,
        fontSize: 5.5,
        fontWeight: 'normal',
        textAlign: 'left',
        prefix: 'SKU: ',
        maxLines: 1,
        rotation: 0,
        zIndex: 2,
      })
    }

    if (hasPrice && !resultElements.some(el => el.type === 'text' && el.dataField === 'item.sellingPrice')) {
      const priceX = hasSku ? Math.min(24, Math.floor(widthMm * 0.45)) : 1
      const priceW = hasSku ? (widthMm - priceX - 1) : (widthMm - 2)
      resultElements.push({
        id: 'dyn-price',
        type: 'text',
        dataField: 'item.sellingPrice',
        isCurrency: true,
        x: priceX,
        y: footerY,
        width: Math.max(10, priceW),
        height: 5,
        fontSize: widthMm <= 40 ? 8 : 10,
        fontWeight: 'bold',
        textAlign: hasSku ? 'right' : 'center',
        maxLines: 1,
        rotation: 0,
        zIndex: 2,
      })
    }

    if (visibleFields.showPriceCode && !resultElements.some(el => el.type === 'text' && el.dataField === 'item.priceCode')) {
      resultElements.push({
        id: 'dyn-pricecode',
        type: 'text',
        dataField: 'item.priceCode',
        x: Math.max(2, widthMm - 16),
        y: 1,
        width: 14,
        height: 3,
        fontSize: 6,
        fontWeight: 'normal',
        textAlign: 'right',
        prefix: '*',
        maxLines: 1,
        rotation: 0,
        zIndex: 2,
      })
    }

    if (visibleFields.showCategory && !resultElements.some(el => el.type === 'text' && el.dataField === 'item.category')) {
      resultElements.push({
        id: 'dyn-category',
        type: 'text',
        dataField: 'item.category',
        x: 2,
        y: footerY,
        width: 18,
        height: 3,
        fontSize: 6,
        fontWeight: 'normal',
        textAlign: 'left',
        maxLines: 1,
        rotation: 0,
        zIndex: 2,
      })
    }

    if (visibleFields.showUnit && !resultElements.some(el => el.type === 'text' && el.dataField === 'item.unit')) {
      resultElements.push({
        id: 'dyn-unit',
        type: 'text',
        dataField: 'item.unit',
        x: Math.max(2, widthMm / 2 - 8),
        y: footerY,
        width: 16,
        height: 3,
        fontSize: 6,
        fontWeight: 'normal',
        textAlign: 'center',
        prefix: '/ ',
        maxLines: 1,
        rotation: 0,
        zIndex: 2,
      })
    }

    return {
      ...selectedTemplate,
      elements: resultElements,
    }
  }, [selectedTemplate, visibleFields])

  async function handlePrint() {
    const templateToPrint = activeTemplate || selectedTemplate
    if (!templateToPrint) {
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
        const res = await printLabelsRaw(chosenPrinter, templateToPrint, items, {
          currencySymbol,
          tenantName: company?.tenantName,
          codeWord,
          setup: activeSetup,
        })
        if (res.warnings.length) toast.warning(res.warnings.slice(0, 3).join('; '))
        if (res.ok) toast.success(`Sent ${totalLabels} label${totalLabels !== 1 ? 's' : ''} to ${chosenPrinter.name}`)
        else {
          toast.error(`Label printer: ${res.error || 'failed'}`)
          if (res.error?.includes('paired') || res.error?.includes('USB') || res.error?.includes('device') || res.error?.includes('claim')) {
            setShowPrinterSettings(true)
          }
        }
      } catch {
        toast.error('Failed to generate labels')
      } finally {
        setPrinting(false)
      }
      return
    }
    try {
      const success = activeSetup && config.pageSize === 'Label'
        ? await printLabelsOnRoll(templateToPrint, items, activeSetup, currencySymbol, company?.tenantName, codeWord)
        : await printLabels(
          templateToPrint,
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
      {/* Insecure HTTP Warning Banner */}
      {!isSecure && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg flex flex-wrap items-center justify-between text-xs text-amber-800 gap-2 shadow-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
            <span>
              <strong>HTTP Insecure Context:</strong> Direct raw WebUSB is blocked by Chrome/Edge on HTTP. Open over HTTPS or use Browser Print below.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.href = `https://168-144-216-104.sslip.io${window.location.pathname}${window.location.search}`
              }
            }}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold shrink-0 shadow-sm transition-colors"
          >
            🔒 Switch to HTTPS Now
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href={`/c/${company?.tenantSlug || ''}/inventory`}
              className="p-1.5 text-gray-400 hover:text-gray-700 rounded-md hover:bg-gray-100 transition-colors"
              title="Back to Inventory"
            >
              <ArrowLeft size={18} />
            </Link>
            <h1 className="text-xl font-semibold text-gray-900">Print Barcode Labels</h1>
          </div>
          <p className="text-sm text-gray-500 mt-0.5 ml-8">Search items, configure labels, and print</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/c/${company?.tenantSlug || ''}/barcode/label-templates`}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 font-medium transition-colors"
          >
            <Layout size={15} />
            Label Templates
          </Link>
          <button
            onClick={handlePrint}
            disabled={!selectedTemplate || items.length === 0 || printing}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 font-medium shadow-sm transition-colors"
          >
            <Printer size={16} />
            {printing ? 'Sending to Printer...' : 'Print Labels'}
          </button>
        </div>
      </div>

      {/* Barcode Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
        <Link
          href={`/c/${company?.tenantSlug || ''}/barcode/print`}
          className="px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-50 text-blue-700 border border-blue-200 flex items-center gap-1.5"
        >
          <Printer size={13} />
          Print Labels
        </Link>
        <Link
          href={`/c/${company?.tenantSlug || ''}/barcode/label-templates`}
          className="px-3 py-1.5 text-xs font-medium rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors flex items-center gap-1.5"
        >
          <Layout size={13} />
          Templates & Customization
        </Link>
        <Link
          href={`/c/${company?.tenantSlug || ''}/barcode/settings`}
          className="px-3 py-1.5 text-xs font-medium rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors flex items-center gap-1.5"
        >
          <Sliders size={13} />
          Roll Setups & Calibration
        </Link>
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
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-medium"
                >
                  <Sliders size={12} />
                  Manage printers
                </button>
              </div>
              <select
                value={chosenPrinterId}
                onChange={(e) => setPrinterChoice(e.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
              >
                <option value="">Browser print dialog (System driver / Any OS)</option>
                {labelPrinters.length > 0 && (
                  <optgroup label="Label Printers">
                    {labelPrinters.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({LABEL_LANGUAGE_LABELS[p.label.language] || p.label.language.toUpperCase()}, {p.label.dpi} dpi)
                      </option>
                    ))}
                  </optgroup>
                )}
                {otherPrinters.length > 0 && (
                  <optgroup label="Other Connected Printers">
                    {otherPrinters.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.role.toUpperCase()} · {p.transport.toUpperCase()})
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div className="flex items-center justify-between mt-1 text-xs">
                <span className="text-gray-500">Zebra ZD220/ZD230 or USB printer?</span>
                <button
                  type="button"
                  onClick={() => setShowPrinterSettings(true)}
                  className="text-blue-600 font-semibold hover:underline flex items-center gap-1"
                >
                  Connect USB Printer
                </button>
              </div>
              {chosenPrinter?.label?.language === 'zpl' ? (
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800 flex items-center gap-1.5">
                  <span className="font-semibold">🦓 Zebra ZPL Active:</span> Direct thermal ZPL II commands enabled for {chosenPrinter.name}.
                </div>
              ) : chosenPrinter && !isRawLabelPrinter(chosenPrinter) ? (
                <p className="text-xs text-gray-500 mt-1">This printer uses the browser / system print dialog.</p>
              ) : null}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700 flex items-center gap-1">
                  <Ruler size={13} /> Label roll
                </label>
                {isAdmin && (
                  <Link href={`/c/${company?.tenantSlug || ''}/barcode/settings`} className="text-xs text-blue-600 hover:underline">
                    Set up rolls
                  </Link>
                )}
              </div>
              <select
                value={activeSetup?.id || ''}
                onChange={(e) => handleSetupChange(e.target.value)}
                disabled={!!forcedSetup}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm disabled:bg-gray-50"
              >
                <option value="">Template size, 1 across</option>
                {availableSetups.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.labelWidthMm} x {s.labelHeightMm} mm x {s.columns}){s.locked ? ' [locked]' : ''}
                  </option>
                ))}
              </select>
              {activeSetup?.locked && (
                <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                  <Lock size={11} /> Calibrated and locked by an admin{forcedSetup ? '' : ' (you can still pick another roll)'}
                </p>
              )}
              {activeSetup && selectedTemplate &&
                (Math.abs(Number(selectedTemplate.widthMm) - activeSetup.labelWidthMm) > 0.5 ||
                  Math.abs(Number(selectedTemplate.heightMm) - activeSetup.labelHeightMm) > 0.5) && (
                  <p className="text-xs text-red-600 mt-1">
                    Template is {parseFloat(String(selectedTemplate.widthMm))} x {parseFloat(String(selectedTemplate.heightMm))} mm but the roll labels are{' '}
                    {activeSetup.labelWidthMm} x {activeSetup.labelHeightMm} mm. Pick a matching template.
                  </p>
                )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium text-gray-700">Template</label>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/c/${company?.tenantSlug || ''}/barcode/label-templates/new`}
                    className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
                  >
                    <Plus size={11} /> New
                  </Link>
                  {selectedTemplate && (
                    <Link
                      href={`/c/${company?.tenantSlug || ''}/barcode/label-templates/${selectedTemplate.id}`}
                      className="text-xs text-blue-600 hover:underline flex items-center gap-0.5 font-medium"
                    >
                      <Edit3 size={11} /> Edit in Designer
                    </Link>
                  )}
                </div>
              </div>
              <select
                value={selectedTemplate?.id || selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
              >
                <option value="">Select a template</option>
                {availableTemplates.map(t => (
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
                  {activeSetup
                    ? `Label roll (${activeSetup.columns} across)`
                    : `Label${selectedTemplate ? ` (${parseFloat(String(selectedTemplate.widthMm))} x ${parseFloat(String(selectedTemplate.heightMm))} mm)` : ''}`}
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

          {/* Information on Label Customizer (Enable/Disable Fields) */}
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sliders size={16} className="text-blue-600" />
                <span className="text-sm font-semibold text-gray-900">Information on Label</span>
              </div>
              {selectedTemplateId && (
                <Link
                  href={`/c/${company?.tenantSlug || ''}/barcode/label-templates/${selectedTemplateId}`}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  title="Open in full template drag-and-drop designer"
                >
                  <Edit3 size={12} />
                  Full Designer
                </Link>
              )}
            </div>

            <p className="text-xs text-gray-500">
              Enable or disable which product information prints on this barcode label:
            </p>

            {/* Quick Presets */}
            <div className="flex flex-wrap gap-1.5 pb-1">
              <button
                type="button"
                onClick={() => setVisibleFields({
                  showName: true,
                  showBarcode: true,
                  showPrice: true,
                  showSku: true,
                  showCompany: false,
                  showCategory: false,
                  showUnit: false,
                  showPriceCode: false,
                })}
                className="px-2 py-0.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md border font-medium transition-colors"
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => setVisibleFields({
                  showName: true,
                  showBarcode: true,
                  showPrice: true,
                  showSku: true,
                  showCompany: true,
                  showCategory: true,
                  showUnit: true,
                  showPriceCode: true,
                })}
                className="px-2 py-0.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md border font-medium transition-colors"
              >
                All Fields
              </button>
              <button
                type="button"
                onClick={() => setVisibleFields({
                  showName: false,
                  showBarcode: true,
                  showPrice: true,
                  showSku: false,
                  showCompany: false,
                  showCategory: false,
                  showUnit: false,
                  showPriceCode: false,
                })}
                className="px-2 py-0.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md border font-medium transition-colors"
              >
                Price + Barcode
              </button>
              <button
                type="button"
                onClick={() => setVisibleFields({
                  showName: false,
                  showBarcode: true,
                  showPrice: false,
                  showSku: false,
                  showCompany: false,
                  showCategory: false,
                  showUnit: false,
                  showPriceCode: false,
                })}
                className="px-2 py-0.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md border font-medium transition-colors"
              >
                Barcode Only
              </button>
            </div>

            {/* Interactive Grid of Field Toggles */}
            <div className="grid grid-cols-2 gap-1.5 pt-1 border-t">
              <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={visibleFields.showName}
                  onChange={(e) => setVisibleFields((prev) => ({ ...prev, showName: e.target.checked }))}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-medium">Product Name</span>
              </label>

              <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={visibleFields.showBarcode}
                  onChange={(e) => setVisibleFields((prev) => ({ ...prev, showBarcode: e.target.checked }))}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-medium">Barcode Graphic</span>
              </label>

              <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={visibleFields.showPrice}
                  onChange={(e) => setVisibleFields((prev) => ({ ...prev, showPrice: e.target.checked }))}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-medium">Selling Price</span>
              </label>

              <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={visibleFields.showSku}
                  onChange={(e) => setVisibleFields((prev) => ({ ...prev, showSku: e.target.checked }))}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-medium">SKU / Code</span>
              </label>

              <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={visibleFields.showCompany}
                  onChange={(e) => setVisibleFields((prev) => ({ ...prev, showCompany: e.target.checked }))}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-medium">Store Name</span>
              </label>

              <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={visibleFields.showCategory}
                  onChange={(e) => setVisibleFields((prev) => ({ ...prev, showCategory: e.target.checked }))}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-medium">Category</span>
              </label>

              <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={visibleFields.showUnit}
                  onChange={(e) => setVisibleFields((prev) => ({ ...prev, showUnit: e.target.checked }))}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-medium">Unit (pcs/kg)</span>
              </label>

              <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={visibleFields.showPriceCode}
                  onChange={(e) => setVisibleFields((prev) => ({ ...prev, showPriceCode: e.target.checked }))}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-medium">Cost Code</span>
              </label>
            </div>
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
                  {activeSetup && activeSetup.columns > 1 ? ` (${activeSetup.columns} across roll)` : ''}
                </span>
              )}
            </div>

            {/* View Mode Toggle for Multi-column rolls (e.g. 38x25 twin stickers) */}
            {activeSetup && activeSetup.columns > 1 && (
              <div className="flex items-center bg-slate-100 p-1 rounded-md text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setPreviewMode('roll')}
                  className={`flex-1 py-1 px-2 rounded transition-colors text-center ${
                    previewMode === 'roll'
                      ? 'bg-white text-blue-700 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Twin Sticker Roll ({activeSetup.columns} in 1 line)
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('single')}
                  className={`flex-1 py-1 px-2 rounded transition-colors text-center ${
                    previewMode === 'single'
                      ? 'bg-white text-blue-700 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Single Sticker ({parseFloat(String(selectedTemplate?.widthMm || activeSetup.labelWidthMm))} × {parseFloat(String(selectedTemplate?.heightMm || activeSetup.labelHeightMm))} mm)
                </button>
              </div>
            )}

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

                {/* Main Preview Box */}
                {activeSetup && activeSetup.columns > 1 && previewMode === 'roll' ? (
                  <div className="p-3 bg-slate-100/80 dark:bg-slate-800/60 rounded-lg flex flex-col items-center justify-center border border-dashed border-gray-300 dark:border-gray-700">
                    <div className="w-full">
                      <StickerRollPreview
                        setup={activeSetup}
                        template={activeTemplate || selectedTemplate}
                        items={items}
                        currencySymbol={currencySymbol}
                        tenantName={company?.tenantName}
                        codeWord={codeWord}
                        maxRows={2}
                      />
                    </div>
                    <p className="text-[11px] text-blue-600 dark:text-blue-400 mt-2 font-medium text-center">
                      Twin-sticker roll: 2 stickers print side-by-side in each line (80 mm roll)
                    </p>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-100/70 dark:bg-slate-800/50 rounded-lg flex flex-col items-center justify-center border border-dashed border-gray-200 dark:border-gray-700 min-h-[160px]">
                    <LabelPreview
                      template={activeTemplate || selectedTemplate}
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
                )}

                {/* Secondary Roll Preview if single sticker mode is chosen */}
                {activeSetup && (previewMode === 'single' || activeSetup.columns === 1) && (
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-gray-600">On the roll layout:</div>
                    <StickerRollPreview
                      setup={activeSetup}
                      template={activeTemplate || selectedTemplate}
                      items={items}
                      currencySymbol={currencySymbol}
                      tenantName={company?.tenantName}
                      codeWord={codeWord}
                      maxRows={2}
                    />
                  </div>
                )}

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
          <div className={`bg-white dark:bg-gray-900 rounded-xl ${activeSetup ? 'max-w-3xl' : 'max-w-lg'} w-full p-6 shadow-2xl space-y-4`}>
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
              {activeSetup ? (
                <StickerRollPreview
                  setup={activeSetup}
                  template={activeTemplate || selectedTemplate}
                  items={items}
                  currencySymbol={currencySymbol}
                  tenantName={company?.tenantName}
                  codeWord={codeWord}
                  zoom="true"
                  maxRows={6}
                />
              ) : (
              <div className="shadow-md bg-white p-2 rounded">
                <LabelPreview
                  template={activeTemplate || selectedTemplate}
                  item={items[previewIndex]?.item || null}
                  currencySymbol={currencySymbol}
                  tenantName={company?.tenantName}
                  codeWord={codeWord}
                  maxWidth={450}
                />
              </div>
              )}
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

      <PrinterSettingsModal isOpen={showPrinterSettings} onClose={() => setShowPrinterSettings(false)} initialRole="label" />
    </div>
  )
}
