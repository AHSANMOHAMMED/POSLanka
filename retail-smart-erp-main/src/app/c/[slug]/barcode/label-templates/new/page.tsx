'use client'

import { use, useState } from 'react'
import { LabelDesigner } from '@/components/labels/LabelDesigner'
import { TemplatePresetPicker } from '@/components/labels/TemplatePresetPicker'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import type { LabelPreset } from '@/lib/labels/presets'
import type { LabelShape } from '@/lib/labels/types'

export default function NewBarcodeLabelTemplatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params)
  const company = useCompanyOptional()
  const [preset, setPreset] = useState<LabelPreset | null | undefined>(undefined) // undefined = choosing, null = blank

  if (preset === undefined) {
    return (
      <TemplatePresetPicker
        businessType={company?.businessType}
        onSelect={(p) => setPreset(p)}
        onSkip={() => setPreset(null)}
      />
    )
  }

  const initialData = preset ? {
    name: preset.name,
    description: preset.description,
    widthMm: preset.widthMm,
    heightMm: preset.heightMm,
    labelShape: preset.labelShape as LabelShape,
    cornerRadius: preset.cornerRadius ?? null,
    elements: preset.elements.map(el => ({ ...el, id: `el-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` })),
  } : undefined

  return <LabelDesigner tenantSlug={slug} presetData={initialData} />
}
