'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { Printer, Minus, Plus, X, Search, Tag, Eye, ChevronLeft, ChevronRight, Sliders, Edit3, Lock, Ruler, ArrowLeft, Layout, AlertTriangle } from 'lucide-react'
import { AsyncCreatableSelect } from '@/components/ui/async-creatable-select'
import { LabelPreview } from '@/components/labels/LabelPreview'
import { printLabels, printLabelsOnRoll, printLabelsRaw, isRawLabelPrinter, rawLabelDpi, printAlignmentTestDialog } from '@/lib/labels/label-print'
import { DirectLabelPrinterPanel } from '@/components/labels/DirectLabelPrinterPanel'
import { BrowserLabelPrintGuide, browserGuideHidden } from '@/components/labels/BrowserLabelPrintGuide'
import { preflightLabels } from '@/lib/print/label/preflight'
import { StickerRollPreview } from '@/components/labels/StickerRollPreview'
import { useStickerSetups } from '@/hooks/useStickerSetups'
import { usePermission } from '@/hooks/usePermission'
import { defaultStickerSetup, setupsForBranch, stickerRollWidthMm, STICKER_PRESETS, setupFromPreset, type StickerSetup } from '@/lib/labels/sticker-stock'
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
  nameLengthMode: 'initial' | 'autofit' | 'multiline'
  nameFontSize: 'small' | 'normal' | 'large'
  showBarcode: boolean
  barcodeType: 'code128' | 'qrcode'
  showBarcodeText: boolean
  showPrice: boolean
  showSku: boolean
  showCompany: boolean
  showVendor: boolean
  showCategory: boolean
  showUnit: boolean
  showPriceCode: boolean
}

const DEFAULT_VISIBLE_FIELDS: VisibleBarcodeFields = {
  showName: true,
  nameLengthMode: 'initial',
  nameFontSize: 'normal',
  showBarcode: true,
  barcodeType: 'code128',
  showBarcodeText: true,
  showPrice: true,
  showSku: true,
  showCompany: false,
  showVendor: false,
  showCategory: false,
  showUnit: false,
  showPriceCode: false,
}

/**
 * Order templates for automatic picks: ones that print a barcode first, then the tenant default,
 * so a size match never lands on a barcode-less template (e.g. "PLU Label" for scale items).
 */
function rankTemplates(list: LabelTemplate[]): LabelTemplate[] {
  const score = (t: LabelTemplate) => (t.elements?.some((e) => e?.type === 'barcode') ? 2 : 0) + (t.isDefault ? 1 : 0)
  return [...list].sort((a, b) => score(b) - score(a))
}

/** First template matching the predicates in order, trying templates that print a barcode before any others. */
function pickTemplate(list: LabelTemplate[], ...preds: Array<(t: LabelTemplate) => boolean>): LabelTemplate | undefined {
  const ranked = rankTemplates(list)
  const withBarcode = ranked.filter((t) => t.elements?.some((e) => e?.type === 'barcode'))
  for (const pool of [withBarcode, ranked]) {
    for (const pred of preds) {
      const t = pool.find(pred)
      if (t) return t
    }
  }
  return undefined
}

