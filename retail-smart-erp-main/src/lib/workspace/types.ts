// Workspace block type system
// Based on ERPNext's block-based workspace model

export type WorkspaceBlockType =
  | 'heading'
  | 'paragraph'
  | 'number_card'
  | 'shortcut'
  | 'chart'
  | 'quick_list'
  | 'card'
  | 'spacer'
  | 'settings_content'

export interface BaseBlock {
  id: string
  type: WorkspaceBlockType
  colSpan?: number // 1-12, default 12 (full width)
}

export interface HeadingBlock extends BaseBlock {
  type: 'heading'
  data: { text: string; level: 2 | 3 | 4 }
}

export interface ParagraphBlock extends BaseBlock {
  type: 'paragraph'
  data: { text: string }
}

export interface NumberCardBlock extends BaseBlock {
  type: 'number_card'
  data: {
    label: string
    metricKey: string
    color: string
    href: string
    icon: string
    prefix?: string
  }
}

export interface ShortcutBlock extends BaseBlock {
  type: 'shortcut'
  data: {
    shortcuts: Array<{
      label: string
      href: string
      icon: string
      color?: string
      countMetricKey?: string
    }>
  }
}

export interface ChartBlock extends BaseBlock {
  type: 'chart'
  data: {
    title: string
    chartKey: string
    chartType: 'bar' | 'line' | 'pie' | 'doughnut'
    color?: string
    height?: number
  }
}

export interface QuickListBlock extends BaseBlock {
  type: 'quick_list'
  data: {
    title: string
    listKey: string
    limit?: number
    href: string
  }
}

export interface CardBlock extends BaseBlock {
  type: 'card'
  data: {
    title: string
    links: Array<{
      label: string
      href: string
      description?: string
    }>
  }
}

export interface SpacerBlock extends BaseBlock {
  type: 'spacer'
  data: { height?: number }
}

export interface SettingsContentBlock extends BaseBlock {
  type: 'settings_content'
  data: {
    section:
      | 'business_type'
      | 'service_config'
      | 'staff'
      | 'account_info'
      | 'subscription'
      | 'print_settings'
      | 'session'
  }
}

export type WorkspaceBlock =
  | HeadingBlock
  | ParagraphBlock
  | NumberCardBlock
  | ShortcutBlock
  | ChartBlock
  | QuickListBlock
  | CardBlock
  | SpacerBlock
  | SettingsContentBlock

export interface WorkspaceConfig {
  key: string
  title: string
  description: string
  icon: string
  colorScheme: string
  blocks: WorkspaceBlock[]
}

// Chart data format returned by API
export interface ChartData {
  labels: string[]
  datasets: Array<{
    label: string
    data: number[]
    colors?: string[]
  }>
}

// Quick list data format returned by API
export interface QuickListData {
  title: string
  columns: Array<{ key: string; label: string; type?: 'text' | 'number' | 'date' | 'status' | 'currency' }>
  rows: Array<Record<string, unknown>>
  totalCount: number
}

// Metric values returned by API
export type MetricValues = Record<string, { value: number }>
