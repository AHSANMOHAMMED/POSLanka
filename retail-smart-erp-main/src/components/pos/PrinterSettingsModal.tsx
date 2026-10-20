'use client'

import { useEffect, useState } from 'react'
import { Printer, X, Usb, Bluetooth, Globe, Server, Loader2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import { FormInput, FormSelect, FormCheckbox, FormField } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { usePrinter, type PrinterTransportKind } from '@/hooks/usePrinter'
import { PrintAgentTransport, type PrintAgentTarget } from '@/lib/print/escpos/transports'
import { useEscapeKey } from '@/hooks/useEscapeKey'

export interface PrinterSettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

const TRANSPORTS: Array<{
  kind: PrinterTransportKind
  label: string
  description: string
  icon: typeof Usb
}> = [
  { kind: 'browser', label: 'Browser', description: 'Standard print dialog (any printer, slower)', icon: Globe },
  { kind: 'webusb', label: 'USB', description: 'Direct ESC/POS over WebUSB (Chrome/Edge)', icon: Usb },
  { kind: 'webbluetooth', label: 'Bluetooth', description: 'BLE receipt printers (Chrome/Edge, Android)', icon: Bluetooth },
  { kind: 'agent', label: 'Print agent', description: 'Local helper on this PC: network, shared or serial printer', icon: Server },
]

export function PrinterSettingsModal({ isOpen, onClose }: PrinterSettingsModalProps) {
  const printer = usePrinter()
  const { settings, updateSettings, status, support, deviceName } = printer
  const [busy, setBusy] = useState<'test' | 'drawer' | 'pair' | null>(null)
  const [agentOk, setAgentOk] = useState<boolean | null>(null)
  const [agentTargets, setAgentTargets] = useState<PrintAgentTarget[]>([])

  useEffect(() => {
    if (!isOpen || settings.transport !== 'agent') return
    let cancelled = false
    ;(async () => {
      const ok = await PrintAgentTransport.health(settings.agentUrl)
      if (cancelled) return
      setAgentOk(ok)
      if (ok) {
        try {
          setAgentTargets(await PrintAgentTransport.listTargets(settings.agentUrl))
        } catch {
          setAgentTargets([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, settings.transport, settings.agentUrl])

  useEscapeKey(isOpen, onClose)

  if (!isOpen) return null

  const run = async (kind: 'test' | 'drawer' | 'pair', fn: () => Promise<boolean | string | null>, okMsg: string) => {
    setBusy(kind)
    try {
      const result = await fn()
      if (result) toast.success(typeof result === 'string' ? `${okMsg}: ${result}` : okMsg)
      else if (status.message) toast.error(status.message)
    } finally {
      setBusy(null)
    }
  }

  const needsPairing = settings.transport === 'webusb' || settings.transport === 'webbluetooth'
  const unsupported =
    (settings.transport === 'webusb' && !support.webusb) || (settings.transport === 'webbluetooth' && !support.webbluetooth)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[95vh]">
        <div className="bg-slate-900 text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <Printer className="w-5 h-5 text-teal-300" />
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-teal-300 font-bold block">This terminal</span>
              <h2 className="text-base font-bold leading-tight">Receipt printer settings</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto text-sm">
          {/* Transport picker */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Connection</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TRANSPORTS.map((t) => {
                const Icon = t.icon
                const selected = settings.transport === t.kind
                const available =
                  t.kind === 'webusb' ? support.webusb : t.kind === 'webbluetooth' ? support.webbluetooth : true
                return (
                  <button
                    key={t.kind}
                    type="button"
                    onClick={() => updateSettings({ transport: t.kind })}
                    className={`text-left rounded-xl border p-3 flex gap-3 transition-colors ${
                      selected
                        ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${selected ? 'text-teal-600' : 'text-gray-400'}`} />
                    <div className="min-w-0">
                      <div className="font-semibold flex items-center gap-2">
                        {t.label}
                        {!available && (
                          <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                            not supported here
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t.description}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Device pairing */}
          {needsPairing && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium">Device</div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {deviceName ? deviceName : 'No device paired yet'}
                </div>
                {unsupported && (
                  <div className="text-xs text-amber-700 dark:text-amber-300 mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    This browser cannot use {settings.transport === 'webusb' ? 'WebUSB' : 'Web Bluetooth'}. Use Chrome or Edge over HTTPS.
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busy !== null || unsupported}
                  onClick={() => run('pair', () => printer.pairDevice(), 'Paired')}
                  className="px-3 py-1.5 rounded-md bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5"
                >
                  {busy === 'pair' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Pair / Select device
                </button>
                {deviceName && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => printer.forgetDevice().then(() => toast.info('Device forgotten'))}
                    className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-semibold"
                  >
                    Forget
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Print agent */}
          {settings.transport === 'agent' && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">Print agent</div>
                <div className="text-xs flex items-center gap-1.5">
                  {agentOk === null ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                  ) : agentOk ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> connected
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> not reachable
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setAgentOk(null)
                      PrintAgentTransport.health(settings.agentUrl).then(setAgentOk)
                      PrintAgentTransport.listTargets(settings.agentUrl).then(setAgentTargets).catch(() => setAgentTargets([]))
                    }}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                    title="Re-check"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField label="Agent URL">
                  <FormInput
                    value={settings.agentUrl}
                    onChange={(e) => updateSettings({ agentUrl: e.target.value })}
                    placeholder="http://127.0.0.1:9123"
                    inputSize="sm"
                  />
                </FormField>
                <FormField label="Target printer">
                  {agentTargets.length > 0 ? (
                    <FormSelect
                      value={settings.agentTarget}
                      onChange={(e) => updateSettings({ agentTarget: e.target.value })}
                      selectSize="sm"
                    >
                      <option value="">Default target</option>
                      {agentTargets.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name} ({t.type})
                        </option>
                      ))}
                    </FormSelect>
                  ) : (
                    <FormInput
                      value={settings.agentTarget}
                      onChange={(e) => updateSettings({ agentTarget: e.target.value })}
                      placeholder="e.g. counter1 (from printers.json)"
                      inputSize="sm"
                    />
                  )}
                </FormField>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Run <code className="font-mono">tools/print-agent</code> on this PC to print to network (port 9100), shared or serial
                printers.
              </p>
            </div>
          )}

          {/* Paper & behaviour */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Paper width">
              <FormSelect
                value={String(settings.paperWidth)}
                onChange={(e) => updateSettings({ paperWidth: e.target.value === '58' ? 58 : 80 })}
                selectSize="sm"
              >
                <option value="80">80 mm (48 columns)</option>
                <option value="58">58 mm (32 columns)</option>
              </FormSelect>
            </FormField>
            <FormField label="Copies">
              <FormInput
                type="number"
                min={1}
                max={5}
                value={settings.copies}
                onChange={(e) => updateSettings({ copies: Number(e.target.value) || 1 })}
                inputSize="sm"
              />
            </FormField>
          </div>
          <div className="space-y-2">
            <FormCheckbox
              label="Auto-print receipt after each sale"
              checked={settings.autoPrint}
              onChange={(e) => updateSettings({ autoPrint: e.target.checked })}
            />
            <FormCheckbox
              label="Kick cash drawer on cash sales (printer DK port)"
              checked={settings.drawerKick}
              disabled={settings.transport === 'browser'}
              onChange={(e) => updateSettings({ drawerKick: e.target.checked })}
            />
            <FormCheckbox
              label="Print Sinhala / Tamil text as bitmap (slower, works on any ESC/POS printer)"
              checked={settings.unicodeAsBitmap}
              disabled={settings.transport === 'browser'}
              onChange={(e) => updateSettings({ unicodeAsBitmap: e.target.checked })}
            />
          </div>

          {/* Status */}
          {status.state === 'error' && status.message && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs p-2.5 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{status.message}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2 bg-gray-50 dark:bg-slate-900/60">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null || unsupported}
              onClick={() => run('test', () => printer.testPrint(), 'Test page sent')}
              className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
              Test print
            </button>
            <button
              type="button"
              disabled={busy !== null || settings.transport === 'browser' || unsupported}
              onClick={() => run('drawer', () => printer.openDrawer(), 'Drawer kick sent')}
              className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-semibold disabled:opacity-50"
            >
              Open drawer
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-slate-900 dark:bg-white dark:text-slate-900 text-white text-xs font-semibold"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
