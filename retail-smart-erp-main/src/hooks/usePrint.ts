'use client'

import { useState, useCallback } from 'react'
import { DocumentType, PaperSize, PrintSettings, DocumentPrintSettings, DEFAULT_PRINT_SETTINGS, PAPER_SIZES } from '@/lib/print/types'
import { executePrint, buildPrintStyles } from '@/lib/print/print-executor'

interface UsePrintOptions {
  documentType: DocumentType
  title: string
  getContent: () => string
  businessInfo?: {
    name: string
    address?: string
    phone?: string
    email?: string
    taxId?: string
  }
}

interface UsePrintReturn {
  isPrintPreviewOpen: boolean
  openPrintPreview: () => void
  closePrintPreview: () => void
  printDirect: () => Promise<void>
  settings: PrintSettings
  loadSettings: () => Promise<void>
}

export function usePrint(options: UsePrintOptions): UsePrintReturn {
  const { documentType, title, getContent } = options
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false)
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS[documentType])

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/print-settings')
      if (res.ok) {
        const allSettings: DocumentPrintSettings = await res.json()
        if (allSettings[documentType]) {
          setSettings(allSettings[documentType])
        }
      }
    } catch (error) {
      console.error('Failed to load print settings:', error)
    }
  }, [documentType])

  const openPrintPreview = useCallback(() => {
    loadSettings()
    setIsPrintPreviewOpen(true)
  }, [loadSettings])

  const closePrintPreview = useCallback(() => {
    setIsPrintPreviewOpen(false)
  }, [])

  const printDirect = useCallback(async () => {
    await loadSettings()

    const content = getContent()
    if (!content) {
      console.error('No content to print')
      return
    }

    const paperSize = PAPER_SIZES[settings.paperSize]
    const isLandscape = settings.orientation === 'landscape'
    const width = isLandscape ? paperSize.height : paperSize.width
    const height = isLandscape ? paperSize.width : paperSize.height
    const printStyles = buildPrintStyles(settings, width, height)

    const success = await executePrint(title, printStyles, content)
    if (!success) {
      console.error('Print failed - popup may be blocked')
    }
  }, [settings, title, getContent, loadSettings])

  return {
    isPrintPreviewOpen,
    openPrintPreview,
    closePrintPreview,
    printDirect,
    settings,
    loadSettings
  }
}

// Quick print function for one-off printing without hooks
export async function quickPrint(
  documentType: DocumentType,
  title: string,
  content: string,
  options?: { paperSize?: PaperSize }
): Promise<boolean> {
  let settings = DEFAULT_PRINT_SETTINGS[documentType]

  try {
    const res = await fetch('/api/print-settings')
    if (res.ok) {
      const allSettings: DocumentPrintSettings = await res.json()
      if (allSettings[documentType]) {
        settings = allSettings[documentType]
      }
    }
  } catch (error) {
    console.error('Failed to load print settings:', error)
  }

  // Allow caller to override paper size (e.g. from POS profile receiptPrintFormat)
  if (options?.paperSize && PAPER_SIZES[options.paperSize]) {
    settings = { ...settings, paperSize: options.paperSize }
  }

  const paperSize = PAPER_SIZES[settings.paperSize]
  const isLandscape = settings.orientation === 'landscape'
  const width = isLandscape ? paperSize.height : paperSize.width
  const height = isLandscape ? paperSize.width : paperSize.height
  const printStyles = buildPrintStyles(settings, width, height)

  return executePrint(title, printStyles, content)
}
