'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { Tag, Loader2, Scale, Save, ArrowLeft } from 'lucide-react'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { SectionCard } from '@/components/ui/section-card'
import { FormInput, FormField, FormSelect, FormCheckbox } from '@/components/ui/form-elements'
import { useDebounce } from '@/hooks/useDebounce'
import { toast } from '@/components/ui/toast'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { StickerSetupsManager } from '@/components/labels/StickerSetupsManager'

// ─── Weighing-scale barcode config ────────────────────────────────────────

export interface ScaleBarcodeConfig {
  enabled: boolean
  prefixes: string[]
  pluStart: number
  pluLength: number
  valueStart: number
  valueLength: number
  valueType: 'weight' | 'price'
  valueDecimals: number
}

const DEFAULT_SCALE_CONFIG: ScaleBarcodeConfig = {
  enabled: false,
  prefixes: ['2'],
  pluStart: 2,
  pluLength: 5,
  valueStart: 7,
  valueLength: 5,
  valueType: 'weight',
  valueDecimals: 3,
}

function normalizeScaleConfig(raw: unknown): ScaleBarcodeConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ScaleBarcodeConfig>
  const int = (v: unknown, d: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : d
  }
  return {
    enabled: !!r.enabled,
    prefixes: Array.isArray(r.prefixes) && r.prefixes.length ? r.prefixes.map(String) : DEFAULT_SCALE_CONFIG.prefixes,
    pluStart: int(r.pluStart, DEFAULT_SCALE_CONFIG.pluStart),
    pluLength: int(r.pluLength, DEFAULT_SCALE_CONFIG.pluLength),
    valueStart: int(r.valueStart, DEFAULT_SCALE_CONFIG.valueStart),
    valueLength: int(r.valueLength, DEFAULT_SCALE_CONFIG.valueLength),
    valueType: r.valueType === 'price' ? 'price' : 'weight',
    valueDecimals: int(r.valueDecimals, DEFAULT_SCALE_CONFIG.valueDecimals),
  }
}

/** Client-side preview parser mirroring the server's weighing-scale logic. */
export function parseScaleBarcode(code: string, cfg: ScaleBarcodeConfig):
  | { ok: true; prefix: string; plu: string; rawValue: string; value: number }
  | { ok: false; reason: string } {
  const digits = code.replace(/\s+/g, '')
  if (!/^\d+$/.test(digits)) return { ok: false, reason: 'Barcode must be numeric' }
  const prefix = cfg.prefixes.find((p) => p && digits.startsWith(p))
  if (!prefix) return { ok: false, reason: `No matching prefix (${cfg.prefixes.join(', ')})` }
  const needed = Math.max(cfg.pluStart + cfg.pluLength, cfg.valueStart + cfg.valueLength)
  if (digits.length < needed) return { ok: false, reason: `Barcode too short: needs at least ${needed} digits` }
  const plu = digits.slice(cfg.pluStart, cfg.pluStart + cfg.pluLength)
  const rawValue = digits.slice(cfg.valueStart, cfg.valueStart + cfg.valueLength)
  const value = parseInt(rawValue, 10) / Math.pow(10, cfg.valueDecimals)
  return { ok: true, prefix, plu, rawValue, value }
}

function buildExample(cfg: ScaleBarcodeConfig): string {
  const len = Math.max(13, cfg.pluStart + cfg.pluLength, cfg.valueStart + cfg.valueLength)
  const arr = Array.from({ length: len }, () => '0')
  const prefix = cfg.prefixes[0] || '2'
  for (let i = 0; i < prefix.length && i < len; i++) arr[i] = prefix[i]
  const plu = '12345'.padStart(cfg.pluLength, '0').slice(-cfg.pluLength)
  for (let i = 0; i < cfg.pluLength; i++) if (cfg.pluStart + i < len) arr[cfg.pluStart + i] = plu[i]
  const val = (cfg.valueType === 'weight' ? '1250' : '34950').padStart(cfg.valueLength, '0').slice(-cfg.valueLength)
  for (let i = 0; i < cfg.valueLength; i++) if (cfg.valueStart + i < len) arr[cfg.valueStart + i] = val[i]
  return arr.join('')
}

