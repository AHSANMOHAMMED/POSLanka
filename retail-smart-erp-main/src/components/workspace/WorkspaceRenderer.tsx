'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { RefreshCw, Settings2, Loader2 } from 'lucide-react'
import { useRealtimeData, useModuleAccess } from '@/hooks'
import { useCompanyOptional } from '@/components/providers/CompanyContextProvider'
import type { WorkspaceConfig, WorkspaceBlock, MetricValues } from '@/lib/workspace/types'
import { stripBasePathFromBlocks, toRelativeHref } from '@/lib/workspace/shortcut-catalog'
import { HeadingBlock } from './blocks/HeadingBlock'
import { ParagraphBlock } from './blocks/ParagraphBlock'
import { NumberCardBlock } from './blocks/NumberCardBlock'
import { ShortcutBlock } from './blocks/ShortcutBlock'
import { ChartBlock } from './blocks/ChartBlock'
import { QuickListBlock } from './blocks/QuickListBlock'
import { CardBlock } from './blocks/CardBlock'
import { SpacerBlock } from './blocks/SpacerBlock'
import { WorkspaceCustomizer } from './WorkspaceCustomizer'
import { ShortcutPickerModal } from './ShortcutPickerModal'


interface WorkspaceRendererProps {
  workspaceKey: string
  /** For settings page: renders custom content for settings_content blocks */
  renderSettingsContent?: (section: string) => React.ReactNode
}

export function WorkspaceRenderer({ workspaceKey, renderSettingsContent }: WorkspaceRendererProps) {
  const params = useParams()
  const slug = params.slug as string
  const basePath = `/c/${slug}`

  const [config, setConfig] = useState<WorkspaceConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<MetricValues>({})
  const [metricsLoading, setMetricsLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // Shortcut picker state
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerBlockId, setPickerBlockId] = useState<string | null>(null)

  // Business context for shortcut picker
  const { data: session } = useSession()
  const company = useCompanyOptional()
  const businessType = company?.businessType || session?.user?.businessType
  const role = session?.user?.role
  const { isModuleEnabled } = useModuleAccess()

  // Fetch workspace config
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceKey}`)
      if (res.ok) {
        const data = await res.json()
        setConfig(data.config)
      } else {
        console.error(`Failed to fetch workspace config (${res.status})`)
      }
    } catch (error) {
      console.error('Failed to fetch workspace config:', error)
    } finally {
      setLoading(false)
    }
  }, [workspaceKey])

  // Collect all metric keys from blocks
  const metricKeys = useMemo(() => {
    if (!config) return []
    const keys = new Set<string>()
    for (const block of config.blocks) {
      if (block.type === 'number_card') {
        keys.add(block.data.metricKey)
      }
      if (block.type === 'shortcut') {
        for (const s of block.data.shortcuts) {
          if (s.countMetricKey) keys.add(s.countMetricKey)
        }
      }
    }
    return Array.from(keys)
  }, [config])

  // Fetch metrics in batch
  const fetchMetrics = useCallback(async () => {
    if (metricKeys.length === 0) {
      setMetricsLoading(false)
      return
    }
    try {
      const res = await fetch(`/api/workspace/number-card?keys=${metricKeys.join(',')}`)
      if (res.ok) {
        const data = await res.json()
        setMetrics(data)
      } else {
        console.error(`Failed to fetch metrics (${res.status})`)
      }
    } catch (error) {
      console.error('Failed to fetch metrics:', error)
    } finally {
      setMetricsLoading(false)
    }
  }, [metricKeys])

  // Initial load
  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  // Fetch metrics when config loads
  useEffect(() => {
    if (config && metricKeys.length > 0) {
      fetchMetrics()
    }
  }, [config, metricKeys, fetchMetrics])

  // Real-time updates for metrics + all blocks
  const refreshAll = useCallback(async () => {
    setMetricsLoading(true)
    setRefreshKey(k => k + 1)
    await fetchMetrics()
  }, [fetchMetrics])

  useRealtimeData(refreshAll, {
    entityType: ['sale', 'work-order', 'item', 'appointment', 'estimate', 'customer', 'purchase-order', 'warehouse', 'warehouse-stock', 'supplier', 'vehicle'],
    enabled: !editMode,
  })

  // Manual refresh
  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setMetricsLoading(true)
    setRefreshKey(k => k + 1)
    await Promise.all([fetchConfig(), fetchMetrics()])
    setRefreshing(false)
  }, [fetchConfig, fetchMetrics])

  // Save customization (strips basePath from hrefs before persisting)
  const handleSave = useCallback(async (blocks: WorkspaceBlock[]) => {
    try {
      // Normalize: strip basePath from all hrefs before saving to DB
      const normalizedBlocks = stripBasePathFromBlocks(blocks, basePath)

      const res = await fetch(`/api/workspace/${workspaceKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: normalizedBlocks }),
      })
      if (res.ok) {
        const data = await res.json()
        setConfig(data.config)
        setEditMode(false)
        // Re-fetch metrics for new blocks
        setMetricsLoading(true)
        await fetchMetrics()
      } else {
        const errorBody = await res.json().catch(() => ({}))
        console.error(`Failed to save workspace (${res.status}):`, errorBody.error || '')
      }
    } catch (error) {
      console.error('Failed to save workspace:', error)
    }
  }, [workspaceKey, basePath, fetchMetrics])

  // Reset to default
  const handleReset = useCallback(async () => {
    try {
      await fetch(`/api/workspace/${workspaceKey}`, { method: 'DELETE' })
      await fetchConfig()
      setMetricsLoading(true)
      await fetchMetrics()
    } catch (error) {
      console.error('Failed to reset workspace:', error)
    }
  }, [workspaceKey, fetchConfig, fetchMetrics])

  // Open shortcut picker for a specific shortcut block
  const handleOpenPicker = useCallback((blockId: string) => {
    setPickerBlockId(blockId)
    setPickerOpen(true)
  }, [])

  // Save shortcuts from picker
  const handlePickerSave = useCallback(async (newShortcuts: Array<{ label: string; href: string; icon: string; color?: string; countMetricKey?: string }>) => {
    if (!config || !pickerBlockId) return

    // Update the target shortcut block with new shortcuts
    const updatedBlocks = config.blocks.map((block) => {
      if (block.id === pickerBlockId && block.type === 'shortcut') {
        return {
          ...block,
          data: { ...block.data, shortcuts: newShortcuts },
        } as typeof block
      }
      return block
    })

    await handleSave(updatedBlocks)
    setPickerOpen(false)
    setPickerBlockId(null)
  }, [config, pickerBlockId, handleSave])

  // Get current shortcuts for the picker (normalized to relative hrefs)
  const pickerCurrentShortcuts = useMemo(() => {
    if (!config || !pickerBlockId) return []
    const block = config.blocks.find((b) => b.id === pickerBlockId)
    if (!block || block.type !== 'shortcut') return []
    return block.data.shortcuts.map((s) => ({
      ...s,
      href: toRelativeHref(s.href),
    }))
  }, [config, pickerBlockId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!config) {
    return (
      <div className="text-center py-24 text-gray-500">
        Workspace not found
      </div>
    )
  }

  if (editMode) {
    return (
      <WorkspaceCustomizer
        config={config}
        onSave={handleSave}
        onCancel={() => setEditMode(false)}
        onReset={handleReset}
        metrics={metrics}
        metricsLoading={metricsLoading}
        basePath={basePath}
        colorScheme={config.colorScheme}
        renderSettingsContent={renderSettingsContent}
      />
    )
  }

  return (
    <div className="space-y-3">
      {/* Compact Module Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">{String(config.title || '')}</h1>
          <span className="text-sm text-gray-400 dark:text-gray-500 hidden sm:inline">{String(config.description || '')}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => setEditMode(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Customize
          </button>
        </div>
      </div>

      {/* Blocks Grid */}
      <div className="grid grid-cols-12 gap-3">
        {config.blocks.map((block) => {
          // For settings_content blocks, pre-check if the section renders content
          if (block.type === 'settings_content') {
            if (!renderSettingsContent) return null
            const content = renderSettingsContent(block.data.section)
            if (!content) return null
            return (
              <div key={block.id} className={`col-span-12 ${getColSpanClass(block.colSpan)} flex`}>
                {content}
              </div>
            )
          }

          return (
            <div key={block.id} className={`col-span-12 ${getColSpanClass(block.colSpan)} flex`}>
              <BlockRenderer
                block={block}
                metrics={metrics}
                metricsLoading={metricsLoading}
                colorScheme={config.colorScheme}
                basePath={basePath}
                renderSettingsContent={renderSettingsContent}
                onAddShortcut={handleOpenPicker}
                refreshKey={refreshKey}
              />
            </div>
          )
        })}
      </div>

      {/* Shortcut Picker Modal */}
      {pickerOpen && pickerBlockId && (
        <ShortcutPickerModal
          isOpen={pickerOpen}
          onClose={() => { setPickerOpen(false); setPickerBlockId(null) }}
          onSave={handlePickerSave}
          currentShortcuts={pickerCurrentShortcuts}
          businessType={businessType}
          role={role}
          isModuleEnabled={isModuleEnabled}
        />
      )}
    </div>
  )
}

