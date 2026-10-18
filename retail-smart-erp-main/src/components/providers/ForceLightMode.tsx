'use client'

import { useEffect } from 'react'

/**
 * Forces light mode while mounted by removing the 'dark' class
 * from <html> and restoring it on unmount.
 */
export function ForceLightMode() {
  useEffect(() => {
    const root = document.documentElement
    const wasDark = root.classList.contains('dark')

    root.classList.remove('dark')
    if (!root.classList.contains('light')) {
      root.classList.add('light')
    }

    return () => {
      // Restore previous theme on unmount
      if (wasDark) {
        root.classList.remove('light')
        root.classList.add('dark')
      }
    }
  }, [])

  return null
}
