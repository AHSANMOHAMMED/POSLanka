// Template renderer: merges print template config with document content
// Used by usePrint to apply letter head, field visibility, and custom CSS

export interface LetterHeadConfig {
  headerHtml?: string | null
  footerHtml?: string | null
  headerImage?: string | null
  footerImage?: string | null
  headerHeight: number
  footerHeight: number
  alignment: 'left' | 'center' | 'right'
}

export interface PrintTemplateConfig {
  paperSize: string
  orientation: string
  margins: { top: number; right: number; bottom: number; left: number }
  showLogo: boolean
  showHeader: boolean
  showFooter: boolean
  customCss?: string | null
  letterHead?: LetterHeadConfig | null
}

export function renderWithLetterHead(
  content: string,
  letterHead: LetterHeadConfig | null | undefined
): string {
  if (!letterHead) return content

  const align = letterHead.alignment || 'center'
  const headerH = letterHead.headerHeight || 60
  const footerH = letterHead.footerHeight || 30

  let header = ''
  if (letterHead.headerImage || letterHead.headerHtml) {
    header = `
      <div class="letter-head-header" style="text-align: ${align}; min-height: ${Math.round(headerH / 3)}px; padding-bottom: 8px; margin-bottom: 12px; border-bottom: 1px solid #ddd;">
        ${letterHead.headerImage ? `<img src="${letterHead.headerImage}" style="max-height: ${headerH}px;" alt="Header" />` : ''}
        ${letterHead.headerHtml || ''}
      </div>
    `
  }

  let footer = ''
  if (letterHead.footerImage || letterHead.footerHtml) {
    footer = `
      <div class="letter-head-footer" style="text-align: ${align}; min-height: ${Math.round(footerH / 3)}px; padding-top: 8px; margin-top: 12px; border-top: 1px solid #ddd;">
        ${letterHead.footerImage ? `<img src="${letterHead.footerImage}" style="max-height: ${footerH}px;" alt="Footer" />` : ''}
        ${letterHead.footerHtml || ''}
      </div>
    `
  }

  return `${header}${content}${footer}`
}

export function buildTemplateStyles(
  config: PrintTemplateConfig,
  width: number,
  height: number
): string {
  let css = `
    @page {
      size: ${width}mm ${height}mm;
      margin: ${config.margins.top}mm ${config.margins.right}mm ${config.margins.bottom}mm ${config.margins.left}mm;
    }
  `

  if (config.customCss) {
    css += '\n' + config.customCss
  }

  return css
}
