'use client'

import * as React from 'react'
import { useEffect, useRef, useCallback } from 'react'
import {
  AlertTriangle,
  CheckCircle,
  Info,
  XCircle,
  X,
  HelpCircle,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { modalSizes, type ModalSize } from '@/lib/ui/tokens'

// ============================================
// DIALOG VARIANTS
// ============================================

export type DialogVariant = 'default' | 'danger' | 'warning' | 'success' | 'info'

const variantConfig = {
  default: {
    icon: HelpCircle,
    iconClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    buttonClass: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
  },
  danger: {
    icon: Trash2,
    iconClass: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    buttonClass: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
  },
  warning: {
    icon: AlertTriangle,
    iconClass: 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400',
    buttonClass: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
  },
  success: {
    icon: CheckCircle,
    iconClass: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    buttonClass: 'bg-green-600 hover:bg-green-700 focus:ring-green-500',
  },
  info: {
    icon: Info,
    iconClass: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
    buttonClass: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
  },
}

// ============================================
// BASE DIALOG COMPONENT
// ============================================

export interface DialogProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  description?: string
  size?: ModalSize
  children?: React.ReactNode
  showCloseButton?: boolean
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  className?: string
}

export function Dialog({
  isOpen,
  onClose,
  title,
  description,
  size = 'md',
  children,
  showCloseButton = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    if (!closeOnEscape) return

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
  }, [isOpen, onClose, closeOnEscape])

  // Focus trap
  useEffect(() => {
    if (isOpen && dialogRef.current) {
      const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusableElements.length > 0) {
        focusableElements[0].focus()
      }
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'dialog-title' : undefined}
      aria-describedby={description ? 'dialog-description' : undefined}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 transition-opacity"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden="true"
      />

      {/* Dialog panel */}
      <div
        ref={dialogRef}
        className={cn(
          'relative bg-white dark:bg-gray-800 rounded shadow-xl w-full',
          'transform transition-all',
          modalSizes[size],
          className
        )}
      >
        {/* Header */}
        {(title || showCloseButton) && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            {title && (
              <h2
                id="dialog-title"
                className="text-base font-semibold text-gray-900 dark:text-white"
              >
                {title}
              </h2>
            )}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        {/* Description (if no children) */}
        {description && !children && (
          <div className="px-4 py-3">
            <p
              id="dialog-description"
              className="text-sm text-gray-600 dark:text-gray-300"
            >
              {description}
            </p>
          </div>
        )}

        {/* Content */}
        {children}
      </div>
    </div>
  )
}

// ============================================
// DIALOG CONTENT COMPONENTS
// ============================================

export function DialogContent({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('px-4 py-3', className)}>
      {children}
    </div>
  )
}

export function DialogFooter({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 rounded-b-lg',
        className
      )}
    >
      {children}
    </div>
  )
}

// ============================================
// CONFIRM DIALOG COMPONENT
// ============================================

export interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: DialogVariant
  processing?: boolean
  /** @deprecated Use `processing` instead */
  loading?: boolean
  icon?: React.ReactNode
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  processing = false,
  loading = false,
  icon,
}: ConfirmDialogProps) {
  const isProcessing = processing || loading
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const config = variantConfig[variant]
  const Icon = config.icon

  // Focus cancel button when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => cancelButtonRef.current?.focus(), 0)
    }
  }, [isOpen])

  return (
    <Dialog
      isOpen={isOpen}
      onClose={isProcessing ? () => {} : onClose}
      title={title}
      closeOnBackdrop={!isProcessing}
      closeOnEscape={!isProcessing}
    >
      <DialogContent>
        <div className="flex items-start gap-3">
          <div className={cn('p-2 rounded-full shrink-0', config.iconClass)}>
            {icon || <Icon size={20} />}
          </div>
          <div className="flex-1 pt-0.5">
            <p className="text-sm text-gray-700 dark:text-gray-300">{message}</p>
          </div>
        </div>
      </DialogContent>

      <DialogFooter>
        <button
          ref={cancelButtonRef}
          type="button"
          onClick={onClose}
          disabled={isProcessing}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isProcessing}
          className={cn(
            'px-3 py-1.5 text-sm text-white rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
            config.buttonClass
          )}
        >
          {isProcessing ? 'Processing...' : confirmText}
        </button>
      </DialogFooter>
    </Dialog>
  )
}

