'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Printer,
  X,
  Usb,
  Bluetooth,
  Globe,
  Server,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trash2,
  Tag,
  Receipt,
  ChefHat,
} from 'lucide-react'
import { FormInput, FormSelect, FormCheckbox, FormField } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { usePrinters, buildReceiptTestBytes, type PrinterTransportKind, type PrinterProfile, type PrinterRole } from '@/hooks/usePrinter'
import { PrintAgentTransport, supportsWebBluetooth, supportsWebUsb, type PrintAgentTarget } from '@/lib/print/escpos/transports'
import { LABEL_LANGUAGES, LABEL_LANGUAGE_LABELS, ROLE_LABELS, type LabelLanguage } from '@/lib/print/printer-profiles'
import { labelTestTemplate } from '@/lib/print/label'
import { printLabelsRaw } from '@/lib/labels/label-print'
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
  { kind: 'webusb', label: 'USB', description: 'Direct raw printing over WebUSB (Chrome/Edge)', icon: Usb },
  { kind: 'webbluetooth', label: 'Bluetooth', description: 'BLE printers (Chrome/Edge, Android)', icon: Bluetooth },
  { kind: 'agent', label: 'Print agent', description: 'Local helper on this PC: network, shared or serial printer', icon: Server },
]

const ROLE_ICONS: Record<PrinterRole, typeof Receipt> = { receipt: Receipt, label: Tag, kitchen: ChefHat }

