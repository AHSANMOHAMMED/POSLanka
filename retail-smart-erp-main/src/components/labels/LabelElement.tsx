'use client'

import { useEffect, useState } from 'react'
import type { LabelElement as LabelElementType, LabelItemData, TextElement } from '@/lib/labels/types'
import { renderBarcodeDataUrl, getBarcodeFallbackData, validateBarcodeData } from '@/lib/labels/barcode-renderer'
import { encodePriceCode, calculateAutoFitFontSize } from '@/lib/labels/label-renderer'

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface LabelElementProps {
  element: LabelElementType
  zoom: number
  selected: boolean
  onSelect: () => void
  onDragStart: (e: React.MouseEvent) => void
  onResizeStart?: (e: React.MouseEvent, handle: ResizeHandle) => void
  item?: LabelItemData | null
  codeWord?: string
}

const SAMPLE_DATA: Record<string, string> = {
  'item.name': 'Sample Item',
  'item.sku': 'SKU-001',
  'item.barcode': '1234567890128',
  'item.sellingPrice': '9.99',
  'item.costPrice': '5.50',
  'item.priceCode': '5.50',
  'item.discountCode': '9.99',
  'item.brand': 'Brand',
  'item.oemPartNumber': 'OEM-123',
  'item.pluCode': '4011',
  'item.category': 'Category',
  'item.unit': 'pcs',
  'item.weight': '0.5 kg',
  'item.dimensions': '10x5x3',
  'tenant.name': 'Company',
  'custom': 'Custom Text',
}

function resolveValue(element: { dataField: string; customValue?: string }, item?: LabelItemData | null, codeWord?: string): string {
  if (element.dataField === 'custom') return element.customValue || 'Custom Text'

  if (item) {
    if (element.dataField === 'item.priceCode') {
      const cost = parseFloat(item.costPrice)
      return codeWord?.length === 10 ? encodePriceCode(cost, codeWord) : cost.toFixed(2)
    }
    if (element.dataField === 'item.discountCode') {
      const selling = parseFloat(item.sellingPrice)
      return codeWord?.length === 10 ? encodePriceCode(selling, codeWord) : selling.toFixed(2)
    }
    const fieldMap: Record<string, string | null> = {
      'item.name': item.name,
      'item.sku': item.sku,
      'item.barcode': item.barcode,
      'item.sellingPrice': item.sellingPrice,
      'item.costPrice': item.costPrice,
      'item.brand': item.brand,
      'item.oemPartNumber': item.oemPartNumber,
      'item.pluCode': item.pluCode,
      'item.category': item.category,
      'item.unit': item.unit,
      'item.weight': item.weight,
      'item.dimensions': item.dimensions,
    }
    return fieldMap[element.dataField] || ''
  }

  // Designer mode (no item) — use sample data with price code encoding
  if (element.dataField === 'item.priceCode') {
    return codeWord?.length === 10 ? encodePriceCode(5.50, codeWord) : SAMPLE_DATA['item.priceCode'] || ''
  }
  if (element.dataField === 'item.discountCode') {
    return codeWord?.length === 10 ? encodePriceCode(9.99, codeWord) : SAMPLE_DATA['item.discountCode'] || ''
  }
  return SAMPLE_DATA[element.dataField] || ''
}

const HANDLE_SIZE = 8
const HANDLE_POSITIONS: { handle: ResizeHandle; x: string; y: string; cursor: string }[] = [
  { handle: 'nw', x: '-4px', y: '-4px', cursor: 'nw-resize' },
  { handle: 'n',  x: 'calc(50% - 4px)', y: '-4px', cursor: 'n-resize' },
  { handle: 'ne', x: 'calc(100% - 4px)', y: '-4px', cursor: 'ne-resize' },
  { handle: 'e',  x: 'calc(100% - 4px)', y: 'calc(50% - 4px)', cursor: 'e-resize' },
  { handle: 'se', x: 'calc(100% - 4px)', y: 'calc(100% - 4px)', cursor: 'se-resize' },
  { handle: 's',  x: 'calc(50% - 4px)', y: 'calc(100% - 4px)', cursor: 's-resize' },
  { handle: 'sw', x: '-4px', y: 'calc(100% - 4px)', cursor: 'sw-resize' },
  { handle: 'w',  x: '-4px', y: 'calc(50% - 4px)', cursor: 'w-resize' },
]

