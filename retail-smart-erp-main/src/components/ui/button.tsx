import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none active:scale-[0.98]',
  {
    variants: {
      variant: {
        default: 'bg-[var(--primary)] text-white shadow-xs hover:shadow-md hover:brightness-105 border border-white/10 active:brightness-95',
        destructive: 'bg-gradient-to-r from-red-600 to-rose-600 text-white shadow-xs hover:shadow-md hover:from-red-700 hover:to-rose-700 border border-white/10',
        outline: 'border border-gray-300 dark:border-white/15 bg-white/90 dark:bg-white/[0.04] text-gray-800 dark:text-gray-100 shadow-2xs hover:bg-gray-100 dark:hover:bg-white/[0.08] hover:border-gray-400 dark:hover:border-white/25 backdrop-blur-xs',
        secondary: 'bg-gray-100 dark:bg-white/[0.08] text-gray-800 dark:text-gray-200 shadow-2xs hover:bg-gray-200 dark:hover:bg-white/[0.12] border border-transparent dark:border-white/[0.06]',
        ghost: 'text-gray-700 dark:text-gray-300 hover:bg-gray-100/80 dark:hover:bg-white/[0.08] hover:text-gray-950 dark:hover:text-white',
        link: 'text-[var(--primary)] underline-offset-4 hover:underline active:opacity-80',
        success: 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-xs hover:shadow-md hover:from-emerald-700 hover:to-teal-700 border border-white/10',
        warning: 'bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-xs hover:shadow-md hover:from-amber-600 hover:to-yellow-600 border border-white/10',
        brand: 'bg-gradient-to-r from-[#875A7B] to-[#6e4a65] text-white shadow-xs hover:shadow-md hover:brightness-105 border border-white/10',
      },
      size: {
        xs: 'h-6 px-2 text-xs gap-1',
        sm: 'h-7 px-2.5 text-xs gap-1',
        default: 'h-8 px-3 py-1.5 gap-1.5',
        lg: 'h-9 px-6 gap-2',
        xl: 'h-10 px-8 text-base gap-2',
        icon: 'h-8 w-8',
        'mobile-lg': 'h-11 px-6 py-3 text-base gap-2.5',
        'mobile-sm': 'h-10 px-4 py-2.5 text-sm gap-2',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
      fullWidth: false,
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const isDisabled = disabled || loading
    
    return (
      <button
        className={cn(buttonVariants({ variant, size, fullWidth, className }), loading && 'relative')}
        ref={ref}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        {...props}
      >
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
        <span className={cn('inline-flex items-center justify-center gap-2', loading && 'invisible')}>
          {leftIcon && <span className="flex-shrink-0">{leftIcon}</span>}
          {children}
          {rightIcon && <span className="flex-shrink-0">{rightIcon}</span>}
        </span>
      </button>
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
