'use client'

import { useState, useCallback, useMemo, use } from 'react'
import { useRealtimeDataMultiple } from '@/hooks'
import Link from 'next/link'
import {
  ArrowLeft,
  Database,
  HardDrive,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  Info,
  Loader2,
  Sparkles,
  ArrowRight,
  X,
  ChevronDown,
  ChevronRight,
  Search,
  FileText,
  Image as ImageIcon,
  File,
  Layers,
} from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────────

interface UsageData {
  tenant: {
    id: string
    name: string
    slug: string
    businessType: string
  }
  usage: {
    databaseBytes: number
    fileStorageBytes: number
    updatedAt: string | null
  } | null
  subscription: {
    status: string
    trialEndsAt: string | null
  } | null
  tier: {
    id: string
    name: string
    displayName: string
  } | null
  limits: {
    maxDatabaseBytes: number | null
    maxFileStorageBytes: number | null
  }
  canManage: boolean
}

interface TableBreakdown {
  name: string
  label: string
  rows: number
  bytes: number
}

interface ModuleBreakdown {
  key: string
  label: string
  color: string
  totalBytes: number
  totalRows: number
  tables: TableBreakdown[]
}

interface FileCategory {
  category: string
  bytes: number
  count: number
  color: string
}

interface TopFile {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  createdAt: string
  thumbnailUrl: string | null
}

interface BreakdownData {
  database: {
    totalBytes: number
    modules: ModuleBreakdown[]
  }
  files: {
    totalBytes: number
    byCategory: FileCategory[]
    topFiles: TopFile[]
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function shortDate(date: string): string {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return ImageIcon
  if (mimeType === 'application/pdf') return FileText
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return FileText
  if (mimeType.includes('document') || mimeType.includes('word')) return FileText
  return File
}

// ─── SVG Doughnut (inline, formatBytes center) ─────────────────────

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) }
}

function describeArc(
  cx: number, cy: number, outerR: number, innerR: number,
  startAngle: number, endAngle: number,
): string {
  const os = polarToCartesian(cx, cy, outerR, endAngle)
  const oe = polarToCartesian(cx, cy, outerR, startAngle)
  const is_ = polarToCartesian(cx, cy, innerR, startAngle)
  const ie = polarToCartesian(cx, cy, innerR, endAngle)
  const large = endAngle - startAngle > 180 ? 1 : 0
  return [
    `M ${os.x} ${os.y}`,
    `A ${outerR} ${outerR} 0 ${large} 0 ${oe.x} ${oe.y}`,
    `L ${is_.x} ${is_.y}`,
    `A ${innerR} ${innerR} 0 ${large} 1 ${ie.x} ${ie.y}`,
    'Z',
  ].join(' ')
}

interface DoughnutSegment {
  label: string
  value: number
  color: string
}

