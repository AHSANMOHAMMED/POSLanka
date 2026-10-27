'use client'

/**
 * Printer list for the "Print agent" connection: every printer installed in
 * the OS of this PC (with its driver) plus printers.json targets, discovered
 * by tools/print-agent (GET /printers). One click selects a printer; each row
 * has its own Test print. Shows install / start help when the agent is down.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, Printer, RefreshCw, Server, Star } from 'lucide-react'
import { FormField, FormInput } from '@/components/ui/form-elements'
import { DEFAULT_AGENT_URL, PrintAgentTransport, type PrintAgentTarget } from '@/lib/print/escpos/transports'
import { guessLabelPrinter, isLikelyLabelPrinter, sortPrintersForLabels } from '@/lib/print/label/printer-detect'
import { PrintAgentInstallCommands } from '@/components/print/PrintAgentInstallCommands'

export interface AgentPrinterPickerProps {
  agentUrl: string
  agentTarget: string
  onChange: (patch: { agentUrl?: string; agentTarget?: string }) => void
  /** Send a test page to the given agent target ('' = agent default). */
  onTest: (target: string) => Promise<void>
  testing?: boolean
  /** Called with the full printer entry (incl. driver) when the user picks one. */
  onPickTarget?: (target: PrintAgentTarget) => void
  /** Label printers first, with a "label printer" badge. */
  preferLabelPrinters?: boolean
}

export function AgentPrinterPicker({ agentUrl, agentTarget, onChange, onTest, testing, onPickTarget, preferLabelPrinters }: AgentPrinterPickerProps) {
  const [agentOk, setAgentOk] = useState<boolean | null>(null)
  const [targets, setTargets] = useState<PrintAgentTarget[]>([])
  const [loading, setLoading] = useState(false)
  const [testingName, setTestingName] = useState<string | null>(null)

  const url = agentUrl || DEFAULT_AGENT_URL

  const load = useCallback(
    async (refresh: boolean, isCancelled: () => boolean = () => false) => {
      setLoading(true)
      setAgentOk(null)
      const ok = await PrintAgentTransport.health(url)
      if (isCancelled()) return
      setAgentOk(ok)
      if (ok) {
        try {
          const list = await PrintAgentTransport.listTargets(url, refresh)
          if (!isCancelled()) setTargets(preferLabelPrinters ? sortPrintersForLabels(list) : list)
        } catch {
          if (!isCancelled()) setTargets([])
        }
      } else {
        setTargets([])
      }
      if (!isCancelled()) setLoading(false)
    },
    [url, preferLabelPrinters]
  )

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => load(false, () => cancelled), 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [load])

  const test = async (name: string) => {
    setTestingName(name)
    try {
      await onTest(name)
    } finally {
      setTestingName(null)
    }
  }

  const selectedKnown = !agentTarget || targets.some((t) => t.name === agentTarget)

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium flex items-center gap-1.5">
          <Server className="w-4 h-4 text-gray-400" /> Printers on this PC
        </div>
        <div className="text-xs flex items-center gap-1.5">
          {agentOk === null ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
          ) : agentOk ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> agent connected
            </>
          ) : (
            <>
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> agent not reachable
            </>
          )}
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="ml-1 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1 font-semibold disabled:opacity-50"
            title="Scan installed printers again"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {agentOk === false && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-900 dark:text-amber-100 space-y-1.5">
          <p className="font-semibold">The POSLanka print agent is not running on this computer.</p>
          <p>It is a small helper that lets this page print straight to any printer installed in Windows, macOS or Linux (with its own driver), without the print dialog.</p>
          <PrintAgentInstallCommands />
          <p>Then press Refresh.</p>
          <p className="text-amber-800 dark:text-amber-200">
            Running but still not reachable? Check the Agent URL below, or run the command above again (it allows this site in printers.json).
          </p>
        </div>
      )}

      {agentOk && targets.length === 0 && !loading && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          No printers found. Install the printer in the operating system (Settings &gt; Printers) and press Refresh.
        </p>
      )}

      {targets.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700 max-h-64 overflow-y-auto">
          {targets.map((t) => {
            const active = agentTarget === t.name
            const installed = t.source === 'os'
            return (
              <div
                key={`${t.source || 'config'}:${t.name}`}
                className={`flex items-center gap-2 px-3 py-2 ${active ? 'bg-teal-50 dark:bg-teal-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onChange({ agentTarget: t.name })
                    onPickTarget?.(t)
                  }}
                  className="flex-1 min-w-0 text-left flex items-center gap-2"
                >
                  <span
                    className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      active ? 'border-teal-600' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  >
                    {active && <span className="w-2 h-2 rounded-full bg-teal-600" />}
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 font-medium truncate">
                      {t.name}
                      {t.isDefault && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                          <Star className="w-2.5 h-2.5" /> default
                        </span>
                      )}
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          installed
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                            : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                        }`}
                      >
                        {installed ? 'installed' : `configured · ${t.type}`}
                      </span>
                      {preferLabelPrinters && isLikelyLabelPrinter(t.name, t.driver) && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                          label printer · {guessLabelPrinter(t.name, t.driver).language.toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {installed ? `Driver: ${t.driver || 'unknown'}${t.port ? ` · ${t.port}` : ''}` : t.description || t.port || ''}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  disabled={!!testing || testingName !== null}
                  onClick={() => test(t.name)}
                  className="shrink-0 px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-50"
                >
                  {testingName === t.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />}
                  Test print
                </button>
              </div>
            )
          })}
        </div>
      )}

      {!selectedKnown && (
        <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" /> Selected printer &quot;{agentTarget}&quot; was not found on this PC.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Agent URL">
          <FormInput value={agentUrl} onChange={(e) => onChange({ agentUrl: e.target.value })} placeholder={DEFAULT_AGENT_URL} inputSize="sm" />
        </FormField>
        <FormField label="Printer name (manual)">
          <FormInput
            value={agentTarget}
            onChange={(e) => onChange({ agentTarget: e.target.value })}
            placeholder="blank = agent default printer"
            inputSize="sm"
          />
        </FormField>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Bytes are sent RAW to the printer (ESC/POS, ZPL, TSPL), so thermal and label printers print at full speed. On Windows any
        installed driver works, including &quot;Generic / Text Only&quot;.
      </p>
    </div>
  )
}
