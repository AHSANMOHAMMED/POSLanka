'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useResponsive'

// ============================================
// SIZE VARIANTS
// ============================================

export type FormElementSize = 'sm' | 'md' | 'lg' | 'mobile'

const sizeStyles: Record<FormElementSize, string> = {
  sm: 'h-7 px-2 py-0.5 text-xs',
  md: 'h-8 px-2.5 py-1 text-sm',
  lg: 'h-9 px-3 py-1.5 text-sm',
  mobile: 'min-h-[44px] px-3 py-2 text-base',
}

// ============================================
// SHARED BASE STYLES
// ============================================

const baseInputStyles = `
  w-full rounded-md border
  bg-white dark:bg-gray-800
  border-gray-300 dark:border-gray-600
  text-gray-900 dark:text-white
  placeholder-gray-400 dark:placeholder-gray-500
  focus:outline-none focus:ring-2 focus:ring-[#0d6efd] focus:border-[#0d6efd]
  disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-900
  transition-colors
`

// ============================================
// RESPONSIVE SIZE HOOK
// ============================================

/**
 * Hook to get responsive size for form elements
 * Automatically uses 'mobile' size on mobile devices
 */
export function useResponsiveSize(defaultSize: FormElementSize = 'md'): FormElementSize {
  const isMobile = useIsMobile()
  
  if (isMobile && defaultSize !== 'sm') {
    return 'mobile'
  }
  
  return defaultSize
}

// ============================================
// FORM INPUT COMPONENT
// ============================================

export interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  inputSize?: FormElementSize
  error?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  ({ className, type, inputSize = 'md', error, leftIcon, rightIcon, ...props }, ref) => {
    const responsiveSize = useResponsiveSize(inputSize)
    
    if (leftIcon || rightIcon) {
      return (
        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-gray-400">
              {leftIcon}
            </div>
          )}
          <input
            type={type}
            className={cn(
              baseInputStyles,
              sizeStyles[responsiveSize],
              leftIcon && 'pl-8',
              rightIcon && 'pr-8',
              error && 'border-red-500 focus:ring-red-500 focus:border-red-500',
              className
            )}
            ref={ref}
            {...props}
          />
          {rightIcon && (
            <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none text-gray-400">
              {rightIcon}
            </div>
          )}
        </div>
      )
    }

    return (
      <input
        type={type}
        className={cn(
          baseInputStyles,
          sizeStyles[responsiveSize],
          error && 'border-red-500 focus:ring-red-500 focus:border-red-500',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
FormInput.displayName = 'FormInput'

// ============================================
// FORM SELECT COMPONENT
// ============================================

export interface FormSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  selectSize?: FormElementSize
  error?: boolean
  children: React.ReactNode
}

export const FormSelect = React.forwardRef<HTMLSelectElement, FormSelectProps>(
  ({ className, children, selectSize = 'md', error, ...props }, ref) => {
    const responsiveSize = useResponsiveSize(selectSize)
    
    return (
      <select
        className={cn(
          baseInputStyles,
          sizeStyles[responsiveSize],
          'cursor-pointer appearance-none',
          'bg-no-repeat bg-right',
          'pr-8',
          error && 'border-red-500 focus:ring-red-500 focus:border-red-500',
          className
        )}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`,
          backgroundPosition: 'right 0.5rem center',
          backgroundSize: '1.25rem 1.25rem',
        }}
        ref={ref}
        {...props}
      >
        {children}
      </select>
    )
  }
)
FormSelect.displayName = 'FormSelect'

// ============================================
// FORM TEXTAREA COMPONENT
// ============================================

export interface FormTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  textareaSize?: FormElementSize
  error?: boolean
}

export const FormTextarea = React.forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  ({ className, textareaSize = 'md', error, ...props }, ref) => {
    const responsiveSize = useResponsiveSize(textareaSize)
    
    return (
      <textarea
        className={cn(
          baseInputStyles,
          responsiveSize === 'mobile' ? 'px-3 py-2 text-base min-h-[100px]' : 'px-2.5 py-2 text-sm min-h-[80px]',
          'resize-y',
          error && 'border-red-500 focus:ring-red-500 focus:border-red-500',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
FormTextarea.displayName = 'FormTextarea'

// ============================================
// FORM CHECKBOX COMPONENT
// ============================================

export interface FormCheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
  description?: string
}

export const FormCheckbox = React.forwardRef<HTMLInputElement, FormCheckboxProps>(
  ({ className, label, description, id, ...props }, ref) => {
    const generatedId = React.useId()
    const inputId = id || generatedId

    return (
      <div className="flex items-start">
        <div className="flex items-center h-5">
          <input
            type="checkbox"
            id={inputId}
            className={cn(
              'h-4 w-4 rounded border-gray-300 dark:border-gray-600',
              'text-[#0d6efd] focus:ring-[#0d6efd] focus:ring-2',
              'bg-white dark:bg-gray-800',
              'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
              className
            )}
            ref={ref}
            {...props}
          />
        </div>
        {(label || description) && (
          <div className="ml-2">
            {label && (
              <label
                htmlFor={inputId}
                className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer"
              >
                {label}
              </label>
            )}
            {description && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
            )}
          </div>
        )}
      </div>
    )
  }
)
FormCheckbox.displayName = 'FormCheckbox'

// ============================================
// FORM RADIO COMPONENT
// ============================================

export interface FormRadioProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string
}

export const FormRadio = React.forwardRef<HTMLInputElement, FormRadioProps>(
  ({ className, label, id, ...props }, ref) => {
    const generatedId = React.useId()
    const inputId = id || generatedId

    return (
      <div className="flex items-center">
        <input
          type="radio"
          id={inputId}
          className={cn(
            'h-4 w-4 border-gray-300 dark:border-gray-600',
            'text-[#0d6efd] focus:ring-[#0d6efd] focus:ring-2',
            'bg-white dark:bg-gray-800',
            'cursor-pointer disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
          ref={ref}
          {...props}
        />
        {label && (
          <label
            htmlFor={inputId}
            className="ml-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer"
          >
            {label}
          </label>
        )}
      </div>
    )
  }
)
FormRadio.displayName = 'FormRadio'

// ============================================
// FORM LABEL COMPONENT
// ============================================

export interface FormLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean
  optional?: boolean
}

export const FormLabel = React.forwardRef<HTMLLabelElement, FormLabelProps>(
  ({ className, children, required, optional, ...props }, ref) => {
    return (
      <label
        className={cn(
          'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-0.5',
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
        {required && <span className="text-red-500 ml-0.5">*</span>}
        {optional && (
          <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">(optional)</span>
        )}
      </label>
    )
  }
)
FormLabel.displayName = 'FormLabel'

// ============================================
// FORM FIELD WRAPPER COMPONENT
// ============================================

export interface FormFieldProps {
  label?: string
  required?: boolean
  optional?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
  className?: string
  labelClassName?: string
}

export function FormField({
  label,
  required,
  optional,
  hint,
  error,
  children,
  className,
  labelClassName,
}: FormFieldProps) {
  return (
    <div className={className}>
      {label && (
        <FormLabel required={required} optional={optional} className={labelClassName}>
          {label}
        </FormLabel>
      )}
      {children}
      {hint && !error && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      )}
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}

// ============================================
// FORM SECTION COMPONENT
// ============================================

export interface FormSectionProps {
  title?: string
  description?: string
  columns?: 1 | 2 | 3 | 4
  children: React.ReactNode
  className?: string
}

export function FormSection({
  title,
  description,
  columns = 2,
  children,
  className,
}: FormSectionProps) {
  const columnClasses = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  }

  return (
    <div className={cn('space-y-3', className)}>
      {(title || description) && (
        <div className="border-b border-gray-200 dark:border-gray-700 pb-2">
          {title && (
            <h4 className="text-xs font-medium text-gray-900 dark:text-white uppercase tracking-wide">
              {title}
            </h4>
          )}
          {description && (
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {description}
            </p>
          )}
        </div>
      )}
      <div className={cn('grid gap-3', columnClasses[columns])}>
        {children}
      </div>
    </div>
  )
}

// ============================================
// FORM ACTIONS COMPONENT
// ============================================

export interface FormActionsProps {
  children: React.ReactNode
  className?: string
  align?: 'left' | 'center' | 'right' | 'between'
}

export function FormActions({
  children,
  className,
  align = 'right',
}: FormActionsProps) {
  const alignClasses = {
    left: 'justify-start',
    center: 'justify-center',
    right: 'justify-end',
    between: 'justify-between',
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 pt-4 border-t border-gray-200 dark:border-gray-700',
        alignClasses[align],
        className
      )}
    >
      {children}
    </div>
  )
}

// ============================================
// INLINE EDITABLE INPUT COMPONENT
// ============================================

export interface InlineEditInputProps extends Omit<FormInputProps, 'onBlur'> {
  onSave: (value: string) => void
  onCancel?: () => void
  editing?: boolean
}

export function InlineEditInput({
  onSave,
  onCancel,
  editing = true,
  defaultValue,
  ...props
}: InlineEditInputProps) {
  const [value, setValue] = React.useState(defaultValue?.toString() || '')
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSave(value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setValue(defaultValue?.toString() || '')
      onCancel?.()
    }
  }

  const handleBlur = () => {
    onSave(value)
  }

  if (!editing) {
    return <span className="text-sm">{value || '-'}</span>
  }

  return (
    <FormInput
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      inputSize="sm"
      {...props}
    />
  )
}