export function LabelElementComponent({ element, zoom, selected, onSelect, onDragStart, onResizeStart, codeWord }: LabelElementProps) {
  const mmToPx = (mm: number) => mm * (96 / 25.4) * zoom

  const style: React.CSSProperties = {
    position: 'absolute',
    left: mmToPx(element.x),
    top: mmToPx(element.y),
    width: mmToPx(element.width),
    height: mmToPx(element.height),
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    zIndex: element.zIndex,
    cursor: 'move',
    outline: selected ? '2px solid #3b82f6' : '1px dashed transparent',
    outlineOffset: 1,
    userSelect: 'none',
  }

  return (
    <div
      style={style}
      onMouseDown={(e) => {
        e.stopPropagation()
        onSelect()
        onDragStart(e)
      }}
    >
      {element.type === 'barcode' && <BarcodePreview element={element} />}
      {element.type === 'text' && <TextPreview element={element} zoom={zoom} codeWord={codeWord} />}
      {element.type === 'image' && <ImagePreview element={element} />}
      {element.type === 'shape' && <ShapePreview element={element} />}

      {/* Resize handles - only visible when selected */}
      {selected && onResizeStart && (
        <>
          {HANDLE_POSITIONS.map(({ handle, x, y, cursor }) => (
            <div
              key={handle}
              style={{
                position: 'absolute',
                left: x,
                top: y,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                background: 'white',
                border: '2px solid #3b82f6',
                borderRadius: 1,
                cursor,
                zIndex: 9999,
              }}
              onMouseDown={(e) => {
                e.stopPropagation()
                onResizeStart(e, handle)
              }}
            />
          ))}
        </>
      )}
    </div>
  )
}

function BarcodePreview({ element }: { element: LabelElementType & { type: 'barcode' } }) {
  const [dataUrl, setDataUrl] = useState<string>('')
  const rawData = resolveValue(element)
  // Use format-appropriate fallback when data is empty or incompatible with
  // the selected format (e.g. 13-digit EAN-13 sample won't work for UPC-A)
  const data = (rawData && !validateBarcodeData(element.format, rawData))
    ? rawData
    : getBarcodeFallbackData(element.format)

  useEffect(() => {
    renderBarcodeDataUrl(element.format, data, {
      showText: element.showText,
    }).then(setDataUrl)
  }, [element.format, data, element.showText])

  return (
    <img
      src={dataUrl}
      alt="barcode"
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      draggable={false}
    />
  )
}

function TextPreview({ element, zoom, codeWord }: { element: LabelElementType & { type: 'text' }; zoom: number; codeWord?: string }) {
  const textEl = element as TextElement
  let text = resolveValue(textEl, undefined, codeWord)
  if (element.prefix) text = element.prefix + text
  if (element.suffix) text = text + element.suffix

  // Use pt units (matching print output) scaled by zoom for WYSIWYG fidelity.
  // 1pt = 1/72in; at 96dpi, 1pt = 96/72 = 1.333px. Zoom scales the container
  // already via mmToPx, so we just need to match the pt size at the current zoom.
  let fontSize = element.fontSize
  if (textEl.autoFit && text) {
    const widthPx = element.width * (96 / 25.4)
    const heightPx = element.height * (96 / 25.4)
    fontSize = calculateAutoFitFontSize(text, widthPx, heightPx, element.fontWeight, element.fontSize, element.maxLines)
  }
  const fontSizePx = fontSize * (96 / 72) * zoom

  return (
    <div
      style={{
        fontSize: fontSizePx,
        fontWeight: element.fontWeight,
        textAlign: element.textAlign,
        lineHeight: 1.2,
        overflow: 'hidden',
        wordBreak: 'break-word',
        display: '-webkit-box',
        WebkitLineClamp: element.maxLines,
        WebkitBoxOrient: 'vertical' as const,
        width: '100%',
        height: '100%',
      }}
    >
      {text}
    </div>
  )
}

function ImagePreview({ element }: { element: LabelElementType & { type: 'image' } }) {
  if (element.source === 'custom' && element.customUrl) {
    return <img src={element.customUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} draggable={false} />
  }
  return (
    <div style={{
      width: '100%', height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f9fafb', border: '1px dashed #d1d5db',
      fontSize: 10, color: '#9ca3af',
    }}>
      {element.source === 'logo' ? 'Logo' : 'Image'}
    </div>
  )
}

function ShapePreview({ element }: { element: LabelElementType & { type: 'shape' } }) {
  if (element.shape === 'line') {
    return (
      <div style={{
        width: '100%',
        borderTop: `${element.borderWidth}px ${element.borderStyle} ${element.borderColor}`,
        position: 'absolute',
        top: '50%',
      }} />
    )
  }

  if (element.shape === 'ellipse') {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        border: `${element.borderWidth}px ${element.borderStyle} ${element.borderColor}`,
        background: element.fillColor || 'transparent',
        boxSizing: 'border-box',
        borderRadius: '50%',
      }} />
    )
  }

  // rectangle or rounded-rectangle
  const radius = element.shape === 'rounded-rectangle' && element.cornerRadius
    ? `${element.cornerRadius}mm`
    : undefined

  return (
    <div style={{
      width: '100%',
      height: '100%',
      border: `${element.borderWidth}px ${element.borderStyle} ${element.borderColor}`,
      background: element.fillColor || 'transparent',
      boxSizing: 'border-box',
      borderRadius: radius,
    }} />
  )
}
