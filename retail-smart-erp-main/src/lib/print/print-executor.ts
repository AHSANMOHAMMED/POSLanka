'use client'

import { PrintSettings, Margins, MAX_MARGIN, MAX_COPIES } from './types'

/**
 * Clamp margin values to valid range (0 to MAX_MARGIN mm)
 */
export function clampMargins(margins: Margins): Margins {
  return {
    top: Math.max(0, Math.min(MAX_MARGIN, margins.top || 0)),
    right: Math.max(0, Math.min(MAX_MARGIN, margins.right || 0)),
    bottom: Math.max(0, Math.min(MAX_MARGIN, margins.bottom || 0)),
    left: Math.max(0, Math.min(MAX_MARGIN, margins.left || 0)),
  }
}

/**
 * Clamp copies to valid range (1 to MAX_COPIES)
 */
export function clampCopies(copies: number): number {
  return Math.max(1, Math.min(MAX_COPIES, copies || 1))
}

/**
 * Build CSS styles for print output.
 * Extracted from usePrint.ts to share across all print consumers.
 */
export function buildPrintStyles(settings: PrintSettings, width: number, height: number): string {
  const margins = clampMargins(settings.margins)

  let css = `
    @page {
      size: ${width}mm ${height}mm;
      margin: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
    }

    * {
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      line-height: 1.4;
      color: #000;
      margin: 0;
      padding: 0;
    }

    .print-content {
      width: 100%;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      padding: 4px 8px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }

    th {
      font-weight: 600;
      background: #f5f5f5;
    }

    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .font-bold { font-weight: 700; }
    .font-semibold { font-weight: 600; }
    .font-medium { font-weight: 500; }
    .font-mono { font-family: ui-monospace, monospace; }
    .text-sm { font-size: 11px; }
    .text-xs { font-size: 10px; }
    .text-lg { font-size: 14px; }
    .text-xl { font-size: 16px; }
    .text-2xl { font-size: 18px; }

    .mt-1 { margin-top: 4px; }
    .mt-2 { margin-top: 8px; }
    .mt-4 { margin-top: 16px; }
    .mt-8 { margin-top: 32px; }
    .mb-1 { margin-bottom: 4px; }
    .mb-2 { margin-bottom: 8px; }
    .mb-4 { margin-bottom: 16px; }
    .mb-6 { margin-bottom: 24px; }
    .mb-8 { margin-bottom: 32px; }
    .py-2 { padding-top: 8px; padding-bottom: 8px; }
    .pt-1 { padding-top: 4px; }
    .pt-2 { padding-top: 8px; }
    .pt-4 { padding-top: 16px; }
    .pb-1 { padding-bottom: 4px; }
    .pb-2 { padding-bottom: 8px; }
    .pb-4 { padding-bottom: 16px; }
    .px-2 { padding-left: 8px; padding-right: 8px; }
    .px-3 { padding-left: 12px; padding-right: 12px; }
    .p-3 { padding: 12px; }

    .border { border: 1px solid #ddd; }
    .border-t { border-top: 1px solid #ddd; }
    .border-b { border-bottom: 1px solid #ddd; }
    .border-dashed { border-style: dashed; }
    .border-gray-400 { border-color: #9ca3af; }
    .rounded { border-radius: 4px; }

    .bg-gray-100 { background-color: #f3f4f6; }
    .text-gray-500 { color: #6b7280; }
    .text-gray-600 { color: #4b5563; }

    .flex { display: flex; }
    .justify-between { justify-content: space-between; }
    .justify-end { justify-content: flex-end; }
    .items-center { align-items: center; }
    .gap-2 { gap: 8px; }
    .gap-4 { gap: 16px; }
    .gap-8 { gap: 32px; }

    .grid { display: grid; }
    .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

    .w-64 { width: 256px; }
    .space-y-1 > * + * { margin-top: 4px; }
    .space-y-2 > * + * { margin-top: 8px; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .whitespace-pre-wrap { white-space: pre-wrap; }

    .no-print { display: none !important; }

    @media print {
      * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        color-adjust: exact;
      }
    }
  `

  // Watermark overlay
  if (settings.watermark?.text) {
    const wm = settings.watermark
    const opacity = Math.max(0.05, Math.min(0.3, wm.opacity || 0.08))
    const rotation = wm.rotation ?? -45
    css += `
    .print-content {
      position: relative;
    }
    .print-content::after {
      content: '${wm.text.replace(/[\\';}{}/]/g, '').substring(0, 100)}';
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(${rotation}deg);
      font-size: 80px;
      font-weight: 700;
      opacity: ${opacity};
      pointer-events: none;
      z-index: 1000;
      color: #000;
      white-space: nowrap;
    }
    `
  }

  return css
}