function StorageDoughnut({
  segments,
  centerLabel,
  centerValue,
  size = 200,
}: {
  segments: DoughnutSegment[]
  centerLabel: string
  centerValue: string
  size?: number
}) {
  const [hovered, setHovered] = useState<number | null>(null)

  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (total === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-gray-400 dark:text-gray-500" style={{ width: size, height: size }}>
        No data
      </div>
    )
  }

  const cx = size / 2
  const cy = size / 2
  const outerR = size * 0.44
  const innerR = size * 0.28
  const isSingle = segments.length === 1

  const arcs = segments.map((seg, i) => {
    const before = segments.slice(0, i).reduce((s, x) => s + x.value, 0)
    const startAngle = (before / total) * 360
    const endAngle = ((before + seg.value) / total) * 360
    return { ...seg, startAngle, endAngle, index: i, pct: (seg.value / total) * 100 }
  })

  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {isSingle ? (
          <g onMouseEnter={() => setHovered(0)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer' }}>
            <circle
              cx={cx} cy={cy}
              r={(outerR + innerR) / 2}
              fill="none"
              stroke={arcs[0].color}
              strokeWidth={outerR - innerR}
              style={{ transform: hovered === 0 ? 'scale(1.03)' : 'scale(1)', transformOrigin: `${cx}px ${cy}px`, transition: 'transform 0.2s ease' }}
            />
          </g>
        ) : (
          arcs.map((arc) => {
            const isH = hovered === arc.index
            const mid = (arc.startAngle + arc.endAngle) / 2
            const off = isH ? 4 : 0
            const rad = ((mid - 90) * Math.PI) / 180
            return (
              <path
                key={arc.index}
                d={describeArc(cx, cy, outerR, innerR, arc.startAngle, arc.endAngle)}
                fill={arc.color}
                stroke="white"
                strokeWidth={2}
                onMouseEnter={() => setHovered(arc.index)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  cursor: 'pointer',
                  transform: `translate(${off * Math.cos(rad)}px, ${off * Math.sin(rad)}px)`,
                  transition: 'transform 0.2s ease',
                  filter: isH ? 'brightness(1.1)' : undefined,
                }}
              />
            )
          })
        )}
        <text x={cx} y={cy - 8} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500" fontSize={10} fontWeight={400}>
          {centerLabel}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" className="fill-gray-900 dark:fill-white" fontSize={14} fontWeight={600}>
          {centerValue}
        </text>
        {hovered !== null && arcs[hovered] && (
          <text x={cx} y={cy + 26} textAnchor="middle" fontSize={9} fill={arcs[hovered].color} fontWeight={500}>
            {arcs[hovered].label}: {arcs[hovered].pct.toFixed(1)}%
          </text>
        )}
      </svg>
    </div>
  )
}

// ─── Skeleton shimmer ───────────────────────────────────────────────

function BreakdownSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="flex items-center gap-6">
        <div className="w-[180px] h-[180px] rounded-full bg-gray-200 dark:bg-gray-700" />
        <div className="flex-1 space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-4 bg-gray-200 dark:bg-gray-700 rounded" style={{ width: `${90 - i * 15}%` }} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-gray-700/50 rounded" />
        ))}
      </div>
    </div>
  )
}

// ─── Database Breakdown ─────────────────────────────────────────────

