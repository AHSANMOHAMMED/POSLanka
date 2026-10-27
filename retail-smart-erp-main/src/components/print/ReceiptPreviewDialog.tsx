'use client'

/**
 * Print preview for raw ESC/POS jobs (receipts, Z reports, test pages): the
 * bytes are decoded back into lines (exact columns, bold, double size,
 * alignment, logo / bitmap text rendered from the raster) and shown on a
 * paper strip with Print / Cancel and a printer switcher.
 *
 * `openReceiptPreview()` mounts the dialog imperatively, so any code path
 * (hooks, libs) can await the cashier's decision without owning a React tree.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Loader2, Printer, X } from 'lucide-react'
import { decodeEscPosPreview, type EscPosPreviewLine } from '@/lib/print/escpos/preview'
import { COLUMNS } from '@/lib/print/escpos/encoder'
import { SMALL_FONT_COLUMNS } from '@/lib/print/escpos/receipt-from-model'
import { PrintAgentTransport, TRANSPORT_LABELS, type PrintAgentTarget } from '@/lib/print/escpos/transports'
import { getPrinterProfilesSnapshot, ROLE_LABELS, type PrinterProfile } from '@/lib/print/printer-profiles'

export interface ReceiptPreviewRequest {
  bytes: Uint8Array
  title?: string
  profile: PrinterProfile
  /** Rebuild the bytes for another printer (paper width / code page differ). */
  rebuild?: (profile: PrinterProfile) => Promise<Uint8Array>
}

export interface ReceiptPreviewResult {
  /** Printer chosen in the dialog (may carry a one-off agentTarget override). */
  profile: PrinterProfile
  bytes: Uint8Array
}

const PAPER_PX: Record<58 | 80, number> = { 58: 300, 80: 400 }

