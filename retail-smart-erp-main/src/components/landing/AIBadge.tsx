'use client'

import { Sparkles } from 'lucide-react'

interface AIBadgeProps {
  className?: string
  size?: 'sm' | 'md'
}

export default function AIBadge({ className = '', size = 'sm' }: AIBadgeProps) {
  const sizeClasses = size === 'sm'
    ? 'px-2 py-0.5 text-[10px] gap-1'
    : 'px-3 py-1 text-xs gap-1.5'

  return (
    <span className={`ai-badge-pulse inline-flex items-center ${sizeClasses} font-semibold rounded-full bg-gradient-to-r from-amber-500/15 to-amber-400/15 text-amber-400 border border-amber-500/30 ${className}`}>
      <Sparkles className={size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      AI-Powered
    </span>
  )
}
