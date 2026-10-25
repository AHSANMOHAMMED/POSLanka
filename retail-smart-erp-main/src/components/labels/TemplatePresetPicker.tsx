'use client'

import { useState } from 'react'
import { Layout, Tag, ShoppingCart, UtensilsCrossed, Car, Circle } from 'lucide-react'
import { LABEL_PRESETS, type LabelPreset } from '@/lib/labels/presets'
import { LabelPreview } from './LabelPreview'
import { StickerRollPreview } from './StickerRollPreview'
import { STICKER_PRESETS, setupFromPreset } from '@/lib/labels/sticker-stock'

interface TemplatePresetPickerProps {
  businessType?: string
  onSelect: (preset: LabelPreset) => void
  onSkip: () => void
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  retail: <Tag size={14} />,
  supermarket: <ShoppingCart size={14} />,
  restaurant: <UtensilsCrossed size={14} />,
  auto_service: <Car size={14} />,
  dealership: <Car size={14} />,
  special: <Circle size={14} />,
}

export function TemplatePresetPicker({ businessType, onSelect, onSkip }: TemplatePresetPickerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Filter presets by business type, show all if none specified
  const relevantPresets = businessType
    ? LABEL_PRESETS.filter(p => p.businessTypes.includes(businessType) || p.businessTypes.includes('all'))
    : LABEL_PRESETS

  const selectedPreset = relevantPresets.find(p => p.id === selectedId)

  // Group presets by their primary business type
  const grouped = relevantPresets.reduce<Record<string, LabelPreset[]>>((acc, p) => {
    const key = p.businessTypes[0] === 'all' ? 'universal' : p.businessTypes[0]
    if (!acc[key]) acc[key] = []
    acc[key].push(p)
    return acc
  }, {})

  const groupLabels: Record<string, string> = {
    universal: 'Universal',
    retail: 'Retail',
    supermarket: 'Supermarket',
    restaurant: 'Restaurant',
    auto_service: 'Auto Service',
    dealership: 'Dealership',
  }

  return (
    <div className="max-w-3xl mx-auto py-8">
      <div className="text-center mb-6">
        <h2 className="text-xl font-semibold text-gray-900">Start from a Preset</h2>
        <p className="text-sm text-gray-500 mt-1">Choose a pre-configured label template or start blank</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {Object.entries(grouped).map(([group, presets]) => (
          <div key={group}>
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase mb-2 px-1">
              {CATEGORY_ICONS[group] || <Layout size={14} />}
              {groupLabels[group] || group}
            </div>
            {presets.map(preset => (
              <button
                key={preset.id}
                onClick={() => setSelectedId(preset.id === selectedId ? null : preset.id)}
                className={`w-full text-left p-3 rounded border mb-2 transition-colors ${
                  selectedId === preset.id
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="font-medium text-sm text-gray-900">{preset.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">{preset.description}</div>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Preview of selected preset */}
      {selectedPreset && (
        <div className="border rounded-lg p-4 bg-gray-50 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-700">Preview: {selectedPreset.name}</h4>
            {(selectedPreset.columns ?? 1) > 1 && (
              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                {selectedPreset.columns} stickers per line (Twin-sticker roll)
              </span>
            )}
          </div>
          <div className="flex justify-center">
            {(selectedPreset.columns ?? 1) > 1 ? (
              <StickerRollPreview
                setup={{
                  id: 'preset-preview',
                  name: selectedPreset.name,
                  labelWidthMm: selectedPreset.widthMm,
                  labelHeightMm: selectedPreset.heightMm,
                  columns: selectedPreset.columns ?? 2,
                  columnGapMm: 2,
                  rowGapMm: 2,
                  marginLeftMm: 1,
                  offsetXMm: 0,
                  offsetYMm: 0,
                  dpi: 203,
                  language: null,
                  darkness: null,
                  speed: null,
                  direction: 1,
                  warehouseId: null,
                  locked: false,
                  isDefault: false,
                }}
                template={{
                  widthMm: selectedPreset.widthMm,
                  heightMm: selectedPreset.heightMm,
                  elements: selectedPreset.elements,
                  labelShape: selectedPreset.labelShape,
                  cornerRadius: selectedPreset.cornerRadius,
                }}
                items={[]}
                showGuides={false}
              />
            ) : (
              <LabelPreview
                template={{
                  widthMm: selectedPreset.widthMm,
                  heightMm: selectedPreset.heightMm,
                  elements: selectedPreset.elements,
                  labelShape: selectedPreset.labelShape,
                  cornerRadius: selectedPreset.cornerRadius,
                }}
                maxWidth={350}
              />
            )}
          </div>
        </div>
      )}

      <div className="flex justify-center gap-3">
        <button
          onClick={onSkip}
          className="px-4 py-2 text-sm text-gray-700 bg-white border rounded hover:bg-gray-50"
        >
          Start Blank
        </button>
        <button
          onClick={() => selectedPreset && onSelect(selectedPreset)}
          disabled={!selectedPreset}
          className="px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          Use This Preset
        </button>
      </div>
    </div>
  )
}
