'use client'

import { cn } from '@/lib/utils'

export interface StatusBarStage {
  key: string
  label: string
}

interface StatusBarProps {
  stages: StatusBarStage[]
  currentStage: string
  onStageClick?: (stageKey: string) => void
  className?: string
}

/**
 * Odoo-style status bar with arrow-shaped pipeline stages.
 *
 * Usage:
 *   <StatusBar
 *     stages={[
 *       { key: 'draft', label: 'Draft' },
 *       { key: 'confirmed', label: 'Confirmed' },
 *       { key: 'in_progress', label: 'In Progress' },
 *       { key: 'done', label: 'Done' },
 *     ]}
 *     currentStage="confirmed"
 *     onStageClick={(key) => handleStatusChange(key)}
 *   />
 */
export function StatusBar({ stages, currentStage, onStageClick, className }: StatusBarProps) {
  const currentIndex = stages.findIndex(s => s.key === currentStage)

  return (
    <div className={cn('flex items-center', className)}>
      {stages.map((stage, index) => {
        const isCurrent = stage.key === currentStage
        const isPast = index < currentIndex
        const isClickable = !!onStageClick

        return (
          <button
            key={stage.key}
            type="button"
            onClick={() => onStageClick?.(stage.key)}
            disabled={!isClickable}
            className={cn(
              'relative flex items-center justify-center px-4 py-1.5 text-xs font-medium transition-colors',
              'border-y border-r first:border-l first:rounded-l last:rounded-r',
              isCurrent && 'bg-[#0d6efd] text-white border-[#0d6efd] z-10',
              isPast && 'bg-[#e8f0fe] text-[#0d6efd] border-[#b6d4fe] dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700',
              !isCurrent && !isPast && 'bg-white text-[#6c757d] border-[#dee2e6] dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600',
              isClickable && !isCurrent && 'hover:bg-[#f8f9fa] dark:hover:bg-gray-700 cursor-pointer',
              !isClickable && 'cursor-default',
            )}
          >
            {stage.label}
          </button>
        )
      })}
    </div>
  )
}
