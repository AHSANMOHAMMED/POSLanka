'use client'

/**
 * "Print directly" setup for label printers (L6).
 *
 * Asks the local print agent (tools/print-agent) for the printers installed
 * on this PC, shows label printers first (Zebra / ZDesigner, TSC, Xprinter,
 * Godex, DBL / generic "Label printer" drivers ...), guesses each one's
 * language (ZPL / TSPL / EPL) and DPI from its name + driver, and turns one
 * click into a label printer profile (transport 'agent', RAW bytes to that
 * printer). Raw printing never goes through the Chrome dialog, so the
 * driver's paper size cannot shrink, skip or reorder stickers.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, Loader2, Printer, RefreshCw, Zap } from 'lucide-react'
import { DEFAULT_AGENT_URL, PrintAgentTransport, type PrintAgentTarget } from '@/lib/print/escpos/transports'
import { newPrinterProfile, upsertPrinterProfile, type LabelLanguage, type PrinterProfile } from '@/lib/print/printer-profiles'
import { guessLabelPrinter, isLikelyLabelPrinter, sortPrintersForLabels } from '@/lib/print/label/printer-detect'
import { stickerRollWidthMm, type StickerSetup } from '@/lib/labels/sticker-stock'
import { printAlignmentTestRaw } from '@/lib/labels/label-print'
import { toast } from '@/components/ui/toast'

export interface DirectLabelPrinterPanelProps {
  /** Roll in use (stored on the profile; drives the alignment test). */
  setup: StickerSetup | null
  /** Configured printer profiles (usePrinters().printers). */
  printers: PrinterProfile[]
  /** Profile currently used for printing labels ('' = browser dialog). */
  selectedId: string
  onSelect: (profileId: string) => void
  /** /c/<slug> base for the agent download links. */
  basePath: string
  compact?: boolean
}

type Lang = Exclude<LabelLanguage, 'browser' | 'escpos-raster'>
const LANGS: { value: Lang; label: string }[] = [
  { value: 'zpl', label: 'ZPL (Zebra & emulations)' },
  { value: 'tspl', label: 'TSPL (TSC, Xprinter, DBL, Gprinter...)' },
  { value: 'epl', label: 'EPL (Zebra LP/TLP 2844)' },
]

