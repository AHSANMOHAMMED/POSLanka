'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { Type } from 'lucide-react'
import {
  TEXT_SCALES,
  TEXT_SCALE_EVENT,
  TEXT_SCALE_LABELS,
  applyTextScale,
  readTextScale,
  saveTextScale,
  type TextScale,
  type TextScaleScope,
} from '@/lib/ui/text-scale'

const noopSubscribe = () => () => {}

function subscribe(cb: () => void) {
  window.addEventListener(TEXT_SCALE_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(TEXT_SCALE_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}

/** Current text scale for a scope (localStorage, synced across controls and tabs); applies it to <html>. */
export function useTextScale(scope: TextScaleScope, userId?: string | null) {
  const scale = useSyncExternalStore(
    subscribe,
    () => readTextScale(scope, userId),
    () => 1 as TextScale
  )
  // Server snapshot (1) is used while hydrating: skip applying it so the pre-paint value stays
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  useEffect(() => {
    if (hydrated) applyTextScale(scope, scale)
  }, [scope, scale, hydrated])
  const setScale = useCallback((s: TextScale) => saveTextScale(scope, s, userId), [scope, userId])
  return { scale, setScale }
}

/**
 * Text size picker (90% .. 140%). `variant="menu"` is a compact row for user
 * menus; `variant="field"` a labelled segmented control for settings pages.
 */
export function TextSizeControl({
  scope,
  userId,
  variant = 'menu',
  className = '',
}: {
  scope: TextScaleScope
  userId?: string | null
  variant?: 'menu' | 'field'
  className?: string
}) {
  const { scale, setScale } = useTextScale(scope, userId)
  return (
    <div className={className}>
      <div className={`flex items-center gap-2 ${variant === 'menu' ? 'mb-1.5' : 'mb-2'}`}>
        <Type size={14} className="text-gray-400" aria-hidden />
        <span className={variant === 'menu' ? 'text-xs text-gray-600 dark:text-gray-300' : 'text-sm font-medium text-gray-700 dark:text-gray-300'}>
          Text size
        </span>
        <span className="ml-auto text-xs text-gray-400">{TEXT_SCALE_LABELS[scale]}</span>
      </div>
      <div className="flex rounded border border-gray-200 dark:border-gray-700 overflow-hidden" role="radiogroup" aria-label="Text size">
        {TEXT_SCALES.map((s, i) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={scale === s}
            aria-label={TEXT_SCALE_LABELS[s]}
            title={TEXT_SCALE_LABELS[s]}
            onClick={() => setScale(s)}
            className={`flex-1 py-1 leading-none transition-colors ${i > 0 ? 'border-l border-gray-200 dark:border-gray-700' : ''} ${
              scale === s
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
            // Fixed px so the picker itself does not jump while the page rescales
            style={{ fontSize: 10 + i * 2 }}
          >
            A
          </button>
        ))}
      </div>
    </div>
  )
}