function RasterImage({ line, paperDots, widthPx }: { line: EscPosPreviewLine; paperDots: number; widthPx: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const w = line.width || 0
  const h = line.height || 0
  useEffect(() => {
    const c = ref.current
    const raster = line.raster
    if (!c || !raster || !w || !h) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(w, h)
    const bpr = w / 8
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const on = (raster[y * bpr + (x >> 3)] ?? 0) & (0x80 >> (x & 7))
        const o = (y * w + x) * 4
        const v = on ? 0 : 255
        img.data[o] = v
        img.data[o + 1] = v
        img.data[o + 2] = v
        img.data[o + 3] = on ? 255 : 0
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [line.raster, w, h])
  if (!w || !h) return null
  const scale = widthPx / paperDots
  const justify = line.align === 'right' ? 'flex-end' : line.align === 'center' ? 'center' : 'flex-start'
  return (
    <div style={{ display: 'flex', justifyContent: justify }}>
      <canvas ref={ref} width={w} height={h} style={{ width: w * scale, height: h * scale, imageRendering: 'pixelated' }} />
    </div>
  )
}

/** Paper strip rendering of ESC/POS bytes. */
export function EscPosPaper({ bytes, paperWidth }: { bytes: Uint8Array; paperWidth: 58 | 80 }) {
  const lines = useMemo(() => decodeEscPosPreview(bytes), [bytes])
  const widthPx = PAPER_PX[paperWidth]
  const paperDots = paperWidth === 58 ? 384 : 576
  const cols = COLUMNS[paperWidth]
  const fontPx = widthPx / (cols * 0.6)
  const smallFontPx = widthPx / (SMALL_FONT_COLUMNS[paperWidth] * 0.6)
  return (
    <div
      className="bg-white shadow-md mx-auto px-3 py-4"
      style={{ width: widthPx + 24, fontFamily: "'Courier New', ui-monospace, monospace", fontSize: fontPx, lineHeight: 1.25, color: '#000' }}
    >
      {lines.map((l, i) => {
        if (l.kind === 'image') return <RasterImage key={i} line={l} paperDots={paperDots} widthPx={widthPx} />
        if (l.kind === 'barcode' || l.kind === 'qr') {
          return (
            <div key={i} style={{ textAlign: 'center', margin: '4px 0' }}>
              <span style={{ display: 'inline-block', padding: '4px 8px', border: '1px dashed #9ca3af', fontSize: 11, maxWidth: '100%', overflowWrap: 'anywhere' }}>
                {l.kind === 'qr' ? 'QR' : 'Barcode'}: {l.text}
              </span>
            </div>
          )
        }
        if (l.kind === 'cut') {
          return (
            <div key={i} style={{ borderTop: '2px dashed #9ca3af', margin: '10px -12px', textAlign: 'center', fontSize: 10, color: '#6b7280' }}>
              ✂ cut
            </div>
          )
        }
        const base = l.small ? smallFontPx : fontPx
        const tall = l.h >= 2 && l.w < 2
        return (
          <div
            key={i}
            style={{
              whiteSpace: 'pre',
              textAlign: l.align,
              fontWeight: l.bold ? 700 : 400,
              fontSize: l.w >= 2 ? base * Math.min(l.w, 3) : base,
              height: tall ? '2.5em' : undefined,
              transform: tall ? 'scaleY(2)' : undefined,
              transformOrigin: 'top',
              overflow: 'hidden',
            }}
          >
            {l.text || ' '}
          </div>
        )
      })}
    </div>
  )
}

export interface ReceiptPreviewDialogProps extends ReceiptPreviewRequest {
  onPrint: (result: ReceiptPreviewResult) => void
  onCancel: () => void
}

export function ReceiptPreviewDialog({ bytes: initialBytes, title, profile: initialProfile, rebuild, onPrint, onCancel }: ReceiptPreviewDialogProps) {
  const printers = useMemo(() => {
    const list = getPrinterProfilesSnapshot().filter((p) => p.role !== 'label')
    return list.some((p) => p.id === initialProfile.id) ? list : [initialProfile, ...list]
  }, [initialProfile])
  const [profileId, setProfileId] = useState(initialProfile.id)
  const [agentTarget, setAgentTarget] = useState(initialProfile.agentTarget)
  const [bytes, setBytes] = useState(initialBytes)
  const [rebuilding, setRebuilding] = useState(false)
  const [agentTargets, setAgentTargets] = useState<PrintAgentTarget[]>([])

  const profile = printers.find((p) => p.id === profileId) || initialProfile
  const effective: PrinterProfile = profile.transport === 'agent' ? { ...profile, agentTarget } : profile

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  // Installed / configured printers of the agent for the one-off target switch.
  useEffect(() => {
    if (profile.transport !== 'agent') return
    let cancelled = false
    PrintAgentTransport.listTargets(profile.agentUrl)
      .then((t) => !cancelled && setAgentTargets(t))
      .catch(() => !cancelled && setAgentTargets([]))
    return () => {
      cancelled = true
    }
  }, [profile.transport, profile.agentUrl])

  const choosePrinter = async (id: string) => {
    const next = printers.find((p) => p.id === id)
    if (!next) return
    setProfileId(id)
    setAgentTarget(next.agentTarget)
    const layoutChanged =
      next.paperWidth !== profile.paperWidth || next.codePage !== profile.codePage || next.unicodeAsBitmap !== profile.unicodeAsBitmap || next.copies !== profile.copies
    if (rebuild && layoutChanged) {
      setRebuilding(true)
      try {
        setBytes(await rebuild(next))
      } catch {
        /* keep the previous bytes */
      } finally {
        setRebuilding(false)
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[95vh]">
        <div className="px-5 py-3 flex items-center justify-between border-b border-gray-200 dark:border-gray-800">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider font-bold text-teal-600 dark:text-teal-300">Print preview</p>
            <h2 className="text-base font-bold truncate text-gray-900 dark:text-white">{title || 'Receipt'}</h2>
          </div>
          <button type="button" onClick={onCancel} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-gray-100 dark:bg-slate-950 p-4 relative">
          {rebuilding && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-black/40">
              <Loader2 className="w-6 h-6 animate-spin text-teal-600" />
            </div>
          )}
          <EscPosPaper bytes={bytes} paperWidth={effective.paperWidth} />
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-800 space-y-3 text-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Printer</span>
              <select
                value={profileId}
                onChange={(e) => choosePrinter(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
              >
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({ROLE_LABELS[p.role]} · {TRANSPORT_LABELS[p.transport]} · {p.paperWidth}mm)
                  </option>
                ))}
              </select>
            </label>
            {profile.transport === 'agent' && (
              <label className="block">
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Send to</span>
                <select
                  value={agentTarget}
                  onChange={(e) => setAgentTarget(e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
                >
                  <option value="">Agent default printer</option>
                  {agentTarget && !agentTargets.some((t) => t.name === agentTarget) && <option value={agentTarget}>{agentTarget}</option>}
                  {agentTargets.map((t) => (
                    <option key={`${t.source}:${t.name}`} value={t.name}>
                      {t.name}
                      {t.isDefault ? ' (default)' : ''}
                      {t.driver ? ` - ${t.driver}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {profile.transport === 'browser' && (
            <p className="text-xs text-gray-500 dark:text-gray-400">The system print dialog opens next; choose the printer there.</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-md border border-gray-300 dark:border-gray-600 text-sm font-semibold text-gray-700 dark:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              disabled={rebuilding}
              onClick={() => onPrint({ profile: effective, bytes })}
              className="px-4 py-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
            >
              <Printer className="w-4 h-4" /> Print
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Show the preview and resolve with the chosen printer + bytes, or null when
 * the user cancels. Client-only; resolves immediately (no preview) on the server.
 */
export function openReceiptPreview(req: ReceiptPreviewRequest): Promise<ReceiptPreviewResult | null> {
  if (typeof document === 'undefined') return Promise.resolve({ profile: req.profile, bytes: req.bytes })
  return new Promise((resolve) => {
    const host = document.createElement('div')
    host.setAttribute('data-receipt-preview', '')
    document.body.appendChild(host)
    const root = createRoot(host)
    let done = false
    const finish = (result: ReceiptPreviewResult | null) => {
      if (done) return
      done = true
      resolve(result)
      // Unmount after the current event finishes.
      setTimeout(() => {
        root.unmount()
        host.remove()
      }, 0)
    }
    root.render(<ReceiptPreviewDialog {...req} onPrint={(r) => finish(r)} onCancel={() => finish(null)} />)
  })
}