export function DirectLabelPrinterPanel({ setup, printers, selectedId, onSelect, basePath, compact }: DirectLabelPrinterPanelProps) {
  const agentUrl = useMemo(() => printers.find((p) => p.transport === 'agent')?.agentUrl || DEFAULT_AGENT_URL, [printers])
  const [agentOk, setAgentOk] = useState<boolean | null>(null)
  const [targets, setTargets] = useState<PrintAgentTarget[]>([])
  const [loading, setLoading] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [overrides, setOverrides] = useState<Record<string, { language?: Lang; dpi?: 203 | 300 }>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(
    async (refresh: boolean, cancelled: () => boolean = () => false) => {
      setLoading(true)
      const ok = await PrintAgentTransport.health(agentUrl)
      if (cancelled()) return
      setAgentOk(ok)
      let list: PrintAgentTarget[] = []
      if (ok) {
        try {
          list = await PrintAgentTransport.listTargets(agentUrl, refresh)
        } catch {
          list = []
        }
      }
      if (!cancelled()) {
        setTargets(sortPrintersForLabels(list))
        setLoading(false)
      }
    },
    [agentUrl]
  )

  useEffect(() => {
    let c = false
    const t = setTimeout(() => load(false, () => c), 0)
    return () => {
      c = true
      clearTimeout(t)
    }
  }, [load])

  const labelTargets = targets.filter((t) => isLikelyLabelPrinter(t.name, t.driver))
  const visible = showAll || labelTargets.length === 0 ? targets : labelTargets
  const profileFor = (name: string) => printers.find((p) => p.role === 'label' && p.transport === 'agent' && p.agentTarget === name) || null

  const settingsFor = (t: PrintAgentTarget) => {
    const existing = profileFor(t.name)
    const guess = guessLabelPrinter(t.name, t.driver)
    const o = overrides[t.name] || {}
    const lang: Lang = o.language || (existing && existing.label.language !== 'browser' && existing.label.language !== 'escpos-raster' ? existing.label.language : guess.language)
    const dpi: 203 | 300 = o.dpi || existing?.label.dpi || guess.dpi
    return { guess, lang, dpi, existing }
  }

  const adopt = (t: PrintAgentTarget): PrinterProfile => {
    const { lang, dpi, existing } = settingsFor(t)
    const label = {
      ...(existing?.label || {}),
      language: lang,
      dpi,
      widthMm: setup ? stickerRollWidthMm(setup) : existing?.label.widthMm || 50,
      heightMm: setup?.labelHeightMm ?? existing?.label.heightMm ?? 25,
      gapMm: setup?.rowGapMm ?? existing?.label.gapMm ?? 2,
      ...(setup ? { stickerSetupId: setup.id } : {}),
    }
    const profile = existing
      ? { ...existing, label: { ...existing.label, ...label } }
      : newPrinterProfile('label', { name: t.name.slice(0, 60), transport: 'agent', agentUrl, agentTarget: t.name, deviceKey: `agent:${t.name}`, autoPrint: false, label })
    upsertPrinterProfile(profile)
    onSelect(profile.id)
    return profile
  }

  const alignmentTest = async (t: PrintAgentTarget) => {
    if (!setup) return toast.error('Pick a label roll first')
    setBusy(t.name)
    try {
      const profile = adopt(t)
      const res = await printAlignmentTestRaw(profile, setup)
      if (res.ok) toast.success(`Alignment test sent: ${setup.columns * 2} labels numbered in print order`)
      else toast.error(res.error || 'Print failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50/60 dark:bg-emerald-900/10 dark:border-emerald-800 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-emerald-900 dark:text-emerald-100 flex items-center gap-1.5 text-sm">
          <Zap size={14} /> Print directly (recommended)
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="px-2 py-1 rounded border border-emerald-300 bg-white dark:bg-gray-900 flex items-center gap-1 font-medium disabled:opacity-50"
          title="Look for printers again"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {agentOk ? 'Refresh' : 'Retry'}
        </button>
      </div>

      {agentOk === null && (
        <p className="text-gray-600 flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Looking for the POSLanka print agent on this PC...
        </p>
      )}

      {agentOk === false && (
        <div className="space-y-1.5 text-gray-700 dark:text-gray-300">
          <p>
            Sends the labels straight to the label printer in its own language (ZPL / TSPL): exact sticker size, every sticker in order, sharp
            barcodes. No print dialog, no paper-size settings. One-time setup on this PC:
          </p>
          <ol className="list-decimal ml-4 space-y-0.5">
            <li>
              Install <b>Node.js LTS</b> from{' '}
              <a href="https://nodejs.org" target="_blank" rel="noreferrer" className="text-blue-700 underline">
                nodejs.org
              </a>
              .
            </li>
            <li>
              Download{' '}
              <a href={`${basePath}/barcode/print-agent?file=index.mjs`} className="text-blue-700 underline inline-flex items-center gap-0.5">
                <Download size={11} /> index.mjs
              </a>{' '}
              and{' '}
              <a href={`${basePath}/barcode/print-agent?file=start-windows.cmd`} className="text-blue-700 underline inline-flex items-center gap-0.5">
                <Download size={11} /> start-windows.cmd
              </a>{' '}
              into one folder (e.g. <code>C:\poslanka-agent</code>).
            </li>
            <li>Double-click <b>start-windows.cmd</b> (macOS / Linux: <code>node index.mjs</code>) and leave the window open.</li>
            <li>Press <b>Retry</b>. Your installed label printer appears here.</li>
          </ol>
        </div>
      )}

      {agentOk && targets.length === 0 && !loading && (
        <p className="text-amber-800 flex items-center gap-1">
          <AlertTriangle size={12} /> Agent running, but no printers are installed in Windows. Install the label printer driver, then Refresh.
        </p>
      )}

      {agentOk && visible.length > 0 && (
        <div className="divide-y divide-emerald-200 dark:divide-emerald-900 rounded border border-emerald-200 dark:border-emerald-900 bg-white dark:bg-gray-900">
          {visible.slice(0, compact ? 4 : 12).map((t) => {
            const { guess, lang, dpi, existing } = settingsFor(t)
            const active = !!existing && existing.id === selectedId
            return (
              <div key={`${t.source || 'cfg'}:${t.name}`} className={`p-2 space-y-1.5 ${active ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1">
                      {active && <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />}
                      {t.name}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">{t.driver ? `Driver: ${t.driver}` : t.description || t.port || ''}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      adopt(t)
                      toast.success(`Labels will print directly to ${t.name} (${lang.toUpperCase()}, ${dpi} dpi)`)
                    }}
                    className={`shrink-0 px-2.5 py-1 rounded font-semibold flex items-center gap-1 ${active ? 'bg-emerald-600 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
                  >
                    <Printer size={12} /> {active ? 'In use' : 'Print directly'}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={lang}
                    onChange={(e) => setOverrides((o) => ({ ...o, [t.name]: { ...o[t.name], language: e.target.value as Lang } }))}
                    className="px-1.5 py-0.5 border rounded bg-white dark:bg-gray-800 text-[11px]"
                    title="Printer language (auto-detected from the driver; change it if the test label prints as text)"
                  >
                    {LANGS.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={dpi}
                    onChange={(e) => setOverrides((o) => ({ ...o, [t.name]: { ...o[t.name], dpi: Number(e.target.value) === 300 ? 300 : 203 } }))}
                    className="px-1.5 py-0.5 border rounded bg-white dark:bg-gray-800 text-[11px]"
                    title="Print head resolution (on the printer's label: 203 dpi = 8 dots/mm, 300 dpi = 12 dots/mm)"
                  >
                    <option value={203}>203 dpi</option>
                    <option value={300}>300 dpi</option>
                  </select>
                  <button
                    type="button"
                    disabled={busy !== null || !setup}
                    onClick={() => alignmentTest(t)}
                    className="px-1.5 py-0.5 border rounded bg-white dark:bg-gray-800 text-[11px] font-medium disabled:opacity-50 flex items-center gap-1"
                    title="Prints 2 rows of numbered labels (1, 2 / 3, 4) with a border, to check size and order"
                  >
                    {busy === t.name ? <Loader2 size={10} className="animate-spin" /> : null} Alignment test
                  </button>
                  {!guess.confident && <span className="text-amber-700">check with a test</span>}
                </div>
                {guess.note && <p className="text-[11px] text-gray-500">{guess.note}</p>}
              </div>
            )
          })}
        </div>
      )}

      {agentOk && labelTargets.length > 0 && targets.length > labelTargets.length && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="text-blue-700 underline">
          {showAll ? 'Show label printers only' : `Show all ${targets.length} printers`}
        </button>
      )}
      {agentOk && labelTargets.length === 0 && targets.length > 0 && (
        <p className="text-gray-600">No printer looks like a label printer by name; pick yours from the list above.</p>
      )}
    </div>
  )
}
