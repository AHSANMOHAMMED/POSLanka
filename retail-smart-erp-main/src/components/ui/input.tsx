import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  /** Size variant for responsive design */
  size?: 'default' | 'sm' | 'lg' | 'mobile'
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size = 'default', ...props }, ref) => {
    const sizeClasses = {
      default: 'h-8 px-2.5 py-1 text-sm',
      sm: 'h-7 px-2 py-0.5 text-xs',
      lg: 'h-9 px-3 py-1.5 text-sm',
      mobile: 'h-11 px-4 py-2.5 text-base min-h-[44px]',
    }

    const sizeKey = size as keyof typeof sizeClasses

    return (
      <input
        type={type}
        className={cn(
          'flex w-full rounded border border-[#ced4da] bg-white dark:bg-transparent shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[#6c757d] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#0d6efd] focus-visible:border-[#86b7fe] disabled:cursor-not-allowed disabled:opacity-50',
          'text-base sm:text-sm', // Larger text on mobile for better readability
          sizeClasses[sizeKey],
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
