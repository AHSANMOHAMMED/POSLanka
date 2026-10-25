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
    columns: preset.columns,
    labelShape: preset.labelShape as LabelShape,
    cornerRadius: preset.cornerRadius ?? null,
    // Deterministic ids (pure during render); the designer re-keys elements on edit
    elements: preset.elements.map((el, index) => ({ ...el, id: `el-${preset.name.replace(/\W+/g, '-').toLowerCase()}-${index}` })),
  } : undefined

  return <LabelDesigner tenantSlug={slug} presetData={initialData} />
}
