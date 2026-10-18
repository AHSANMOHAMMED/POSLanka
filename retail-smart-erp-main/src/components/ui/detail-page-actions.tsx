'use client'

import { useState, useCallback } from 'react'
import { Button } from './button'
import { ConfirmDialog, type DialogVariant } from './dialog'
import { cn } from '@/lib/utils'

// --- Types ---

export type ActionVariant = 'primary' | 'success' | 'warning' | 'danger' | 'outline' | 'ghost'

export interface ActionConfirmation {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: DialogVariant
}

export interface ActionConfig {
  key: string
  label: string
  icon?: React.ReactNode
  variant?: ActionVariant
  onClick: () => void | Promise<void>
  confirmation?: ActionConfirmation
  disabled?: boolean
  hidden?: boolean
  loading?: boolean
  position?: 'left' | 'right'
  className?: string
}

export interface DetailPageActionsProps {
  actions: ActionConfig[]
  className?: string
}

// Map our action variants to Button component variants
const variantMap: Record<ActionVariant, 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'success' | 'warning'> = {
  primary: 'default',
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
  outline: 'outline',
  ghost: 'ghost',
}

export function DetailPageActions({ actions, className }: DetailPageActionsProps) {
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean
    action: ActionConfig | null
    processing: boolean
  }>({ isOpen: false, action: null, processing: false })

  const visibleActions = actions.filter(a => !a.hidden)
  const leftActions = visibleActions.filter(a => a.position === 'left')
  const rightActions = visibleActions.filter(a => a.position !== 'left')

  const handleClick = useCallback((action: ActionConfig) => {
    if (action.confirmation) {
      setConfirmState({ isOpen: true, action, processing: false })
    } else {
      action.onClick()
    }
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!confirmState.action) return
    setConfirmState(prev => ({ ...prev, processing: true }))
    try {
      await confirmState.action.onClick()
    } finally {
      setConfirmState({ isOpen: false, action: null, processing: false })
    }
  }, [confirmState.action])

  const handleClose = useCallback(() => {
    if (!confirmState.processing) {
      setConfirmState({ isOpen: false, action: null, processing: false })
    }
  }, [confirmState.processing])

  if (visibleActions.length === 0) return null

  return (
    <>
      <div className={cn(
        'flex items-center justify-between gap-3 px-4 py-3',
        'bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700',
        'sticky bottom-0 z-10',
        className
      )}>
        {/* Left side - secondary/danger actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {leftActions.map(action => (
            <Button
              key={action.key}
              variant={variantMap[action.variant || 'outline']}
              size="sm"
              onClick={() => handleClick(action)}
              disabled={action.disabled || action.loading}
              loading={action.loading}
              leftIcon={action.loading ? undefined : action.icon}
              className={action.className}
            >
              {action.label}
            </Button>
          ))}
        </div>

        {/* Right side - primary actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {rightActions.map(action => (
            <Button
              key={action.key}
              variant={variantMap[action.variant || 'outline']}
              size="sm"
              onClick={() => handleClick(action)}
              disabled={action.disabled || action.loading}
              loading={action.loading}
              leftIcon={action.loading ? undefined : action.icon}
              className={action.className}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Shared confirmation dialog */}
      {confirmState.action?.confirmation && (
        <ConfirmDialog
          isOpen={confirmState.isOpen}
          onClose={handleClose}
          onConfirm={handleConfirm}
          title={confirmState.action.confirmation.title}
          message={confirmState.action.confirmation.message}
          confirmText={confirmState.action.confirmation.confirmText || confirmState.action.label}
          cancelText={confirmState.action.confirmation.cancelText || 'Cancel'}
          variant={confirmState.action.confirmation.variant || 'default'}
          processing={confirmState.processing}
        />
      )}
    </>
  )
}