// ============================================
// ALERT DIALOG COMPONENT
// ============================================

export interface AlertDialogProps {
  isOpen: boolean
  onClose: () => void
  title: string
  message: string
  variant?: 'error' | 'success' | 'warning' | 'info'
  buttonText?: string
  icon?: React.ReactNode
}

const alertVariantMap: Record<string, DialogVariant> = {
  error: 'danger',
  success: 'success',
  warning: 'warning',
  info: 'info',
}

const alertIconMap: Record<string, React.ComponentType<{ size: number }>> = {
  error: XCircle,
  success: CheckCircle,
  warning: AlertTriangle,
  info: Info,
}

export function AlertDialog({
  isOpen,
  onClose,
  title,
  message,
  variant = 'info',
  buttonText = 'OK',
  icon,
}: AlertDialogProps) {
  const dialogVariant = alertVariantMap[variant] || 'info'
  const config = variantConfig[dialogVariant]
  const Icon = alertIconMap[variant] || Info

  return (
    <Dialog isOpen={isOpen} onClose={onClose} title={title}>
      <DialogContent>
        <div className="flex items-start gap-3">
          <div className={cn('p-2 rounded-full shrink-0', config.iconClass)}>
            {icon || <Icon size={20} />}
          </div>
          <div className="flex-1 pt-0.5">
            <p className="text-sm text-gray-700 dark:text-gray-300">{message}</p>
          </div>
        </div>
      </DialogContent>

      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            'px-3 py-1.5 text-sm text-white rounded transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2',
            config.buttonClass
          )}
        >
          {buttonText}
        </button>
      </DialogFooter>
    </Dialog>
  )
}

// ============================================
// FORM DIALOG COMPONENT
// ============================================

export interface FormDialogProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (e: React.FormEvent) => void
  title: string
  size?: ModalSize
  children: React.ReactNode
  submitText?: string
  cancelText?: string
  processing?: boolean
  submitDisabled?: boolean
  showFooter?: boolean
  className?: string
}

export function FormDialog({
  isOpen,
  onClose,
  onSubmit,
  title,
  size = 'lg',
  children,
  submitText = 'Save',
  cancelText = 'Cancel',
  processing = false,
  submitDisabled = false,
  showFooter = true,
  className,
}: FormDialogProps) {
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      onSubmit(e)
    },
    [onSubmit]
  )

  return (
    <Dialog
      isOpen={isOpen}
      onClose={processing ? () => {} : onClose}
      title={title}
      size={size}
      closeOnBackdrop={!processing}
      closeOnEscape={!processing}
      className={className}
    >
      <form onSubmit={handleSubmit}>
        <DialogContent className="max-h-[calc(100vh-200px)] overflow-y-auto">
          {children}
        </DialogContent>

        {showFooter && (
          <DialogFooter>
            <button
              type="button"
              onClick={onClose}
              disabled={processing}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {cancelText}
            </button>
            <button
              type="submit"
              disabled={processing || submitDisabled}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              {processing ? 'Saving...' : submitText}
            </button>
          </DialogFooter>
        )}
      </form>
    </Dialog>
  )
}

// ============================================
// DELETE DIALOG COMPONENT
// ============================================

export interface DeleteDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title?: string
  itemName?: string
  processing?: boolean
}

export function DeleteDialog({
  isOpen,
  onClose,
  onConfirm,
  title = 'Delete Item',
  itemName,
  processing = false,
}: DeleteDialogProps) {
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title={title}
      message={
        itemName
          ? `Are you sure you want to delete "${itemName}"? This action cannot be undone.`
          : 'Are you sure you want to delete this item? This action cannot be undone.'
      }
      confirmText="Delete"
      variant="danger"
      processing={processing}
    />
  )
}