function DatabaseBreakdown({ data }: { data: BreakdownData }) {
  const [expandedModule, setExpandedModule] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const { modules, totalBytes } = data.database

  const filteredModules = useMemo(() => {
    if (!search.trim()) return modules
    const q = search.toLowerCase()
    return modules
      .map(mod => ({
        ...mod,
        tables: mod.tables.filter(t =>
          t.label.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
        ),
      }))
      .filter(mod =>
        mod.label.toLowerCase().includes(q) || mod.tables.length > 0
      )
  }, [modules, search])

  const doughnutSegments = modules.map(m => ({
    label: m.label,
    value: m.totalBytes,
    color: m.color,
  }))

  if (modules.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
          <Database className="w-5 h-5 text-purple-500" />
          Database Breakdown
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
          No database records found. Start adding data to see the breakdown.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-6 border-b border-gray-100 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Database className="w-5 h-5 text-purple-500" />
          Database Storage Breakdown
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Estimated storage by business module
        </p>
      </div>

      {/* Chart + Legend */}
      <div className="p-6 flex flex-col sm:flex-row items-center gap-6">
        <StorageDoughnut
          segments={doughnutSegments}
          centerLabel="Total"
          centerValue={formatBytes(totalBytes)}
          size={180}
        />

        <div className="flex-1 min-w-0 grid grid-cols-1 gap-1.5">
          {modules.map(mod => {
            const pct = totalBytes > 0 ? (mod.totalBytes / totalBytes) * 100 : 0
            return (
              <div key={mod.key} className="flex items-center gap-2 text-sm">
                <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: mod.color }} />
                <span className="text-gray-700 dark:text-gray-300 truncate">{mod.label}</span>
                <span className="text-gray-400 dark:text-gray-500 ml-auto tabular-nums text-xs whitespace-nowrap">
                  {formatBytes(mod.totalBytes)}
                </span>
                <span className="text-gray-400 dark:text-gray-500 tabular-nums text-xs w-10 text-right">
                  {pct.toFixed(1)}%
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Table details */}
      <div className="border-t border-gray-100 dark:border-gray-700">
        <div className="px-6 py-3 flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Table Details</h4>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search tables..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-500 w-44"
            />
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {filteredModules.map(mod => {
            const isExpanded = expandedModule === mod.key || search.trim().length > 0
            const pct = totalBytes > 0 ? (mod.totalBytes / totalBytes) * 100 : 0
            return (
              <div key={mod.key}>
                <button
                  onClick={() => setExpandedModule(expandedModule === mod.key ? null : mod.key)}
                  className="w-full px-6 py-2.5 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left"
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  }
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: mod.color }} />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{mod.label}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                    ({mod.tables.length} {mod.tables.length === 1 ? 'table' : 'tables'})
                  </span>
                  <div className="flex-1" />
                  <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                    {mod.totalRows.toLocaleString()} rows
                  </span>
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 tabular-nums w-20 text-right">
                    {formatBytes(mod.totalBytes)}
                  </span>
                  <div className="w-16 h-1.5 bg-gray-100 dark:bg-gray-600 rounded-full overflow-hidden flex-shrink-0">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: mod.color }} />
                  </div>
                </button>

                {isExpanded && (
                  <div className="bg-gray-50/50 dark:bg-gray-900/30">
                    {(search.trim() ? mod.tables : modules.find(m => m.key === mod.key)?.tables || mod.tables).map(table => {
                      const tPct = totalBytes > 0 ? (table.bytes / totalBytes) * 100 : 0
                      return (
                        <div
                          key={table.name}
                          className="px-6 py-1.5 pl-16 flex items-center gap-3 text-xs"
                        >
                          <Layers className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <span className="text-gray-600 dark:text-gray-400 truncate" title={table.name}>
                            {table.label}
                          </span>
                          <div className="flex-1" />
                          <span className="text-gray-400 dark:text-gray-500 tabular-nums">
                            {table.rows.toLocaleString()} rows
                          </span>
                          <span className="text-gray-600 dark:text-gray-400 tabular-nums w-20 text-right font-medium">
                            {formatBytes(table.bytes)}
                          </span>
                          <span className="text-gray-400 dark:text-gray-500 tabular-nums w-10 text-right">
                            {tPct.toFixed(1)}%
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {filteredModules.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
              No tables match &ldquo;{search}&rdquo;
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── File Breakdown ─────────────────────────────────────────────────

function FileBreakdown({ data }: { data: BreakdownData }) {
  const { byCategory, topFiles, totalBytes } = data.files

  const doughnutSegments = byCategory.map(c => ({
    label: c.category,
    value: c.bytes,
    color: c.color,
  }))

  if (byCategory.length === 0 && topFiles.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-4">
          <HardDrive className="w-5 h-5 text-green-500" />
          File Storage Breakdown
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">
          No files uploaded yet. Upload documents or images to see the breakdown.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="p-6 border-b border-gray-100 dark:border-gray-700">
        <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-green-500" />
          File Storage Breakdown
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Files stored in Cloudflare R2
        </p>
      </div>

      {/* Chart + Legend */}
      {byCategory.length > 0 && (
        <div className="p-6 flex flex-col sm:flex-row items-center gap-6">
          <StorageDoughnut
            segments={doughnutSegments}
            centerLabel="Total"
            centerValue={formatBytes(totalBytes)}
            size={180}
          />

          <div className="flex-1 min-w-0 space-y-2">
            {byCategory.map(cat => {
              const pct = totalBytes > 0 ? (cat.bytes / totalBytes) * 100 : 0
              return (
                <div key={cat.category} className="flex items-center gap-2.5">
                  <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: cat.color }} />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{cat.category}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    ({cat.count} {cat.count === 1 ? 'file' : 'files'})
                  </span>
                  <div className="flex-1" />
                  <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                    {formatBytes(cat.bytes)}
                  </span>
                  <span className="text-xs tabular-nums text-gray-400 dark:text-gray-500 w-10 text-right">
                    {pct.toFixed(1)}%
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Top Files */}
      {topFiles.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          <div className="px-6 py-3">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Largest Files</h4>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
                  <th className="text-left px-6 py-2 font-medium">File</th>
                  <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Type</th>
                  <th className="text-right px-3 py-2 font-medium">Size</th>
                  <th className="text-right px-6 py-2 font-medium hidden sm:table-cell">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {topFiles.map(f => {
                  const FIcon = fileIcon(f.fileType)
                  return (
                    <tr key={f.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="px-6 py-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FIcon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <span className="text-gray-700 dark:text-gray-300 truncate max-w-[200px]" title={f.fileName}>
                            {f.fileName}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 hidden sm:table-cell whitespace-nowrap">
                        {f.fileType.split('/').pop()?.toUpperCase() || '-'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                        {formatBytes(f.fileSize)}
                      </td>
                      <td className="px-6 py-2 text-right text-gray-500 dark:text-gray-400 hidden sm:table-cell whitespace-nowrap">
                        {shortDate(f.createdAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Info note */}
      <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30">
        <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
          <Info className="w-3 h-3 flex-shrink-0" />
          Includes uploaded documents, images, item photos, and company logos in cloud storage.
        </p>
      </div>
    </div>
  )
}

// ─── StorageCard (existing) ─────────────────────────────────────────

function StorageCard({
  icon: Icon,
  title,
  description,
  used,
  limit,
  gradient,
  iconBg,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  used: number
  limit: number | null
  gradient: string
  iconBg: string
}) {
  const percentage = limit ? Math.min((used / limit) * 100, 100) : 0
  const isWarning = percentage >= 80
  const isCritical = percentage >= 95

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-lg transition-all">
      <div className={`p-6 ${gradient}`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 ${iconBg} rounded-2xl flex items-center justify-center`}>
              <Icon className="w-7 h-7 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-lg">{title}</h3>
              <p className="text-sm text-white/70">{description}</p>
            </div>
          </div>
          {isWarning && (
            <div className={`px-3 py-1.5 rounded text-xs font-semibold ${
              isCritical ? 'bg-red-500 text-white' : 'bg-yellow-400 text-yellow-900'
            }`}>
              {isCritical ? 'Critical' : 'Warning'}
            </div>
          )}
        </div>
      </div>

      <div className="p-6">
        <div className="flex items-end justify-between mb-4">
          <span className="text-4xl font-bold text-gray-900 dark:text-white">{formatBytes(used)}</span>
          {limit && (
            <span className="text-gray-500 dark:text-gray-400 text-lg">of {formatBytes(limit)}</span>
          )}
        </div>

        {limit ? (
          <div className="relative h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                isCritical ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-blue-500'
              }`}
              style={{ width: `${percentage}%` }}
            />
            {/* 80% threshold marker */}
            <div
              className="absolute top-0 h-full w-0.5 bg-yellow-600/50"
              style={{ left: '80%' }}
              title="80% — Warning threshold"
            />
            {/* 90% threshold marker */}
            <div
              className="absolute top-0 h-full w-0.5 bg-red-600/50"
              style={{ left: '90%' }}
              title="90% — Critical threshold"
            />
          </div>
        ) : (
          <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full opacity-30" style={{ width: '100%' }} />
          </div>
        )}

        <div className="flex items-center justify-between mt-3 text-sm">
          <span className="text-gray-500 dark:text-gray-400 font-medium">
            {limit ? `${percentage.toFixed(1)}% used` : 'No limit set'}
          </span>
          {limit && (
            <span className="text-gray-500 dark:text-gray-400">
              {formatBytes(Math.max(0, limit - used))} remaining
            </span>
          )}
        </div>

        {isWarning && (
          <div className={`mt-4 p-4 rounded-md flex items-start gap-3 ${isCritical ? 'bg-red-50 dark:bg-red-900/30' : 'bg-yellow-50 dark:bg-yellow-900/30'}`}>
            <AlertTriangle className={`w-5 h-5 flex-shrink-0 ${isCritical ? 'text-red-500 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'}`} />
            <p className={`text-sm ${isCritical ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'}`}>
              {isCritical
                ? 'Storage limit almost reached. Upgrade your plan to continue.'
                : 'Approaching storage limit. Consider upgrading soon.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function UsagePage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const { tenantId } = use(params)
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // Breakdown state
  const [breakdown, setBreakdown] = useState<BreakdownData | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(true)

  const fetchUsage = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    try {
      const res = await fetch(`/api/account/usage/${tenantId}`)
      if (res.ok) {
        const usageData = await res.json()
        setData({
          tenant: usageData.tenant,
          usage: usageData.usage ? {
            databaseBytes: usageData.totals?.storageBytes || 0,
            fileStorageBytes: usageData.totals?.fileStorageBytes || 0,
            updatedAt: usageData.usage.updatedAt,
          } : null,
          subscription: usageData.subscription,
          tier: usageData.tier,
          limits: {
            maxDatabaseBytes: usageData.limits?.maxStorageBytes || null,
            maxFileStorageBytes: usageData.limits?.maxFileStorageBytes || null,
          },
          canManage: usageData.canManage,
        })
        setError('')
      } else {
        const errData = await res.json()
        setError(errData.error || 'Unable to load usage data')
      }
    } catch {
      setError('Failed to load usage data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [tenantId])

  const fetchBreakdown = useCallback(async () => {
    setBreakdownLoading(true)
    try {
      const res = await fetch(`/api/account/usage/${tenantId}/breakdown`)
      if (res.ok) {
        const bd = await res.json()
        setBreakdown(bd)
      }
    } catch {
      // Non-critical — silently ignore
    } finally {
      setBreakdownLoading(false)
    }
  }, [tenantId])

  // Real-time updates via WebSocket
  useRealtimeDataMultiple([fetchUsage, fetchBreakdown], { entityType: 'account-usage' })

  const handleRefresh = useCallback(() => {
    fetchUsage(true)
    fetchBreakdown()
  }, [fetchUsage, fetchBreakdown])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400 dark:text-gray-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="space-y-8">
        <div className="flex items-center gap-4">
          <Link
            href="/account"
            className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
        </div>
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-2xl flex items-center justify-center mb-4">
            <X className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-gray-500 dark:text-gray-400">{error || 'Usage data not found'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/account"
            className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Hero Section */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl mb-4">
          <Database className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">{data.tenant.name}</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-2">Storage usage and limits</p>
      </div>

      {/* Plan Info Card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 hover:shadow-lg transition-all">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center">
              <TrendingUp className="w-7 h-7 text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-900 dark:text-white text-lg">
                {data.tier?.displayName || 'No Plan'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {data.subscription?.status === 'trial'
                  ? 'Free Plan'
                  : data.subscription?.status === 'active'
                  ? 'Active subscription'
                  : data.subscription?.status || 'No subscription'}
              </p>
            </div>
          </div>
          <Link
            href={`/account/subscription/${tenantId}`}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Manage Plan
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Storage Cards — prefer breakdown totals (real-time) over stored values (trigger-maintained) */}
      <div className="grid gap-6 md:grid-cols-2">
        <StorageCard
          icon={Database}
          title="Database Storage"
          description="Space used by your business data"
          used={breakdown?.database.totalBytes ?? data.usage?.databaseBytes ?? 0}
          limit={data.limits.maxDatabaseBytes}
          gradient="bg-gradient-to-br from-purple-500 to-purple-600"
          iconBg="bg-purple-400/30"
        />

        <StorageCard
          icon={HardDrive}
          title="File Storage"
          description="Space used by uploaded files"
          used={breakdown?.files.totalBytes ?? data.usage?.fileStorageBytes ?? 0}
          limit={data.limits.maxFileStorageBytes}
          gradient="bg-gradient-to-br from-green-500 to-emerald-600"
          iconBg="bg-green-400/30"
        />
      </div>

      {/* Breakdown Sections */}
      {breakdownLoading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-6">
              <Database className="w-5 h-5 text-purple-500" />
              Database Breakdown
            </h3>
            <BreakdownSkeleton />
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2 mb-6">
              <HardDrive className="w-5 h-5 text-green-500" />
              File Storage Breakdown
            </h3>
            <BreakdownSkeleton />
          </div>
        </div>
      ) : breakdown ? (
        <div className="grid gap-6 lg:grid-cols-1">
          <DatabaseBreakdown data={breakdown} />
          <FileBreakdown data={breakdown} />
        </div>
      ) : null}

      {/* Threshold Legend */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Storage Thresholds</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 p-3 bg-yellow-50 dark:bg-yellow-900/30 rounded-md">
            <div className="w-1.5 h-8 bg-yellow-500 rounded-full" />
            <div>
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-400">80% — Warning</p>
              <p className="text-xs text-yellow-600 dark:text-yellow-500">Consider upgrading soon</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-orange-50 dark:bg-orange-900/30 rounded-md">
            <div className="w-1.5 h-8 bg-red-500 rounded-full" />
            <div>
              <p className="text-sm font-medium text-orange-800 dark:text-orange-400">90% — Critical</p>
              <p className="text-xs text-orange-600 dark:text-orange-500">Upgrade recommended</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/30 rounded-md">
            <div className="w-1.5 h-8 bg-red-700 rounded-full" />
            <div>
              <p className="text-sm font-medium text-red-800 dark:text-red-400">100% — Blocked</p>
              <p className="text-xs text-red-600 dark:text-red-500">New records blocked</p>
            </div>
          </div>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/30 dark:to-purple-900/30 border border-blue-200 dark:border-blue-800 rounded-2xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-md flex items-center justify-center flex-shrink-0">
            <Info className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">How storage is calculated</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              <strong>Database storage</strong> includes all your business records — customers, sales, inventory, work orders, and more.
              <strong> File storage</strong> includes uploaded images, documents, and receipt attachments.
            </p>
            <ul className="text-sm text-gray-600 dark:text-gray-400 mt-2 space-y-1 list-disc list-inside">
              <li>At <strong>80%</strong> usage, you&apos;ll see a warning banner on your dashboard.</li>
              <li>At <strong>90%</strong>, we&apos;ll send an email alert and recommend upgrading.</li>
              <li>At <strong>100% database</strong>, new records are blocked (existing sales still work).</li>
              <li>At <strong>100% file storage</strong>, file uploads are blocked immediately.</li>
            </ul>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-3 flex items-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Storage is calculated daily. Last updated:{' '}
              <strong>{data.usage?.updatedAt ? formatDate(data.usage.updatedAt) : 'Never'}</strong>
            </p>
          </div>
        </div>
      </div>

      {/* Upgrade CTA */}
      {data.canManage && (data.limits.maxDatabaseBytes || data.limits.maxFileStorageBytes) && (
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-32 translate-x-32" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-24 -translate-x-24" />

          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-yellow-400" />
              </div>
              <div>
                <h3 className="font-bold text-xl">Need more storage?</h3>
                <p className="text-gray-300 mt-1">
                  Upgrade your plan to get more database and file storage.
                </p>
              </div>
            </div>
            <Link
              href="/account/plans"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white dark:bg-gray-100 text-gray-900 rounded-md font-semibold hover:bg-gray-100 dark:hover:bg-gray-200 transition-colors"
            >
              View Plans
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
