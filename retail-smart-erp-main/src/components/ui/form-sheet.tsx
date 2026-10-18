'use client'

import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// ============================================
// FORM SHEET (Odoo-style centered form card)
// ============================================

interface FormSheetProps {
  children: ReactNode
  className?: string
  /** Maximum width */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full'
}

const maxWidthClasses = {
  sm: 'max-w-2xl',
  md: 'max-w-4xl',
  lg: 'max-w-5xl',
  xl: 'max-w-6xl',
  '2xl': 'max-w-7xl',
  full: 'max-w-full',
}

/**
 * Odoo-style "sheet" — a white card centered on the gray background.
 * Use this to wrap form/detail page content.
 *
 * ```tsx
 * <FormSheet>
 *   <FormSheetHeader>
 *     <StatusBar stages={...} currentStage="draft" />
 *   </FormSheetHeader>
 *   <FormSheetSection title="General Information" columns={2}>
 *     <div>Field 1</div>
 *     <div>Field 2</div>
 *   </FormSheetSection>
 * </FormSheet>
 * ```
 */
export function FormSheet({ children, className, maxWidth = 'lg' }: FormSheetProps) {
  return (
    <div className={cn(
      'mx-auto w-full bg-white dark:bg-gray-800 border border-[#dee2e6] dark:border-gray-700 rounded shadow-sm',
      maxWidthClasses[maxWidth],
      className
    )}>
      {children}
    </div>
  )
}

// ============================================
// FORM SHEET HEADER
// ============================================

interface FormSheetHeaderProps {
  children: ReactNode
  className?: string
}

export function FormSheetHeader({ children, className }: FormSheetHeaderProps) {
  return (
    <div className={cn(
      'px-6 py-4 border-b border-[#dee2e6] dark:border-gray-700',
      className
    )}>
      {children}
    </div>
  )
}

// ============================================
// FORM SHEET SECTION
// ============================================

interface FormSheetSectionProps {
  title?: string
  children: ReactNode
  columns?: 1 | 2 | 3
  className?: string
}

export function FormSheetSection({ title, children, columns = 1, className }: FormSheetSectionProps) {
  const gridClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  }

  return (
    <div className={cn('px-6 py-4', className)}>
      {title && (
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-sm font-semibold text-[#495057] dark:text-gray-300 uppercase tracking-wide">
            {title}
          </h3>
          <div className="flex-1 h-px bg-[#dee2e6] dark:bg-gray-700" />
        </div>
      )}
      <div className={cn('grid gap-x-6 gap-y-3', gridClasses[columns])}>
        {children}
      </div>
    </div>
  )
}

// ============================================
// FORM FIELD (Odoo-style label + value)
// ============================================

interface FormSheetFieldProps {
  label: string
  required?: boolean
  children: ReactNode
  className?: string
}

export function FormSheetField({ label, required, children, className }: FormSheetFieldProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label className="text-xs font-semibold text-[#495057] dark:text-gray-400 uppercase tracking-wider">
        {label}
        {required && <span className="text-[#dc3545] ml-0.5">*</span>}
      </label>
      <div className="text-sm text-[#212529] dark:text-gray-200">
        {children}
      </div>
    </div>
  )
}
