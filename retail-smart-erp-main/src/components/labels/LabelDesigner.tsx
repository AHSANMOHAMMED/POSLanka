'use client'

import { useState, useCallback, useEffect } from 'react'
import { Save, ZoomIn, ZoomOut, Grid3x3, Eye, Undo2 } from 'lucide-react'
import type { LabelElement, LabelTemplate, LabelShape } from '@/lib/labels/types'
import { ElementToolbox } from './ElementToolbox'
import { LabelCanvas } from './LabelCanvas'
import { ElementProperties } from './ElementProperties'
import { LabelPreview } from './LabelPreview'
import { useUnsavedChangesWarning } from '@/hooks'
import { toast } from '@/components/ui/toast'

interface PresetData {
  name: string
  description: string
  widthMm: number
  heightMm: number
  labelShape: LabelShape
  cornerRadius: number | null
  elements: LabelElement[]
}

interface LabelDesignerProps {
  templateId?: string
  initialData?: LabelTemplate
  presetData?: PresetData
  tenantSlug: string
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.5, 2, 3]

export function LabelDesigner({ templateId, initialData, presetData, tenantSlug }: LabelDesignerProps) {
  const src = presetData || initialData
  const [name, setName] = useState(src?.name || 'New Label Template')
  const [description, setDescription] = useState(src?.description || '')
  const [widthMm, setWidthMm] = useState(src ? Number(src.widthMm) : 50)
  const [heightMm, setHeightMm] = useState(src ? Number(src.heightMm) : 25)
  const [labelShape, setLabelShape] = useState<LabelShape>((src?.labelShape as LabelShape) || 'rectangle')
  const [cornerRadius, setCornerRadius] = useState<number | null>(src?.cornerRadius ?? null)
  const [elements, setElements] = useState<LabelElement[]>(src?.elements || [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [showGrid, setShowGrid] = useState(true)
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [history, setHistory] = useState<LabelElement[][]>([])
  const [codeWord, setCodeWord] = useState<string>('')

  useUnsavedChangesWarning(isDirty)

  // Fetch code word from tenant label settings
  useEffect(() => {
    fetch('/api/label-settings')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json() })
      .then(data => setCodeWord(data.codeWord || ''))
      .catch(() => {})
  }, [])

  const selectedElement = elements.find(el => el.id === selectedId) || null

  function pushHistory() {
    setHistory(prev => [...prev.slice(-20), elements.map(el => ({ ...el }))])
  }

  function undo() {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory(h => h.slice(0, -1))
    setElements(prev)
    setIsDirty(true)
  }

  const handleAddElement = useCallback((element: LabelElement) => {
    pushHistory()
    setElements(prev => [...prev, element])
    setSelectedId(element.id)
    setIsDirty(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements])

  const handleUpdateElement = useCallback((id: string, updates: Partial<LabelElement>) => {
    setElements(prev => prev.map(el => el.id === id ? { ...el, ...updates } as LabelElement : el))
    setIsDirty(true)
  }, [])

  const handleChangeElement = useCallback((updated: LabelElement) => {
    pushHistory()
    setElements(prev => prev.map(el => el.id === updated.id ? updated : el))
    setIsDirty(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements])

  const handleDeleteElement = useCallback(() => {
    if (!selectedId) return
    pushHistory()
    setElements(prev => prev.filter(el => el.id !== selectedId))
    setSelectedId(null)
    setIsDirty(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, elements])

  const handleDuplicateElement = useCallback(() => {
    if (!selectedId) return
    const el = elements.find(e => e.id === selectedId)
    if (!el) return
    pushHistory()
    const newEl = { ...el, id: `el-${Date.now()}-dup`, x: el.x + 2, y: el.y + 2 }
    setElements(prev => [...prev, newEl])
    setSelectedId(newEl.id)
    setIsDirty(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, elements])

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        handleDeleteElement()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault()
        handleDuplicateElement()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        undo()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleDeleteElement, handleDuplicateElement])

  async function handleSave() {
    setSaving(true)
    try {
      const body = {
        name,
        description: description || undefined,
        widthMm,
        heightMm,
        labelShape,
        cornerRadius: labelShape === 'rounded-rectangle' ? cornerRadius : undefined,
        elements,
      }

      const url = templateId ? `/api/label-templates/${templateId}` : '/api/label-templates'
      const method = templateId ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        const data = await res.json()
        toast.success('Template saved successfully')
        setIsDirty(false)

        // If creating new, redirect to edit page
        if (!templateId && data.id) {
          window.location.href = `/c/${tenantSlug}/settings/label-templates/${data.id}`
        }
      } else {
        const err = await res.json().catch(() => null)
        toast.error(err?.error || 'Failed to save template')
      }
    } catch {
      toast.error('Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  const zoomIndex = ZOOM_LEVELS.indexOf(zoom)

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-white">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setIsDirty(true) }}
            className="text-lg font-semibold border-none focus:outline-none focus:ring-0 bg-transparent w-64"
            placeholder="Template name"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => { setDescription(e.target.value); setIsDirty(true) }}
            className="text-sm text-gray-500 border-none focus:outline-none focus:ring-0 bg-transparent w-48"
            placeholder="Description (optional)"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={undo}
            disabled={history.length === 0}
            className="p-1.5 text-gray-500 hover:text-gray-700 disabled:opacity-30 rounded"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={16} />
          </button>
          <div className="flex items-center gap-1 border rounded px-1">
            <button
              onClick={() => { if (zoomIndex > 0) setZoom(ZOOM_LEVELS[zoomIndex - 1]) }}
              disabled={zoomIndex <= 0}
              className="p-1 text-gray-500 hover:text-gray-700 disabled:opacity-30"
            >
              <ZoomOut size={14} />
            </button>
            <span className="text-xs text-gray-600 w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => { if (zoomIndex < ZOOM_LEVELS.length - 1) setZoom(ZOOM_LEVELS[zoomIndex + 1]) }}
              disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
              className="p-1 text-gray-500 hover:text-gray-700 disabled:opacity-30"
            >
              <ZoomIn size={14} />
            </button>
          </div>
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`p-1.5 rounded ${showGrid ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}`}
            title="Toggle grid"
          >
            <Grid3x3 size={16} />
          </button>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`p-1.5 rounded ${showPreview ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:text-gray-700'}`}
            title="Toggle preview"
          >
            <Eye size={16} />
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <ElementToolbox
          widthMm={widthMm}
          heightMm={heightMm}
          labelShape={labelShape}
          cornerRadius={cornerRadius}
          onWidthChange={(w) => { setWidthMm(w); setIsDirty(true) }}
          onHeightChange={(h) => { setHeightMm(h); setIsDirty(true) }}
          onShapeChange={(s) => { setLabelShape(s); setIsDirty(true) }}
          onCornerRadiusChange={(r) => { setCornerRadius(r); setIsDirty(true) }}
          onAddElement={handleAddElement}
        />

        <div className="flex-1 flex flex-col overflow-hidden">
          <LabelCanvas
            widthMm={widthMm}
            heightMm={heightMm}
            labelShape={labelShape}
            cornerRadius={cornerRadius}
            elements={elements}
            selectedId={selectedId}
            zoom={zoom}
            showGrid={showGrid}
            onSelectElement={setSelectedId}
            onUpdateElement={handleUpdateElement}
            codeWord={codeWord}
          />

          {/* Preview panel */}
          {showPreview && (
            <div className="border-t p-4 bg-gray-50">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Preview (sample data)</h4>
              <LabelPreview
                template={{ widthMm, heightMm, elements, labelShape, cornerRadius }}
                codeWord={codeWord}
                maxWidth={400}
              />
            </div>
          )}
        </div>

        <ElementProperties
          element={selectedElement}
          onChange={handleChangeElement}
          onDelete={handleDeleteElement}
          onDuplicate={handleDuplicateElement}
          codeWord={codeWord}
        />
      </div>
    </div>
  )
}