const near = (a: unknown, b: number) => Math.abs(Number(a) - b) <= 0.5

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

  // Label printers configured on this terminal. '' = browser / OS system print dialog.
  const { printers } = usePrinters()
  const labelPrinters = printers.filter((p) => p.role === 'label')
  const otherPrinters = printers.filter((p) => p.role !== 'label')
  // null = not chosen this session: a direct (raw) label printer is the default when one is configured,
  // the browser dialog only when there is none (or the cashier picks it explicitly).
  const [printerChoice, setPrinterChoice] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sky_barcode_printer_id') || null
    }
    return null
  })
  const [showPrinterSettings, setShowPrinterSettings] = useState(false)
  const [printing, setPrinting] = useState(false)
  // Set synchronously on click: a second click before React re-renders must not start a second job.
  const printLock = useRef(false)
  // Default: Chrome's print dialog with the printer's own driver. A direct printer is used only when picked under Advanced.
  const chosenPrinterId = printerChoice && printers.some((p) => p.id === printerChoice) ? printerChoice : ''
  const chosenPrinter = printers.find((p) => p.id === chosenPrinterId) || null
  const choosePrinter = (id: string) => {
    setPrinterChoice(id)
    if (typeof window !== 'undefined') {
      if (id) localStorage.setItem('sky_barcode_printer_id', id)
      else localStorage.removeItem('sky_barcode_printer_id')
    }
  }
  // Browser print dialog checklist (paper size), shown before the dialog opens
  const [guideJob, setGuideJob] = useState<null | { done: (go: boolean) => void; rows: number; setup: StickerSetup; continuous: boolean }>(null)
  // Printer can't find the gaps (FEED runs through many stickers, e.g. a fixed centre sensor under the gap of a
  // multi-across roll): print as a continuous roll, one page = label height + row gap, so no gap sensing is needed.
  const [noGapSensing, setNoGapSensing] = useState(() => {
    try {
      return typeof window !== 'undefined' && localStorage.getItem('sky_label_no_gap_sensing') === '1'
    } catch {
      return false
    }
  })
  const toggleNoGapSensing = (on: boolean) => {
    setNoGapSensing(on)
    try {
      if (on) localStorage.setItem('sky_label_no_gap_sensing', '1')
      else localStorage.removeItem('sky_label_no_gap_sensing')
    } catch {
      /* private mode */
    }
  }
  // Test print from the checklist: one at a time (each click would otherwise queue another job)
  const testLock = useRef(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
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
  const [setupChoice, setSetupChoice] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const savedSetupId = localStorage.getItem('sky_barcode_setup_id')
      if (savedSetupId) return savedSetupId
      const savedCols = localStorage.getItem('sky_barcode_roll_columns')
      if (savedCols === '1') return '38x25x1'
      if (savedCols === '3') return '32x25x3'
      if (savedCols === '2') return '38x25x2'
    }
    return '38x25x2'
  })
  const activeSetup = forcedSetup
    ?? (setupChoice !== null ? availableSetups.find((s) => s.id === setupChoice) || null : linkedSetup || fallbackSetup || availableSetups[0] || null)

  // Guard the 2-inch-printer trap: warn when the calibrated roll is physically
  // wider than the chosen label printer's paper (e.g. twin 38x25 on a ZD230).
  const rollWidthMm = activeSetup ? stickerRollWidthMm(activeSetup) : 0
  const sizeMismatch = !!(
    chosenPrinter &&
    activeSetup &&
    isRawLabelPrinter(chosenPrinter) &&
    rollWidthMm > chosenPrinter.label.widthMm + 0.5
  )

  // The template is picked once, on first load. Later refreshes (window focus, e.g. when Chrome's print
  // dialog closes) only update the list, so the label size never changes between prints by itself.
  const templatePicked = useRef(false)
  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/label-templates')
      if (res.ok) {
        const data = await res.json()
        setTemplates(data)
        if (templatePicked.current) return
        templatePicked.current = true
        const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
        const reqTplId = params?.get('templateId')
        if (reqTplId) {
          setSelectedTemplateId(reqTplId)
        } else {
          // Check saved preference first
          const savedTplId = typeof window !== 'undefined' ? localStorage.getItem('sky_barcode_template_id') : null
          const savedCols = typeof window !== 'undefined' ? localStorage.getItem('sky_barcode_roll_columns') : null

          // Built-in presets (id "preset-...") are not in the API list but are valid saved choices
          const savedExists = savedTplId
            ? rankTemplates(data).find((t: LabelTemplate) => t.id === savedTplId) ||
              (LABEL_PRESETS.some((p) => `preset-${p.id}` === savedTplId) ? { id: savedTplId } : null)
            : null
          if (savedExists) {
            setSelectedTemplateId(savedExists.id)
          } else if (savedCols === '1') {
            const singleTpl = pickTemplate(data, (t) => (t.columns ?? 1) === 1 && near(t.widthMm, 38), (t) => near(t.widthMm, 38), (t) => (t.columns ?? 1) === 1) || data[0]
            if (singleTpl) setSelectedTemplateId(singleTpl.id)
          } else if (savedCols === '3') {
            const tripleTpl = rankTemplates(data).find((t: LabelTemplate) => (t.columns ?? 1) === 3) || data[0]
            if (tripleTpl) setSelectedTemplateId(tripleTpl.id)
          } else {
            // Default to Twin Stickers (2 Across on 80mm roll, 38x25 mm)
            const twin38x25 = rankTemplates(data).find((t: LabelTemplate) => (t.columns ?? 1) === 2 && Math.abs(Number(t.widthMm) - 38) <= 0.5 && Math.abs(Number(t.heightMm) - 25) <= 0.5)
            const twinAny = rankTemplates(data).find((t: LabelTemplate) => (t.columns ?? 1) === 2)
            const defaultTpl = twin38x25 || twinAny || rankTemplates(data).find((t: LabelTemplate) => t.isDefault) || data[0]
            if (defaultTpl) setSelectedTemplateId(defaultTpl.id)
          }
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

  // Merge built-in presets if not yet saved in tenant database (e.g. 38x25 single / twin tag)
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
          columns: preset.columns ?? 2,
          labelShape: preset.labelShape,
          cornerRadius: preset.cornerRadius ?? null,
          elements: preset.elements,
          isDefault: preset.id === 'retail-38x25-barcode-2up',
          isActive: true,
        } as unknown as LabelTemplate)
      }
    }
    return list
  }, [templates])

  const selectedTemplate = rankTemplates(availableTemplates).find(t => t.id === selectedTemplateId) ||
    rankTemplates(availableTemplates).find(t => (t.columns ?? 1) === (activeSetup?.columns ?? 2) && Math.abs(Number(t.widthMm) - (activeSetup?.labelWidthMm ?? 38)) <= 0.5) ||
    rankTemplates(availableTemplates).find(t => (t.columns ?? 1) === (activeSetup?.columns ?? 2)) ||
    availableTemplates[0] ||
    null

  // Auto-sync roll setup when a template is selected
  useEffect(() => {
    if (!selectedTemplate) return
    const w = Number(selectedTemplate.widthMm)
    const h = Number(selectedTemplate.heightMm)
    const tCols = selectedTemplate.columns ?? 2
    // The roll (columns across) is the user's choice; only re-pick it when the sticker size differs.
    if (!activeSetup || !near(activeSetup.labelWidthMm, w) || !near(activeSetup.labelHeightMm, h)) {
      const match = availableSetups.find(s =>
        Math.abs(s.labelWidthMm - w) <= 0.5 &&
        Math.abs(s.labelHeightMm - h) <= 0.5 &&
        s.columns === tCols
      ) || availableSetups.find(s =>
        Math.abs(s.labelWidthMm - w) <= 0.5 &&
        Math.abs(s.labelHeightMm - h) <= 0.5
      )
      if (match) {
        setSetupChoice(match.id)
        if (typeof window !== 'undefined') {
          localStorage.setItem('sky_barcode_setup_id', match.id)
          localStorage.setItem('sky_barcode_roll_columns', String(match.columns))
        }
      }
    }
  }, [selectedTemplate, availableSetups, activeSetup])

  // Handle switching roll layout: auto-switch template if dimension mismatches
  const handleSetupChange = (id: string) => {
    setSetupChoice(id)
    if (typeof window !== 'undefined') {
      localStorage.setItem('sky_barcode_setup_id', id)
    }
    if (!id) return
    const chosen = availableSetups.find(s => s.id === id)
    if (chosen) {
      if (typeof window !== 'undefined') {
        localStorage.setItem('sky_barcode_roll_columns', String(chosen.columns))
      }
      // A template is one sticker: keep it while its size matches the roll (columns are the roll's)
      const currentMatches = selectedTemplate &&
        near(selectedTemplate.widthMm, chosen.labelWidthMm) &&
        near(selectedTemplate.heightMm, chosen.labelHeightMm)

      if (!currentMatches) {
        const sameSize = (t: LabelTemplate) => near(t.widthMm, chosen.labelWidthMm) && near(t.heightMm, chosen.labelHeightMm)
        const matchingTpl = pickTemplate(availableTemplates, (t) => sameSize(t) && (t.columns ?? 1) === chosen.columns, sameSize, (t) => (t.columns ?? 1) === chosen.columns)
        if (matchingTpl) {
          setSelectedTemplateId(matchingTpl.id)
          if (typeof window !== 'undefined') {
            localStorage.setItem('sky_barcode_template_id', matchingTpl.id)
          }
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
        supplier: item.supplier?.name || item.brand || null,
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
          supplier: (d.supplier as string) || null,
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
    setVisibleFields(prev => ({
      ...prev,
      showName: elements.some(el => el.type === 'text' && el.dataField === 'item.name'),
      showBarcode: elements.some(el => el.type === 'barcode'),
      showBarcodeText: elements.find(el => el.type === 'barcode')?.showText ?? true,
      showPrice: elements.some(el => el.type === 'text' && el.dataField === 'item.sellingPrice'),
      showSku: elements.some(el => el.type === 'text' && el.dataField === 'item.sku'),
      showCompany: elements.some(el => el.type === 'text' && el.dataField === 'tenant.name'),
      showVendor: elements.some(el => el.type === 'text' && (el.dataField === 'item.supplier' || el.dataField === 'item.brand')),
      showCategory: elements.some(el => el.type === 'text' && el.dataField === 'item.category'),
      showUnit: elements.some(el => el.type === 'text' && el.dataField === 'item.unit'),
      showPriceCode: elements.some(el => el.type === 'text' && el.dataField === 'item.priceCode'),
    }))
  }, [selectedTemplate])

  // Dynamically compute activeTemplate based on enabled/disabled visibleFields
  const activeTemplate = useMemo<LabelTemplate | null>(() => {
    if (!selectedTemplate) return null

    const widthMm = Number(selectedTemplate.widthMm) || 50
    const heightMm = Number(selectedTemplate.heightMm) || 30

    const hasCompany = visibleFields.showCompany
    const hasVendor = visibleFields.showVendor
    const hasName = visibleFields.showName
    const hasBarcode = visibleFields.showBarcode
    const hasPrice = visibleFields.showPrice
    const hasSku = visibleFields.showSku
    const hasPriceCode = visibleFields.showPriceCode
    const hasCategory = visibleFields.showCategory
    const hasUnit = visibleFields.showUnit

    const resultElements: LabelElement[] = []
    let currentY = 1.0

    // ── 1. Top Header: Store Name & Vendor/Supplier Name ──
    if (hasCompany && hasVendor) {
      if (widthMm >= 48) {
        // Wide sticker: side-by-side header
        const halfW = (widthMm - 3) / 2
        resultElements.push({
          id: 'dyn-company',
          type: 'text',
          dataField: 'tenant.name',
          x: 1,
          y: currentY,
          width: halfW,
          height: 3.2,
          fontSize: 6,
          fontWeight: 'bold',
          textAlign: 'left',
          maxLines: 1,
          rotation: 0,
          zIndex: 1,
        })
        resultElements.push({
          id: 'dyn-vendor',
          type: 'text',
          dataField: 'item.supplier',
          prefix: 'Vendor: ',
          x: halfW + 1.5,
          y: currentY,
          width: halfW,
          height: 3.2,
          fontSize: 5.5,
          fontWeight: 'normal',
          textAlign: 'right',
          maxLines: 1,
          rotation: 0,
          zIndex: 1,
        })
        currentY += 3.8
      } else {
        // Compact sticker (38mm): 2 stacked micro-lines
        resultElements.push({
          id: 'dyn-company',
          type: 'text',
          dataField: 'tenant.name',
          x: 1,
          y: currentY,
          width: widthMm - 2,
          height: 2.8,
          fontSize: 5.5,
          fontWeight: 'bold',
          textAlign: 'center',
          maxLines: 1,
          rotation: 0,
          zIndex: 1,
        })
        currentY += 3.0
        resultElements.push({
          id: 'dyn-vendor',
          type: 'text',
          dataField: 'item.supplier',
          prefix: 'By: ',
          x: 1,
          y: currentY,
          width: widthMm - 2,
          height: 2.4,
          fontSize: 5.0,
          fontWeight: 'normal',
          textAlign: 'center',
          maxLines: 1,
          rotation: 0,
          zIndex: 1,
        })
        currentY += 2.8
      }
    } else if (hasCompany) {
      resultElements.push({
        id: 'dyn-company',
        type: 'text',
        dataField: 'tenant.name',
        x: 1,
        y: currentY,
        width: widthMm - 2,
        height: 3.2,
        fontSize: widthMm <= 40 ? 6 : 7,
        fontWeight: 'bold',
        textAlign: 'center',
        maxLines: 1,
        rotation: 0,
        zIndex: 1,
      })
      currentY += 3.8
    } else if (hasVendor) {
      resultElements.push({
        id: 'dyn-vendor',
        type: 'text',
        dataField: 'item.supplier',
        prefix: 'Vendor: ',
        x: 1,
        y: currentY,
        width: widthMm - 2,
        height: 3.2,
        fontSize: widthMm <= 40 ? 6 : 7,
        fontWeight: 'normal',
        textAlign: 'center',
        maxLines: 1,
        rotation: 0,
        zIndex: 1,
      })
      currentY += 3.8
    }

    // ── 2. Product Name with Length / Font Size Optimization ──
    if (hasName) {
      const mode = visibleFields.nameLengthMode
      const sizeOpt = visibleFields.nameFontSize
      const isMulti = mode === 'multiline'
      const isAutoFit = mode === 'autofit'
      const nameH = isMulti ? (widthMm <= 40 ? 5.5 : 6.5) : (widthMm <= 40 ? 3.5 : 4.2)

      const baseFont = sizeOpt === 'small'
        ? 5.5
        : sizeOpt === 'large'
        ? (widthMm <= 40 ? 8.5 : 10)
        : (widthMm <= 40 ? 6.5 : 8)

      resultElements.push({
        id: 'dyn-name',
        type: 'text',
        dataField: 'item.name',
        x: 1,
        y: currentY,
        width: Math.max(10, widthMm - 2),
        height: nameH,
        fontSize: baseFont,
        fontWeight: 'bold',
        textAlign: 'center',
        maxLines: isMulti ? 2 : 1,
        autoFit: isAutoFit,
        rotation: 0,
        zIndex: 1,
      })
      currentY += nameH + 0.8
    }

    // ── 3. Footer Elements (Price, SKU, Price Code, Category, Unit) ──
    const hasAnyFooter = hasPrice || hasSku || hasCategory || hasPriceCode || hasUnit
    const footerH = widthMm <= 40 ? 5.0 : 6.0
    const footerY = Math.max(currentY + 6, heightMm - footerH - 1.0)

    if (hasAnyFooter) {
      // Cost Code (Top right of sticker or above footer)
      if (hasPriceCode) {
        resultElements.push({
          id: 'dyn-pricecode',
          type: 'text',
          dataField: 'item.priceCode',
          x: Math.max(2, widthMm - 18),
          y: 0.8,
          width: 16,
          height: 2.8,
          fontSize: 5.5,
          fontWeight: 'normal',
          textAlign: 'right',
          prefix: '*',
          maxLines: 1,
          rotation: 0,
          zIndex: 3,
        })
      }

      if (hasSku && hasPrice) {
        const skuW = Math.min(22, Math.floor(widthMm * 0.42))
        const priceX = skuW + 2
        const priceW = widthMm - priceX - 1.5

        resultElements.push({
          id: 'dyn-sku',
          type: 'text',
          dataField: 'item.sku',
          prefix: 'SKU: ',
          x: 1.5,
          y: footerY + 1.0,
          width: skuW,
          height: 3.5,
          fontSize: 5.5,
          fontWeight: 'normal',
          textAlign: 'left',
          maxLines: 1,
          rotation: 0,
          zIndex: 2,
        })

        resultElements.push({
          id: 'dyn-price',
          type: 'text',
          dataField: 'item.sellingPrice',
          isCurrency: true,
          suffix: hasUnit ? ' ' : undefined,
          x: priceX,
          y: footerY,
          width: priceW,
          height: footerH,
          fontSize: widthMm <= 40 ? 8.5 : 11,
          fontWeight: 'bold',
          textAlign: 'right',
          maxLines: 1,
          rotation: 0,
          zIndex: 2,
        })
      } else if (hasPrice) {
        resultElements.push({
          id: 'dyn-price',
          type: 'text',
          dataField: 'item.sellingPrice',
          isCurrency: true,
          x: 1,
          y: footerY,
          width: widthMm - 2,
          height: footerH,
          fontSize: widthMm <= 40 ? 10.5 : 13,
          fontWeight: 'bold',
          textAlign: 'center',
          maxLines: 1,
          rotation: 0,
          zIndex: 2,
        })
      } else if (hasSku) {
        resultElements.push({
          id: 'dyn-sku',
          type: 'text',
          dataField: 'item.sku',
          prefix: 'SKU: ',
          x: 1,
          y: footerY,
          width: widthMm - 2,
          height: 4,
          fontSize: 6.5,
          fontWeight: 'normal',
          textAlign: 'center',
          maxLines: 1,
          rotation: 0,
          zIndex: 2,
        })
      }

      if (hasCategory && !hasSku) {
        resultElements.push({
          id: 'dyn-category',
          type: 'text',
          dataField: 'item.category',
          x: 1.5,
          y: footerY + 1,
          width: Math.floor(widthMm * 0.45),
          height: 3,
          fontSize: 5.5,
          fontWeight: 'normal',
          textAlign: 'left',
          maxLines: 1,
          rotation: 0,
          zIndex: 2,
        })
      }

      if (hasUnit && !hasPrice) {
        resultElements.push({
          id: 'dyn-unit',
          type: 'text',
          dataField: 'item.unit',
          prefix: 'Unit: ',
          x: Math.max(2, widthMm / 2 - 8),
          y: footerY,
          width: 16,
          height: 3,
          fontSize: 6,
          fontWeight: 'normal',
          textAlign: 'center',
          maxLines: 1,
          rotation: 0,
          zIndex: 2,
        })
      }
    }

    // ── 4. Barcode Graphic (Fills remaining height) ──
    if (hasBarcode) {
      const isQr = visibleFields.barcodeType === 'qrcode'
      const barcodeTopY = currentY
      const bottomLimit = hasAnyFooter ? footerY - 0.5 : heightMm - 1.0
      const availableBarcodeH = Math.max(6, bottomLimit - barcodeTopY)
      const barcodeH = isQr
        ? Math.min(availableBarcodeH, Math.min(widthMm - 4, 18))
        : Math.min(22, availableBarcodeH)
      const barcodeW = isQr ? barcodeH : Math.max(10, widthMm - 4)
      const barcodeX = isQr ? Math.max(2, (widthMm - barcodeW) / 2) : 2

      resultElements.push({
        id: 'dyn-barcode',
        type: 'barcode',
        dataField: 'item.barcode',
        format: isQr ? 'qrcode' : 'code128',
        barWidth: 2,
        showText: isQr ? false : visibleFields.showBarcodeText,
        x: barcodeX,
        y: barcodeTopY,
        width: barcodeW,
        height: barcodeH,
        rotation: 0,
        zIndex: 1,
      })
    }

    return {
      ...selectedTemplate,
      elements: resultElements,
    }
  }, [selectedTemplate, visibleFields])

  /** One print job per click: exactly the listed quantities, in list order, never sent twice. */
  async function handlePrint(forceBrowserPrint = false) {
    if (printLock.current) return
    printLock.current = true
    setPrinting(true)
    try {
      await runPrint(forceBrowserPrint)
    } finally {
      printLock.current = false
      setPrinting(false)
    }
  }

  async function runPrint(forceBrowserPrint: boolean) {
    const templateToPrint = activeTemplate || selectedTemplate
    if (!templateToPrint) {
      toast.error('Please select a template')
      return
    }
    if (items.length === 0) {
      toast.error('Please add items to print')
      return
    }

    const defaultCols = (Number(templateToPrint.widthMm) || 38) <= 40 ? 2 : 1
    const tCols = templateToPrint.columns ?? (activeSetup?.columns ?? defaultCols)
    const effectiveSetup: StickerSetup = activeSetup || {
      id: `setup-auto-${tCols}`,
      name: `Auto ${tCols} Across`,
      labelWidthMm: Number(templateToPrint.widthMm) || 38,
      labelHeightMm: Number(templateToPrint.heightMm) || 25,
      columns: tCols,
      columnGapMm: tCols > 1 ? 2 : 0,
      rowGapMm: 2,
      marginLeftMm: tCols > 1 ? 1 : 0,
      offsetXMm: 0,
      offsetYMm: 0,
      dpi: 203,
      language: null,
      darkness: null,
      speed: null,
      direction: 1,
      warehouseId: null,
      locked: false,
      isDefault: false,
    }

    const printViaRoll = config.pageSize === 'Label'
    const direct = !forceBrowserPrint && isRawLabelPrinter(chosenPrinter)

    // Pre-print barcode check: never send an unscannable / unfindable barcode silently.
    const pf = preflightLabels(templateToPrint, items, {
      dpi: direct && chosenPrinter ? rawLabelDpi(chosenPrinter, effectiveSetup) : effectiveSetup.dpi,
      labelWidthMm: Number(templateToPrint.widthMm),
      tenantName: company?.tenantName,
    })
    if (pf.errors > 0) {
      const lines = pf.issues
        .filter((i) => i.severity === 'error')
        .slice(0, 6)
        .map((i) => `- ${i.itemName}: ${i.message}`)
        .join('\n')
      if (!window.confirm(`${pf.errors} barcode problem${pf.errors === 1 ? '' : 's'} - these labels would not scan at the POS:\n\n${lines}\n\nPrint anyway?`)) return
    }

    // Continuous roll: each page is one row plus its gap, the printer feeds exactly that (no gap sensing).
    const dialogSetup: StickerSetup = noGapSensing
      ? { ...effectiveSetup, labelHeightMm: effectiveSetup.labelHeightMm + effectiveSetup.rowGapMm, rowGapMm: 0 }
      : effectiveSetup
    const dialogPrint = () =>
      printViaRoll
        ? printLabelsOnRoll(templateToPrint, items, dialogSetup, currencySymbol, company?.tenantName, codeWord)
        : printLabels(templateToPrint, items, config, currencySymbol, company?.tenantName, codeWord)
    // Browser dialog: show the paper-size checklist first (unless dismissed for this size).
    // The checklist is awaited inside the print lock, so the job runs once and the button stays busy meanwhile.
    const viaDialog = async () => {
      if (printViaRoll && !browserGuideHidden(dialogSetup)) {
        const go = await new Promise<boolean>((done) =>
          setGuideJob({ done, rows: Math.ceil(totalLabels / Math.max(1, dialogSetup.columns)), setup: dialogSetup, continuous: noGapSensing })
        )
        setGuideJob(null)
        if (!go) return
      }
      if (!(await dialogPrint())) {
        toast.error('Chrome did not open the print dialog. Wait a few seconds and click Print once. If labels are stuck in the printer queue, clear the queue first.')
      }
    }

    if (direct && chosenPrinter) {
      let error: string
      try {
        const res = await printLabelsRaw(chosenPrinter, templateToPrint, items, {
          currencySymbol,
          tenantName: company?.tenantName,
          codeWord,
          setup: effectiveSetup,
        })
        if (res.ok) {
          const rows = Math.ceil(totalLabels / Math.max(1, effectiveSetup.columns))
          toast.success(`Sent ${totalLabels} label${totalLabels !== 1 ? 's' : ''} (${rows} row${rows !== 1 ? 's' : ''}) to ${chosenPrinter.name}`)
          if (res.warnings.length) toast.warning(res.warnings.slice(0, 2).join('; '))
          return
        }
        error = res.error || 'printer not reachable'
      } catch (e) {
        error = e instanceof Error ? e.message : 'print failed'
      }
      // Never reprint on our own: the printer may already have printed some or all labels before the error.
      toast.error(`${chosenPrinter.name}: ${error}`)
      if (
        window.confirm(
          `Printing to ${chosenPrinter.name} failed:\n${error}\n\nSome labels may already have printed - check the printer first.\n\nPrint all ${totalLabels} label${totalLabels !== 1 ? 's' : ''} again through the print dialog?`
        )
      ) {
        await viaDialog()
      }
      return
    }

    try {
      await viaDialog()
    } catch {
      toast.error('Failed to generate labels')
    }
  }

  // Live barcode check of the current list (shown under the items table).
  const preflight = useMemo(() => {
    const t = activeTemplate || selectedTemplate
    if (!t || items.length === 0) return null
    const raw = isRawLabelPrinter(chosenPrinter)
    return preflightLabels(t, items, {
      dpi: raw && chosenPrinter ? rawLabelDpi(chosenPrinter, activeSetup) : activeSetup?.dpi === 300 ? 300 : 203,
      labelWidthMm: Number(t.widthMm),
      tenantName: company?.tenantName,
    })
  }, [activeTemplate, selectedTemplate, items, chosenPrinter, activeSetup, company?.tenantName])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href={`/c/${company?.tenantSlug || ''}/items`}
              className="p-1.5 text-gray-400 hover:text-gray-700 rounded-md hover:bg-gray-100 transition-colors"
              title="Back to Items"
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
            onClick={() => handlePrint(false)}
            disabled={!selectedTemplate || items.length === 0 || printing}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 font-medium shadow-sm transition-colors"
          >
            <Printer size={16} />
            {printing ? 'Printing...' : chosenPrinter && isRawLabelPrinter(chosenPrinter) ? `Print to ${chosenPrinter.name}` : 'Print Labels'}
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
          {preflight && preflight.issues.length > 0 && (
            <div className={`rounded-lg border p-3 text-xs space-y-1 ${preflight.errors ? 'bg-red-50 border-red-300 text-red-900' : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
              <div className="font-semibold flex items-center gap-1.5">
                <AlertTriangle size={13} />
                {preflight.errors
                  ? `${preflight.errors} label${preflight.errors === 1 ? '' : 's'} would not scan - fix before printing`
                  : 'Barcode notes'}
              </div>
              <ul className="list-disc ml-5 space-y-0.5">
                {preflight.issues.slice(0, 8).map((i, k) => (
                  <li key={k}>
                    <b>{i.itemName}</b>: {i.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Right: Template & Preview */}
        <div className="space-y-3">
          {/* Advanced: print without the dialog (print helper / USB). Closed unless already in use. */}
          <details open={!!chosenPrinterId} className="bg-white rounded-lg border p-3 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-gray-600">Advanced: print without the Chrome dialog (optional)</summary>
            <div className="mt-3 space-y-3">
              <DirectLabelPrinterPanel
                setup={activeSetup}
                printers={printers}
                selectedId={chosenPrinterId}
                onSelect={choosePrinter}
                basePath={`/c/${company?.tenantSlug || ''}`}
              />
              <select
                value={chosenPrinterId}
                onChange={(e) => choosePrinter(e.target.value)}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm font-medium bg-white"
              >
                <option value="">Chrome print dialog (recommended)</option>
                {labelPrinters.length > 0 && (
                  <optgroup label="Direct label printers (no dialog)">
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
              <button
                type="button"
                onClick={() => setShowPrinterSettings(true)}
                className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-medium"
              >
                <Sliders size={12} />
                Manage printers
              </button>
            </div>
          </details>
          {/* Template selector */}
          <div className="bg-white rounded-lg border p-4 space-y-3">
            {!chosenPrinterId ? (
              <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800">
                Prints through Chrome. One time only: install the driver for your printer model (from the maker&apos;s website) and set its paper size to{' '}
                <b>{activeSetup ? `${stickerRollWidthMm(activeSetup)} x ${activeSetup.labelHeightMm + (noGapSensing ? activeSetup.rowGapMm : 0)} mm` : 'the label size'}</b>
                {noGapSensing ? <>, media type <b>Continuous</b></> : null}.
              </div>
            ) : (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
                Printing directly to <b>{chosenPrinter?.name}</b> (no dialog). To use Chrome instead, pick &quot;Chrome print dialog&quot; under Advanced.
              </div>
            )}
            {/* Quick Roll Type Selector: 1 Across, 2 Across (Twin), 3 Across */}
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-gray-700 flex items-center gap-1">
                  Sticker Roll Format:
                  <span className="text-[10px] font-normal text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                    Auto-calibrated for OS default / idle printer
                  </span>
                </label>
              </div>
              <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg border text-xs">
                {/* 1 Across: Single */}
                <button
                  type="button"
                  onClick={() => {
                    const singleSetup = availableSetups.find(s => s.columns === 1 && Math.abs(s.labelWidthMm - 38) <= 0.5) ||
                      availableSetups.find(s => s.columns === 1)
                    if (singleSetup) handleSetupChange(singleSetup.id)
                    const singleTpl = pickTemplate(availableTemplates, (t) => (t.columns ?? 1) === 1 && near(t.widthMm, 38), (t) => near(t.widthMm, 38), (t) => (t.columns ?? 1) === 1)
                    if (singleTpl) {
                      setSelectedTemplateId(singleTpl.id)
                      if (typeof window !== 'undefined') localStorage.setItem('sky_barcode_template_id', singleTpl.id)
                    }
                    if (typeof window !== 'undefined') localStorage.setItem('sky_barcode_roll_columns', '1')
                  }}
                  className={`py-2 px-1 rounded-md text-center transition-all ${
                    (activeSetup?.columns ?? 1) === 1
                      ? 'bg-white text-blue-700 font-bold shadow-xs border border-blue-400 ring-1 ring-blue-300'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                  }`}
                  title="Single sticker roll: 1 sticker per row (38 mm or standard roll)"
                >
                  <span className="block font-semibold">1 Across</span>
                  <span className="text-[10px] block opacity-80">Single · 38mm</span>
                </button>

                {/* 2 Across: Twin 80mm Roll */}
                <button
                  type="button"
                  onClick={() => {
                    const twinSetup = availableSetups.find(s => s.columns === 2 && Math.abs(s.labelWidthMm - 38) <= 0.5) ||
                      availableSetups.find(s => s.columns === 2)
                    if (twinSetup) handleSetupChange(twinSetup.id)
                    const twinTpl = rankTemplates(availableTemplates).find(t => (t.columns ?? 1) === 2 && Math.abs(Number(t.widthMm) - 38) <= 0.5) ||
                      rankTemplates(availableTemplates).find(t => (t.columns ?? 1) === 2)
                    if (twinTpl) {
                      setSelectedTemplateId(twinTpl.id)
                      if (typeof window !== 'undefined') localStorage.setItem('sky_barcode_template_id', twinTpl.id)
                    }
                    if (typeof window !== 'undefined') localStorage.setItem('sky_barcode_roll_columns', '2')
                  }}
                  className={`py-2 px-1 rounded-md text-center transition-all ${
                    (activeSetup?.columns ?? 1) === 2
                      ? 'bg-white text-blue-700 font-bold shadow-xs border border-blue-400 ring-1 ring-blue-300'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                  }`}
                  title="Twin stickers roll: 2 stickers side-by-side on 80 mm roll"
                >
                  <span className="block font-semibold">2 Across ★</span>
                  <span className="text-[10px] block opacity-80">Twin · 80mm Roll</span>
                </button>

                {/* 3 Across: Triple */}
                <button
                  type="button"
                  onClick={() => {
                    const tripleSetup = availableSetups.find(s => s.columns === 3 && Math.abs(s.labelWidthMm - 32) <= 1) ||
                      availableSetups.find(s => s.columns === 3)
                    if (tripleSetup) handleSetupChange(tripleSetup.id)
                    const tripleTpl = rankTemplates(availableTemplates).find(t => (t.columns ?? 1) === 3)
                    if (tripleTpl) {
                      setSelectedTemplateId(tripleTpl.id)
                      if (typeof window !== 'undefined') localStorage.setItem('sky_barcode_template_id', tripleTpl.id)
                    }
                    if (typeof window !== 'undefined') localStorage.setItem('sky_barcode_roll_columns', '3')
                  }}
                  className={`py-2 px-1 rounded-md text-center transition-all ${
                    (activeSetup?.columns ?? 1) === 3
                      ? 'bg-white text-blue-700 font-bold shadow-xs border border-blue-400 ring-1 ring-blue-300'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                  }`}
                  title="Triple stickers roll: 3 stickers side-by-side on 102-110 mm roll"
                >
                  <span className="block font-semibold">3 Across</span>
                  <span className="text-[10px] block opacity-80">Triple · 105mm</span>
                </button>
              </div>
              {sizeMismatch && (
                <div className="mt-1.5 p-2 bg-amber-50 border border-amber-300 rounded flex items-start gap-2 text-xs text-amber-800">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    <b>{rollWidthMm} mm</b> roll won&apos;t print fully on <b>{chosenPrinter!.name}</b> (its paper is only <b>{chosenPrinter!.label.widthMm} mm</b> wide — a {chosenPrinter!.label.widthMm <= 58 ? '2-inch' : chosenPrinter!.label.widthMm <= 80 ? '3-inch' : '4-inch'} printer).
                    The right sticker column would be clipped. Pick a 1-across setup, or use a printer that matches this roll.
                  </span>
                </div>
              )}
              {!chosenPrinterId && (
                <label className="mt-2 flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={noGapSensing} onChange={(e) => toggleNoGapSensing(e.target.checked)} />
                  <span>
                    My printer can&apos;t find the gaps (pressing FEED runs through many stickers). Print as a continuous roll:{' '}
                    {activeSetup ? `${activeSetup.labelHeightMm + activeSetup.rowGapMm} mm` : 'label + gap'} per row.
                  </span>
                </label>
              )}
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
                <option value="">Template size, auto columns</option>
                <optgroup label="Twin Sticker Rolls (2 across · Standard 80mm Roll)">
                  {availableSetups.filter(s => s.columns === 2).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.labelWidthMm} x {s.labelHeightMm} mm x 2 across){s.locked ? ' [locked]' : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Single Sticker Rolls (1 across · Single roll)">
                  {availableSetups.filter(s => s.columns === 1).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.labelWidthMm} x {s.labelHeightMm} mm){s.locked ? ' [locked]' : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Triple / Multi-across Rolls (3+ across · 105mm+)">
                  {availableSetups.filter(s => s.columns >= 3).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.labelWidthMm} x {s.labelHeightMm} mm x {s.columns} across){s.locked ? ' [locked]' : ''}
                    </option>
                  ))}
                </optgroup>
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

          {/* Information on Label Customizer (Enable/Disable Fields & Length Optimizer) */}
          <div className="bg-white rounded-lg border p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sliders size={16} className="text-blue-600" />
                <span className="text-sm font-semibold text-gray-900">Customise Label Information</span>
              </div>
              {selectedTemplateId && (
                <Link
                  href={`/c/${company?.tenantSlug || ''}/barcode/label-templates/${selectedTemplateId}`}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-medium"
                  title="Open in full template drag-and-drop designer"
                >
                  <Edit3 size={12} />
                  Full Designer
                </Link>
              )}
            </div>

            <p className="text-xs text-gray-500">
              Click to choose which product details print on this sticker:
            </p>

            {/* Quick 1-Click Presets */}
            <div>
              <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1">
                Quick 1-Click Presets:
              </span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setVisibleFields(prev => ({
                    ...prev,
                    showName: true,
                    nameLengthMode: 'initial',
                    showBarcode: true,
                    showBarcodeText: true,
                    showPrice: true,
                    showSku: true,
                    showCompany: false,
                    showVendor: false,
                    showCategory: false,
                    showUnit: false,
                    showPriceCode: false,
                  }))}
                  className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md border font-medium transition-colors"
                >
                  Standard
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleFields(prev => ({
                    ...prev,
                    showName: true,
                    nameLengthMode: 'initial',
                    showBarcode: true,
                    showBarcodeText: true,
                    showPrice: true,
                    showSku: true,
                    showCompany: false,
                    showVendor: true,
                    showCategory: false,
                    showUnit: false,
                    showPriceCode: false,
                  }))}
                  className="px-2 py-1 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-md font-medium transition-colors"
                >
                  + Vendor Name
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleFields(prev => ({
                    ...prev,
                    showName: true,
                    nameLengthMode: 'initial',
                    showBarcode: true,
                    showBarcodeText: true,
                    showPrice: true,
                    showSku: false,
                    showCompany: true,
                    showVendor: true,
                    showCategory: false,
                    showUnit: false,
                    showPriceCode: false,
                  }))}
                  className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md border font-medium transition-colors"
                >
                  Store + Vendor
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleFields(prev => ({
                    ...prev,
                    showName: false,
                    showBarcode: true,
                    showBarcodeText: true,
                    showPrice: true,
                    showSku: false,
                    showCompany: false,
                    showVendor: false,
                    showCategory: false,
                    showUnit: false,
                    showPriceCode: false,
                  }))}
                  className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md border font-medium transition-colors"
                >
                  Price + Barcode
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleFields(prev => ({
                    ...prev,
                    showName: true,
                    nameLengthMode: 'initial',
                    nameFontSize: 'small',
                    showBarcode: true,
                    showBarcodeText: false,
                    showPrice: true,
                    showSku: false,
                    showCompany: false,
                    showVendor: false,
                    showCategory: false,
                    showUnit: false,
                    showPriceCode: true,
                  }))}
                  className="px-2 py-1 text-xs bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 rounded-md font-medium transition-colors"
                >
                  Jewelry / Small Tag
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleFields(prev => ({
                    ...prev,
                    showName: true,
                    nameLengthMode: 'autofit',
                    showBarcode: true,
                    showBarcodeText: true,
                    showPrice: true,
                    showSku: true,
                    showCompany: true,
                    showVendor: true,
                    showCategory: true,
                    showUnit: true,
                    showPriceCode: true,
                  }))}
                  className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md border font-medium transition-colors"
                >
                  All Details
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleFields(prev => ({
                    ...prev,
                    showName: false,
                    showBarcode: true,
                    showBarcodeText: false,
                    showPrice: false,
                    showSku: false,
                    showCompany: false,
                    showVendor: false,
                    showCategory: false,
                    showUnit: false,
                    showPriceCode: false,
                  }))}
                  className="px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md border font-medium transition-colors"
                >
                  Barcode Only
                </button>
              </div>
            </div>

            {/* Product Name Length & Font Size Optimizer */}
            {visibleFields.showName && (
              <div className="p-2.5 bg-blue-50/60 rounded-md border border-blue-200 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-blue-900 flex items-center gap-1">
                    ✏️ Item Name Optimization:
                  </span>
                  <div className="flex items-center gap-1 text-[11px]">
                    <span className="text-gray-500">Size:</span>
                    {(['small', 'normal', 'large'] as const).map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setVisibleFields(prev => ({ ...prev, nameFontSize: s }))}
                        className={`px-1.5 py-0.5 rounded border capitalize transition-colors ${
                          visibleFields.nameFontSize === s
                            ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setVisibleFields(prev => ({ ...prev, nameLengthMode: 'initial' }))}
                    className={`flex-1 py-1 px-2 rounded text-xs font-medium border text-center transition-colors ${
                      visibleFields.nameLengthMode === 'initial'
                        ? 'bg-blue-600 text-white border-blue-600 font-semibold shadow-xs'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                    }`}
                    title="Keeps initial name cleanly on 1 line - never overlaps barcode below"
                  >
                    Initial Name (1 Line)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleFields(prev => ({ ...prev, nameLengthMode: 'autofit' }))}
                    className={`flex-1 py-1 px-2 rounded text-xs font-medium border text-center transition-colors ${
                      visibleFields.nameLengthMode === 'autofit'
                        ? 'bg-blue-600 text-white border-blue-600 font-semibold shadow-xs'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                    }`}
                    title="Automatically shrinks font so entire long product name fits on 1 line"
                  >
                    Auto-Shrink
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibleFields(prev => ({ ...prev, nameLengthMode: 'multiline' }))}
                    className={`flex-1 py-1 px-2 rounded text-xs font-medium border text-center transition-colors ${
                      visibleFields.nameLengthMode === 'multiline'
                        ? 'bg-blue-600 text-white border-blue-600 font-semibold shadow-xs'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                    }`}
                    title="Allows long product names to wrap onto 2 compact lines"
                  >
                    2 Lines
                  </button>
                </div>
              </div>
            )}

            {/* Barcode Options */}
            {visibleFields.showBarcode && (
              <div className="flex flex-col gap-2 p-2 bg-slate-50 rounded-md border text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-700">Barcode Symbology:</span>
                  <div className="flex rounded-md shadow-xs bg-slate-200 p-0.5">
                    <button
                      type="button"
                      onClick={() => setVisibleFields(prev => ({ ...prev, barcodeType: 'code128' }))}
                      className={`px-2 py-0.5 text-xs font-medium rounded ${visibleFields.barcodeType !== 'qrcode' ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      1D Barcode (Code 128)
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibleFields(prev => ({ ...prev, barcodeType: 'qrcode' }))}
                      className={`px-2 py-0.5 text-xs font-medium rounded ${visibleFields.barcodeType === 'qrcode' ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'}`}
                    >
                      2D QR Code
                    </button>
                  </div>
                </div>
                {visibleFields.barcodeType !== 'qrcode' && (
                  <div className="flex items-center justify-between pt-1 border-t border-slate-200">
                    <span className="text-gray-600">Numbers Below Bars:</span>
                    <label className="flex items-center gap-1.5 cursor-pointer text-gray-700 select-none">
                      <input
                        type="checkbox"
                        checked={visibleFields.showBarcodeText}
                        onChange={(e) => setVisibleFields(prev => ({ ...prev, showBarcodeText: e.target.checked }))}
                        className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span>Print numbers below bars</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Interactive Grid of Field Toggles */}
            <div className="grid grid-cols-2 gap-1.5 pt-2 border-t">
              <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={visibleFields.showName}
                  onChange={(e) => setVisibleFields((prev) => ({ ...prev, showName: e.target.checked }))}
                  className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-semibold text-gray-900">Product Name</span>
              </label>

              <label className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-gray-700 select-none">
                <input
                  type="checkbox"
                  checked={visibleFields.showVendor}
                  onChange={(e) => setVisibleFields((prev) => ({ ...prev, showVendor: e.target.checked }))}
                  className="rounded text-emerald-600 focus:ring-emerald-500 w-4 h-4 cursor-pointer"
                />
                <span className="font-semibold text-emerald-800 flex items-center gap-1">
                  Vendor / Supplier
                  <span className="px-1 py-0.2 text-[9px] bg-emerald-100 text-emerald-700 rounded font-bold">NEW</span>
                </span>
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
                <span className="font-medium">Cost Code (*)</span>
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
                  Twin Roll View ({activeSetup.columns} across)
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
                  <span>Target: <strong className="text-gray-700">{chosenPrinter ? chosenPrinter.name : 'Chrome print dialog'}</strong></span>
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
      {guideJob && (
        <BrowserLabelPrintGuide
          isOpen
          setup={guideJob.setup}
          rows={guideJob.rows}
          continuous={guideJob.continuous}
          onClose={() => guideJob.done(false)}
          onAlignmentTest={async () => {
            if (testLock.current) return
            testLock.current = true
            try {
              if (!(await printAlignmentTestDialog(guideJob.setup))) toast.error('Chrome did not open the print dialog. Wait a few seconds and try once more.')
            } finally {
              testLock.current = false
            }
          }}
          onContinue={() => guideJob.done(true)}
        />
      )}
    </div>
  )
}
