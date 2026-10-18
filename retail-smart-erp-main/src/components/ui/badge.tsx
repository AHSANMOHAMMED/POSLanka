'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { getStatusColor } from '@/lib/ui/tokens'

// ============================================
// BADGE VARIANTS
// ============================================

export type BadgeVariant =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'outline'

export type BadgeSize = 'sm' | 'md' | 'lg'

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  primary: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  secondary: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  danger: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  outline: 'bg-transparent border border-gray-300 text-gray-700 dark:border-gray-600 dark:text-gray-300',
}

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-xs',
  md: 'px-2 py-0.5 text-xs',
  lg: 'px-2.5 py-1 text-sm',
}

// ============================================
// BADGE COMPONENT
// ============================================

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: BadgeSize
  dot?: boolean
  removable?: boolean
  onRemove?: () => void
}

export function Badge({
  className,
  variant = 'default',
  size = 'md',
  dot = false,
  removable = false,
  onRemove,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-medium rounded-full whitespace-nowrap',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full',
            variant === 'success' && 'bg-green-500',
            variant === 'warning' && 'bg-yellow-500',
            variant === 'danger' && 'bg-red-500',
            variant === 'info' && 'bg-blue-500',
            variant === 'primary' && 'bg-blue-500',
            (variant === 'default' || variant === 'secondary' || variant === 'outline') && 'bg-gray-500'
          )}
        />
      )}
      {children}
      {removable && onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-0.5 hover:bg-black/10 dark:hover:bg-white/10 rounded-full p-0.5"
        >
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </span>
  )
}

// ============================================
// STATUS BADGE COMPONENT
// ============================================

export interface StatusBadgeProps extends Omit<BadgeProps, 'variant'> {
  status: string
  showDot?: boolean
}

/**
 * StatusBadge automatically maps status strings to appropriate colors
 * Supports: draft, pending, submitted, approved, in_progress, completed,
 * cancelled, on_hold, overdue, paid, partial, unpaid, active, inactive
 */
export function StatusBadge({
  status,
  showDot = true,
  className,
  size = 'md',
  ...props
}: StatusBadgeProps) {
  const colors = getStatusColor(status)

  // Format status for display (e.g., "in_progress" -> "In Progress")
  const displayStatus = status
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 font-medium rounded-full whitespace-nowrap',
        colors.bg,
        colors.text,
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {showDot && (
        <span className={cn('w-1.5 h-1.5 rounded-full', colors.dot)} />
      )}
      {displayStatus}
    </span>
  )
}

// ============================================
// COUNT BADGE COMPONENT
// ============================================

export interface CountBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  count: number
  max?: number
  variant?: 'default' | 'primary' | 'danger'
  size?: 'sm' | 'md'
}

/**
 * CountBadge for displaying numeric counts (notifications, items, etc.)
 */
export function CountBadge({
  count,
  max = 99,
  variant = 'default',
  size = 'md',
  className,
  ...props
}: CountBadgeProps) {
  const displayCount = count > max ? `${max}+` : count.toString()

  const variantClasses = {
    default: 'bg-gray-500 text-white',
    primary: 'bg-blue-600 text-white',
    danger: 'bg-red-600 text-white',
  }

  const sizeClasses = {
    sm: 'min-w-[18px] h-[18px] text-xs',
    md: 'min-w-[22px] h-[22px] text-xs',
  }

  if (count === 0) return null

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center font-medium rounded-full px-1.5',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {displayCount}
    </span>
  )
}

// ============================================
// LABEL BADGE COMPONENT
// ============================================

export interface LabelBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  color?: 'gray' | 'red' | 'yellow' | 'green' | 'blue' | 'indigo' | 'purple' | 'pink'
}

const labelColors: Record<string, string> = {
  gray: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  green: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
}

/**
 * LabelBadge for tags and labels with custom colors
 */
export function LabelBadge({
  color = 'gray',
  className,
  children,
  ...props
}: LabelBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        labelColors[color],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
