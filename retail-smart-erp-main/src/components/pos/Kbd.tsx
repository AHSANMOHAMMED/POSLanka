import type { ReactNode } from 'react'

/** Small keyboard-shortcut badge shown on POS buttons ("F9", "Alt+C" …). Hidden on touch-only phones. */
export function Kbd({ children, className = '', tone = 'light', title }: {
  children: ReactNode
  className?: string
  tone?: 'light' | 'dark'
  title?: string
}) {
  const colours = tone === 'dark'
    ? 'bg-white/20 text-white border-white/30'
    : 'bg-slate-200/70 dark:bg-gray-700 text-slate-700 dark:text-gray-200 border-slate-300/70 dark:border-gray-600'
  return (
    <kbd
      title={title}
      className={`hidden sm:inline-flex items-center px-1 py-px rounded border text-[10px] min-[1920px]:text-[11px] font-mono font-bold leading-none whitespace-nowrap ${colours} ${className}`}
    >
      {children}
    </kbd>
  )
}
