'use client'

import { Loader2 } from 'lucide-react'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg' | 'xl'
  text?: string
  className?: string
  fullPage?: boolean
}

const sizeMap = {
  sm: 16,
  md: 24,
  lg: 32,
  xl: 48,
}

const textSizeMap = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
}

export function LoadingSpinner({
  size = 'md',
  text,
  className = '',
  fullPage = false
}: LoadingSpinnerProps) {
  const content = (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      <Loader2
        size={sizeMap[size]}
        className="animate-spin text-blue-600"
      />
      {text && (
        <p className={`text-gray-600 ${textSizeMap[size]}`}>{text}</p>
      )}
    </div>
  )

  if (fullPage) {
    return (
      <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50">
        {content}
      </div>
    )
  }

  return content
}

// Page loading state component
export function PageLoading({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="flex items-center justify-center h-64">
      <LoadingSpinner size="lg" text={text} />
    </div>
  )
}

// Button loading state (for inline use)
export function ButtonSpinner({ className = '' }: { className?: string }) {
  return <Loader2 size={16} className={`animate-spin ${className}`} />
}
