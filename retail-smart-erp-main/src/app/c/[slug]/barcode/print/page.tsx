'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { Printer, Minus, Plus, X, Search, Tag, Eye, ChevronLeft, ChevronRight, Sliders, Edit3, Lock, Ruler, ArrowLeft, Layout, AlertTriangle, RotateCcw } from 'lucide-react'
import { AsyncCreatableSelect } from '@/components/ui/async-creatable-select'
import { LabelPreview, type LabelPreviewRender } from '@/components/labels/LabelPreview'
import { ElementCustomizer } from '@/components/labels/ElementCustomizer'
import { PrinterSetupPanel } from '@/components/labels/PrinterSetupPanel'
import { useLabelPrintSetup } from '@/components/labels/useLabelPrintSetup'
import { printLabels, printLabelsOnRoll, printLabelsRaw, printAlignmentTestRaw, printAlignmentTestDialog } from '@/lib/labels/label-print'
import { useDirectLabelPrinter } from '@/hooks/useDirectZebra'
import { PrintAgentInstallCommands } from '@/components/print/PrintAgentInstallCommands'
import { preflightLabels } from '@/lib/print/label/preflight'
import { guessLabelPrinter } from '@/lib/print/label/printer-detect'
import { StickerRollPreview } from '@/components/labels/StickerRollPreview'
import { useStickerSetups } from '@/hooks/useStickerSetups'
import { usePermission } from '@/hooks/usePermission'
import {
  DEFAULT_STICKER_SETUP,
  defaultStickerSetup,
  sanitizeStickerSetup,
  setupsForBranch,
  stickerRollWidthMm,
  STICKER_PRESETS,
  setupFromPreset,
  type StickerSetup,
} from '@/lib/labels/sticker-stock'
import {
  applyElementTweaks,
  buildQuickLayout,
  fieldsFromTemplate,
  presetFields,
  QUICK_PRESETS,
  type ElementTweak,
  type LabelPrintSetup,
  type PrintLanguage,
  type QuickFields,
} from '@/lib/labels/print-setup'
import { LABEL_PRESETS } from '@/lib/labels/presets'
import { toast } from '@/components/ui/toast'
import { useTenantCurrency } from '@/hooks'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import type { LabelTemplate, LabelItemData } from '@/lib/labels/types'
import type { AsyncSelectOption } from '@/components/ui/async-creatable-select'

