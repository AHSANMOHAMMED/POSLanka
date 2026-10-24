'use client'

/**
 * What a raw ESC/POS thermal printer prints for a receipt model: the bytes from
 * buildReceiptEscPosFromModel decoded back into lines (exact columns, bold,
 * double size, alignment, logo / barcode / QR placeholders).
 */
import { useMemo } from 'react'
import type { ReceiptModel } from '@/lib/print/receipt-model'
import { buildReceiptEscPosFromModel, SMALL_FONT_COLUMNS } from '@/lib/print/escpos/receipt-from-model'
import { COLUMNS } from '@/lib/print/escpos/encoder'
import { decodeEscPosPreview } from '@/lib/print/escpos/preview'

export function ThermalReceiptPreview({ model, paperWidth, widthPx }: { model: ReceiptModel; paperWidth: 58 | 80; widthPx: number }) {
  const lines = useMemo(() => {
    // A stand-in logo raster so the preview shows where (and how wide) the logo prints
    const dots = paperWidth === 58 ? 384 : 576
    const logoW = Math.round((dots * model.logo.widthPct) / 100)
    const logoRaster = model.logo.show ? fakeLogo(dots, logoW, 48) : null
    return decodeEscPosPreview(buildReceiptEscPosFromModel(model, { paperWidth, logoRaster, noCut: true }))
  }, [model, paperWidth])
  const cols = model.fontSize === 'small' ? SMALL_FONT_COLUMNS[paperWidth] : COLUMNS[paperWidth]
  const fontPx = widthPx / (cols * 0.6)
  const dots = paperWidth === 58 ? 384 : 576

  return (
    <div style={{ width: widthPx, fontFamily: "'Courier New', ui-monospace, monospace", fontSize: fontPx, lineHeight: 1.25, color: '#000' }}>
      {lines.map((l, i) => {
        if (l.kind === 'image') {
          if ((l.height || 0) <= 3) return <div key={i} style={{ borderTop: '2px solid #000', margin: '2px 0' }} />
          const pct = model.logo.widthPct
          const justify = model.logo.align === 'left' ? 'flex-start' : model.logo.align === 'right' ? 'flex-end' : 'center'
          return (
            <div key={i} style={{ display: 'flex', justifyContent: justify }}>
              <div style={{ width: `${(pct * (l.width || dots)) / dots}%`, height: 28, background: '#e5e7eb', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                logo
              </div>
            </div>
          )
        }
        if (l.kind === 'barcode' || l.kind === 'qr') {
          return (
            <div key={i} style={{ textAlign: 'center', margin: '2px 0' }}>
              <span style={{ display: 'inline-block', padding: '2px 6px', border: '1px dashed #9ca3af', fontSize: 10, maxWidth: '100%', overflowWrap: 'anywhere' }}>
                {l.kind === 'qr' ? 'QR' : 'Code 128'}: {l.text}
              </span>
            </div>
          )
        }
        if (l.kind === 'cut') return null
        const tall = l.h >= 2
        return (
          <div
            key={i}
            style={{
              whiteSpace: 'pre',
              textAlign: l.align,
              fontWeight: l.bold ? 700 : 400,
              fontSize: l.w >= 2 ? fontPx * 2 : undefined,
              height: tall && l.w < 2 ? `${2.5}em` : undefined,
              transform: tall && l.w < 2 ? 'scaleY(2)' : undefined,
              transformOrigin: 'top',
              overflow: 'hidden',
            }}
          >
            {l.text || ' '}
          </div>
        )
      })}
    </div>
  )
}

function fakeLogo(dots: number, logoW: number, h: number) {
  const bpr = dots / 8
  const data = new Uint8Array(bpr * h)
  const x0 = Math.floor((dots - logoW) / 2)
  for (let y = 0; y < h; y++) for (let x = x0; x < x0 + logoW; x++) data[y * bpr + (x >> 3)] |= 0x80 >> (x & 7)
  return { width: dots, height: h, data }
}
