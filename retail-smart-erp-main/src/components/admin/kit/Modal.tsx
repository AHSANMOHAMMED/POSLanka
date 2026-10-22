'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button, type ButtonVariant } from './Button'

export interface AdminModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children?: ReactNode
}

const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' } as const

/**
 * Accessible dialog: Esc and backdrop close it, focus moves inside, body scroll locks.
 * On phones it docks to the bottom as a sheet.
 */
export function AdminModal({ open, onClose, title, description, footer, size = 'md', children }: AdminModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-modal-close])')
      ;(el ?? panelRef.current)?.focus()
    }, 0)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'adm-fade-in relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-adm-border bg-adm-surface text-adm-fg shadow-[var(--adm-shadow-lg)] outline-none sm:rounded-2xl',
          widths[size]
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-adm-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold text-adm-fg">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-adm-muted">{description}</p>}
          </div>
          <button
            type="button"
            data-modal-close
            onClick={onClose}
            aria-label="Close"
            className="adm-focus -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-adm-subtle hover:bg-adm-surface-2 hover:text-adm-fg"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        {children !== undefined && <div className="adm-scroll overflow-y-auto px-5 py-4">{children}</div>}
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-adm-border px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  )
}

/** Yes/no confirmation built on AdminModal. */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
  loading,
  children,
}: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  confirmVariant?: ButtonVariant
  loading?: boolean
  children?: ReactNode
}) {
  return (
    <AdminModal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant={confirmVariant} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      {children}
    </AdminModal>
  )
}
