'use client'

import { useEffect } from 'react'
import { Keyboard, X } from 'lucide-react'
import { POS_SHORTCUTS, POS_CONTEXT_SHORTCUTS } from '@/lib/pos/shortcuts'

/** "Keyboard shortcuts" overlay (? or Ctrl+/ on the POS). */
export function ShortcutsHelpModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === '?' || (e.key === '/' && (e.ctrlKey || e.metaKey))) {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const groups = Array.from(new Set(POS_SHORTCUTS.map((s) => s.group)))
  const ctxGroups = Array.from(new Set(POS_CONTEXT_SHORTCUTS.map((s) => s.group)))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl min-[1920px]:max-w-5xl max-h-[90vh] flex flex-col border border-slate-200 dark:border-gray-700"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-gray-700">
          <h3 className="font-bold text-lg text-slate-900 dark:text-white flex items-center gap-2">
            <Keyboard size={20} className="text-teal-700" /> Keyboard shortcuts
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 text-slate-500" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-5 grid gap-6 md:grid-cols-2 min-[1920px]:grid-cols-3">
          {groups.map((g) => (
            <section key={g}>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">{g}</h4>
              <ul className="space-y-1.5">
                {POS_SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <li key={s.action} className="flex items-center justify-between gap-3 text-sm min-[1920px]:text-base">
                    <span className="text-slate-700 dark:text-gray-200">{s.label}</span>
                    <span className="flex gap-1 shrink-0">
                      {s.keys.map((k) => (
                        <kbd key={k} className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-gray-600 bg-slate-100 dark:bg-gray-800 font-mono text-xs font-bold text-slate-800 dark:text-gray-100">{k}</kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {ctxGroups.map((g) => (
            <section key={`ctx-${g}`}>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">In the {g.toLowerCase()}</h4>
              <ul className="space-y-1.5">
                {POS_CONTEXT_SHORTCUTS.filter((s) => s.group === g).map((s) => (
                  <li key={s.keys + s.label} className="flex items-center justify-between gap-3 text-sm min-[1920px]:text-base">
                    <span className="text-slate-700 dark:text-gray-200">{s.label}</span>
                    <kbd className="px-1.5 py-0.5 rounded border border-slate-300 dark:border-gray-600 bg-slate-100 dark:bg-gray-800 font-mono text-xs font-bold text-slate-800 dark:text-gray-100 shrink-0">{s.keys}</kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="px-5 py-3 border-t border-slate-100 dark:border-gray-700 text-xs text-slate-500">
          Shortcuts pause while a window (payment, discount …) is open and work again when it closes. Every action is also
          in the Actions panel (Alt+A or Ctrl+K). Esc closes this list.
        </p>
      </div>
    </div>
  )
}