/**
 * Execute print using a hidden iframe (never blocked by popup blockers).
 * Falls back to window.open() if iframe fails.
 * Resolves immediately once the print dialog is triggered — callers
 * should NOT use the return value to toggle loading spinners.
 */
export function executePrint(title: string, styles: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(title)}</title>
  <style>${styles}</style>
</head>
<body>
  <div class="print-content">${content}</div>
</body>
</html>`

    let resolved = false
    const resolveOnce = (value: boolean) => {
      if (resolved) return
      resolved = true
      resolve(value)
    }

    try {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
      iframe.setAttribute('title', 'Print Frame')
      document.body.appendChild(iframe)

      const iframeWin = iframe.contentWindow
      const iframeDoc = iframe.contentDocument || iframeWin?.document

      if (!iframeDoc || !iframeWin) {
        document.body.removeChild(iframe)
        resolveOnce(fallbackPrint(title, styles, content))
        return
      }

      iframeDoc.open()
      iframeDoc.write(html)
      iframeDoc.close()

      const cleanup = () => {
        if (iframe.parentNode) {
          document.body.removeChild(iframe)
        }
      }

      // Wait for all images (including base64 data URLs for barcodes) to decode
      const waitForImages = (): Promise<void> => {
        const images = Array.from(iframeDoc.querySelectorAll('img'))
        if (images.length === 0) return Promise.resolve()
        return Promise.all(
          images.map(img => {
            if (img.complete && img.naturalWidth > 0) return Promise.resolve()
            return new Promise<void>((res) => {
              img.onload = () => res()
              img.onerror = () => res()
              setTimeout(res, 3000)
            })
          })
        ).then(() => {})
      }

      let triggered = false
      const triggerPrint = async () => {
        if (triggered) return
        triggered = true

        try {
          await waitForImages()

          // Clean up iframe after print dialog closes (or after timeout)
          if ('onafterprint' in iframeWin) {
            iframeWin.onafterprint = () => setTimeout(cleanup, 500)
          }

          iframeWin.focus()
          iframeWin.print()

          // Resolve immediately — buttons stay enabled
          resolveOnce(true)

          // Fallback cleanup if onafterprint doesn't fire
          setTimeout(cleanup, 60000)
        } catch {
          cleanup()
          resolveOnce(fallbackPrint(title, styles, content))
        }
      }

      if (iframe.contentDocument?.readyState === 'complete') {
        requestAnimationFrame(() => triggerPrint())
      } else {
        iframe.onload = () => requestAnimationFrame(() => triggerPrint())
        setTimeout(() => triggerPrint(), 500)
      }

    } catch {
      resolveOnce(fallbackPrint(title, styles, content))
    }
  })
}

/**
 * Fallback: open in a popup window (may be blocked by popup blockers).
 */
function fallbackPrint(title: string, styles: string, content: string): boolean {
  const printWindow = window.open('', '_blank', 'width=800,height=600')
  if (!printWindow) {
    return false
  }

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${escapeHtml(title)}</title>
  <style>${styles}</style>
</head>
<body>
  <div class="print-content">${content}</div>
  <script>
    window.onload = function() {
      // Set onafterprint BEFORE calling print() so it works in
      // both blocking (Chrome) and non-blocking (Safari) browsers.
      window.onafterprint = function() { window.close(); };
      window.print();
      // Fallback for browsers where onafterprint never fires:
      // close window after print() returns (blocking browsers).
      setTimeout(function() { window.close(); }, 500);
    };
  </script>
</body>
</html>`)
  printWindow.document.close()
  return true
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
