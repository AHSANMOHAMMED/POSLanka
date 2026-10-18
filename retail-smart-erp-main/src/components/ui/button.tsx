import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        default: 'bg-[#0d6efd] text-white shadow-sm hover:bg-[#0b5ed7] active:bg-[#0a58ca]',
        destructive: 'bg-[#dc3545] text-white shadow-sm hover:bg-[#bb2d3b] active:bg-[#b02a37]',
        outline: 'border border-[#dee2e6] bg-white text-[#212529] shadow-sm hover:bg-[#f8f9fa] active:bg-[#e9ecef] dark:bg-transparent dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700',
        secondary: 'bg-[#6c757d] text-white shadow-sm hover:bg-[#5c636a] active:bg-[#565e64]',
        ghost: 'hover:bg-[#f8f9fa] hover:text-[#212529] dark:hover:bg-gray-700 dark:hover:text-gray-200',
        link: 'text-[#0d6efd] underline-offset-4 hover:underline dark:text-[#6ea8fe]',
        success: 'bg-[#198754] text-white shadow-sm hover:bg-[#157347] active:bg-[#146c43]',
        warning: 'bg-[#ffc107] text-[#212529] shadow-sm hover:bg-[#ffca2c] active:bg-[#ffcd39]',
        brand: 'bg-[#875A7B] text-white shadow-sm hover:bg-[#6e4a65] active:bg-[#5d3e56]',
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
