'use client'

/**
 * Browser-only: renders page 1 of an uploaded PDF form to a PNG at `dpi`, so a pre-printed form
 * designed as a PDF can be used as the template background at its exact page size.
 * pdfjs is loaded on demand so it never enters the main bundle.
 */
interface PdfJsDoc {
  getPage: (pageNumber: number) => Promise<{
    getViewport: (options: { scale: number }) => { width: number; height: number }
    render: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void> }
  }>
  destroy?: () => void | Promise<void>
}

interface PdfJsModule {
  GlobalWorkerOptions?: { workerSrc?: string }
  getDocument: (source: { data: Uint8Array }) => { promise: Promise<PdfJsDoc> }
}

export async function pdfFirstPageToPng(file: File, dpi = 300): Promise<{ file: File; widthMm: number; heightMm: number }> {
  // Load pdfjs dynamically at runtime to avoid bundler build-time resolution when running in offline/contained environments
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<PdfJsModule>
  let pdfjs: PdfJsModule
  try {
    pdfjs = await dynamicImport('pdfjs-dist')
  } catch {
    // Fallback to CDN when running in the browser
    pdfjs = await dynamicImport('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/+esm')
  }

  if (pdfjs?.GlobalWorkerOptions) {
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs'
    } catch {
      // Worker options fallback
    }
  }

  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  try {
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 }) // 72 points per inch
    const viewport = page.getViewport({ scale: dpi / 72 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Could not convert the PDF page')
    const name = file.name.replace(/\.pdf$/i, '') + '.png'
    return {
      file: new File([blob], name, { type: 'image/png' }),
      widthMm: (base.width / 72) * 25.4,
      heightMm: (base.height / 72) * 25.4,
    }
  } finally {
    void doc?.destroy?.()
  }
}
