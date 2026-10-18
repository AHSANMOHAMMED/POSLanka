// Print system types

export type DocumentType = 'receipt' | 'work_order' | 'estimate' | 'invoice' | 'purchase_order' | 'purchase_invoice' | 'stock_transfer' | 'sales_order'

export type PaperSize =
  | 'thermal_58mm'
  | 'thermal_80mm'
  | 'a4'
  | 'a5'
  | 'letter'
  | 'legal'

export type Orientation = 'portrait' | 'landscape'

export const MAX_MARGIN = 50
export const MAX_COPIES = 20

export interface WatermarkConfig {
  text: string
  opacity: number
  rotation: number
}

export interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface PrintSettings {
  paperSize: PaperSize
  orientation: Orientation
  copies: number
  margins: Margins
  showHeader: boolean
  showFooter: boolean
  showLogo: boolean
  watermark?: WatermarkConfig | null
}

export interface DocumentPrintSettings {
  receipt: PrintSettings
  work_order: PrintSettings
  estimate: PrintSettings
  invoice: PrintSettings
  purchase_order: PrintSettings
  purchase_invoice: PrintSettings
  stock_transfer: PrintSettings
  sales_order: PrintSettings
}

export const DEFAULT_PRINT_SETTINGS: DocumentPrintSettings = {
  receipt: {
    paperSize: 'thermal_80mm',
    orientation: 'portrait',
    copies: 1,
    margins: { top: 5, right: 5, bottom: 5, left: 5 },
    showHeader: true,
    showFooter: true,
    showLogo: true,
  },
  work_order: {
    paperSize: 'a4',
    orientation: 'portrait',
    copies: 1,
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    showHeader: true,
    showFooter: true,
    showLogo: true,
  },
  estimate: {
    paperSize: 'a4',
    orientation: 'portrait',
    copies: 1,
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    showHeader: true,
    showFooter: true,
    showLogo: true,
  },
  invoice: {
    paperSize: 'a4',
    orientation: 'portrait',
    copies: 2,
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    showHeader: true,
    showFooter: true,
    showLogo: true,
  },
  purchase_order: {
    paperSize: 'a4',
    orientation: 'portrait',
    copies: 1,
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    showHeader: true,
    showFooter: true,
    showLogo: true,
  },
  purchase_invoice: {
    paperSize: 'a4',
    orientation: 'portrait',
    copies: 1,
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    showHeader: true,
    showFooter: true,
    showLogo: true,
  },
  stock_transfer: {
    paperSize: 'a4',
    orientation: 'portrait',
    copies: 2,
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    showHeader: true,
    showFooter: true,
    showLogo: true,
  },
  sales_order: {
    paperSize: 'a4',
    orientation: 'portrait',
    copies: 1,
    margins: { top: 10, right: 10, bottom: 10, left: 10 },
    showHeader: true,
    showFooter: true,
    showLogo: true,
  },
}

export const PAPER_SIZES: Record<PaperSize, { width: number; height: number; label: string }> = {
  thermal_58mm: { width: 58, height: 297, label: '58mm Thermal' },
  thermal_80mm: { width: 80, height: 297, label: '80mm Thermal' },
  a4: { width: 210, height: 297, label: 'A4' },
  a5: { width: 148, height: 210, label: 'A5' },
  letter: { width: 216, height: 279, label: 'Letter' },
  legal: { width: 216, height: 356, label: 'Legal' },
}
