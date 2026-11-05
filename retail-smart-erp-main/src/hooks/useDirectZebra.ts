'use client'

/**
 * "Direct to label printer": the labels are encoded in the printer's language (ZPL / TSPL / EPL, the one
 * the shop chose in Printer setup, else guessed from the printer name) and sent RAW through the skyERPOS
 * print helper (tools/print-agent, http://127.0.0.1:9123) to the installed printer, bypassing the Windows
 * driver, Chrome's preview and its paper size. The printer finds the gap before every row, so rows
 * cannot drift. The mode and the printer are chosen per PC (localStorage), next to the default Chrome
 * print preview path.
 */
import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_AGENT_URL, PrintAgentTransport, type PrintAgentTarget } from '@/lib/print/escpos/transports'
import { newPrinterProfile, type LabelLanguage, type PrinterProfile } from '@/lib/print/printer-profiles'
import { guessLabelPrinter, isLikelyLabelPrinter, sortPrintersForLabels } from '@/lib/print/label/printer-detect'

export type LabelPrintMode = 'chrome' | 'direct'

const MODE_KEY = 'sky_label_print_mode'
const PRINTER_KEY = 'sky_label_direct_printer'

const read = (key: string) => {
  try {
    return typeof window !== 'undefined' ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

export function readLabelPrintMode(): LabelPrintMode {
  return read(MODE_KEY) === 'direct' ? 'direct' : 'chrome'
}

/** Language / dpi the shop chose in Printer setup (null = guess from the printer name). */
export interface DirectPrinterPrefs {
  language?: LabelLanguage | null
  dpi?: 203 | 300 | 600 | null
}

/** Printer profile for one raw print to an installed printer through the helper (the chosen language, else guessed from the name). */
export function directPrinterProfile(name: string, driver?: string | null, prefs: DirectPrinterPrefs = {}): PrinterProfile {
  const guess = guessLabelPrinter(name, driver)
  const language: LabelLanguage = prefs.language && prefs.language !== 'browser' ? prefs.language : guess.language === 'epl' || guess.language === 'tspl' ? guess.language : 'zpl'
  return newPrinterProfile('label', {
    id: `direct-${name}`,
    name,
    transport: 'agent',
    agentUrl: DEFAULT_AGENT_URL,
    agentTarget: name,
    label: { widthMm: 80, heightMm: 25, gapMm: 2, dpi: prefs.dpi === 300 || (!prefs.dpi && guess.dpi === 300) ? 300 : 203, language },
  })
}

export type DirectState = 'idle' | 'checking' | 'ready' | 'missing'

export function useDirectZebra(prefs: DirectPrinterPrefs = {}) {
  const [mode, setModeState] = useState<LabelPrintMode>(readLabelPrintMode)
  const [state, setState] = useState<DirectState>('idle')
  const [targets, setTargets] = useState<PrintAgentTarget[]>([])
  const [printer, setPrinterState] = useState<string>(() => read(PRINTER_KEY) || '')

  const setMode = (m: LabelPrintMode) => {
    setModeState(m)
    write(MODE_KEY, m)
  }
  const setPrinter = (name: string) => {
    setPrinterState(name)
    write(PRINTER_KEY, name)
  }

  // Ask the helper for its printers; state changes only once it answers ('idle' shows as "looking").
  const probe = useCallback(async () => {
    if (!(await PrintAgentTransport.health())) {
      setState('missing')
      return
    }
    const list = await PrintAgentTransport.listTargets(DEFAULT_AGENT_URL, true).catch(() => [] as PrintAgentTarget[])
    const installed = sortPrintersForLabels(list.filter((t) => (t.kind || t.type) === 'system'))
    setTargets(installed)
    setState('ready')
    setPrinterState((cur) => {
      if (cur && installed.some((t) => t.name === cur)) return cur
      const pick = installed.find((t) => isLikelyLabelPrinter(t.name, t.driver)) || installed[0]
      if (pick) write(PRINTER_KEY, pick.name)
      return pick?.name || ''
    })
  }, [])

  const check = () => {
    setState('checking')
    void probe()
  }

  useEffect(() => {
    // probe() only sets state after the helper answers (async)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mode === 'direct') void probe()
  }, [mode, probe])

  const target = targets.find((t) => t.name === printer) || null
  const profile = target ? directPrinterProfile(target.name, target.driver, prefs) : null
  return { mode, setMode, state, targets, printer, setPrinter, profile, check }
}

/** Same hook under the name the UI uses ("Direct to label printer": any brand, not only Zebra). */
export const useDirectLabelPrinter = useDirectZebra
