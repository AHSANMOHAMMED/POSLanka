'use client'

import { useState } from 'react'

export function useExport() {
  const [showExportDialog, setShowExportDialog] = useState(false)

  return {
    showExportDialog,
    openExport: () => setShowExportDialog(true),
    closeExport: () => setShowExportDialog(false),
  }
}
