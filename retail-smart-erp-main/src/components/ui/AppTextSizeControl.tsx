'use client'

import React, { useEffect, useRef, useState } from 'react'
import {
  useTextScale,
  TextSizeControl,
} from '@/components/ui/text-size-control'
import {
  TEXT_SCALES,
  TEXT_SCALE_LABELS,
} from '@/lib/ui/text-scale'
import { cn } from '@/lib/utils'

export interface AppTextSizeControlProps {
  userId?: string | null
  variant?: 'navbar' | 'pos' | 'default'
  className?: string
}

export function AppTextSizeControl({
  userId,
  variant = 'navbar',
  className,
}: AppTextSizeControlProps) {
  const { scale, setScale } = useTextScale('app', userId)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const currentIndex = TEXT_SCALES.indexOf(scale)

  const stepDown = () => {
    if (currentIndex > 0) setScale(TEXT_SCALES[currentIndex - 1])
  }
  const stepUp = () => {
    if (currentIndex < TEXT_SCALES.length - 1) setScale(TEXT_SCALES[currentIndex + 1])
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const isPos = variant === 'pos'
  const isNavbar = variant === 'navbar'

  return (
    <div ref={ref} className={cn('relative inline-flex items-center', className)}>
      <div
        className={cn(
          'flex items-center rounded-xl p-0.5 transition-colors',
          isNavbar && 'bg-white/10 text-white/80 border border-white/10',
          isPos && 'bg-slate-800/90 text-slate-200 border border-slate-700/80',
          !isNavbar && !isPos && 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700'
        )}
      >
        <button
          type="button"
          onClick={stepDown}
          disabled={currentIndex <= 0}
          title="Decrease text size (A-)"
          aria-label="Decrease text size"
          className={cn(
            'flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-lg text-xs font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
            isNavbar && 'hover:bg-white/15 hover:text-white',
            isPos && 'hover:bg-slate-700 hover:text-white',
            !isNavbar && !isPos && 'hover:bg-gray-200 dark:hover:bg-gray-700'
          )}
        >
          A⁻
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={`Text size: ${TEXT_SCALE_LABELS[scale]} (click to customize)`}
          aria-label={`Current text size: ${TEXT_SCALE_LABELS[scale]}`}
          className={cn(
            'px-1.5 py-0.5 text-[11px] font-mono font-medium transition-colors',
            isNavbar && 'hover:text-white',
            isPos && 'hover:text-white',
            !isNavbar && !isPos && 'hover:text-gray-900 dark:hover:text-white'
          )}
        >
          {TEXT_SCALE_LABELS[scale]}
        </button>
        <button
          type="button"
          onClick={stepUp}
          disabled={currentIndex >= TEXT_SCALES.length - 1}
          title="Increase text size (A+)"
          aria-label="Increase text size"
          className={cn(
            'flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-lg text-sm font-bold transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
            isNavbar && 'hover:bg-white/15 hover:text-white',
            isPos && 'hover:bg-slate-700 hover:text-white',
            !isNavbar && !isPos && 'hover:bg-gray-200 dark:hover:bg-gray-700'
          )}
        >
          A⁺
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-2xl border border-gray-200 dark:border-white/10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl p-3 shadow-xl animate-dropdown text-gray-900 dark:text-gray-100">
          <TextSizeControl scope="app" userId={userId} />
        </div>
      )}
    </div>
  )
}
