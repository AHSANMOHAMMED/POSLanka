'use client'

import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  divider?: boolean
  shortcut?: string
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  position: { x: number; y: number } | null
  onClose: () => void
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!position) return

    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') handleClose()
    }

    function handleScroll() {
      handleClose()
    }

    // Delay adding click listener to avoid immediately closing from the right-click event
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleClose)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleClose)
    }
  }, [position, handleClose])

  if (!position) return null

  // Calculate position with edge detection
  const menuWidth = 220
  const menuHeight = items.reduce((h, item) => h + (item.divider ? 9 : 36), 8)

  let x = position.x
  let y = position.y

  if (typeof window !== 'undefined') {
    if (x + menuWidth > window.innerWidth - 8) {
      x = position.x - menuWidth
    }
    if (y + menuHeight > window.innerHeight - 8) {
      y = Math.max(8, position.y - menuHeight)
    }
  }

  const menu = (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[200px] max-w-[280px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-xl py-1 animate-in fade-in zoom-in-95 duration-100"
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((item, index) => (
        <div key={index}>
          {item.divider && index > 0 && (
            <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
          )}
          <button
            role="menuitem"
            disabled={item.disabled}
            onClick={(e) => {
              e.stopPropagation()
              if (!item.disabled) {
                item.onClick()
                handleClose()
              }
            }}
            className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors text-left ${
              item.disabled
                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                : item.danger
                  ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}
          >
            {item.icon && (
              <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                {item.icon}
              </span>
            )}
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-xs text-gray-400 dark:text-gray-500 ml-4">{item.shortcut}</span>
            )}
          </button>
        </div>
      ))}
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(menu, document.body)
}
