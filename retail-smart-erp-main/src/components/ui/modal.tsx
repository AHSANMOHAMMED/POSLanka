'use client'

import { useEffect, useRef, useId, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================
// MODAL TYPES
// ============================================

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl' | 'full'
  /** Close when clicking backdrop */
  closeOnBackdrop?: boolean
  /** Show close button in header */
  showCloseButton?: boolean
  /** Custom footer content */
  footer?: React.ReactNode
  /** Additional class for the modal content */
  className?: string
  /** Disable animations */
  disableAnimation?: boolean
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-5xl',
  '3xl': 'max-w-6xl',
  '4xl': 'max-w-7xl',
  '5xl': 'max-w-[90vw]',
  full: 'max-w-[95vw] md:max-w-[95vw]',
  mobile: 'max-w-[95vw] w-[95vw] mx-auto', // Mobile-optimized full width with margins
}

// ============================================
// MODAL COMPONENT
// ============================================

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  size = 'md',
  closeOnBackdrop = false,
  showCloseButton = true,
  footer,
  className,
  disableAnimation = false,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  // Animation states
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  // Handle open/close with animation
  useEffect(() => {
    if (isOpen) {
      // Opening
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(true)
      document.body.style.overflow = 'hidden'
      // Trigger animation on next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimating(true)
        })
      })
      // Focus close button after animation
      setTimeout(() => closeButtonRef.current?.focus(), 150)
    } else {
      // Closing
      setIsAnimating(false)
      // Wait for animation to complete before hiding
      const timer = setTimeout(() => {
        setIsVisible(false)
        document.body.style.overflow = 'unset'
      }, disableAnimation ? 0 : 200)
      return () => clearTimeout(timer)
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen, disableAnimation])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  // Handle backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose()
    }
  }, [closeOnBackdrop, onClose])

  // Don't render if not visible
  if (!isVisible) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        'transition-opacity duration-200',
        isAnimating ? 'opacity-100' : 'opacity-0'
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        ref={modalRef}
        className={cn(
          'relative bg-white dark:bg-gray-800 rounded-md shadow-xl w-full',
          'max-h-[90vh] flex flex-col',
          'transition-all duration-200',
          isAnimating
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-4',
          sizeClasses[size],
          // Mobile full width with small margins
          'mx-2 sm:mx-4',
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2
            id={titleId}
            className="text-base font-semibold text-gray-900 dark:text-white pr-8"
          >
            {title}
          </h2>
          {showCloseButton && (
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              aria-label="Close dialog"
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Content - scrollable */}
        <div className="flex-1 overflow-y-auto px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 bg-gray-50 dark:bg-gray-800/50 rounded-b-md">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================
// MODAL FOOTER COMPONENT
// ============================================

interface ModalFooterProps {
  children: React.ReactNode
  className?: string
  align?: 'left' | 'center' | 'right' | 'between'
}

export function ModalFooter({ children, className, align = 'right' }: ModalFooterProps) {
  const alignClasses = {
    left: 'justify-start',
    center: 'justify-center',
    right: 'justify-end',
    between: 'justify-between',
  }

  return (
    <div className={cn('flex items-center gap-2', alignClasses[align], className)}>
      {children}
    </div>
  )
}

// ============================================
// MODAL BODY COMPONENT (for consistent spacing)
// ============================================

interface ModalBodyProps {
  children: React.ReactNode
  className?: string
}

export function ModalBody({ children, className }: ModalBodyProps) {
  return (
    <div className={cn('space-y-4', className)}>
      {children}
    </div>
  )
}

// ============================================
// DRAWER COMPONENT (slide from side)
// ============================================

interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
  position?: 'left' | 'right'
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  showCloseButton?: boolean
  footer?: React.ReactNode
  className?: string
}

const drawerSizes = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-full',
}

export function Drawer({
  isOpen,
  onClose,
  title,
  children,
  position = 'right',
  size = 'md',
  showCloseButton = true,
  footer,
  className,
}: DrawerProps) {
  const titleId = useId()
  const [isVisible, setIsVisible] = useState(false)
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsVisible(true)
      document.body.style.overflow = 'hidden'
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsAnimating(true)
        })
      })
    } else {
      setIsAnimating(false)
      const timer = setTimeout(() => {
        setIsVisible(false)
        document.body.style.overflow = 'unset'
      }, 200)
      return () => clearTimeout(timer)
    }

    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, onClose])

  if (!isVisible) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-50',
        'transition-opacity duration-200',
        isAnimating ? 'opacity-100' : 'opacity-0'
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className={cn(
          'fixed inset-y-0 w-full bg-white dark:bg-gray-800 shadow-xl flex flex-col',
          'transition-transform duration-200 ease-out',
          drawerSizes[size],
          position === 'left' ? 'left-0' : 'right-0',
          position === 'left'
            ? (isAnimating ? 'translate-x-0' : '-translate-x-full')
            : (isAnimating ? 'translate-x-0' : 'translate-x-full'),
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white">
            {title}
          </h2>
          {showCloseButton && (
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              aria-label="Close drawer"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
