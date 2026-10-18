'use client'

import { useState } from 'react'

export function useImport() {
  const [showImportWizard, setShowImportWizard] = useState(false)

  return {
    showImportWizard,
    openImport: () => setShowImportWizard(true),
    closeImport: () => setShowImportWizard(false),
  }
}
