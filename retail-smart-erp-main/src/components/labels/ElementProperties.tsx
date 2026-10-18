'use client'

import { Trash2, Copy } from 'lucide-react'
import type { LabelElement, BarcodeFormat } from '@/lib/labels/types'
import { BARCODE_FORMATS, DYNAMIC_FIELDS } from '@/lib/labels/types'

interface ElementPropertiesProps {
  element: LabelElement | null
  onChange: (updated: LabelElement) => void
  onDelete: () => void
  onDuplicate: () => void
  codeWord?: string
}

export function ElementProperties({ element, onChange, onDelete, onDuplicate, codeWord }: ElementPropertiesProps) {
  if (!element) {
    return (
      <div className="w-[280px] border-l bg-gray-50 p-4 flex items-center justify-center">
        <p className="text-sm text-gray-400">Select an element to edit its properties</p>
      </div>
    )
  }

  function update(partial: Partial<LabelElement>) {
    onChange({ ...element!, ...partial } as LabelElement)
  }

  return (
    <div className="w-[280px] border-l bg-gray-50 p-3 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">
          {element.type === 'barcode' ? 'Barcode' :
           element.type === 'text' ? 'Text' :
           element.type === 'image' ? 'Image' : 'Shape'}
        </h3>
        <div className="flex gap-1">
          <button onClick={onDuplicate} className="p-1 text-gray-500 hover:text-blue-600 rounded" title="Duplicate">
            <Copy size={14} />
          </button>
          <button onClick={onDelete} className="p-1 text-gray-500 hover:text-red-600 rounded" title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Position & Size */}
      <Section title="Position">
        <div className="grid grid-cols-2 gap-2">
          <NumField label="X (mm)" value={element.x} onChange={(v) => update({ x: v })} min={0} step={0.5} />
          <NumField label="Y (mm)" value={element.y} onChange={(v) => update({ y: v })} min={0} step={0.5} />
          <NumField label="W (mm)" value={element.width} onChange={(v) => update({ width: v })} min={1} step={0.5} />
          <NumField label="H (mm)" value={element.height} onChange={(v) => update({ height: v })} min={1} step={0.5} />
        </div>
        <NumField label="Rotation" value={element.rotation} onChange={(v) => update({ rotation: v })} min={-360} max={360} />
        <NumField label="Z-Index" value={element.zIndex} onChange={(v) => update({ zIndex: v })} min={0} max={200} />
      </Section>

      {/* Type-specific properties */}
      {element.type === 'barcode' && (
        <Section title="Barcode">
          <SelectField label="Format" value={element.format} options={BARCODE_FORMATS.map(f => ({ value: f.value, label: f.label }))} onChange={(v) => update({ format: v as BarcodeFormat })} />
          <SelectField label="Data Field" value={element.dataField} options={DYNAMIC_FIELDS.map(f => ({ value: f.value, label: `${f.group}: ${f.label}` }))} onChange={(v) => update({ dataField: v as LabelElement['type'] extends 'barcode' ? typeof element.dataField : never })} />
          {element.dataField === 'custom' && (
            <TextField label="Custom Value" value={element.customValue || ''} onChange={(v) => update({ customValue: v })} />
          )}
          <CheckboxField label="Show text below" checked={element.showText} onChange={(v) => update({ showText: v })} />
          <NumField label="Bar Width" value={element.barWidth} onChange={(v) => update({ barWidth: v })} min={1} max={4} />
        </Section>
      )}

      {element.type === 'text' && (
        <Section title="Text">
          <SelectField label="Data Field" value={element.dataField} options={DYNAMIC_FIELDS.map(f => ({ value: f.value, label: `${f.group}: ${f.label}` }))} onChange={(v) => update({ dataField: v as typeof element.dataField })} />
          {element.dataField === 'custom' && (
            <TextField label="Custom Text" value={element.customValue || ''} onChange={(v) => update({ customValue: v })} />
          )}
          <NumField label={element.autoFit ? 'Max Font Size (pt)' : 'Font Size (pt)'} value={element.fontSize} onChange={(v) => update({ fontSize: v })} min={4} max={72} />
          <CheckboxField label="Auto-fit text" checked={element.autoFit || false} onChange={(v) => update({ autoFit: v })} />
          <SelectField label="Weight" value={element.fontWeight} options={[{ value: 'normal', label: 'Normal' }, { value: 'bold', label: 'Bold' }]} onChange={(v) => update({ fontWeight: v as 'normal' | 'bold' })} />
          <SelectField label="Align" value={element.textAlign} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} onChange={(v) => update({ textAlign: v as 'left' | 'center' | 'right' })} />
          <TextField label="Prefix" value={element.prefix || ''} onChange={(v) => update({ prefix: v })} placeholder="e.g. $" />
          <TextField label="Suffix" value={element.suffix || ''} onChange={(v) => update({ suffix: v })} />
          <NumField label="Max Lines" value={element.maxLines} onChange={(v) => update({ maxLines: v })} min={1} max={10} />
          <CheckboxField label="Format as currency" checked={element.isCurrency || false} onChange={(v) => update({ isCurrency: v })} />
          {(element.dataField === 'item.priceCode' || element.dataField === 'item.discountCode') && (
            codeWord?.length === 10 ? (
              <p className="text-[10px] text-green-600 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full" />
                Code Word configured in Settings
              </p>
            ) : (
              <div className="p-2 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-700">
                Code Word not configured. Set it up in{' '}
                <span className="font-medium">Barcode &amp; Labels &rarr; Label Settings</span>
              </div>
            )
          )}
        </Section>
      )}

      {element.type === 'image' && (
        <Section title="Image">
          <SelectField label="Source" value={element.source} options={[{ value: 'logo', label: 'Company Logo' }, { value: 'item-image', label: 'Item Image' }, { value: 'custom', label: 'Custom URL' }]} onChange={(v) => update({ source: v as 'logo' | 'item-image' | 'custom' })} />
          {element.source === 'custom' && (
            <TextField label="Image URL" value={element.customUrl || ''} onChange={(v) => update({ customUrl: v })} placeholder="https://..." />
          )}
        </Section>
      )}

      {element.type === 'shape' && (
        <Section title="Shape">
          <SelectField label="Shape" value={element.shape} options={[
            { value: 'line', label: 'Line' },
            { value: 'rectangle', label: 'Rectangle' },
            { value: 'rounded-rectangle', label: 'Rounded Rectangle' },
            { value: 'ellipse', label: 'Ellipse' },
          ]} onChange={(v) => update({ shape: v as 'line' | 'rectangle' | 'rounded-rectangle' | 'ellipse' })} />
          <NumField label="Border Width" value={element.borderWidth} onChange={(v) => update({ borderWidth: v })} min={0} max={10} />
          <ColorField label="Border Color" value={element.borderColor} onChange={(v) => update({ borderColor: v })} />
          <SelectField label="Border Style" value={element.borderStyle} options={[{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }]} onChange={(v) => update({ borderStyle: v as 'solid' | 'dashed' | 'dotted' })} />
          {element.shape === 'rounded-rectangle' && (
            <NumField label="Corner Radius (mm)" value={element.cornerRadius || 0} onChange={(v) => update({ cornerRadius: v })} min={0} max={50} step={0.5} />
          )}
          {element.shape !== 'line' && (
            <ColorField label="Fill Color" value={element.fillColor || ''} onChange={(v) => update({ fillColor: v || undefined })} />
          )}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h4 className="text-[10px] font-semibold text-gray-400 uppercase mb-2">{title}</h4>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function NumField({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number
}) {
  return (
    <div>
      <label className="text-[10px] text-gray-500">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min} max={max} step={step}
        className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  )
}

function TextField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div>
      <label className="text-[10px] text-gray-500">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  )
}

function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-[10px] text-gray-500">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function CheckboxField({ label, checked, onChange }: {
  label: string; checked: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="rounded" />
      {label}
    </label>
  )
}

function ColorField({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-[10px] text-gray-500">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 p-0 border rounded cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="flex-1 px-2 py-1 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    </div>
  )
}