interface ItemWithQty {
  item: LabelItemData
  quantity: number
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

/** Built-in / seeded templates use the quick layout by default; the shop's own designs print as designed. */
const isBuiltinTemplate = (t: LabelTemplate) => t.id.startsWith('preset-') || LABEL_PRESETS.some((p) => p.name === t.name)

const readLocal = (key: string) => {
  try {
    return typeof window !== 'undefined' ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}
const writeLocal = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

const FIELD_TOGGLES: { key: keyof QuickFields; label: string }[] = [
  { key: 'showName', label: 'Product Name' },
  { key: 'showVendor', label: 'Vendor / Supplier' },
  { key: 'showBarcode', label: 'Barcode Graphic' },
  { key: 'showPrice', label: 'Selling Price' },
  { key: 'showSku', label: 'SKU / Code' },
  { key: 'showCompany', label: 'Store Name' },
  { key: 'showCategory', label: 'Category' },
  { key: 'showUnit', label: 'Unit (pcs/kg)' },
  { key: 'showPriceCode', label: 'Cost Code (*)' },
]

export default function BarcodePrintPage() {
  const [templates, setTemplates] = useState<LabelTemplate[] | null>(null)
  const [selectedTemplateIdLocal, setSelectedTemplateId] = useState<string>('')
  const [items, setItems] = useState<ItemWithQty[]>([])
  const [searchValue, setSearchValue] = useState('')
  const [codeWord, setCodeWord] = useState<string>('')
  const [previewIndex, setPreviewIndex] = useState(0)
  const [showFullPreview, setShowFullPreview] = useState(false)
  const [previewMode, setPreviewMode] = useState<'roll' | 'single'>('single')
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const { symbol: currencySymbol } = useTenantCurrency()
  const company = useCompanyOptional()

  // The shop's print setup (printer, roll, layout, element tweaks, lock) - stored for the shop
  const ps = useLabelPrintSetup()
  const setup = ps.setup
  const locked = setup.locked
  const update = ps.update

  const [printing, setPrinting] = useState(false)
  // Chrome print preview (default) or straight to the label printer through the print helper (per PC)
  const direct = useDirectLabelPrinter({ language: setup.printer.language, dpi: setup.printer.dpi })
  // Set synchronously on click: a second click before React re-renders must not start a second job.
  const printLock = useRef(false)

  // Browser-dialog options (stored with the setup)
  const noGapSensing = setup.chrome.noGapSensing
  const rowGapOverride = setup.chrome.rowGapMm
  const offsetOverride = setup.chrome.offsetYMm
  const config = { labelsPerRow: 3, gapMm: setup.chrome.sheetGapMm, pageSize: setup.chrome.pageSize }
  const setChrome = (patch: Partial<LabelPrintSetup['chrome']>) => update((s) => ({ ...s, chrome: { ...s.chrome, ...patch } }))
  const changeRowGap = (mm: number) => setChrome({ rowGapMm: Math.max(0, Math.min(10, Math.round(mm * 2) / 2)) })
  const changeOffset = (mm: number) => setChrome({ offsetYMm: Math.max(-10, Math.min(10, Math.round(mm * 2) / 2)) })

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

  const fallbackSetup = defaultStickerSetup(availableSetups)
  // A locked default roll cannot be switched by cashiers
  const forcedSetup = !isAdmin && fallbackSetup?.locked ? fallbackSetup : null
  const [setupChoiceLocal, setSetupChoice] = useState<string | null>(() => {
    const savedSetupId = readLocal('sky_barcode_setup_id')
    if (savedSetupId) return savedSetupId
    const savedCols = readLocal('sky_barcode_roll_columns')
    if (savedCols === '1') return '38x25x1'
    if (savedCols === '3') return '32x25x3'
    return '38x25x2'
  })
  // A locked print setup prints with its own roll
  const setupChoice = locked && setup.layout.setupId ? setup.layout.setupId : setupChoiceLocal
  // A remembered built-in roll id (e.g. '38x25x2') is replaced in the list by the tenant's own saved copy of
  // that roll (same size and columns): resolve to that copy so its calibration (row gap, offsets) is used.
  const chosenSetup = (() => {
    if (setupChoice === null) return null
    const byId = availableSetups.find((s) => s.id === setupChoice)
    if (byId) return byId
    const preset = STICKER_PRESETS.find((p) => p.id === setupChoice)
    return preset
      ? availableSetups.find((s) => s.columns === preset.columns && near(s.labelWidthMm, preset.labelWidthMm) && near(s.labelHeightMm, preset.labelHeightMm)) || null
      : null
  })()
  // Roll typed in Printer setup
  const mediaRoll = useMemo(
    () => (setup.media ? sanitizeStickerSetup({ ...DEFAULT_STICKER_SETUP, ...setup.media, id: 'print-setup-roll', name: 'Typed roll (Printer setup)' }) : null),
    [setup.media]
  )
  const baseRoll: StickerSetup | null = locked
    ? mediaRoll ?? chosenSetup ?? fallbackSetup ?? null
    : forcedSetup ?? mediaRoll ?? (setupChoice !== null ? chosenSetup : fallbackSetup || availableSetups[0] || null)
  // Printer setup values (dpi, darkness, speed) win over the roll's
  const activeSetup: StickerSetup | null = useMemo(
    () =>
      baseRoll
        ? {
            ...baseRoll,
            dpi: setup.printer.dpi ?? baseRoll.dpi,
            darkness: setup.printer.darkness ?? baseRoll.darkness,
            speed: setup.printer.speed ?? baseRoll.speed,
          }
        : null,
    [baseRoll, setup.printer.dpi, setup.printer.darkness, setup.printer.speed]
  )
  const dpi = activeSetup?.dpi ?? setup.printer.dpi ?? 203

  // Fetch templates and label settings on mount, and re-fetch on window focus (the list only)
  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/label-templates')
      if (res.ok) setTemplates(await res.json())
    } catch {
      toast.error('Failed to load templates')
    }
  }, [])
  useEffect(() => {
    // fetchTemplates() sets state after the request answers
    void fetchTemplates()
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
    const list = [...(templates || [])]
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

  // The template is picked once, when the templates and the shop's setup are loaded. Later refreshes (window
  // focus, e.g. when Chrome's print dialog closes) only update the list, so the label never changes by itself.
  const templatePicked = useRef(false)
  useEffect(() => {
    if (templatePicked.current || !templates || !ps.loaded) return
    templatePicked.current = true
    const data = templates
    const params = new URLSearchParams(window.location.search)
    const reqTplId = params.get('templateId')
    const exists = (id: string | null) =>
      !!id && (data.some((t) => t.id === id) || LABEL_PRESETS.some((p) => `preset-${p.id}` === id))
    if (setup.layout.setupId) setSetupChoice(setup.layout.setupId)
    let pick: string | undefined
    if (reqTplId && !locked) pick = reqTplId
    else if (exists(setup.layout.templateId)) pick = setup.layout.templateId!
    else if (exists(readLocal('sky_barcode_template_id'))) pick = readLocal('sky_barcode_template_id')!
    else {
      const savedCols = readLocal('sky_barcode_roll_columns')
      if (savedCols === '1') {
        pick = (pickTemplate(data, (t) => (t.columns ?? 1) === 1 && near(t.widthMm, 38), (t) => near(t.widthMm, 38), (t) => (t.columns ?? 1) === 1) || data[0])?.id
      } else if (savedCols === '3') {
        pick = (rankTemplates(data).find((t) => (t.columns ?? 1) === 3) || data[0])?.id
      } else {
        // Default to Twin Stickers (2 Across on 80mm roll, 38x25 mm)
        const twin38x25 = rankTemplates(data).find((t) => (t.columns ?? 1) === 2 && near(t.widthMm, 38) && near(t.heightMm, 25))
        const twinAny = rankTemplates(data).find((t) => (t.columns ?? 1) === 2)
        pick = (twin38x25 || twinAny || rankTemplates(data).find((t) => t.isDefault) || data[0])?.id
      }
    }
    if (pick) setSelectedTemplateId(pick)
  }, [templates, ps.loaded, setup.layout.setupId, setup.layout.templateId, locked])

  const selectedTemplateId = locked && setup.layout.templateId ? setup.layout.templateId : selectedTemplateIdLocal
  const selectedTemplate = rankTemplates(availableTemplates).find(t => t.id === selectedTemplateId) ||
    rankTemplates(availableTemplates).find(t => (t.columns ?? 1) === (activeSetup?.columns ?? 2) && Math.abs(Number(t.widthMm) - (activeSetup?.labelWidthMm ?? 38)) <= 0.5) ||
    rankTemplates(availableTemplates).find(t => (t.columns ?? 1) === (activeSetup?.columns ?? 2)) ||
    availableTemplates[0] ||
    null

  const chooseTemplate = (id: string) => {
    if (locked) return
    setSelectedTemplateId(id)
    setSelectedElementId(null)
    writeLocal('sky_barcode_template_id', id)
    update((s) => ({ ...s, layout: { ...s.layout, templateId: id || null } }))
  }

  // Auto-sync roll setup when a template of another size is selected (not while locked or with a typed roll)
  useEffect(() => {
    if (!selectedTemplate || locked || setup.media) return
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
        writeLocal('sky_barcode_setup_id', match.id)
        writeLocal('sky_barcode_roll_columns', String(match.columns))
      }
    }
  }, [selectedTemplate, availableSetups, activeSetup, locked, setup.media])

  // Handle switching roll layout: auto-switch template if dimension mismatches
  const handleSetupChange = (id: string) => {
    if (locked) return
    setSetupChoice(id)
    writeLocal('sky_barcode_setup_id', id)
    let tplId: string | null = null
    const chosen = id ? availableSetups.find(s => s.id === id) : null
    if (chosen) {
      writeLocal('sky_barcode_roll_columns', String(chosen.columns))
      // A template is one sticker: keep it while its size matches the roll (columns are the roll's)
      const currentMatches = selectedTemplate &&
        near(selectedTemplate.widthMm, chosen.labelWidthMm) &&
        near(selectedTemplate.heightMm, chosen.labelHeightMm)
      if (!currentMatches) {
        const sameSize = (t: LabelTemplate) => near(t.widthMm, chosen.labelWidthMm) && near(t.heightMm, chosen.labelHeightMm)
        const matchingTpl = pickTemplate(availableTemplates, (t) => sameSize(t) && (t.columns ?? 1) === chosen.columns, sameSize, (t) => (t.columns ?? 1) === chosen.columns)
        if (matchingTpl) {
          tplId = matchingTpl.id
          setSelectedTemplateId(matchingTpl.id)
          writeLocal('sky_barcode_template_id', matchingTpl.id)
        }
      }
    }
    // picking a roll from the list replaces a roll typed in Printer setup
    update((s) => ({ ...s, media: null, layout: { ...s.layout, setupId: id || null, ...(tplId ? { templateId: tplId } : {}) } }))
  }

  const quickRoll = (cols: 1 | 2 | 3) => {
    if (locked) return
    const roll =
      cols === 1
        ? availableSetups.find(s => s.columns === 1 && Math.abs(s.labelWidthMm - 38) <= 0.5) || availableSetups.find(s => s.columns === 1)
        : cols === 2
          ? availableSetups.find(s => s.columns === 2 && Math.abs(s.labelWidthMm - 38) <= 0.5) || availableSetups.find(s => s.columns === 2)
          : availableSetups.find(s => s.columns === 3 && Math.abs(s.labelWidthMm - 32) <= 1) || availableSetups.find(s => s.columns === 3)
    if (roll) handleSetupChange(roll.id)
    const tpl =
      cols === 1
        ? pickTemplate(availableTemplates, (t) => (t.columns ?? 1) === 1 && near(t.widthMm, 38), (t) => near(t.widthMm, 38), (t) => (t.columns ?? 1) === 1)
        : cols === 2
          ? rankTemplates(availableTemplates).find(t => (t.columns ?? 1) === 2 && Math.abs(Number(t.widthMm) - 38) <= 0.5) || rankTemplates(availableTemplates).find(t => (t.columns ?? 1) === 2)
          : rankTemplates(availableTemplates).find(t => (t.columns ?? 1) === 3)
    if (tpl) chooseTemplate(tpl.id)
    writeLocal('sky_barcode_roll_columns', String(cols))
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

  // ── Layout: quick layout (fields) or the template as designed, plus the per-element tweaks ──
  const preset = setup.layout.preset
  const presetState = setup.layout.presets[preset]
  const source: 'quick' | 'designed' = setup.layout.source ?? (selectedTemplate && !isBuiltinTemplate(selectedTemplate) ? 'designed' : 'quick')
  const visibleFields: QuickFields = useMemo(
    () => presetState?.fields ?? (preset === 'custom' ? fieldsFromTemplate(selectedTemplate) : presetFields(preset)),
    [presetState, preset, selectedTemplate]
  )
  const setVisibleFields = (fn: (f: QuickFields) => QuickFields) =>
    update((s) => {
      const cur = s.layout.presets[s.layout.preset]
      return { ...s, layout: { ...s.layout, presets: { ...s.layout.presets, [s.layout.preset]: { ...cur, fields: fn(cur?.fields ?? visibleFields) } } } }
    })
  const choosePreset = (id: string) => {
    setSelectedElementId(null)
    update((s) => ({ ...s, layout: { ...s.layout, preset: id, source: 'quick' } }))
  }
  const resetPreset = () =>
    update((s) => {
      const presets = { ...s.layout.presets }
      delete presets[s.layout.preset]
      return { ...s, layout: { ...s.layout, presets } }
    })

  // Size the quick layout is built for: a roll typed in Printer setup wins over the template size
  const labelW = setup.media ? setup.media.labelWidthMm : Number(selectedTemplate?.widthMm) || 50
  const labelH = setup.media ? setup.media.labelHeightMm : Number(selectedTemplate?.heightMm) || 30
  const baseElements = useMemo(
    () => (!selectedTemplate ? [] : source === 'designed' ? selectedTemplate.elements || [] : buildQuickLayout(labelW, labelH, visibleFields)),
    [selectedTemplate, source, labelW, labelH, visibleFields]
  )
  const tweaks = useMemo(
    () => (source === 'designed' ? (selectedTemplate ? setup.layout.templateTweaks[selectedTemplate.id] : undefined) : presetState?.tweaks) || {},
    [source, selectedTemplate, setup.layout.templateTweaks, presetState]
  )
  const setTweak = (id: string, t: ElementTweak | null) => {
    if (!selectedTemplate) return
    const tplId = selectedTemplate.id
    update((s) => {
      if (source === 'designed') {
        const map = { ...(s.layout.templateTweaks[tplId] || {}) }
        if (t) map[id] = t
        else delete map[id]
        return { ...s, layout: { ...s.layout, templateTweaks: { ...s.layout.templateTweaks, [tplId]: map } } }
      }
      const cur = s.layout.presets[s.layout.preset] || {}
      const map = { ...(cur.tweaks || {}) }
      if (t) map[id] = t
      else delete map[id]
      return { ...s, layout: { ...s.layout, presets: { ...s.layout.presets, [s.layout.preset]: { ...cur, tweaks: map } } } }
    })
  }

  // What prints and what the preview shows
  const activeTemplate = useMemo<LabelTemplate | null>(() => {
    if (!selectedTemplate) return null
    return {
      ...selectedTemplate,
      ...(source === 'quick' && setup.media ? { widthMm: String(labelW), heightMm: String(labelH) } : {}),
      elements: applyElementTweaks(baseElements, tweaks),
    } as LabelTemplate
  }, [selectedTemplate, source, setup.media, labelW, labelH, baseElements, tweaks])

  // ── Printer language and how the preview is drawn ──
  const target = direct.targets.find((t) => t.name === direct.printer) || null
  const guessedLanguage: PrintLanguage | null = target ? (() => {
    const g = guessLabelPrinter(target.name, target.driver).language
    return g === 'epl' || g === 'tspl' ? g : 'zpl'
  })() : null
  const rawLanguage: PrintLanguage = setup.printer.language ?? guessedLanguage ?? 'zpl'
  const directOn = direct.mode === 'direct' && config.pageSize === 'Label'
  const previewRender: LabelPreviewRender = directOn
    ? rawLanguage === 'driver' || rawLanguage === 'escpos-raster' || setup.printer.renderMode === 'exact'
      ? { mode: 'raster', dpi }
      : { mode: 'native', dpi, language: rawLanguage }
    : { mode: 'html', dpi }
  const rawOverrides = { language: setup.printer.language, dpi: setup.printer.dpi, renderMode: setup.printer.renderMode }

  function effectiveRoll(templateToPrint: LabelTemplate): StickerSetup {
    const defaultCols = (Number(templateToPrint.widthMm) || 38) <= 40 ? 2 : 1
    const tCols = templateToPrint.columns ?? (activeSetup?.columns ?? defaultCols)
    return activeSetup || sanitizeStickerSetup({
      id: `setup-auto-${tCols}`,
      name: `Auto ${tCols} Across`,
      labelWidthMm: Number(templateToPrint.widthMm) || 38,
      labelHeightMm: Number(templateToPrint.heightMm) || 25,
      columns: tCols,
      columnGapMm: tCols > 1 ? 2 : 0,
      rowGapMm: 2,
      marginLeftMm: tCols > 1 ? 1 : 0,
      dpi: setup.printer.dpi ?? 203,
      darkness: setup.printer.darkness,
      speed: setup.printer.speed,
    })
  }

  /** One print job per click: exactly the listed quantities, in list order, never sent twice. */
  async function handlePrint() {
    if (printLock.current) return
    printLock.current = true
    setPrinting(true)
    try {
      await runPrint()
    } finally {
      printLock.current = false
      setPrinting(false)
    }
  }

  async function runPrint() {
    const templateToPrint = activeTemplate || selectedTemplate
    if (!templateToPrint) {
      toast.error('Please select a template')
      return
    }
    if (items.length === 0) {
      toast.error('Please add items to print')
      return
    }
    const effectiveSetup = effectiveRoll(templateToPrint)
    const printViaRoll = config.pageSize === 'Label'

    // Pre-print barcode check: never send an unscannable / unfindable barcode silently.
    const pf = preflightLabels(templateToPrint, items, {
      dpi: effectiveSetup.dpi,
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
    const shifted: StickerSetup = { ...effectiveSetup, offsetYMm: effectiveSetup.offsetYMm + offsetOverride }
    const dialogSetup: StickerSetup = noGapSensing
      ? { ...shifted, labelHeightMm: shifted.labelHeightMm + (rowGapOverride ?? shifted.rowGapMm), rowGapMm: 0 }
      : shifted
    // Direct to label printer: printer commands straight to the printer (gap sensing before every row).
    if (direct.mode === 'direct' && printViaRoll) {
      if (!direct.profile) {
        toast.error(direct.state === 'missing' ? 'The print helper is not running on this PC. Install or start it (see "Direct to label printer"), or switch to Chrome print preview.' : 'Choose the printer under "Direct to label printer" first.')
        return
      }
      try {
        const res = await printLabelsRaw(direct.profile, templateToPrint, items, { currencySymbol, tenantName: company?.tenantName, codeWord, setup: shifted, ...rawOverrides })
        if (res.ok) {
          toast.success(`Sent ${totalLabels} label${totalLabels === 1 ? '' : 's'} to ${direct.profile.name}`)
          if (res.warnings.length) toast.warning(res.warnings.slice(0, 2).join('; '))
        } else {
          // never reprint on our own: some labels may already be out
          toast.error(`${direct.profile.name}: ${res.error || 'print failed'}. Check the printer before printing again.`)
        }
      } catch (e) {
        toast.error(`${direct.profile.name}: ${e instanceof Error ? e.message : 'print failed'}. Check the printer before printing again.`)
      }
      return
    }

    const dialogPrint = () =>
      printViaRoll
        ? printLabelsOnRoll(templateToPrint, items, dialogSetup, currencySymbol, company?.tenantName, codeWord)
        : printLabels(templateToPrint, items, config, currencySymbol, company?.tenantName, codeWord)
    // One click = Chrome's print preview with every page; the user prints from there.
    try {
      if (!(await dialogPrint())) {
        toast.error('Chrome did not open the print preview. Wait a few seconds and click Print once.')
      }
    } catch {
      toast.error('Failed to generate labels')
    }
  }

  async function testPrint() {
    const tpl = activeTemplate || selectedTemplate
    const roll = tpl ? effectiveRoll(tpl) : activeSetup
    if (!roll) {
      toast.error('Pick a label roll first')
      return
    }
    const shifted: StickerSetup = { ...roll, offsetYMm: roll.offsetYMm + offsetOverride }
    setTesting(true)
    try {
      if (direct.mode === 'direct') {
        if (!direct.profile) {
          toast.error('Choose the printer under "Direct to label printer" first.')
          return
        }
        const res = await printAlignmentTestRaw(direct.profile, shifted, rawOverrides)
        if (res.ok) toast.success('Test sent: boxes 1 2 / 3 4 should sit inside the stickers')
        else toast.error(res.error || 'Test print failed')
      } else {
        const dialogSetup: StickerSetup = noGapSensing ? { ...shifted, labelHeightMm: shifted.labelHeightMm + (rowGapOverride ?? shifted.rowGapMm), rowGapMm: 0 } : shifted
        if (!(await printAlignmentTestDialog(dialogSetup))) toast.error('Chrome did not open the print preview')
      }
    } finally {
      setTesting(false)
    }
  }

  const lockSetup = () =>
    ps.lock((s) => ({
      ...s,
      layout: { ...s.layout, templateId: selectedTemplate?.id ?? s.layout.templateId, setupId: setup.media ? s.layout.setupId : activeSetup?.id ?? s.layout.setupId, source },
    }))

  // Live barcode check of the current list (shown under the items table).
  const preflight = useMemo(() => {
    const t = activeTemplate || selectedTemplate
    if (!t || items.length === 0) return null
    return preflightLabels(t, items, {
      dpi,
      labelWidthMm: Number(t.widthMm),
      tenantName: company?.tenantName,
    })
  }, [activeTemplate, selectedTemplate, items, dpi, company?.tenantName])

  const previewTemplate = activeTemplate || selectedTemplate
  const previewCaption =
    previewRender.mode === 'raster'
      ? `Exactly what the printer gets (${dpi} dpi picture)`
      : previewRender.mode === 'native'
        ? `Printer fonts (${rawLanguage.toUpperCase()}): long text is cut like on the printer`
        : 'Chrome print preview'

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
            {locked && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                <Lock size={11} /> Setup locked
              </span>
            )}
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
            onClick={() => handlePrint()}
            disabled={!selectedTemplate || items.length === 0 || printing}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50 font-medium shadow-sm transition-colors"
          >
            <Printer size={16} />
            {printing ? (direct.mode === 'direct' ? 'Sending to printer...' : 'Opening Chrome print...') : 'Print Labels'}
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
        {/* Left: Items List + Preview */}
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

          {/* Preview + click-to-adjust */}
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
                <Eye size={15} className="text-blue-600" />
                Label Preview
              </h3>
              {previewTemplate && (
                <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                  {parseFloat(String(previewTemplate.widthMm))} × {parseFloat(String(previewTemplate.heightMm))} mm
                  {activeSetup && activeSetup.columns > 1 ? ` (${activeSetup.columns} across roll)` : ''}
                </span>
              )}
            </div>

            {/* View Mode Toggle for Multi-column rolls (e.g. 38x25 twin stickers) */}
            {activeSetup && activeSetup.columns > 1 && (
              <div className="flex items-center bg-slate-100 p-1 rounded-md text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setPreviewMode('single')}
                  className={`flex-1 py-1 px-2 rounded transition-colors text-center ${previewMode === 'single' ? 'bg-white text-blue-700 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  One sticker (click to adjust)
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('roll')}
                  className={`flex-1 py-1 px-2 rounded transition-colors text-center ${previewMode === 'roll' ? 'bg-white text-blue-700 shadow-sm font-semibold' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  On the roll ({activeSetup.columns} across)
                </button>
              </div>
            )}

            {previewTemplate ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
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
                  {activeSetup && activeSetup.columns > 1 && previewMode === 'roll' ? (
                    <div className="p-3 bg-slate-100/80 dark:bg-slate-800/60 rounded-lg border border-dashed border-gray-300 dark:border-gray-700">
                      <StickerRollPreview
                        setup={activeSetup}
                        template={previewTemplate}
                        items={items}
                        currencySymbol={currencySymbol}
                        tenantName={company?.tenantName}
                        codeWord={codeWord}
                        maxRows={2}
                        render={previewRender}
                      />
                    </div>
                  ) : (
                    <div className="p-4 bg-slate-100/70 dark:bg-slate-800/50 rounded-lg flex flex-col items-center justify-center border border-dashed border-gray-200 dark:border-gray-700 min-h-[160px]">
                      <LabelPreview
                        template={previewTemplate}
                        item={items[previewIndex]?.item || null}
                        currencySymbol={currencySymbol}
                        tenantName={company?.tenantName}
                        codeWord={codeWord}
                        maxWidth={340}
                        render={previewRender}
                        onElementClick={setSelectedElementId}
                        selectedId={selectedElementId}
                      />
                      {items.length === 0 && (
                        <p className="text-[11px] text-gray-400 mt-2 italic">Sample preview • Add items to preview real products</p>
                      )}
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{previewCaption}</span>
                    <button
                      type="button"
                      onClick={() => setShowFullPreview(true)}
                      className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                    >
                      <Eye size={12} />
                      Enlarge
                    </button>
                  </div>
                </div>
                <ElementCustomizer
                  elements={baseElements}
                  tweaks={tweaks}
                  selectedId={selectedElementId}
                  onSelect={(id) => {
                    setSelectedElementId(id)
                    if (id && activeSetup && activeSetup.columns > 1) setPreviewMode('single')
                  }}
                  onChange={setTweak}
                  disabled={locked}
                />
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 text-sm">
                Select a template to see the preview
              </div>
            )}
          </div>
        </div>

        {/* Right: how to print, roll, template, fields, printer setup */}
        <div className="space-y-3">
          <div className="bg-white rounded-lg border p-4 space-y-3">
            <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-lg text-xs" role="radiogroup" aria-label="How to print">
              {([['chrome', 'Chrome print preview', 'Any printer, via its driver'], ['direct', 'Direct to label printer', 'Exact, no preview (print helper)']] as const).map(([m, title, sub]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={direct.mode === m}
                  onClick={() => direct.setMode(m)}
                  className={`px-2 py-1.5 rounded-md text-left transition-all ${direct.mode === m ? 'bg-white text-blue-700 font-semibold shadow-xs border border-blue-400' : 'text-gray-600 hover:bg-gray-200/50'}`}
                >
                  <span className="block">{title}</span>
                  <span className="block text-[10px] font-normal opacity-80">{sub}</span>
                </button>
              ))}
            </div>
            {direct.mode === 'direct' ? (
              <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-900 space-y-2">
                {direct.state === 'checking' || direct.state === 'idle' ? (
                  <div>Looking for the skyERPOS print helper on this PC…</div>
                ) : direct.state === 'missing' ? (
                  <>
                    <div>
                      <b>One time on this PC:</b> install the skyERPOS print helper, then click <b>Check again</b>. It sends the labels straight to
                      the label printer (no Windows driver settings, no Chrome preview).
                    </div>
                    <PrintAgentInstallCommands downloadBase={`/c/${company?.tenantSlug || ''}`} />
                    <button type="button" onClick={() => direct.check()} className="px-2 py-1 rounded border border-blue-300 bg-white hover:bg-blue-100 font-medium">
                      Check again
                    </button>
                  </>
                ) : direct.targets.length === 0 ? (
                  <div>
                    The print helper is running but sees no installed printer. Install the printer driver, then{' '}
                    <button type="button" onClick={() => direct.check()} className="underline font-semibold">check again</button>.
                  </div>
                ) : (
                  <>
                    <label className="flex items-center gap-2">
                      <span className="shrink-0">Printer (this PC):</span>
                      <select value={direct.printer} onChange={(e) => direct.setPrinter(e.target.value)} className="flex-1 min-w-0 border rounded px-1.5 py-1 bg-white text-gray-900">
                        {direct.targets.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                      </select>
                    </label>
                    <div>
                      Sends the labels in <b>{setup.printer.language ? rawLanguage.toUpperCase() : `${rawLanguage.toUpperCase()} (auto)`}</b>. The printer finds
                      the gap before every row. Wrong language or brand? Change it under <b>Printer setup</b> below.
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-800">
                Print opens Chrome&apos;s print preview. One time only: install your printer model&apos;s driver and set its paper size to{' '}
                <b>{activeSetup ? `${stickerRollWidthMm(activeSetup)} x ${activeSetup.labelHeightMm + (noGapSensing ? rowGapOverride ?? activeSetup.rowGapMm : 0)} mm` : 'the label size'}</b>
                {noGapSensing ? <>, media type <b>Continuous</b></> : null}. In Chrome: More settings → that paper size, Margins None.{' '}
                <Link href={`/c/${company?.tenantSlug || ''}/barcode/settings`} className="font-semibold underline">
                  Printer setup command
                </Link>
              </div>
            )}

            <fieldset disabled={locked} className="space-y-3">
              {/* Quick Roll Type Selector: 1 Across, 2 Across (Twin), 3 Across */}
              <div className="pt-1">
                <label className="text-xs font-semibold text-gray-700 block mb-1.5">Sticker Roll Format:</label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg border text-xs">
                  {([
                    [1, '1 Across', 'Single · 38mm'],
                    [2, '2 Across ★', 'Twin · 80mm Roll'],
                    [3, '3 Across', 'Triple · 105mm'],
                  ] as const).map(([cols, title, sub]) => (
                    <button
                      key={cols}
                      type="button"
                      onClick={() => quickRoll(cols)}
                      className={`py-2 px-1 rounded-md text-center transition-all ${
                        (activeSetup?.columns ?? 1) === cols
                          ? 'bg-white text-blue-700 font-bold shadow-xs border border-blue-400 ring-1 ring-blue-300'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/50'
                      }`}
                    >
                      <span className="block font-semibold">{title}</span>
                      <span className="text-[10px] block opacity-80">{sub}</span>
                    </button>
                  ))}
                </div>
                {direct.mode === 'chrome' && (
                  <label className="mt-2 flex items-start gap-2 text-xs text-gray-700 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={noGapSensing} onChange={(e) => setChrome({ noGapSensing: e.target.checked })} />
                    <span>
                      My printer can&apos;t find the gaps (pressing FEED runs through many stickers). Print as a continuous roll:{' '}
                      {activeSetup ? `${activeSetup.labelHeightMm + (rowGapOverride ?? activeSetup.rowGapMm)} mm` : 'label + gap'} per row.
                    </span>
                  </label>
                )}
                {direct.mode === 'chrome' && noGapSensing && activeSetup && (
                  <div className="mt-1.5 ml-5 text-xs text-gray-700">
                    <div className="flex items-center gap-2">
                      <span>Gap between rows:</span>
                      <button type="button" onClick={() => changeRowGap((rowGapOverride ?? activeSetup.rowGapMm) - 0.5)} className="p-0.5 border rounded hover:bg-gray-100" aria-label="Smaller gap">
                        <Minus size={12} />
                      </button>
                      <b className="w-12 text-center">{(rowGapOverride ?? activeSetup.rowGapMm).toFixed(1)} mm</b>
                      <button type="button" onClick={() => changeRowGap((rowGapOverride ?? activeSetup.rowGapMm) + 0.5)} className="p-0.5 border rounded hover:bg-gray-100" aria-label="Bigger gap">
                        <Plus size={12} />
                      </button>
                    </div>
                    <div className="text-gray-500 mt-0.5">
                      Later stickers print too high (into the gap above)? Make it bigger. Too low? Make it smaller. Change the printer&apos;s paper height to match:{' '}
                      {activeSetup.labelHeightMm + (rowGapOverride ?? activeSetup.rowGapMm)} mm.
                    </div>
                  </div>
                )}
                {activeSetup && (
                  <div className="mt-1.5 ml-5 text-xs text-gray-700">
                    <div className="flex items-center gap-2">
                      <span>Move print:</span>
                      <button type="button" onClick={() => changeOffset(offsetOverride - 0.5)} className="p-0.5 border rounded hover:bg-gray-100" aria-label="Move print up">
                        <Minus size={12} />
                      </button>
                      <b className="w-20 text-center">
                        {offsetOverride === 0 ? '0 mm' : `${Math.abs(offsetOverride).toFixed(1)} mm ${offsetOverride > 0 ? 'down' : 'up'}`}
                      </b>
                      <button type="button" onClick={() => changeOffset(offsetOverride + 0.5)} className="p-0.5 border rounded hover:bg-gray-100" aria-label="Move print down">
                        <Plus size={12} />
                      </button>
                    </div>
                    <div className="text-gray-500 mt-0.5">Same shift on every sticker: top line cut off or in the gap? Press + (down). Bottom line cut off? Press – (up).</div>
                  </div>
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
                  value={setup.media ? '__typed' : activeSetup?.id || ''}
                  onChange={(e) => handleSetupChange(e.target.value)}
                  disabled={!!forcedSetup}
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm disabled:bg-gray-50"
                >
                  {setup.media && (
                    <option value="__typed" disabled>
                      Typed in Printer setup ({setup.media.labelWidthMm} x {setup.media.labelHeightMm} mm x {setup.media.columns})
                    </option>
                  )}
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
                {baseRoll?.locked && !setup.media && (
                  <p className="text-xs text-amber-700 mt-1 flex items-center gap-1">
                    <Lock size={11} /> Calibrated and locked by an admin{forcedSetup ? '' : ' (you can still pick another roll)'}
                  </p>
                )}
                {activeSetup && previewTemplate &&
                  (Math.abs(Number(previewTemplate.widthMm) - activeSetup.labelWidthMm) > 0.5 ||
                    Math.abs(Number(previewTemplate.heightMm) - activeSetup.labelHeightMm) > 0.5) && (
                    <p className="text-xs text-red-600 mt-1">
                      Template is {parseFloat(String(previewTemplate.widthMm))} x {parseFloat(String(previewTemplate.heightMm))} mm but the roll labels are{' '}
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
                    {selectedTemplate && !selectedTemplate.id.startsWith('preset-') && (
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
                  onChange={(e) => chooseTemplate(e.target.value)}
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
                  onChange={(e) => setChrome({ pageSize: e.target.value as 'Label' | 'A4' | 'Letter' })}
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
              {config.pageSize !== 'Label' && (
                <div>
                  <label className="text-sm font-medium text-gray-700 mb-1 block">Gap (mm)</label>
                  <input
                    type="number"
                    value={config.gapMm}
                    onChange={(e) => setChrome({ sheetGapMm: Math.max(0, Math.min(20, Number(e.target.value))) })}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                    min={0}
                    max={20}
                  />
                </div>
              )}
            </fieldset>
          </div>

          {/* What prints on the label */}
          <div className="bg-white rounded-lg border p-4 space-y-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sliders size={16} className="text-blue-600" />
                <span className="text-sm font-semibold text-gray-900">Customise Label Information</span>
              </div>
              {selectedTemplate && !selectedTemplate.id.startsWith('preset-') && (
                <Link
                  href={`/c/${company?.tenantSlug || ''}/barcode/label-templates/${selectedTemplate.id}`}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-medium"
                  title="Open in full template drag-and-drop designer"
                >
                  <Edit3 size={12} />
                  Full Designer
                </Link>
              )}
            </div>

            <fieldset disabled={locked} className="space-y-3">
              <div className="grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-lg text-xs" role="radiogroup" aria-label="Layout">
                {([
                  ['quick', 'Quick layout', 'Tick the details below'],
                  ['designed', 'As designed', 'The template from the designer'],
                ] as const).map(([m, title, sub]) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={source === m}
                    onClick={() => {
                      setSelectedElementId(null)
                      update((s) => ({ ...s, layout: { ...s.layout, source: m } }))
                    }}
                    className={`px-2 py-1.5 rounded-md text-left ${source === m ? 'bg-white text-blue-700 font-semibold shadow-xs border border-blue-400' : 'text-gray-600 hover:bg-gray-200/50'}`}
                  >
                    <span className="block">{title}</span>
                    <span className="block text-[10px] font-normal opacity-80">{sub}</span>
                  </button>
                ))}
              </div>

              {source === 'designed' ? (
                <p className="text-xs text-gray-600">
                  Prints <b>{selectedTemplate?.name || 'the template'}</b> exactly as designed (its barcode type, fields and positions). Click a part of the
                  preview to fine-tune it here, or open the Full Designer.
                </p>
              ) : (
                <>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Quick 1-Click Presets:</span>
                      {presetState && (
                        <button type="button" onClick={resetPreset} className="text-[11px] text-gray-500 hover:text-gray-800 flex items-center gap-0.5" title="Back to this layout's defaults">
                          <RotateCcw size={11} /> Reset
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => choosePreset(p.id)}
                          className={`px-2 py-1 text-xs rounded-md border font-medium transition-colors ${preset === p.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-100 hover:bg-slate-200 text-slate-800'}`}
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1">Each layout keeps its own ticks and adjustments.</p>
                  </div>

                  {/* Product Name Length & Font Size Optimizer */}
                  {visibleFields.showName && (
                    <div className="p-2.5 bg-blue-50/60 rounded-md border border-blue-200 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-blue-900">Item name:</span>
                        <div className="flex items-center gap-1 text-[11px]">
                          <span className="text-gray-500">Size:</span>
                          {(['small', 'normal', 'large'] as const).map(s => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setVisibleFields(prev => ({ ...prev, nameFontSize: s }))}
                              className={`px-1.5 py-0.5 rounded border capitalize transition-colors ${visibleFields.nameFontSize === s ? 'bg-blue-600 text-white border-blue-600 font-semibold' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {([
                          ['initial', 'Initial Name (1 Line)', 'Keeps the name on 1 line - never overlaps the barcode below'],
                          ['autofit', 'Auto-Shrink', 'Shrinks the font so the whole name fits on 1 line'],
                          ['multiline', '2 Lines', 'Long names wrap onto 2 compact lines'],
                        ] as const).map(([m, title, hint]) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setVisibleFields(prev => ({ ...prev, nameLengthMode: m }))}
                            className={`flex-1 py-1 px-2 rounded text-xs font-medium border text-center transition-colors ${visibleFields.nameLengthMode === m ? 'bg-blue-600 text-white border-blue-600 font-semibold shadow-xs' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}
                            title={hint}
                          >
                            {title}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Barcode Options */}
                  {visibleFields.showBarcode && (
                    <div className="flex flex-col gap-2 p-2 bg-slate-50 rounded-md border text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-700">Barcode Symbology:</span>
                        <div className="flex rounded-md shadow-xs bg-slate-200 p-0.5">
                          {([['code128', '1D Barcode (Code 128)'], ['qrcode', '2D QR Code']] as const).map(([v, l]) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setVisibleFields(prev => ({ ...prev, barcodeType: v }))}
                              className={`px-2 py-0.5 text-xs font-medium rounded ${(visibleFields.barcodeType === 'qrcode') === (v === 'qrcode') ? 'bg-white shadow text-slate-900' : 'text-slate-600 hover:text-slate-900'}`}
                            >
                              {l}
                            </button>
                          ))}
                        </div>
                      </div>
                      {visibleFields.barcodeType !== 'qrcode' && (
                        <label className="flex items-center justify-between pt-1 border-t border-slate-200 cursor-pointer">
                          <span className="text-gray-600">Print numbers below bars</span>
                          <input
                            type="checkbox"
                            checked={visibleFields.showBarcodeText}
                            onChange={(e) => setVisibleFields(prev => ({ ...prev, showBarcodeText: e.target.checked }))}
                            className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5 cursor-pointer"
                          />
                        </label>
                      )}
                    </div>
                  )}

                  {/* Interactive Grid of Field Toggles */}
                  <div className="grid grid-cols-2 gap-1.5 pt-2 border-t">
                    {FIELD_TOGGLES.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 p-1.5 rounded hover:bg-slate-50 cursor-pointer text-xs text-gray-700 select-none">
                        <input
                          type="checkbox"
                          checked={!!visibleFields[key]}
                          onChange={(e) => setVisibleFields((prev) => ({ ...prev, [key]: e.target.checked }))}
                          className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
                        />
                        <span className="font-medium">{label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </fieldset>
          </div>

          <PrinterSetupPanel
            setup={setup}
            roll={activeSetup}
            update={update}
            canManage={ps.canManage}
            mode={direct.mode}
            guessedLanguage={guessedLanguage}
            onTestPrint={testPrint}
            testing={testing}
            onLock={lockSetup}
            onUnlock={ps.unlock}
            saveState={ps.saveState}
          />
        </div>
      </div>

      {/* Full Preview Modal */}
      {showFullPreview && previewTemplate && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className={`bg-white dark:bg-gray-900 rounded-xl ${activeSetup ? 'max-w-3xl' : 'max-w-lg'} w-full p-6 shadow-2xl space-y-4`}>
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Label Preview (100% scale)</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {previewTemplate.name} ({parseFloat(String(previewTemplate.widthMm))} × {parseFloat(String(previewTemplate.heightMm))} mm) · {previewCaption}
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
                  template={previewTemplate}
                  items={items}
                  currencySymbol={currencySymbol}
                  tenantName={company?.tenantName}
                  codeWord={codeWord}
                  zoom="true"
                  maxRows={6}
                  render={previewRender}
                />
              ) : (
                <div className="shadow-md bg-white p-2 rounded">
                  <LabelPreview
                    template={previewTemplate}
                    item={items[previewIndex]?.item || null}
                    currencySymbol={currencySymbol}
                    tenantName={company?.tenantName}
                    codeWord={codeWord}
                    maxWidth={450}
                    render={previewRender}
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
    </div>
  )
}
