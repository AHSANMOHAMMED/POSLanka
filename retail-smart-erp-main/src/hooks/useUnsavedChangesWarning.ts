'use client'

import { useEffect } from 'react'

/**
 * Hook to warn users when they try to leave a page with unsaved changes.
 * Handles both browser navigation (refresh, close tab) and shows a warning.
 *
 * @param hasUnsavedChanges - Boolean indicating if there are unsaved changes
 * @param message - Optional custom message (note: most browsers ignore custom messages)
 */
export function useUnsavedChangesWarning(
  hasUnsavedChanges: boolean,
  message: string = 'You have unsaved changes. Are you sure you want to leave?'
) {
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        // Most modern browsers ignore custom messages for security reasons
        // but we set it anyway for older browsers
        e.returnValue = message
        return message
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [hasUnsavedChanges, message])
}
