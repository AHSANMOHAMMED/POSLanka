'use client'

import Link from 'next/link'
import { Plus } from 'lucide-react'
import type { ShortcutBlock as ShortcutBlockType, MetricValues } from '@/lib/workspace/types'
import { getIcon } from '../icon-map'

const COLOR_BG: Record<string, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  red: 'bg-red-500',
  purple: 'bg-purple-500',
  amber: 'bg-amber-500',
  violet: 'bg-violet-500',
  emerald: 'bg-emerald-500',
  slate: 'bg-slate-500',
}

interface ShortcutBlockProps {
  block: ShortcutBlockType
  metrics: MetricValues
  colorScheme: string
  onAddShortcut?: () => void
}

export function ShortcutBlock({ block, metrics, colorScheme, onAddShortcut }: ShortcutBlockProps) {
  const { shortcuts } = block.data

  const schemeClasses: Record<string, { bg: string; border: string; hover: string; text: string; iconBg: string }> = {
    blue: { bg: 'bg-blue-50/50', border: 'border-blue-100', hover: 'hover:bg-blue-100/70 hover:border-blue-200', text: 'text-blue-700', iconBg: 'bg-blue-500' },
    green: { bg: 'bg-green-50/50', border: 'border-green-100', hover: 'hover:bg-green-100/70 hover:border-green-200', text: 'text-green-700', iconBg: 'bg-green-500' },
    violet: { bg: 'bg-violet-50/50', border: 'border-violet-100', hover: 'hover:bg-violet-100/70 hover:border-violet-200', text: 'text-violet-700', iconBg: 'bg-violet-500' },
    amber: { bg: 'bg-amber-50/50', border: 'border-amber-100', hover: 'hover:bg-amber-100/70 hover:border-amber-200', text: 'text-amber-700', iconBg: 'bg-amber-500' },
    emerald: { bg: 'bg-emerald-50/50', border: 'border-emerald-100', hover: 'hover:bg-emerald-100/70 hover:border-emerald-200', text: 'text-emerald-700', iconBg: 'bg-emerald-500' },
    slate: { bg: 'bg-gray-50/50', border: 'border-gray-200', hover: 'hover:bg-gray-100/70 hover:border-gray-300', text: 'text-gray-700', iconBg: 'bg-gray-500' },
  }

  const scheme = schemeClasses[colorScheme] || schemeClasses.blue

  return (
    <div className="bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden w-full">
      <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
        <h2 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          Shortcuts
        </h2>
      </div>
      <div className="p-3">
        <div className="flex flex-wrap gap-2">
          {shortcuts.map((shortcut) => {
            const Icon = getIcon(shortcut.icon)
            const rawBadge = shortcut.countMetricKey ? metrics[shortcut.countMetricKey]?.value : undefined
            const badgeValue = typeof rawBadge === 'number' ? rawBadge : undefined

            return (
              <Link
                key={shortcut.href + shortcut.label}
                href={shortcut.href}
                className={`relative flex items-center gap-2 px-3 py-2 rounded border ${scheme.bg} ${scheme.border} ${scheme.hover} transition-all duration-150 group`}
              >
                {badgeValue !== undefined && badgeValue > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-sm">
                    {badgeValue > 99 ? '99+' : badgeValue}
                  </span>
                )}
                <div className={`w-7 h-7 ${shortcut.color ? COLOR_BG[shortcut.color] || scheme.iconBg : scheme.iconBg} rounded-md flex items-center justify-center flex-shrink-0`}>
                  <Icon className="w-3.5 h-3.5 text-white" strokeWidth={2} />
                </div>
                <span className={`text-xs font-medium ${scheme.text} whitespace-nowrap`}>
                  {shortcut.label}
                </span>
              </Link>
            )
          })}

          {/* Add shortcut button */}
          {onAddShortcut && (
            <button
              type="button"
              onClick={onAddShortcut}
              className={`flex items-center gap-2 px-3 py-2 rounded border-2 border-dashed ${scheme.border} hover:border-gray-300 dark:hover:border-gray-500 transition-all duration-150 group`}
            >
              <div className="w-7 h-7 rounded-md bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 group-hover:bg-gray-200 dark:group-hover:bg-gray-600 transition-colors">
                <Plus className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" strokeWidth={2} />
              </div>
              <span className="text-xs font-medium text-gray-400 dark:text-gray-500 whitespace-nowrap group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors">
                Add
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
