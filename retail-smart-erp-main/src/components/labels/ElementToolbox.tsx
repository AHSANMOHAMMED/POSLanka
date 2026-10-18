'use client'

import { Barcode, QrCode, Type, Image, Minus, Square, RectangleHorizontal, Circle } from 'lucide-react'
import type { LabelElement, BarcodeFormat, PresetLabelSize, LabelShape } from '@/lib/labels/types'
import { PRESET_LABEL_SIZES } from '@/lib/labels/types'

interface ElementToolboxProps {
  widthMm: number
  heightMm: number
  labelShape: LabelShape
  cornerRadius: number | null
  onWidthChange: (w: number) => void
  onHeightChange: (h: number) => void
  onShapeChange: (shape: LabelShape) => void
  onCornerRadiusChange: (r: number | null) => void
  onAddElement: (element: LabelElement) => void
}

let nextId = 1
function genId() {
  return `el-${Date.now()}-${nextId++}`
}

export function ElementToolbox({ widthMm, heightMm, labelShape, cornerRadius, onWidthChange, onHeightChange, onShapeChange, onCornerRadiusChange, onAddElement }: ElementToolboxProps) {
  const centerX = (w: number) => Math.max(0, (widthMm - w) / 2)
  const centerY = (h: number) => Math.max(0, (heightMm - h) / 2)

  function addBarcode(format: BarcodeFormat = 'code128') {
    const is2D = ['qrcode', 'datamatrix', 'pdf417'].includes(format)
    const w = is2D ? Math.min(15, widthMm * 0.4) : Math.min(30, widthMm * 0.7)
    const h = is2D ? w : Math.min(10, heightMm * 0.4)
    onAddElement({
      id: genId(), type: 'barcode', x: centerX(w), y: centerY(h),
      width: w, height: h, rotation: 0, zIndex: 10,
      format, dataField: 'item.barcode', showText: !is2D, barWidth: 2,
    })
  }

  function addText() {
    const w = Math.min(25, widthMm * 0.6)
    onAddElement({
      id: genId(), type: 'text', x: centerX(w), y: 1,
      width: w, height: 5, rotation: 0, zIndex: 10,
      dataField: 'item.name', fontSize: 8, fontWeight: 'bold',
      textAlign: 'center', maxLines: 2,
    })
  }

  function addImage() {
    const s = Math.min(10, widthMm * 0.3, heightMm * 0.3)
    onAddElement({
      id: genId(), type: 'image', x: centerX(s), y: centerY(s),
      width: s, height: s, rotation: 0, zIndex: 5,
      source: 'logo',
    })
  }

  function addLine() {
    const w = widthMm * 0.8
    onAddElement({
      id: genId(), type: 'shape', x: centerX(w), y: heightMm / 2,
      width: w, height: 1, rotation: 0, zIndex: 5,
      shape: 'line', borderWidth: 1, borderColor: '#000000', borderStyle: 'solid',
    })
  }

  function addRect() {
    const w = Math.min(20, widthMm * 0.5)
    const h = Math.min(10, heightMm * 0.4)
    onAddElement({
      id: genId(), type: 'shape', x: centerX(w), y: centerY(h),
      width: w, height: h, rotation: 0, zIndex: 2,
      shape: 'rectangle', borderWidth: 1, borderColor: '#000000', borderStyle: 'solid',
    })
  }

  function addRoundedRect() {
    const w = Math.min(20, widthMm * 0.5)
    const h = Math.min(10, heightMm * 0.4)
    onAddElement({
      id: genId(), type: 'shape', x: centerX(w), y: centerY(h),
      width: w, height: h, rotation: 0, zIndex: 2,
      shape: 'rounded-rectangle', borderWidth: 1, borderColor: '#000000', borderStyle: 'solid',
      cornerRadius: 2,
    })
  }

  function addEllipse() {
    const s = Math.min(15, widthMm * 0.4, heightMm * 0.4)
    onAddElement({
      id: genId(), type: 'shape', x: centerX(s), y: centerY(s),
      width: s, height: s, rotation: 0, zIndex: 2,
      shape: 'ellipse', borderWidth: 1, borderColor: '#000000', borderStyle: 'solid',
    })
  }

  function handlePresetChange(preset: PresetLabelSize | null) {
    if (preset) {
      onWidthChange(preset.widthMm)
      onHeightChange(preset.heightMm)
      if (preset.shape) {
        onShapeChange(preset.shape)
        if (preset.cornerRadius !== undefined) onCornerRadiusChange(preset.cornerRadius)
      } else {
        onShapeChange('rectangle')
        onCornerRadiusChange(null)
      }
    }
  }

  const matchingPreset = PRESET_LABEL_SIZES.find(p => p.widthMm === widthMm && p.heightMm === heightMm)

  // Group presets by group name
  const groups = PRESET_LABEL_SIZES.reduce<Record<string, PresetLabelSize[]>>((acc, p) => {
    if (!acc[p.group]) acc[p.group] = []
    acc[p.group].push(p)
    return acc
  }, {})

  return (
    <div className="w-[200px] border-r bg-gray-50 p-3 flex flex-col gap-4 overflow-y-auto">
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Elements</h3>
        <div className="flex flex-col gap-1">
          <ToolButton icon={<Barcode size={16} />} label="Barcode" onClick={() => addBarcode('code128')} />
          <ToolButton icon={<QrCode size={16} />} label="QR Code" onClick={() => addBarcode('qrcode')} />
          <ToolButton icon={<Type size={16} />} label="Text" onClick={addText} />
          <ToolButton icon={<Image size={16} />} label="Image" onClick={addImage} />
          <ToolButton icon={<Minus size={16} />} label="Line" onClick={addLine} />
          <ToolButton icon={<Square size={16} />} label="Rectangle" onClick={addRect} />
          <ToolButton icon={<RectangleHorizontal size={16} />} label="Rounded Rect" onClick={addRoundedRect} />
          <ToolButton icon={<Circle size={16} />} label="Ellipse" onClick={addEllipse} />
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Label Size</h3>
        <select
          value={matchingPreset ? matchingPreset.name : 'custom'}
          onChange={(e) => {
            const preset = PRESET_LABEL_SIZES.find(p => p.name === e.target.value)
            handlePresetChange(preset || null)
          }}
          className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {Object.entries(groups).map(([group, presets]) => (
            <optgroup key={group} label={group}>
              {presets.map(p => (
                <option key={p.name} value={p.name}>{p.name}</option>
              ))}
            </optgroup>
          ))}
          <option value="custom">Custom</option>
        </select>
        <div className="flex gap-2 mt-2">
          <div>
            <label className="text-[10px] text-gray-500">W (mm)</label>
            <input
              type="number"
              value={widthMm}
              onChange={(e) => onWidthChange(Math.max(10, Math.min(300, Number(e.target.value))))}
              className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              min={10}
              max={300}
            />
          </div>
          <div>
            <label className="text-[10px] text-gray-500">H (mm)</label>
            <input
              type="number"
              value={heightMm}
              onChange={(e) => onHeightChange(Math.max(10, Math.min(300, Number(e.target.value))))}
              className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              min={10}
              max={300}
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Label Shape</h3>
        <select
          value={labelShape}
          onChange={(e) => {
            const shape = e.target.value as LabelShape
            onShapeChange(shape)
            if (shape === 'circle') {
              // Force equal width/height for circle
              const size = Math.min(widthMm, heightMm)
              onWidthChange(size)
              onHeightChange(size)
            }
          }}
          className="w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="rectangle">Rectangle</option>
          <option value="rounded-rectangle">Rounded Rectangle</option>
          <option value="circle">Circle</option>
          <option value="oval">Oval</option>
        </select>
        {labelShape === 'rounded-rectangle' && (
          <div className="mt-2">
            <label className="text-[10px] text-gray-500">Corner Radius (mm)</label>
            <input
              type="number"
              value={cornerRadius ?? 5}
              onChange={(e) => onCornerRadiusChange(Math.max(1, Math.min(50, Number(e.target.value))))}
              className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              min={1}
              max={50}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ToolButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-700 bg-white border rounded hover:bg-blue-50 hover:border-blue-300 transition-colors w-full text-left"
    >
      {icon}
      {label}
    </button>
  )
}