export function PrinterSettingsModal({ isOpen, onClose }: PrinterSettingsModalProps) {
  const { printers, status, addPrinter, updatePrinter, removePrinter, printTo, pairDevice, forgetDevice, deviceNameOf } = usePrinters()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState<'test' | 'drawer' | 'pair' | null>(null)
  const [agentOk, setAgentOk] = useState<boolean | null>(null)
  const [agentTargets, setAgentTargets] = useState<PrintAgentTarget[]>([])
  const support = useMemo(() => ({ webusb: supportsWebUsb(), webbluetooth: supportsWebBluetooth() }), [])

  const selected: PrinterProfile | null = printers.find((p) => p.id === selectedId) || printers[0] || null

  const selTransport = selected?.transport
  const selAgentUrl = selected?.agentUrl || ''

  useEffect(() => {
    if (!isOpen || selTransport !== 'agent') return
    let cancelled = false
    ;(async () => {
      const ok = await PrintAgentTransport.health(selAgentUrl)
      if (cancelled) return
      setAgentOk(ok)
      if (ok) {
        try {
          const targets = await PrintAgentTransport.listTargets(selAgentUrl)
          if (!cancelled) setAgentTargets(targets)
        } catch {
          if (!cancelled) setAgentTargets([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isOpen, selTransport, selAgentUrl])

  useEscapeKey(isOpen, onClose)

  if (!isOpen) return null

  const update = (patch: Partial<PrinterProfile>) => selected && updatePrinter(selected.id, patch)
  const updateLabel = (patch: Partial<PrinterProfile['label']>) => selected && updatePrinter(selected.id, { label: { ...selected.label, ...patch } })

  const add = (role: PrinterRole) => {
    const p = addPrinter(role)
    setSelectedId(p.id)
  }

  const run = async (kind: 'test' | 'drawer' | 'pair', fn: () => Promise<boolean | string | null>, okMsg: string) => {
    setBusy(kind)
    try {
      const result = await fn()
      if (result) toast.success(typeof result === 'string' ? `${okMsg}: ${result}` : okMsg)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const testPrint = async (p: PrinterProfile): Promise<boolean> => {
    if (p.role === 'label') {
      if (p.label.language === 'browser' || p.transport === 'browser') {
        toast.info('Browser label printing uses the print dialog on the barcode label page.')
        return false
      }
      const res = await printLabelsRaw(p, labelTestTemplate(p.label.widthMm, p.label.heightMm), [{ item: null, quantity: 1 }])
      if (res.warnings.length) toast.warning(res.warnings.join('; '))
      if (!res.ok) toast.error(res.error || 'Label test failed')
      return res.ok
    }
    const ok = await printTo(p, await buildReceiptTestBytes(p), { title: 'Printer test' })
    return ok
  }

  const needsPairing = !!selected && (selected.transport === 'webusb' || selected.transport === 'webbluetooth')
  const unsupported =
    !!selected && ((selected.transport === 'webusb' && !support.webusb) || (selected.transport === 'webbluetooth' && !support.webbluetooth))
  const deviceName = selected ? deviceNameOf(selected) : null
  const isLabel = selected?.role === 'label'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="w-full max-w-4xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800 flex flex-col max-h-[95vh]">
        <div className="bg-slate-900 text-white px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
              <Printer className="w-5 h-5 text-teal-300" />
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-wider text-teal-300 font-bold block">This terminal</span>
              <h2 className="text-base font-bold leading-tight">Printers</h2>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col md:flex-row min-h-0 flex-1">
          {/* Printer list */}
          <div className="md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 p-3 space-y-2 overflow-y-auto">
            {printers.length === 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400 p-2">
                No printers yet. Receipts use the browser print dialog until you add one.
              </p>
            )}
            {printers.map((p) => {
              const Icon = ROLE_ICONS[p.role]
              const active = selected?.id === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2 flex items-center gap-2 text-sm ${
                    active ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-teal-600' : 'text-gray-400'}`} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                      {ROLE_LABELS[p.role]} · {TRANSPORTS.find((t) => t.kind === p.transport)?.label}
                      {p.role === 'label' ? ` · ${p.label.language.toUpperCase()}` : ` · ${p.paperWidth}mm`}
                    </div>
                  </div>
                </button>
              )
            })}
            <div className="pt-2 border-t border-gray-200 dark:border-gray-800 space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Add printer</p>
              {(['receipt', 'label', 'kitchen'] as PrinterRole[]).map((role) => {
                const Icon = ROLE_ICONS[role]
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() => add(role)}
                    className="w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <Icon className="w-3.5 h-3.5 text-gray-400" />
                    {ROLE_LABELS[role]} printer
                  </button>
                )
              })}
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 p-5 space-y-5 overflow-y-auto text-sm">
            {!selected ? (
              <div className="text-center text-gray-500 py-12">Add a printer to configure it.</div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField label="Name">
                    <FormInput value={selected.name} onChange={(e) => update({ name: e.target.value })} inputSize="sm" maxLength={60} />
                  </FormField>
                  <FormField label="Role">
                    <FormSelect value={selected.role} onChange={(e) => update({ role: e.target.value as PrinterRole })} selectSize="sm">
                      <option value="receipt">Receipt (POS sales, Z report, drawer)</option>
                      <option value="label">Label (barcode labels)</option>
                      <option value="kitchen">Kitchen (orders)</option>
                    </FormSelect>
                  </FormField>
                </div>
                {selected.role === 'receipt' && printers.filter((p) => p.role === 'receipt').length > 1 && (
                  <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Several receipt printers: the first one in the list is used for sales.
                  </p>
                )}

                {/* Transport picker */}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Connection</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {TRANSPORTS.map((t) => {
                      const Icon = t.icon
                      const isSel = selected.transport === t.kind
                      const available = t.kind === 'webusb' ? support.webusb : t.kind === 'webbluetooth' ? support.webbluetooth : true
                      return (
                        <button
                          key={t.kind}
                          type="button"
                          onClick={() => update({ transport: t.kind })}
                          className={`text-left rounded-xl border p-3 flex gap-3 transition-colors ${
                            isSel
                              ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${isSel ? 'text-teal-600' : 'text-gray-400'}`} />
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

                {needsPairing && (
                  <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">Device</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{deviceName || 'No device paired yet'}</div>
                      {unsupported && (
                        <div className="text-xs text-amber-700 dark:text-amber-300 mt-1 flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          This browser cannot use {selected.transport === 'webusb' ? 'WebUSB' : 'Web Bluetooth'}. Use Chrome or Edge over HTTPS.
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={busy !== null || unsupported}
                        onClick={() => run('pair', () => pairDevice(selected), 'Paired')}
                        className="px-3 py-1.5 rounded-md bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5"
                      >
                        {busy === 'pair' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                        Pair / Select device
                      </button>
                      {deviceName && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => forgetDevice(selected).then(() => toast.info('Device forgotten'))}
                          className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-semibold"
                        >
                          Forget
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {selected.transport === 'agent' && (
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
                            PrintAgentTransport.health(selected.agentUrl).then(setAgentOk)
                            PrintAgentTransport.listTargets(selected.agentUrl).then(setAgentTargets).catch(() => setAgentTargets([]))
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
                          value={selected.agentUrl}
                          onChange={(e) => update({ agentUrl: e.target.value })}
                          placeholder="http://127.0.0.1:9123"
                          inputSize="sm"
                        />
                      </FormField>
                      <FormField label="Target printer">
                        {agentTargets.length > 0 ? (
                          <FormSelect value={selected.agentTarget} onChange={(e) => update({ agentTarget: e.target.value })} selectSize="sm">
                            <option value="">Default target</option>
                            {agentTargets.map((t) => (
                              <option key={t.name} value={t.name}>
                                {t.name} ({t.type})
                              </option>
                            ))}
                          </FormSelect>
                        ) : (
                          <FormInput
                            value={selected.agentTarget}
                            onChange={(e) => update({ agentTarget: e.target.value })}
                            placeholder="e.g. counter1 (from printers.json)"
                            inputSize="sm"
                          />
                        )}
                      </FormField>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Run <code className="font-mono">tools/print-agent</code> on this PC and add this site to{' '}
                      <code className="font-mono">allowedOrigins</code> in its printers.json.
                    </p>
                  </div>
                )}

                {isLabel ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormField label="Printer language">
                        <FormSelect
                          value={selected.label.language}
                          onChange={(e) => updateLabel({ language: e.target.value as LabelLanguage })}
                          selectSize="sm"
                        >
                          {LABEL_LANGUAGES.map((l) => (
                            <option key={l} value={l}>
                              {LABEL_LANGUAGE_LABELS[l]}
                            </option>
                          ))}
                        </FormSelect>
                      </FormField>
                      <FormField label="Resolution">
                        <FormSelect
                          value={String(selected.label.dpi)}
                          onChange={(e) => updateLabel({ dpi: e.target.value === '300' ? 300 : 203 })}
                          selectSize="sm"
                        >
                          <option value="203">203 dpi (8 dots/mm)</option>
                          <option value="300">300 dpi (12 dots/mm)</option>
                        </FormSelect>
                      </FormField>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <FormField label="Label width (mm)">
                        <FormInput type="number" min={10} max={220} value={selected.label.widthMm} onChange={(e) => updateLabel({ widthMm: Number(e.target.value) })} inputSize="sm" />
                      </FormField>
                      <FormField label="Label height (mm)">
                        <FormInput type="number" min={5} max={400} value={selected.label.heightMm} onChange={(e) => updateLabel({ heightMm: Number(e.target.value) })} inputSize="sm" />
                      </FormField>
                      <FormField label="Gap (mm)">
                        <FormInput type="number" min={0} max={20} step={0.5} value={selected.label.gapMm} onChange={(e) => updateLabel({ gapMm: Number(e.target.value) })} inputSize="sm" />
                      </FormField>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label="Darkness (optional)">
                        <FormInput
                          type="number"
                          min={0}
                          max={30}
                          value={selected.label.darkness ?? ''}
                          onChange={(e) => updateLabel({ darkness: e.target.value === '' ? undefined : Number(e.target.value) })}
                          placeholder="printer default"
                          inputSize="sm"
                        />
                      </FormField>
                      <FormField label="Speed ips (optional)">
                        <FormInput
                          type="number"
                          min={1}
                          max={14}
                          value={selected.label.speed ?? ''}
                          onChange={(e) => updateLabel({ speed: e.target.value === '' ? undefined : Number(e.target.value) })}
                          placeholder="printer default"
                          inputSize="sm"
                        />
                      </FormField>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Templates are printed at their own size; the size here is used for the test label. Use ESC/POS raster to
                      print labels on a receipt printer.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <FormField label="Paper width">
                        <FormSelect
                          value={String(selected.paperWidth)}
                          onChange={(e) => update({ paperWidth: e.target.value === '58' ? 58 : 80 })}
                          selectSize="sm"
                        >
                          <option value="80">80 mm (48 columns)</option>
                          <option value="58">58 mm (32 columns)</option>
                        </FormSelect>
                      </FormField>
                      <FormField label="Copies">
                        <FormInput type="number" min={1} max={5} value={selected.copies} onChange={(e) => update({ copies: Number(e.target.value) || 1 })} inputSize="sm" />
                      </FormField>
                      <FormField label="Code page">
                        <FormSelect value={selected.codePage} onChange={(e) => update({ codePage: e.target.value === 'cp1252' ? 'cp1252' : 'cp437' })} selectSize="sm">
                          <option value="cp437">CP437 (default)</option>
                          <option value="cp1252">Windows-1252 (Latin accents)</option>
                        </FormSelect>
                      </FormField>
                    </div>
                    <div className="space-y-2">
                      {selected.role === 'receipt' && (
                        <>
                          <FormCheckbox label="Auto-print receipt after each sale" checked={selected.autoPrint} onChange={(e) => update({ autoPrint: e.target.checked })} />
                          <FormCheckbox
                            label="Kick cash drawer on cash sales (printer DK port)"
                            checked={selected.drawerKick}
                            disabled={selected.transport === 'browser'}
                            onChange={(e) => update({ drawerKick: e.target.checked })}
                          />
                        </>
                      )}
                      <FormCheckbox
                        label="Print Sinhala / Tamil text as bitmap (slower, works on any ESC/POS printer)"
                        checked={selected.unicodeAsBitmap}
                        disabled={selected.transport === 'browser'}
                        onChange={(e) => update({ unicodeAsBitmap: e.target.checked })}
                      />
                    </div>
                  </>
                )}

                {status.state === 'error' && status.message && (
                  <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 text-xs p-2.5 flex gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{status.message}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2 bg-gray-50 dark:bg-slate-900/60">
          <div className="flex gap-2">
            {selected && (
              <>
                <button
                  type="button"
                  disabled={busy !== null || unsupported}
                  onClick={() => run('test', () => testPrint(selected), isLabel ? 'Test label sent' : 'Test page sent')}
                  className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                >
                  {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                  {isLabel ? 'Test label' : 'Test print'}
                </button>
                {selected.role === 'receipt' && (
                  <button
                    type="button"
                    disabled={busy !== null || selected.transport === 'browser' || unsupported}
                    onClick={() =>
                      run(
                        'drawer',
                        async () => printTo(selected, new Uint8Array([0x1b, 0x40, 0x1b, 0x70, 0, 25, 250])),
                        'Drawer kick sent'
                      )
                    }
                    className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-xs font-semibold disabled:opacity-50"
                  >
                    Open drawer
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Remove printer "${selected.name}"?`)) {
                      removePrinter(selected.id)
                      setSelectedId(null)
                    }
                  }}
                  className="px-3 py-1.5 rounded-md border border-red-200 text-red-600 dark:border-red-800 text-xs font-semibold flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </>
            )}
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
