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
 *
 * Agent missing: shows the one-line installer for this OS (L7). No-install
 * options: pair a USB (WebUSB) or Bluetooth label printer straight from the
 * browser; the new profile becomes the default label printer.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bluetooth, CheckCircle2, Loader2, Printer, RefreshCw, Usb, Zap } from 'lucide-react'
import {
  DEFAULT_AGENT_URL,
  getBleTransport,
  getStoredUsbDeviceInfo,
  getUsbTransport,
  PrintAgentTransport,
  supportsWebBluetooth,
  supportsWebUsb,
  TransportError,
  type PrintAgentTarget,
} from '@/lib/print/escpos/transports'
import {
  makeDefaultLabelPrinter,
  newPrinterProfile,
  touchPrinterProfiles,
  updatePrinterProfile,
  upsertPrinterProfile,
  type LabelLanguage,
  type PrinterProfile,
} from '@/lib/print/printer-profiles'
import { PrintAgentInstallCommands, useClientPrintEnv } from '@/components/print/PrintAgentInstallCommands'
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
            barcodes. No print dialog, no paper-size settings. The small skyERPOS print agent on this computer makes that possible for any
            installed printer.
          </p>
          <PrintAgentInstallCommands downloadBase={basePath} />
          <p>
            Then press <b>Retry</b>. Your installed label printer appears here.
          </p>
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

      <DirectConnectSection setup={setup} printers={printers} selectedId={selectedId} onSelect={onSelect} agentOk={agentOk} />
    </div>
  )
}

// ─── No install: WebUSB / Web Bluetooth ───────────────────────────────────

const ZEBRA_USB_VENDOR = 0x0a5f

function directLanguage(name: string, vendorId?: number | null): Lang {
  if (vendorId === ZEBRA_USB_VENDOR) return 'zpl'
  const g = guessLabelPrinter(name, null)
  return g.confident && (g.language === 'zpl' || g.language === 'epl' || g.language === 'tspl') ? g.language : 'tspl'
}

function rawLang(p: PrinterProfile): Lang {
  const l = p.label.language
  return l === 'zpl' || l === 'epl' || l === 'tspl' ? l : 'tspl'
}

