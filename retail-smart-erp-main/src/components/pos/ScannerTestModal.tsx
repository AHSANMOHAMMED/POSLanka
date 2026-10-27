'use client'

import { useEffect, useRef, useState } from 'react'
import { ScanBarcode, X, Loader2, CheckCircle2, XCircle, RotateCcw } from 'lucide-react'
import { visibleScanText } from '@/lib/pos/scan-burst'
import { sanitizeScan } from '@/lib/inventory/barcode-parse'

interface KeyHit { key: string; t: number }

interface ScanRead {
  id: number
  raw: string
  keys: number
  avgGap: number | null
  maxGap: number | null
  terminator: 'Enter' | 'Tab' | 'none (no suffix)'
  lookup: { state: 'loading' } | { state: 'found'; name: string; detail: string } | { state: 'missing'; detail: string } | { state: 'error'; detail: string }
}

/** A scan with no Enter / Tab suffix is closed after this much silence */
const IDLE_END_MS = 600

/**
 * "Scanner test": shows exactly what the barcode scanner types — raw characters (Enter, Tab and
 * control characters made visible), key timing, the terminator — and what the item lookup makes
 * of it. Tells an unreadable label (nothing arrives) from a code that is not on file.
 * Keys are captured while it is open; the POS behind does not react to them.
 */
