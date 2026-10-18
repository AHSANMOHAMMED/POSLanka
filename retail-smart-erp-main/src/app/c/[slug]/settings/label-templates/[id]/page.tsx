'use client'

import { use, useState, useEffect } from 'react'
import { LabelDesigner } from '@/components/labels/LabelDesigner'
import { PageLoading } from '@/components/ui/loading-spinner'
import type { LabelTemplate } from '@/lib/labels/types'

export default function EditLabelTemplatePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = use(params)
  const [template, setTemplate] = useState<LabelTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/label-templates/${id}`)
        if (res.ok) {
          const data = await res.json()
          setTemplate(data)
        } else {
          setError('Template not found')
        }
      } catch {
        setError('Failed to load template')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) return <PageLoading text="Loading template..." />

  if (error || !template) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">{error || 'Template not found'}</p>
      </div>
    )
  }

  return <LabelDesigner templateId={id} initialData={template} tenantSlug={slug} />
}