function getColSpanClass(colSpan?: number): string {
  if (!colSpan || colSpan === 12) return ''
  const classes: Record<number, string> = {
    1: 'sm:col-span-1',
    2: 'sm:col-span-2',
    3: 'sm:col-span-3',
    4: 'sm:col-span-4',
    5: 'sm:col-span-5',
    6: 'sm:col-span-6',
    7: 'sm:col-span-7',
    8: 'sm:col-span-8',
    9: 'sm:col-span-9',
    10: 'sm:col-span-10',
    11: 'sm:col-span-11',
  }
  return classes[colSpan] || ''
}

interface BlockRendererProps {
  block: WorkspaceBlock
  metrics: MetricValues
  metricsLoading: boolean
  colorScheme: string
  basePath: string
  renderSettingsContent?: (section: string) => React.ReactNode
  onAddShortcut?: (blockId: string) => void
  refreshKey: number
}

function BlockRenderer({ block, metrics, metricsLoading, colorScheme, basePath, renderSettingsContent, onAddShortcut, refreshKey }: BlockRendererProps) {
  switch (block.type) {
    case 'heading':
      return <HeadingBlock block={block} />
    case 'paragraph':
      return <ParagraphBlock block={block} />
    case 'number_card':
      return <NumberCardBlock block={block} metrics={metrics} loading={metricsLoading} />
    case 'shortcut':
      return (
        <ShortcutBlock
          block={block}
          metrics={metrics}
          colorScheme={colorScheme}
          onAddShortcut={onAddShortcut ? () => onAddShortcut(block.id) : undefined}
        />
      )
    case 'chart':
      return <ChartBlock block={block} refreshKey={refreshKey} />
    case 'quick_list':
      return <QuickListBlock block={block} basePath={basePath} refreshKey={refreshKey} />
    case 'card':
      return <CardBlock block={block} />
    case 'spacer':
      return <SpacerBlock block={block} />
    case 'settings_content':
      if (renderSettingsContent) {
        return <>{renderSettingsContent(block.data.section)}</>
      }
      return null
    default:
      return null
  }
}
