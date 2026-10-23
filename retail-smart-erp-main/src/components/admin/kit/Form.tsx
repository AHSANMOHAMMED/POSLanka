'use client'

import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Eye, EyeOff, Search, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type ControlSize = 'sm' | 'md' | 'lg'

function sizeClass(size: ControlSize) {
  return size === 'lg' ? 'adm-input--lg' : size === 'sm' ? 'adm-input--sm' : ''
}

/* ------------------------------------------------------------------ Field */

export interface FieldProps {
  label?: ReactNode
  /** id of the control; when omitted, pass the control as a render prop to receive one. */
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  /** Right-aligned element on the label row (e.g. "Forgot password?" link). */
  labelAside?: ReactNode
  className?: string
  children: ReactNode
}

/** Label + control + hint/error, consistently spaced. */
export function Field({ label, htmlFor, hint, error, required, labelAside, className, children }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {(label || labelAside) && (
        <div className="flex items-center justify-between gap-3">
          {label ? (
            <label htmlFor={htmlFor} className="text-[13px] font-medium text-adm-fg">
              {label}
              {required && <span className="ml-0.5 text-adm-danger" aria-hidden>*</span>}
            </label>
          ) : <span />}
          {labelAside && <div className="text-[13px]">{labelAside}</div>}
        </div>
      )}
      {children}
      {error ? (
        <p className="text-[12.5px] text-adm-danger" role="alert">{error}</p>
      ) : hint ? (
        <p className="text-[12.5px] text-adm-subtle">{hint}</p>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ Input */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Icon rendered inside the left edge; the text is padded so they never overlap. */
  leftIcon?: LucideIcon
  /** Element rendered inside the right edge (button, unit, kbd hint…). */
  rightSlot?: ReactNode
  size?: ControlSize
  invalid?: boolean
  /** Monospace, letter-spaced, centred — for OTP / TOTP codes. */
  code?: boolean
  wrapperClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leftIcon: LeftIcon, rightSlot, size = 'md', invalid, code, className, wrapperClassName, ...rest },
  ref
) {
  const iconSize = size === 'sm' ? 15 : 17
  return (
    <div className={cn('relative', wrapperClassName)}>
      {LeftIcon && (
        <LeftIcon
          size={iconSize}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-adm-subtle"
        />
      )}
      <input
        ref={ref}
        suppressHydrationWarning
        aria-invalid={invalid || undefined}
        className={cn(
          'adm-input block w-full',
          sizeClass(size),
          LeftIcon && 'adm-input--icon-left',
          rightSlot != null && 'adm-input--icon-right',
          code && 'adm-input--code',
          className
        )}
        {...rest}
      />
      {rightSlot != null && (
        <div className="absolute inset-y-0 right-1.5 flex items-center">{rightSlot}</div>
      )}
    </div>
  )
})

/** Password input with an accessible show/hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputProps, 'type' | 'rightSlot'>>(function PasswordInput(props, ref) {
  const [visible, setVisible] = useState(false)
  return (
    <Input
      ref={ref}
      type={visible ? 'text' : 'password'}
      {...props}
      rightSlot={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="adm-focus flex h-8 w-8 items-center justify-center rounded-md text-adm-subtle hover:text-adm-fg"
        >
          {visible ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
        </button>
      }
    />
  )
})

/** Search box: magnifier icon + optional keyboard hint. */
export const SearchInput = forwardRef<HTMLInputElement, Omit<InputProps, 'leftIcon' | 'type'> & { shortcut?: string }>(
  function SearchInput({ shortcut, placeholder = 'Search…', ...rest }, ref) {
    return (
      <Input
        ref={ref}
        type="search"
        leftIcon={Search}
        placeholder={placeholder}
        rightSlot={
          shortcut ? (
            <kbd className="mr-1 rounded border border-adm-border bg-adm-surface-2 px-1.5 py-0.5 text-[11px] text-adm-subtle">{shortcut}</kbd>
          ) : undefined
        }
        {...rest}
      />
    )
  }
)

/* ------------------------------------------------------------------ Select / Textarea */

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: ControlSize
  invalid?: boolean
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ size = 'md', invalid, className, children, ...rest }, ref) {
  return (
    <select ref={ref} aria-invalid={invalid || undefined} className={cn('adm-input block w-full', sizeClass(size), className)} {...rest}>
      {children}
    </select>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className, ...rest }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn('adm-input block w-full', className)} {...rest} />
  }
)

/* ------------------------------------------------------------------ Checkbox / Switch */

export function Checkbox({ label, description, className, id, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const autoId = useId()
  const inputId = id || autoId
  return (
    <label htmlFor={inputId} className={cn('flex cursor-pointer items-start gap-2.5', className)}>
      <input id={inputId} type="checkbox" className="adm-checkbox mt-0.5 shrink-0" {...rest} />
      <span className="min-w-0">
        <span className="block text-[14px] text-adm-fg">{label}</span>
        {description && <span className="block text-[12.5px] text-adm-subtle">{description}</span>}
      </span>
    </label>
  )
}

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
}

export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const id = useId()
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      {(label || description) && (
        <label htmlFor={id} className="min-w-0 cursor-pointer">
          {label && <span className="block text-[14px] font-medium text-adm-fg">{label}</span>}
          {description && <span className="block text-[12.5px] text-adm-subtle">{description}</span>}
        </label>
      )}
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'adm-focus relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-adm-primary' : 'bg-adm-surface-3 border border-adm-border-strong'
        )}
      >
        <span
          className={cn(
            'inline-block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-[3px]'
          )}
        />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ SegmentedControl */

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
}

/** Compact tab-like single choice (ranges, view modes). Scrolls horizontally if it can't fit. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  ariaLabel,
}: {
  value: T
  onChange: (value: T) => void
  options: SegmentedOption<T>[]
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('adm-scroll inline-flex max-w-full overflow-x-auto rounded-lg border border-adm-border bg-adm-surface-2 p-0.5', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'adm-focus shrink-0 rounded-md font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8 px-3 text-[13px]',
              active ? 'bg-adm-surface text-adm-fg shadow-sm ring-1 ring-adm-border' : 'text-adm-muted hover:text-adm-fg'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
