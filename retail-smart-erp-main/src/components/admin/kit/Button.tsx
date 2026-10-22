import Link from 'next/link'
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-soft' | 'link'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const base =
  'adm-focus inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors select-none disabled:opacity-55 disabled:cursor-not-allowed'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-adm-primary text-adm-primary-fg hover:bg-adm-primary-hover shadow-sm',
  secondary: 'bg-adm-surface text-adm-fg border border-adm-border-strong hover:bg-adm-surface-2',
  ghost: 'text-adm-muted hover:text-adm-fg hover:bg-adm-surface-2',
  danger: 'bg-adm-danger text-white hover:opacity-90 shadow-sm',
  'danger-soft': 'bg-adm-danger-soft text-adm-danger hover:opacity-85',
  link: 'text-adm-primary hover:underline underline-offset-2 px-0 h-auto',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-[30px] px-3 text-[13px]',
  md: 'h-[36px] px-3.5 text-[14px]',
  lg: 'h-[44px] px-5 text-[15px]',
  icon: 'h-[36px] w-[36px] p-0',
  'icon-sm': 'h-[30px] w-[30px] p-0',
}

/** Class string for a kit button — use on anything (e.g. a <label> or <a>). */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) {
  return cn(base, variants[variant], variant === 'link' ? '' : sizes[size], className)
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading icon (lucide component). Replaced by a spinner while `loading`. */
  icon?: LucideIcon
  /** Trailing icon. */
  iconRight?: LucideIcon
  loading?: boolean
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, loading, fullWidth, className, children, type = 'button', disabled, ...rest },
  ref
) {
  const iconSize = size === 'lg' ? 18 : size === 'sm' || size === 'icon-sm' ? 14 : 16
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, cn(fullWidth && 'w-full', className))}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="animate-spin" aria-hidden /> : Icon ? <Icon size={iconSize} aria-hidden /> : null}
      {children}
      {IconRight && !loading ? <IconRight size={iconSize} aria-hidden /> : null}
    </button>
  )
})

export interface LinkButtonProps extends Omit<ComponentProps<typeof Link>, 'className'> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconRight?: LucideIcon
  className?: string
  children?: ReactNode
}

/** A next/link styled as a kit button. */
export function LinkButton({ variant = 'secondary', size = 'md', icon: Icon, iconRight: IconRight, className, children, ...rest }: LinkButtonProps) {
  const iconSize = size === 'lg' ? 18 : size === 'sm' || size === 'icon-sm' ? 14 : 16
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {Icon ? <Icon size={iconSize} aria-hidden /> : null}
      {children}
      {IconRight ? <IconRight size={iconSize} aria-hidden /> : null}
    </Link>
  )
}