function DirectConnectSection({
  setup,
  printers,
  selectedId,
  onSelect,
  agentOk,
}: Pick<DirectLabelPrinterPanelProps, 'setup' | 'printers' | 'selectedId' | 'onSelect'> & { agentOk: boolean | null }) {
  const env = useClientPrintEnv()
  const [busy, setBusy] = useState<string | null>(null)
  const usb = env ? supportsWebUsb() : false
  const bt = env ? supportsWebBluetooth() : false
  const direct = printers.filter((p) => p.role === 'label' && (p.transport === 'webusb' || p.transport === 'webbluetooth'))

  const labelConfig = (lang: Lang, base?: PrinterProfile['label']) => ({
    ...(base || {}),
    language: lang,
    dpi: base?.dpi || setup?.dpi || 203,
    widthMm: setup ? stickerRollWidthMm(setup) : base?.widthMm || 50,
    heightMm: setup?.labelHeightMm ?? base?.heightMm ?? 25,
    gapMm: setup?.rowGapMm ?? base?.gapMm ?? 2,
    ...(setup ? { stickerSetupId: setup.id } : {}),
  })

  const makeDefault = (p: PrinterProfile) => {
    makeDefaultLabelPrinter(p.id)
    onSelect(p.id)
  }

  const connect = async (transport: 'webusb' | 'webbluetooth') => {
    // requestDevice() must run inside the click (user gesture): no await before it.
    const draft = newPrinterProfile('label', { transport, autoPrint: false })
    setBusy(transport)
    try {
      const name =
        transport === 'webusb'
          ? await getUsbTransport(draft.deviceKey).requestDevice()
          : await getBleTransport(draft.deviceKey).requestDevice()
      const vendorId = transport === 'webusb' ? getStoredUsbDeviceInfo(draft.deviceKey)?.vendorId : null
      const lang = directLanguage(name, vendorId)
      const profile: PrinterProfile = { ...draft, name: (name || 'Label printer').slice(0, 60), label: { ...draft.label, ...labelConfig(lang) } }
      upsertPrinterProfile(profile)
      touchPrinterProfiles()
      makeDefault(profile)
      toast.success(`${profile.name} connected (${lang.toUpperCase()}). Print an alignment test to check the size.`)
    } catch (e) {
      if (e instanceof TransportError && e.code === 'cancelled') return
      toast.error(e instanceof Error ? e.message : 'Could not connect the printer')
    } finally {
      setBusy(null)
    }
  }

  const alignment = async (p: PrinterProfile) => {
    if (!setup) return toast.error('Pick a label roll first')
    setBusy(p.id)
    try {
      const profile = { ...p, label: { ...p.label, ...labelConfig(rawLang(p), p.label) } }
      upsertPrinterProfile(profile)
      makeDefault(profile)
      const res = await printAlignmentTestRaw(profile, setup)
      if (res.ok) toast.success(`Alignment test sent: ${setup.columns * 2} labels numbered in print order`)
      else toast.error(res.error || 'Print failed')
    } finally {
      setBusy(null)
    }
  }

  if (!env) return null
  const isWindows = env.os === 'windows'
  return (
    <div className="pt-2 mt-1 border-t border-emerald-200 dark:border-emerald-900 space-y-1.5">
      <div className="font-semibold text-gray-800 dark:text-gray-200">No install: connect the label printer to this browser</div>
      {usb || bt ? (
        <div className="flex flex-wrap gap-1.5">
          {usb && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => connect('webusb')}
              className="px-2.5 py-1 rounded border border-emerald-400 bg-white dark:bg-gray-900 font-semibold flex items-center gap-1 disabled:opacity-50"
            >
              {busy === 'webusb' ? <Loader2 size={12} className="animate-spin" /> : <Usb size={12} />} Connect USB label printer
            </button>
          )}
          {bt && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => connect('webbluetooth')}
              className="px-2.5 py-1 rounded border border-emerald-400 bg-white dark:bg-gray-900 font-semibold flex items-center gap-1 disabled:opacity-50"
            >
              {busy === 'webbluetooth' ? <Loader2 size={12} className="animate-spin" /> : <Bluetooth size={12} />} Connect Bluetooth label printer
            </button>
          )}
        </div>
      ) : (
        <p className="text-gray-600 dark:text-gray-400">
          This browser cannot talk to USB / Bluetooth printers{env && !window.isSecureContext ? ' over plain http' : ''}. Open this page in{' '}
          <b>Google Chrome</b> or <b>Microsoft Edge</b> (https) to connect a label printer without installing anything.
        </p>
      )}
      {(usb || bt) && (
        <p className="text-[11px] text-gray-600 dark:text-gray-400">
          {isWindows ? (
            <>
              <AlertTriangle size={11} className="inline text-amber-600 mr-0.5" />
              On Windows, direct USB only works after replacing the printer driver with WinUSB (Zadig), which stops other programs from using it.
              {agentOk ? ' The print agent is running, so use the printers listed above.' : ' Recommended on Windows: the one-command print agent above.'}
            </>
          ) : (
            <>On macOS, Linux, ChromeOS and Android, USB direct printing works with no install. Bluetooth needs a BLE label printer.</>
          )}
        </p>
      )}
      {direct.length > 0 && (
        <div className="divide-y divide-emerald-200 dark:divide-emerald-900 rounded border border-emerald-200 dark:border-emerald-900 bg-white dark:bg-gray-900">
          {direct.map((p) => {
            const active = p.id === selectedId
            const lang = rawLang(p)
            return (
              <div key={p.id} className={`p-2 space-y-1.5 ${active ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 dark:text-gray-100 truncate flex items-center gap-1">
                      {active && <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />}
                      {p.transport === 'webusb' ? <Usb size={12} className="shrink-0" /> : <Bluetooth size={12} className="shrink-0" />}
                      {p.name}
                    </div>
                    <div className="text-[11px] text-gray-500">{p.transport === 'webusb' ? 'USB, direct from the browser' : 'Bluetooth, direct from the browser'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      makeDefault(p)
                      toast.success(`Labels will print directly to ${p.name} (${lang.toUpperCase()})`)
                    }}
                    className="shrink-0 px-2.5 py-1 rounded font-semibold flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <Printer size={12} /> {active ? 'In use' : 'Use for labels'}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={lang}
                    onChange={(e) => updatePrinterProfile(p.id, { label: { ...p.label, language: e.target.value as Lang } })}
                    className="px-1.5 py-0.5 border rounded bg-white dark:bg-gray-800 text-[11px]"
                    title="Printer language (change it if the test label prints as text)"
                  >
                    {LANGS.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={p.label.dpi}
                    onChange={(e) => updatePrinterProfile(p.id, { label: { ...p.label, dpi: Number(e.target.value) === 300 ? 300 : 203 } })}
                    className="px-1.5 py-0.5 border rounded bg-white dark:bg-gray-800 text-[11px]"
                    title="Print head resolution (203 dpi = 8 dots/mm, 300 dpi = 12 dots/mm)"
                  >
                    <option value={203}>203 dpi</option>
                    <option value={300}>300 dpi</option>
                  </select>
                  <button
                    type="button"
                    disabled={busy !== null || !setup}
                    onClick={() => alignment(p)}
                    className="px-1.5 py-0.5 border rounded bg-white dark:bg-gray-800 text-[11px] font-medium disabled:opacity-50 flex items-center gap-1"
                    title="Prints 2 rows of numbered labels (1, 2 / 3, 4) with a border, to check size and order"
                  >
                    {busy === p.id ? <Loader2 size={10} className="animate-spin" /> : null} Alignment test
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