export function ScannerTestModal({ isOpen, onClose, warehouseId }: {
  isOpen: boolean
  onClose: () => void
  warehouseId?: string | null
}) {
  const [reads, setReads] = useState<ScanRead[]>([])
  const [live, setLive] = useState('')
  const hitsRef = useRef<KeyHit[]>([])
  const idleRef = useRef<number | null>(null)
  const seqRef = useRef(0)

  useEffect(() => {
    if (!isOpen) return
    hitsRef.current = []

    async function lookup(id: number, raw: string) {
      const code = sanitizeScan(raw)
      let result: ScanRead['lookup']
      if (!code) {
        result = { state: 'missing', detail: 'Only control characters arrived — nothing to look up' }
      } else {
        try {
          const qs = new URLSearchParams({ barcode: code })
          if (warehouseId) qs.set('warehouseId', warehouseId)
          const res = await fetch(`/api/items/barcode-lookup?${qs.toString()}`)
          const data = await res.json().catch(() => ({}))
          if (res.ok) {
            const scan = (data.scan || {}) as { symbology?: string; matchedBy?: string }
            result = {
              state: 'found',
              name: String(data.name || 'Item'),
              detail: [data.sku && `SKU ${data.sku}`, data.barcode && `barcode ${data.barcode}`, scan.matchedBy && `matched by ${scan.matchedBy}`, scan.symbology && `read as ${scan.symbology}`]
                .filter(Boolean).join(' · '),
            }
          } else if (res.status === 404) {
            const scan = (data.scan || {}) as { symbology?: string; normalized?: string }
            result = { state: 'missing', detail: `No item has this code${scan.symbology ? ` (read as ${scan.symbology}${scan.normalized && scan.normalized !== code ? ` ${scan.normalized}` : ''})` : ''}. Check the item's barcode / SKU.` }
          } else {
            result = { state: 'error', detail: String(data.error || `Lookup failed (${res.status})`) }
          }
        } catch {
          result = { state: 'error', detail: 'Server not reachable' }
        }
      }
      setReads((prev) => prev.map((r) => (r.id === id ? { ...r, lookup: result } : r)))
    }

    function finish(terminator: ScanRead['terminator']) {
      if (idleRef.current) { window.clearTimeout(idleRef.current); idleRef.current = null }
      const hits = hitsRef.current
      hitsRef.current = []
      setLive('')
      if (hits.length === 0) return
      const raw = hits.map((h) => h.key).join('')
      const gaps = hits.slice(1).map((h, i) => h.t - hits[i].t)
      const read: ScanRead = {
        id: ++seqRef.current,
        raw,
        keys: hits.length,
        avgGap: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : null,
        maxGap: gaps.length ? Math.max(...gaps) : null,
        terminator,
        lookup: { state: 'loading' },
      }
      // newest first, last 8 kept
      setReads((prev) => [read, ...prev].slice(0, 8))
      void lookup(read.id, raw)
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
      if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph'].includes(e.key)) return
      e.preventDefault()
      e.stopPropagation()
      const t = performance.now()
      if (e.key === 'Enter') { finish('Enter'); return }
      if (e.key === 'Tab') { finish('Tab'); return }
      let ch: string | null = null
      if (e.key.length === 1 && !e.altKey && !(e.ctrlKey || e.metaKey)) ch = e.key
      // GS (FNC1) usually arrives as Ctrl+] from a keyboard-wedge scanner
      else if (e.ctrlKey && (e.key === ']' || e.code === 'BracketRight')) ch = '\u001d'
      else if (e.key.length === 1) ch = e.key
      else ch = `[${e.key}]`
      hitsRef.current.push({ key: ch, t })
      setLive(hitsRef.current.map((h) => h.key).join(''))
      if (idleRef.current) window.clearTimeout(idleRef.current)
      idleRef.current = window.setTimeout(() => finish('none (no suffix)'), IDLE_END_MS)
    }

    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (idleRef.current) { window.clearTimeout(idleRef.current); idleRef.current = null }
    }
  }, [isOpen, onClose, warehouseId])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Scanner test"
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-slate-200 dark:border-gray-700"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-gray-700">
          <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <ScanBarcode size={20} className="text-teal-700 dark:text-teal-400" /> Scanner test
          </h3>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setReads([])} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-500 dark:text-gray-400" aria-label="Clear" title="Clear">
              <RotateCcw size={16} />
            </button>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-500 dark:text-gray-400" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-4">
          <p className="text-sm text-slate-600 dark:text-gray-300">
            Scan a label now. Everything the scanner sends is shown below. If nothing appears, the scanner
            cannot read the label (print quality, size, symbology switched off in the scanner) — it is not the till.
          </p>

          <div className="rounded-xl border-2 border-dashed border-teal-500/60 bg-teal-50/50 dark:bg-teal-950/20 px-4 py-3 font-mono text-lg min-h-[3.25rem] break-all text-slate-900 dark:text-white">
            {live ? visibleScanText(live) : <span className="text-sm font-sans text-slate-400 dark:text-gray-500">Waiting for a scan…</span>}
          </div>

          {reads.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 dark:border-gray-700 p-4 space-y-2">
              <div className="font-mono text-base break-all text-slate-900 dark:text-white">{visibleScanText(r.raw)}</div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div><dt className="text-slate-500 dark:text-gray-400">Characters</dt><dd className="font-bold text-slate-800 dark:text-gray-100">{r.keys}</dd></div>
                <div><dt className="text-slate-500 dark:text-gray-400">Avg key gap</dt><dd className="font-bold text-slate-800 dark:text-gray-100">{r.avgGap === null ? '—' : `${r.avgGap} ms`}</dd></div>
                <div><dt className="text-slate-500 dark:text-gray-400">Longest gap</dt><dd className="font-bold text-slate-800 dark:text-gray-100">{r.maxGap === null ? '—' : `${Math.round(r.maxGap)} ms`}</dd></div>
                <div><dt className="text-slate-500 dark:text-gray-400">Ends with</dt><dd className={`font-bold ${r.terminator.startsWith('none') ? 'text-amber-700 dark:text-amber-400' : 'text-slate-800 dark:text-gray-100'}`}>{r.terminator}</dd></div>
              </dl>
              {r.terminator.startsWith('none') && (
                <p className="text-xs text-amber-700 dark:text-amber-400">The scanner sends no Enter / Tab after the code. Set it to add an Enter suffix (see its manual), otherwise the till waits.</p>
              )}
              {r.avgGap !== null && r.avgGap >= 50 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">Keys arrive slowly for a scanner ({r.avgGap} ms apart). It still works with an Enter suffix.</p>
              )}
              <div className="text-sm">
                {r.lookup.state === 'loading' && <span className="flex items-center gap-1.5 text-slate-500 dark:text-gray-400"><Loader2 size={14} className="animate-spin" /> Looking up…</span>}
                {r.lookup.state === 'found' && (
                  <span className="flex items-start gap-1.5 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                    <span><span className="font-bold">{r.lookup.name}</span>{r.lookup.detail && <span className="block text-xs text-slate-500 dark:text-gray-400">{r.lookup.detail}</span>}</span>
                  </span>
                )}
                {(r.lookup.state === 'missing' || r.lookup.state === 'error') && (
                  <span className="flex items-start gap-1.5 text-red-700 dark:text-red-400">
                    <XCircle size={16} className="mt-0.5 shrink-0" />
                    <span><span className="font-bold">{r.lookup.state === 'missing' ? 'Not found' : 'Lookup failed'}</span><span className="block text-xs text-slate-500 dark:text-gray-400">{r.lookup.detail}</span></span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <p className="px-5 py-3 border-t border-slate-100 dark:border-gray-700 text-xs text-slate-500 dark:text-gray-400">
          ⏎ = Enter · ⇥ = Tab · [GS] = group separator (GS1) · ␣ = space. Esc closes.
        </p>
      </div>
    </div>
  )
}
