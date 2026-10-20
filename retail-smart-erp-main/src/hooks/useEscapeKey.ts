'use client'

import { useEffect, useRef } from 'react'

/**
 * Close a dialog with Escape (and optionally confirm with Enter) while it is open.
 * Uses the capture phase and stops propagation so page-level shortcuts
 * (POS F-keys, Escape-clears-search) don't also fire for the same key press.
 */
export function useEscapeKey(active: boolean, onEscape: () => void, onEnter?: () => void) {
  const escRef = useRef(onEscape)
  const enterRef = useRef(onEnter)
  // Keep the latest callbacks without re-subscribing the listener on every render
  useEffect(() => {
    escRef.current = onEscape
    enterRef.current = onEnter
  }, [onEscape, onEnter])

  useEffect(() => {
    if (!active) return
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        escRef.current()
        return
      }
      if (e.key === 'Enter' && enterRef.current) {
        const el = document.activeElement as HTMLElement | null
        // Let Enter work normally inside text areas and on focused buttons
        if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON')) return
        e.preventDefault()
        e.stopPropagation()
        enterRef.current()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [active])
}
