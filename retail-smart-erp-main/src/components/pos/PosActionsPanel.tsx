'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { LayoutGrid, X } from 'lucide-react'
import { Kbd } from './Kbd'

export interface PosActionTile {
  id: string
  label: string
  icon: LucideIcon
  /** shortcut that runs this action directly while the panel is closed ("F7", "Alt+B" …) */
  shortcut?: string
  /** greyed out with this explanation (e.g. "Open a shift first") */
  disabledReason?: string | null
  /** extra words the type-to-filter matches ("refund" for Return …) */
  keywords?: string
  /** tile colour (Tailwind classes for the icon badge) */
  tone?: string
  run: () => void
}

/** Moves the highlight in a grid of `count` tiles with `cols` columns (pure; arrows / Home / End). */
export function moveInGrid(index: number, key: string, count: number, cols: number): number {
  if (count <= 0) return -1
  const i = Math.min(Math.max(index, 0), count - 1)
  const c = Math.max(1, cols)
  switch (key) {
    case 'ArrowRight': return Math.min(count - 1, i + 1)
    case 'ArrowLeft': return Math.max(0, i - 1)
    case 'ArrowDown': return i + c < count ? i + c : i
    case 'ArrowUp': return i - c >= 0 ? i - c : i
    case 'Home': return 0
    case 'End': return count - 1
    default: return i
  }
}

/**
 * POS "Actions" launcher (Alt+A / Ctrl+K): the secondary till actions as large tiles. Arrow keys
 * move the highlight in 2-D, Enter / Space runs it, letters filter, Esc closes.
 * Keys are taken in the capture phase so the POS page's own shortcuts never see them.
 * Mount it only while open (`{show && <PosActionsPanel …/>}`) so every opening starts unfiltered.
 */
export function PosActionsPanel({ isOpen, onClose, actions }: {
  isOpen: boolean
  /** closed without running anything (Esc, click outside): the page puts focus back on search */
  onClose: () => void
  actions: PosActionTile[]
}) {
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const lastKeyRef = useRef(0)

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return actions
    return actions.filter((a) => `${a.label} ${a.keywords || ''} ${a.shortcut || ''}`.toLowerCase().includes(f))
  }, [actions, filter])

  // highlighted tile, kept inside the (filtered) list
  const current = visible.length === 0 ? -1 : Math.min(active, visible.length - 1)

  // Keep the highlighted tile focused (screen readers) and in view
  useEffect(() => {
    if (!isOpen || current < 0) return
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-action-index="${current}"]`)
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest' })
  }, [isOpen, current, visible])

  /** Columns as laid out right now (the grid is responsive) */
  function columns(): number {
    const tiles = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-action-index]') || [])
    if (tiles.length === 0) return 1
    const top = tiles[0].offsetTop
    const n = tiles.filter((t) => Math.abs(t.offsetTop - top) < 4).length
    return Math.max(1, n)
  }

  function runAt(i: number) {
    const a = visible[i]
    if (!a || a.disabledReason) return
    // close first: the action may open its own window, which must not sit under this one
    onClose()
    window.setTimeout(() => a.run(), 0)
  }

  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      const now = Date.now()
      const gap = now - lastKeyRef.current
      lastKeyRef.current = now
      const k = e.key
      const ctrl = e.ctrlKey || e.metaKey
      const handled = () => { e.preventDefault(); e.stopPropagation() }
      // the same shortcut closes it again
      if ((e.altKey && e.code === 'KeyA') || (ctrl && e.code === 'KeyK')) { handled(); onClose(); return }
      if (k === 'Escape') {
        handled()
        if (filter) setFilter('')
        else onClose()
        return
      }
      if (e.altKey || ctrl) return
      if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(k)) {
        handled()
        setActive(moveInGrid(current, k, visible.length, columns()))
        return
      }
      if (k === 'Enter' || k === ' ') {
        handled()
        // keys arriving this fast are a barcode scanner, not a choice
        if (gap < 30) return
        runAt(current)
        return
      }
      if (k === 'Backspace') { handled(); setFilter((f) => f.slice(0, -1)); setActive(0); return }
      if (k === 'Tab') {
        handled()
        setActive(visible.length === 0 ? 0 : (current + (e.shiftKey ? visible.length - 1 : 1)) % visible.length)
        return
      }
      if (/^[a-zA-Z]$/.test(k)) { handled(); setFilter((f) => f + k); setActive(0); return }
      // anything else (digits, F-keys …) is swallowed so the till behind does not react
      if (k.length === 1 || /^F\d+$/.test(k)) handled()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, visible, current, filter, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="POS actions"
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl min-[1920px]:max-w-5xl max-h-[90vh] flex flex-col border border-slate-200 dark:border-gray-700"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 dark:border-gray-700">
          <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <LayoutGrid size={20} className="text-teal-700 dark:text-teal-400" /> Actions
          </h3>
          <div className="flex-1 max-w-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-sm font-mono text-slate-700 dark:text-gray-200 truncate" aria-live="polite">
            {filter ? filter : <span className="text-slate-400 dark:text-gray-500 font-sans">Type to filter…</span>}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-500 dark:text-gray-400" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div ref={gridRef} className="overflow-y-auto p-4 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 min-[1920px]:grid-cols-5">
          {visible.length === 0 && (
            <p className="col-span-full text-center text-sm text-slate-500 dark:text-gray-400 py-8">No action matches “{filter}”. Backspace to edit, Esc to clear.</p>
          )}
          {visible.map((a, i) => {
            const Icon = a.icon
            const disabled = !!a.disabledReason
            const isActive = i === current
            return (
              <button
                key={a.id}
                type="button"
                data-action-index={i}
                aria-disabled={disabled}
                title={disabled ? a.disabledReason || undefined : a.label}
                onMouseEnter={() => setActive(i)}
                onClick={() => runAt(i)}
                className={`relative text-left rounded-xl border-2 p-3.5 min-[1920px]:p-4 flex flex-col gap-2 min-h-[6.5rem] outline-none transition-colors ${
                  disabled
                    ? 'opacity-50 cursor-not-allowed bg-slate-50 dark:bg-gray-800/60 border-slate-200 dark:border-gray-700'
                    : isActive
                      ? 'theme-bg-subtle theme-border-primary shadow-md'
                      : 'bg-white dark:bg-gray-800 border-slate-200 dark:border-gray-700 hover:border-slate-300 dark:hover:border-gray-600'
                } ${isActive && disabled ? 'ring-2 ring-slate-400 dark:ring-gray-500' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`w-10 h-10 rounded-lg flex items-center justify-center ${a.tone || 'bg-slate-100 dark:bg-gray-700 text-slate-700 dark:text-gray-200'}`}>
                    <Icon size={20} />
                  </span>
                  {a.shortcut && <Kbd>{a.shortcut}</Kbd>}
                </div>
                <span className="font-bold text-sm min-[1920px]:text-base text-slate-900 dark:text-white leading-tight">{a.label}</span>
                {disabled && <span className="text-[11px] text-slate-500 dark:text-gray-400 leading-tight">{a.disabledReason}</span>}
              </button>
            )
          })}
        </div>

        <p className="px-5 py-3 border-t border-slate-100 dark:border-gray-700 text-xs text-slate-500 dark:text-gray-400">
          ← → ↑ ↓ move · Enter run · letters filter · Esc close. Each shortcut shown also works without opening this panel.
        </p>
      </div>
    </div>
  )
}