export default function BarcodeLabelSettingsPage() {
  const { tenantSlug } = useCompany()
  const [codeWord, setCodeWord] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  // Weighing-scale barcodes
  const [scale, setScale] = useState<ScaleBarcodeConfig>(DEFAULT_SCALE_CONFIG)
  const [scaleLoading, setScaleLoading] = useState(true)
  const [scaleSaving, setScaleSaving] = useState(false)
  const [scaleDirty, setScaleDirty] = useState(false)
  const [prefixText, setPrefixText] = useState(DEFAULT_SCALE_CONFIG.prefixes.join(', '))
  const [example, setExample] = useState('')
  const [exampleTouched, setExampleTouched] = useState(false)

  useEffect(() => {
    fetch('/api/label-settings')
      .then(r => r.json())
      .then(data => setCodeWord(data.codeWord || ''))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/tenant')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const cfg = normalizeScaleConfig(data?.scaleBarcode)
        setScale(cfg)
        setPrefixText(cfg.prefixes.join(', '))
      })
      .catch(() => {})
      .finally(() => setScaleLoading(false))
  }, [])

  const pendingRef = useRef<string | null>(null)

  const saveToServer = useCallback(async () => {
    const cw = pendingRef.current
    if (cw === null) return

    setSaving(true)
    try {
      const res = await fetch('/api/label-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codeWord: cw }),
      })
      if (res.ok) {
        toast.success('Label settings saved')
      } else {
        const data = await res.json().catch(() => null)
        toast.error(data?.error || 'Failed to save label settings')
      }
    } catch {
      toast.error('Error saving label settings')
    } finally {
      setSaving(false)
    }
  }, [])

  const debouncedSave = useDebounce(saveToServer, 800)

  function updateCodeWord(value: string) {
    const cleaned = value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10)
    setCodeWord(cleaned)
    pendingRef.current = cleaned
    debouncedSave()
  }

  function updateScale(patch: Partial<ScaleBarcodeConfig>) {
    setScale(prev => ({ ...prev, ...patch }))
    setScaleDirty(true)
  }

  function updatePrefixes(text: string) {
    setPrefixText(text)
    const prefixes = text
      .split(/[,\s]+/)
      .map(p => p.replace(/\D/g, ''))
      .filter(Boolean)
    updateScale({ prefixes: prefixes.length ? prefixes : ['2'] })
  }

  const exampleCode = exampleTouched ? example : buildExample(scale)
  const parsed = useMemo(() => parseScaleBarcode(exampleCode, scale), [exampleCode, scale])
  const overlap =
    scale.pluStart < scale.valueStart + scale.valueLength && scale.valueStart < scale.pluStart + scale.pluLength

  async function saveScale() {
    setScaleSaving(true)
    try {
      const res = await fetch('/api/tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scaleBarcode: scale }),
      })
      if (res.ok) {
        toast.success('Weighing-scale barcode settings saved')
        setScaleDirty(false)
      } else {
        const data = await res.json().catch(() => null)
        toast.error(data?.error || 'Failed to save weighing-scale settings')
      }
    } catch {
      toast.error('Error saving weighing-scale settings')
    } finally {
      setScaleSaving(false)
    }
  }

  return (
    <ListPageLayout
      module="Barcode & Labels"
      moduleHref="/barcode"
      title="Label Settings"
      actionContent={
        <Link
          href={`/c/${tenantSlug}/barcode/print`}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to Print
        </Link>
      }
    >
      <div className="max-w-3xl space-y-4">
        <StickerSetupsManager />

        <SectionCard
          title="Price Code"
          icon={<Tag size={16} />}
          actions={
            saving ? (
              <span className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <Loader2 size={12} className="animate-spin" />
                Saving...
              </span>
            ) : null
          }
        >
          {loading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Used to encode cost and selling prices on barcode labels so only staff who know the code word can read them.
              </p>
              <FormField label="Code Word (10 unique letters)">
                <FormInput
                  type="text"
                  value={codeWord}
                  onChange={(e) => updateCodeWord(e.target.value)}
                  placeholder="e.g. MAKEPROFIT"
                  maxLength={10}
                  inputSize="sm"
                  className={`w-64 uppercase ${
                    codeWord.length > 0 && new Set(codeWord).size < codeWord.length
                      ? 'border-red-400 focus:ring-red-400'
                      : ''
                  }`}
                />
              </FormField>
              {codeWord.length > 0 && new Set(codeWord).size < codeWord.length && (
                <p className="text-xs text-red-500 mt-1">Each letter must be unique</p>
              )}
              {codeWord.length === 10 && new Set(codeWord).size === 10 && (
                <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-700/50 rounded text-xs text-gray-600 dark:text-gray-300 font-mono">
                  {[1,2,3,4,5,6,7,8,9,0].map((d, i) => `${codeWord[i]}=${d}`).join('  ')}
                </div>
              )}
              {!codeWord && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Enter a 10-letter word where each letter maps to a digit (1-9, 0). Example: MAKEPROFIT
                </p>
              )}
            </>
          )}
        </SectionCard>

        <SectionCard
          title="Weighing-scale barcodes"
          icon={<Scale size={16} />}
          actions={
            <button
              type="button"
              onClick={saveScale}
              disabled={scaleSaving || scaleLoading || !scaleDirty}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold"
            >
              {scaleSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save
            </button>
          }
        >
          {scaleLoading ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Label printers on weighing scales embed the item PLU and the weight (or price) inside an EAN-13 barcode.
                Tell the POS where each part sits so a scanned label adds the right item with the right quantity.
                Positions are 0-based digit indexes from the left; the EAN check digit is ignored.
              </p>

              <FormCheckbox
                label="Enable weighing-scale barcode parsing at the POS"
                checked={scale.enabled}
                onChange={(e) => updateScale({ enabled: e.target.checked })}
              />

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <FormField label="Prefixes" hint="Comma separated, e.g. 2, 20, 21" className="col-span-2">
                  <FormInput value={prefixText} onChange={(e) => updatePrefixes(e.target.value)} inputSize="sm" placeholder="2" />
                </FormField>
                <FormField label="Value type">
                  <FormSelect
                    value={scale.valueType}
                    onChange={(e) => updateScale({ valueType: e.target.value === 'price' ? 'price' : 'weight' })}
                    selectSize="sm"
                  >
                    <option value="weight">Weight (kg)</option>
                    <option value="price">Price</option>
                  </FormSelect>
                </FormField>
                <FormField label="Value decimals">
                  <FormInput
                    type="number" min={0} max={6} value={scale.valueDecimals}
                    onChange={(e) => updateScale({ valueDecimals: Math.max(0, Math.min(6, Number(e.target.value) || 0)) })}
                    inputSize="sm"
                  />
                </FormField>
                <FormField label="PLU start">
                  <FormInput type="number" min={0} max={20} value={scale.pluStart}
                    onChange={(e) => updateScale({ pluStart: Math.max(0, Number(e.target.value) || 0) })} inputSize="sm" />
                </FormField>
                <FormField label="PLU length">
                  <FormInput type="number" min={1} max={10} value={scale.pluLength}
                    onChange={(e) => updateScale({ pluLength: Math.max(1, Number(e.target.value) || 1) })} inputSize="sm" />
                </FormField>
                <FormField label="Value start">
                  <FormInput type="number" min={0} max={20} value={scale.valueStart}
                    onChange={(e) => updateScale({ valueStart: Math.max(0, Number(e.target.value) || 0) })} inputSize="sm" />
                </FormField>
                <FormField label="Value length">
                  <FormInput type="number" min={1} max={10} value={scale.valueLength}
                    onChange={(e) => updateScale({ valueLength: Math.max(1, Number(e.target.value) || 1) })} inputSize="sm" />
                </FormField>
              </div>
              {overlap && (
                <p className="text-xs text-amber-600 dark:text-amber-400">PLU and value digit ranges overlap; check the start/length values.</p>
              )}

              {/* Live preview */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 bg-gray-50 dark:bg-gray-800/50">
                <FormField label="Try a barcode" hint="Edit to test; leave blank to use a generated example">
                  <FormInput
                    value={exampleCode}
                    onChange={(e) => {
                      setExampleTouched(true)
                      setExample(e.target.value.replace(/[^\d\s]/g, ''))
                    }}
                    onBlur={() => { if (!example.trim()) setExampleTouched(false) }}
                    inputSize="sm"
                    className="font-mono w-64"
                  />
                </FormField>
                <div className="mt-2 font-mono text-sm tracking-[0.35em] select-none">
                  {exampleCode.split('').map((ch, i) => {
                    const inPlu = i >= scale.pluStart && i < scale.pluStart + scale.pluLength
                    const inVal = i >= scale.valueStart && i < scale.valueStart + scale.valueLength
                    const inPrefix = scale.prefixes.some(p => exampleCode.startsWith(p) && i < p.length)
                    const cls = inPlu && inVal
                      ? 'bg-red-200 dark:bg-red-900/50'
                      : inPlu
                        ? 'bg-sky-200 dark:bg-sky-900/60'
                        : inVal
                          ? 'bg-emerald-200 dark:bg-emerald-900/60'
                          : inPrefix
                            ? 'bg-violet-200 dark:bg-violet-900/60'
                            : ''
                    return <span key={i} className={`px-0.5 rounded ${cls}`}>{ch}</span>
                  })}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-gray-500 dark:text-gray-400">
                  <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-violet-300 mr-1 align-middle" />prefix</span>
                  <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-sky-300 mr-1 align-middle" />PLU</span>
                  <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-300 mr-1 align-middle" />{scale.valueType === 'weight' ? 'weight' : 'price'}</span>
                </div>
                <div className="mt-3 text-sm">
                  {parsed.ok ? (
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-gray-400">PLU</div>
                        <div className="font-mono font-semibold">{parsed.plu}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-gray-400">Raw value</div>
                        <div className="font-mono font-semibold">{parsed.rawValue}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wide text-gray-400">{scale.valueType === 'weight' ? 'Weight' : 'Price'}</div>
                        <div className="font-mono font-semibold">
                          {parsed.value.toFixed(scale.valueDecimals)} {scale.valueType === 'weight' ? 'kg' : ''}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-amber-600 dark:text-amber-400 text-xs">{parsed.reason}</p>
                  )}
                </div>
              </div>
              {!scale.enabled && (
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Parsing is disabled: scanned scale labels are looked up as ordinary barcodes.
                </p>
              )}
            </div>
          )}
        </SectionCard>
      </div>
    </ListPageLayout>
  )
}
