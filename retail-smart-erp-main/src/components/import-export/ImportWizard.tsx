'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Upload, FileSpreadsheet, FileText, Check,
  AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Loader2,
  ArrowRight, Link2Off, Download, RotateCcw, XCircle, History,
} from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { getEntityConfig, getImportableEntities, getImportFields } from '@/lib/import-export/entity-config'
import { useDataChange } from '@/hooks/useWebSocket'

interface ImportWizardProps {
  isOpen: boolean
  onClose: () => void
  defaultEntity?: string
  onComplete?: () => void
}

type ImportMode = 'insert' | 'update' | 'upsert'
type StockMode = 'none' | 'set' | 'add'

interface PreviewRow {
  row: number
  status: 'valid' | 'error' | 'skip'
  action?: 'insert' | 'update' | 'skip' | 'none'
  error?: string | null
  data: Record<string, unknown>
  errors: { column: string; message: string }[]
  warnings: { column: string; message: string }[]
}

interface PreviewData {
  totalRows: number
  validRows: number
  errorRows: number
  skipRows?: number
  actions?: { total: number; insert: number; update: number; skip: number; error: number }
  columns: string[]
  mappedColumns: Record<string, string>
  preview: PreviewRow[]
  errors: { row: number; column: string; message: string; value: unknown }[]
  warnings: { row: number; column: string; message: string }[]
}

interface ImportResult {
  success: boolean
  imported: number
  inserted?: number
  updated?: number
  skipped: number
  failed?: number
  autoCreated?: number
  errors: { row: number; message: string }[]
  status?: JobStatus
}

interface ParseHeadersResult {
  headers: string[]
  suggestedMapping: Record<string, string>
  rowCount: number
  sampleData: Record<string, string[]>
  fields: { key: string; label: string; type: string; required: boolean }[]
}

type JobStatus = 'queued' | 'validating' | 'processing' | 'done' | 'error' | 'cancelled' | 'interrupted'

interface ImportProgress {
  processed: number
  total: number
  imported: number
  inserted?: number
  updated?: number
  skipped: number
  failed?: number
  autoCreated: number
  errors: { row: number; message: string }[]
  status: JobStatus
  errorMessage?: string | null
}

interface JobSummary {
  jobId: string
  entityName: string
  mode: string
  fileName: string | null
  status: JobStatus
  total: number
  processed: number
  inserted: number
  updated: number
  skipped: number
  failed: number
  createdAt: string
  canResume: boolean
}

const STOCK_HELP = 'Stock columns (items): "Warehouse" (code or name) with "Opening Stock", "Min Stock", "Reorder Qty", or one column per warehouse named stock:<WAREHOUSE_CODE> (e.g. stock:MAIN). New items get exactly that stock (with a ledger entry); existing items follow the stock mode below.'

function progressFromJob(d: Record<string, unknown>): ImportProgress {
  const n = (k: string) => Number(d[k] || 0)
  return {
    processed: n('processed'),
    total: n('total'),
    imported: d.imported !== undefined ? n('imported') : n('inserted') + n('updated'),
    inserted: n('inserted'),
    updated: n('updated'),
    skipped: n('skipped'),
    failed: n('failed'),
    autoCreated: n('autoCreated'),
    errors: (d.errors as { row: number; message: string }[]) || [],
    status: (d.status as JobStatus) || 'processing',
    errorMessage: (d.errorMessage as string | null) ?? null,
  }
}

type Step = 'select' | 'upload' | 'mapping' | 'preview' | 'importing' | 'result'

export function ImportWizard({ isOpen, onClose, defaultEntity, onComplete }: ImportWizardProps) {
  const [step, setStep] = useState<Step>('select')
  const [entity, setEntity] = useState(defaultEntity || '')
  const [mode, setMode] = useState<ImportMode>('insert')
  const [matchBy, setMatchBy] = useState<string[]>([])
  const [stockMode, setStockMode] = useState<StockMode>('none')
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [previewData, setPreviewData] = useState<PreviewData | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [skipErrors, setSkipErrors] = useState(true)
  const [loading, setLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Column mapping state
  const [headerData, setHeaderData] = useState<ParseHeadersResult | null>(null)
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})

  // Background job state
  const [jobId, setJobId] = useState<string | null>(null)
  const [importProgress, setImportProgress] = useState<ImportProgress>({
    processed: 0,
    total: 0,
    imported: 0,
    skipped: 0,
    autoCreated: 0,
    errors: [],
    status: 'processing',
  })
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const jobCompleteHandled = useRef(false)

  const importableEntities = getImportableEntities()
  const entityConfig = entity ? getEntityConfig(entity) : null
  const matchFieldOptions = entityConfig?.uniqueMatchFields || []
  const fieldLabel = (key: string) => entityConfig?.fields.find(f => f.key === key)?.label || key

  // Default match-by order whenever the entity changes
  useEffect(() => {
    setMatchBy(entityConfig?.uniqueMatchFields ? [...entityConfig.uniqueMatchFields] : [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity])

  const loadRecentJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/import/jobs')
      if (!res.ok) return
      const data = await res.json() as { jobs: JobSummary[] }
      setRecentJobs((data.jobs || []).filter(j => !entity || j.entityName === entity).slice(0, 8))
    } catch {
      // non-critical
    }
  }, [entity])

  useEffect(() => {
    if (isOpen && step === 'select') loadRecentJobs()
  }, [isOpen, step, loadRecentJobs])

  function appendOptions(formData: FormData) {
    formData.append('mode', mode)
    if (mode !== 'insert' && matchBy.length > 0) formData.append('matchBy', matchBy.join(','))
    if (entity === 'items') formData.append('stockMode', stockMode)
  }

  function openJob(job: { jobId: string } & Partial<Record<string, unknown>>) {
    setJobId(job.jobId)
    setImportProgress(progressFromJob(job as Record<string, unknown>))
    jobCompleteHandled.current = false
    setLoading(true)
    setStep('importing')
  }

  async function resumeJob(id: string) {
    try {
      const res = await fetch(`/api/import/jobs/${id}/resume`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not resume import')
        return
      }
      toast.success('Import resumed')
      openJob({ jobId: id, status: 'processing' })
    } catch {
      toast.error('Could not resume import')
    }
  }

  async function cancelJob(id: string) {
    try {
      const res = await fetch(`/api/import/jobs/${id}/cancel`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Could not cancel import')
        return
      }
      setImportProgress(progressFromJob(data))
      toast.success('Import cancelled')
    } catch {
      toast.error('Could not cancel import')
    }
  }

  function downloadErrors(id: string) {
    const a = document.createElement('a')
    a.href = `/api/import/jobs/${id}/errors`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  // WebSocket listener for import progress (payload = DB job view)
  useDataChange('import-job', (event) => {
    if (!jobId || event.id !== jobId) return
    const d = event.data as Record<string, unknown> | undefined
    if (!d) return
    const p = progressFromJob(d)
    // WebSocket payloads carry no row errors; keep the polled ones
    setImportProgress(prev => ({ ...p, errors: p.errors.length ? p.errors : prev.errors }))
    if (p.status === 'done' || p.status === 'cancelled') handleJobComplete(p)
    else if (p.status === 'error' || p.status === 'interrupted') setLoading(false)
  }, [jobId])

  // Polling fallback when on 'importing' step
  useEffect(() => {
    if (step !== 'importing' || !jobId) return
    jobCompleteHandled.current = false

    const poll = async () => {
      if (jobCompleteHandled.current) return
      try {
        const res = await fetch(`/api/import/jobs/${jobId}`)
        if (!res.ok) return
        const p = progressFromJob(await res.json())
        setImportProgress(p)
        if (p.status === 'done' || p.status === 'cancelled') handleJobComplete(p)
        else if (p.status === 'error' || p.status === 'interrupted') setLoading(false)
        else setLoading(true)
      } catch {
        // Silent — next poll will retry
      }
    }
    poll()
    pollIntervalRef.current = setInterval(poll, 2000)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, jobId])

  function handleJobComplete(d: ImportProgress) {
    // Guard against double-completion from WS + polling firing simultaneously
    if (jobCompleteHandled.current) return
    jobCompleteHandled.current = true

    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    setLoading(false)

    setImportResult({
      success: d.status === 'done',
      imported: d.imported || 0,
      skipped: d.skipped || 0,
      failed: d.failed || 0,
      inserted: d.inserted || 0,
      updated: d.updated || 0,
      autoCreated: d.autoCreated || 0,
      errors: d.errors || [],
      status: d.status,
    })
    setStep('result')
    if (d.status === 'cancelled') {
      toast.info('Import cancelled')
    } else {
      toast.success(`Import complete: ${d.imported || 0} records imported${(d.skipped || 0) + (d.failed || 0) > 0 ? `, ${(d.skipped || 0) + (d.failed || 0)} not imported` : ''}`)
    }
    onComplete?.()
  }

  function handleClose() {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    setStep('select')
    setEntity(defaultEntity || '')
    setMode('insert')
    setStockMode('none')
    setFile(null)
    setPreviewData(null)
    setImportResult(null)
    setSkipErrors(true)
    setLoading(false)
    setHeaderData(null)
    setColumnMapping({})
    setJobId(null)
    setImportProgress({ processed: 0, total: 0, imported: 0, skipped: 0, autoCreated: 0, errors: [], status: 'processing' })
    setRecentJobs([])
    onClose()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) {
      const ext = f.name.toLowerCase()
      if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
        toast.error('Please upload a CSV or XLSX file')
        return
      }
      setFile(f)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) {
      const ext = f.name.toLowerCase()
      if (!ext.endsWith('.csv') && !ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
        toast.error('Please upload a CSV or XLSX file')
        return
      }
      setFile(f)
    }
  }

  async function downloadTemplate(format: 'csv' | 'xlsx') {
    try {
      const res = await fetch(`/api/export/template?entity=${entity}&format=${format}`)
      if (!res.ok) {
        toast.error('Failed to download template')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${entity}_template.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download template')
    }
  }

  // Parse headers and get auto-mapping suggestions
  const handleParseHeaders = useCallback(async () => {
    if (!file || !entity) return
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('entity', entity)

      const res = await fetch('/api/import/parse-headers', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to parse file' }))
        toast.error(err.error || 'Failed to parse file')
        return
      }

      const data: ParseHeadersResult = await res.json()
      setHeaderData(data)

      // Initialize column mapping from suggestions
      const initialMapping: Record<string, string> = {}
      for (const header of data.headers) {
        initialMapping[header] = data.suggestedMapping[header] || ''
      }
      setColumnMapping(initialMapping)
      setStep('mapping')
    } catch {
      toast.error('Failed to parse file headers')
    } finally {
      setLoading(false)
    }
  }, [file, entity])

  const handlePreview = useCallback(async () => {
    if (!file || !entity) return
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('entity', entity)
      appendOptions(formData)

      // Send custom column mapping (only mapped columns)
      const activeMapping: Record<string, string> = {}
      for (const [header, fieldKey] of Object.entries(columnMapping)) {
        if (fieldKey) activeMapping[header] = fieldKey
      }
      formData.append('columnMapping', JSON.stringify(activeMapping))

      const res = await fetch('/api/import/preview', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Preview failed' }))
        toast.error(err.error || 'Preview failed')
        return
      }

      const data = await res.json()
      setPreviewData(data)
      setStep('preview')
    } catch {
      toast.error('Preview failed')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, entity, mode, matchBy, stockMode, columnMapping])

  async function handleImport() {
    if (!file || !entity) return
    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('entity', entity)
      appendOptions(formData)
      formData.append('skipErrors', String(skipErrors))

      // Send custom column mapping
      const activeMapping: Record<string, string> = {}
      for (const [header, fieldKey] of Object.entries(columnMapping)) {
        if (fieldKey) activeMapping[header] = fieldKey
      }
      formData.append('columnMapping', JSON.stringify(activeMapping))

      const res = await fetch('/api/import/execute', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Import failed to start')
        setLoading(false)
        // Same file already running / interrupted: show that job (Resume is offered there)
        if (res.status === 409 && data.jobId) openJob({ jobId: data.jobId, status: data.status })
        return
      }

      // Server returned { jobId } — switch to importing step (progress is read from the DB job)
      openJob({ jobId: data.jobId, status: 'processing', total: data.total || previewData?.totalRows || 0 })
      // Loading stays true — will be cleared by handleJobComplete
    } catch {
      toast.error('Import failed to start. Please try again.')
      setLoading(false)
    }
  }

  // Column mapping helpers
  function updateMapping(header: string, fieldKey: string) {
    setColumnMapping(prev => ({ ...prev, [header]: fieldKey }))
  }

  function getMappedFieldKeys(): Set<string> {
    return new Set(Object.values(columnMapping).filter(v => v !== ''))
  }

  function getUnmappedRequiredFields(): { key: string; label: string }[] {
    if (!headerData) return []
    const mapped = getMappedFieldKeys()
    return headerData.fields
      .filter(f => f.required && !mapped.has(f.key))
      .map(f => ({ key: f.key, label: f.label }))
  }

  function getDuplicateMappings(): string[] {
    const counts: Record<string, number> = {}
    for (const fieldKey of Object.values(columnMapping)) {
      if (fieldKey) {
        counts[fieldKey] = (counts[fieldKey] || 0) + 1
      }
    }
    return Object.keys(counts).filter(k => counts[k] > 1)
  }

  function canProceedFromMapping(): boolean {
    if (mode === 'insert') {
      const unmappedRequired = getUnmappedRequiredFields()
      if (unmappedRequired.length > 0) return false
    }
    const duplicates = getDuplicateMappings()
    if (duplicates.length > 0) return false
    // At least one column must be mapped
    const mapped = getMappedFieldKeys()
    return mapped.size > 0
  }

  function renderStepIndicator() {
    const steps: { key: Step; label: string }[] = [
      { key: 'select', label: 'Setup' },
      { key: 'upload', label: 'Upload' },
      { key: 'mapping', label: 'Map' },
      { key: 'preview', label: 'Preview' },
      { key: 'importing', label: 'Import' },
      { key: 'result', label: 'Done' },
    ]
    const currentIdx = steps.findIndex(s => s.key === step)

    return (
      <div className="flex items-center gap-1 mb-4">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
              i < currentIdx ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300' :
              i === currentIdx ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
              'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
            }`}>
              {i < currentIdx ? <Check size={12} /> : <span>{i + 1}</span>}
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <ChevronRight size={14} className="mx-0.5 text-gray-400" />
            )}
          </div>
        ))}
      </div>
    )
  }

  function renderSelectStep() {
    return (
      <div className="space-y-4">
        {renderStepIndicator()}

        {!defaultEntity && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Data Type</label>
            <select
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="">Select data type...</option>
              {importableEntities.map(e => (
                <option key={e.name} value={e.name}>{e.label}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Import Mode</label>
          <div className="space-y-2">
            {([
              { value: 'insert', title: 'Insert new records', hint: 'Create new records. Rows that already exist are skipped (never overwritten).' },
              { value: 'update', title: 'Update existing records', hint: 'Only change records that match. Rows without a match are reported as errors.' },
              { value: 'upsert', title: 'Insert or update (upsert)', hint: 'Update matching records and create the rest.' },
            ] as { value: ImportMode; title: string; hint: string }[]).map(opt => (
              <label key={opt.value} className={`flex items-start gap-3 p-3 rounded border-2 cursor-pointer transition-all ${
                mode === opt.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
              }`}>
                <input
                  type="radio"
                  checked={mode === opt.value}
                  onChange={() => setMode(opt.value)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">{opt.title}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">{opt.hint}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {mode !== 'insert' && matchFieldOptions.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Match existing records by</label>
            <div className="flex flex-wrap gap-3">
              {matchFieldOptions.map(key => (
                <label key={key} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={matchBy.includes(key)}
                    onChange={(e) => setMatchBy(prev => e.target.checked
                      ? matchFieldOptions.filter(k => k === key || prev.includes(k))
                      : prev.filter(k => k !== key))}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600"
                  />
                  {fieldLabel(key)}
                </label>
              ))}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Checked in this order; the first value that matches wins.</div>
          </div>
        )}

        {mode !== 'insert' && (
          <div className="p-2.5 bg-blue-50 dark:bg-blue-900/15 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-700 dark:text-blue-300">
            Blank cells keep the existing value. To empty a field, put <code className="font-mono">__CLEAR__</code> in the cell.
          </div>
        )}

        {entity === 'items' && (
          <div className="space-y-2">
            <div className="text-xs text-gray-500 dark:text-gray-400">{STOCK_HELP}</div>
            {mode !== 'insert' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Stock for existing items</label>
                <select
                  value={stockMode}
                  onChange={(e) => setStockMode(e.target.value as StockMode)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
                >
                  <option value="none">Ignore stock columns (default)</option>
                  <option value="set">Set stock to the file quantity</option>
                  <option value="add">Add the file quantity to current stock</option>
                </select>
              </div>
            )}
          </div>
        )}

        {entity && (
          <div className="p-3 bg-gray-50 dark:bg-gray-800/50 rounded border border-gray-200 dark:border-gray-700">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Download Template</div>
            <div className="flex gap-2">
              <button
                onClick={() => downloadTemplate('xlsx')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                <FileSpreadsheet size={14} />
                Excel Template
              </button>
              <button
                onClick={() => downloadTemplate('csv')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                <FileText size={14} />
                CSV Template
              </button>
            </div>
          </div>
        )}

        {recentJobs.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <History size={14} /> Recent imports
            </div>
            <div className="border border-gray-200 dark:border-gray-700 rounded divide-y divide-gray-100 dark:divide-gray-700">
              {recentJobs.map(j => (
                <div key={j.jobId} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <button onClick={() => openJob(j as unknown as { jobId: string } & Record<string, unknown>)} className="min-w-0 text-left hover:underline">
                    <div className="truncate text-gray-900 dark:text-white">{j.fileName || j.entityName} <span className="text-gray-400">({j.mode})</span></div>
                    <div className="text-gray-500 dark:text-gray-400">
                      {new Date(j.createdAt).toLocaleString()} · {j.inserted} new, {j.updated} updated, {j.skipped} skipped, {j.failed} failed
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-1.5 py-0.5 rounded ${
                      j.status === 'done' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                        : j.status === 'interrupted' || j.status === 'error' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                    }`}>{j.status}</span>
                    {j.canResume && (
                      <button onClick={() => resumeJob(j.jobId)} className="flex items-center gap-1 px-2 py-1 text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20">
                        <RotateCcw size={12} /> Resume
                      </button>
                    )}
                    {j.failed + j.skipped > 0 && (
                      <button onClick={() => downloadErrors(j.jobId)} title="Download rows that were not imported" className="p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-200">
                        <Download size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderUploadStep() {
    return (
      <div className="space-y-4">
        {renderStepIndicator()}

        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className={`border-2 border-dashed rounded p-8 text-center transition-colors ${
            file
              ? 'border-green-300 dark:border-green-600 bg-green-50 dark:bg-green-900/10'
              : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
          }`}
        >
          {file ? (
            <div className="space-y-2">
              <CheckCircle size={40} className="mx-auto text-green-500" />
              <div className="text-sm font-medium text-gray-900 dark:text-white">{file.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {(file.size / 1024).toFixed(1)} KB
              </div>
              <button
                onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}
                className="text-xs text-red-600 dark:text-red-400 hover:underline"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload size={40} className="mx-auto text-gray-400" />
              <div className="text-sm text-gray-600 dark:text-gray-300">
                Drag & drop a CSV or Excel file here
              </div>
              <div className="text-xs text-gray-400 dark:text-gray-500">or</div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-1.5 text-sm text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
              >
                Browse files
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400">
          Accepted formats: .csv, .xlsx | Max: 30,000 rows per file
        </div>
      </div>
    )
  }

  function renderMappingStep() {
    if (!headerData) return null

    const mappedKeys = getMappedFieldKeys()
    const unmappedRequired = getUnmappedRequiredFields()
    const duplicates = getDuplicateMappings()
    const mappedCount = Object.values(columnMapping).filter(v => v !== '').length
    const totalHeaders = headerData.headers.length

    return (
      <div className="space-y-4">
        {renderStepIndicator()}

        {/* Summary bar */}
        <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
          <span>{headerData.rowCount.toLocaleString()} rows detected</span>
          <span className="font-medium text-blue-600 dark:text-blue-400">
            {mappedCount}/{totalHeaders} columns mapped
          </span>
        </div>

        {/* Warnings */}
        {unmappedRequired.length > 0 && mode === 'insert' && (
          <div className="flex items-start gap-2 p-2.5 bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 rounded text-xs">
            <AlertCircle size={14} className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-amber-700 dark:text-amber-300">Required fields not mapped: </span>
              <span className="text-amber-600 dark:text-amber-400">
                {unmappedRequired.map(f => f.label).join(', ')}
              </span>
            </div>
          </div>
        )}

        {duplicates.length > 0 && (
          <div className="flex items-start gap-2 p-2.5 bg-red-50 dark:bg-red-900/15 border border-red-200 dark:border-red-800 rounded text-xs">
            <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium text-red-700 dark:text-red-300">Duplicate mappings: </span>
              <span className="text-red-600 dark:text-red-400">
                {duplicates.map(k => headerData.fields.find(f => f.key === k)?.label || k).join(', ')}
              </span>
            </div>
          </div>
        )}

        {/* Mapping table */}
        <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-400 w-[40%]">
                    File Column
                  </th>
                  <th className="px-1 py-2 text-center text-xs font-medium text-gray-400 w-[24px]"></th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-400 w-[45%]">
                    Maps To
                  </th>
                </tr>
              </thead>
              <tbody>
                {headerData.headers.map((header) => {
                  const fieldKey = columnMapping[header] || ''
                  const isSkipped = fieldKey === ''
                  const isDuplicate = fieldKey && duplicates.includes(fieldKey)
                  const samples = headerData.sampleData[header] || []

                  return (
                    <tr
                      key={header}
                      className={`border-t border-gray-100 dark:border-gray-700 ${
                        isDuplicate ? 'bg-red-50 dark:bg-red-900/10' :
                        isSkipped ? 'bg-gray-50/50 dark:bg-gray-800/30' : ''
                      }`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-900 dark:text-white text-xs truncate" title={header}>
                          {header}
                        </div>
                        {samples.length > 0 && (
                          <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate mt-0.5" title={samples.join(', ')}>
                            e.g. {samples.slice(0, 2).join(', ')}
                          </div>
                        )}
                      </td>
                      <td className="px-1 py-2 text-center">
                        {isSkipped ? (
                          <Link2Off size={12} className="text-gray-300 dark:text-gray-600 mx-auto" />
                        ) : (
                          <ArrowRight size={12} className="text-blue-400 mx-auto" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={fieldKey}
                          onChange={(e) => updateMapping(header, e.target.value)}
                          className={`w-full px-2 py-1.5 text-xs border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                            isDuplicate
                              ? 'border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-900/20'
                              : isSkipped
                              ? 'border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-700'
                              : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white'
                          }`}
                        >
                          <option value="">-- Skip (do not import) --</option>
                          {headerData.fields.map(f => {
                            const isAlreadyMapped = mappedKeys.has(f.key) && fieldKey !== f.key
                            return (
                              <option
                                key={f.key}
                                value={f.key}
                                disabled={isAlreadyMapped}
                              >
                                {f.label}{f.required ? ' *' : ''} ({f.type}){isAlreadyMapped ? ' [mapped]' : ''}
                              </option>
                            )
                          })}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="text-[10px] text-gray-400 dark:text-gray-500">
          * = required field for insert mode. Unmapped columns will be skipped.
        </div>
      </div>
    )
  }

  function renderPreviewStep() {
    if (!previewData) return null
    const importFields = entityConfig ? getImportFields(entityConfig) : []

    return (
      <div className="space-y-4">
        {renderStepIndicator()}

        {/* Summary — exactly what the import will do */}
        <div className="flex gap-3">
          <div className="flex-1 p-3 bg-green-50 dark:bg-green-900/20 rounded text-center">
            <div className="text-xl font-bold text-green-700 dark:text-green-300">{previewData.actions?.insert ?? previewData.validRows}</div>
            <div className="text-xs text-green-600 dark:text-green-400">Will insert</div>
          </div>
          {(previewData.actions?.update ?? 0) > 0 && (
            <div className="flex-1 p-3 bg-blue-50 dark:bg-blue-900/20 rounded text-center">
              <div className="text-xl font-bold text-blue-700 dark:text-blue-300">{previewData.actions?.update}</div>
              <div className="text-xs text-blue-600 dark:text-blue-400">Will update</div>
            </div>
          )}
          {(previewData.skipRows ?? 0) > 0 && (
            <div className="flex-1 p-3 bg-amber-50 dark:bg-amber-900/20 rounded text-center">
              <div className="text-xl font-bold text-amber-700 dark:text-amber-300">{previewData.skipRows}</div>
              <div className="text-xs text-amber-600 dark:text-amber-400">Skip (exists)</div>
            </div>
          )}
          <div className="flex-1 p-3 bg-red-50 dark:bg-red-900/20 rounded text-center">
            <div className="text-xl font-bold text-red-700 dark:text-red-300">{previewData.errorRows}</div>
            <div className="text-xs text-red-600 dark:text-red-400">Errors</div>
          </div>
          <div className="flex-1 p-3 bg-gray-50 dark:bg-gray-800 rounded text-center">
            <div className="text-xl font-bold text-gray-700 dark:text-gray-300">{previewData.totalRows}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Total</div>
          </div>
        </div>

        {/* Preview Table */}
        <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-400">Row</th>
                  <th className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-400">Action</th>
                  {importFields.slice(0, 5).map(f => (
                    <th key={f.key} className="px-2 py-1.5 text-left font-medium text-gray-600 dark:text-gray-400 max-w-[120px] truncate">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewData.preview.slice(0, 50).map((row) => (
                  <tr key={row.row} className={`border-t border-gray-100 dark:border-gray-700 ${
                    row.status === 'error' ? 'bg-red-50 dark:bg-red-900/10' : row.status === 'skip' ? 'bg-amber-50 dark:bg-amber-900/10' : ''
                  }`} title={row.error || undefined}>
                    <td className="px-2 py-1.5 text-gray-500">{row.row}</td>
                    <td className="px-2 py-1.5">
                      {row.status === 'valid' ? (
                        <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                          <CheckCircle size={14} /> {row.action === 'update' ? 'update' : 'insert'}
                        </span>
                      ) : row.status === 'skip' ? (
                        <span className="text-amber-600 dark:text-amber-400">skip</span>
                      ) : (
                        <AlertCircle size={14} className="text-red-500" />
                      )}
                    </td>
                    {importFields.slice(0, 5).map(f => (
                      <td key={f.key} className="px-2 py-1.5 max-w-[120px] truncate">
                        {String(row.data[f.key] || '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Errors */}
        {previewData.errors.length > 0 && (
          <div className="border border-red-200 dark:border-red-800 rounded p-3 bg-red-50 dark:bg-red-900/10">
            <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-1.5">
              Errors ({previewData.errors.length})
            </div>
            <div className="max-h-24 overflow-y-auto space-y-0.5">
              {previewData.errors.slice(0, 20).map((err, i) => (
                <div key={i} className="text-xs text-red-600 dark:text-red-400">
                  Row {err.row}: {err.column} — {err.message}
                </div>
              ))}
              {previewData.errors.length > 20 && (
                <div className="text-xs text-red-500 italic">...and {previewData.errors.length - 20} more</div>
              )}
            </div>
          </div>
        )}

        {/* Warnings */}
        {previewData.warnings.length > 0 && (
          <div className="border border-amber-200 dark:border-amber-800 rounded p-3 bg-amber-50 dark:bg-amber-900/10">
            <div className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1.5">
              Warnings ({previewData.warnings.length})
            </div>
            <div className="max-h-16 overflow-y-auto space-y-0.5">
              {previewData.warnings.slice(0, 10).map((warn, i) => (
                <div key={i} className="text-xs text-amber-600 dark:text-amber-400">
                  Row {warn.row}: {warn.column} — {warn.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skip errors option */}
        {previewData.errorRows > 0 && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={skipErrors}
              onChange={(e) => setSkipErrors(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Skip invalid rows and import valid ones only
            </span>
          </label>
        )}
      </div>
    )
  }

  function renderImportingStep() {
    const { processed, total, imported, skipped, autoCreated, status, errorMessage } = importProgress
    const failed = importProgress.failed || 0
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0
    const stalled = status === 'interrupted' || status === 'error'

    return (
      <div className="space-y-6 py-4">
        {renderStepIndicator()}

        <div className="text-center space-y-2">
          {stalled ? (
            <AlertCircle size={40} className="mx-auto text-amber-500" />
          ) : (
            <Loader2 size={40} className="mx-auto text-blue-500 animate-spin" />
          )}
          <div className="text-base font-medium text-gray-900 dark:text-white">
            {status === 'interrupted' ? 'Import interrupted' : status === 'error' ? 'Import stopped' : 'Importing...'}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {processed.toLocaleString()} / {total.toLocaleString()} rows ({pct}%)
          </div>
          {stalled && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              {errorMessage || 'The server stopped processing this job.'} Rows already imported are saved; Resume continues with the remaining rows only.
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
          <div
            className={`${stalled ? 'bg-amber-500' : 'bg-blue-500'} h-3 rounded-full transition-all duration-500 ease-out`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Live counters */}
        <div className="flex gap-3 text-sm">
          <div className="flex-1 text-center p-2 bg-green-50 dark:bg-green-900/20 rounded">
            <div className="font-semibold text-green-700 dark:text-green-300">{imported.toLocaleString()}</div>
            <div className="text-xs text-green-600 dark:text-green-400">Imported</div>
          </div>
          <div className="flex-1 text-center p-2 bg-amber-50 dark:bg-amber-900/20 rounded">
            <div className="font-semibold text-amber-700 dark:text-amber-300">{skipped.toLocaleString()}</div>
            <div className="text-xs text-amber-600 dark:text-amber-400">Skipped</div>
          </div>
          <div className="flex-1 text-center p-2 bg-red-50 dark:bg-red-900/20 rounded">
            <div className="font-semibold text-red-700 dark:text-red-300">{failed.toLocaleString()}</div>
            <div className="text-xs text-red-600 dark:text-red-400">Failed</div>
          </div>
          {autoCreated > 0 && (
            <div className="flex-1 text-center p-2 bg-blue-50 dark:bg-blue-900/20 rounded">
              <div className="font-semibold text-blue-700 dark:text-blue-300">{autoCreated.toLocaleString()}</div>
              <div className="text-xs text-blue-600 dark:text-blue-400">Auto-created</div>
            </div>
          )}
        </div>

        <div className="text-xs text-center text-gray-400 dark:text-gray-500">
          Progress is saved on the server — you can close this window and check back under Recent imports.
        </div>
      </div>
    )
  }

  function renderResultStep() {
    if (!importResult) return null

    return (
      <div className="space-y-4 text-center py-4">
        {importResult.imported > 0 || importResult.status === 'done' ? (
          <CheckCircle size={48} className="mx-auto text-green-500" />
        ) : (
          <AlertCircle size={48} className="mx-auto text-red-500" />
        )}

        <div>
          <div className="text-lg font-semibold text-gray-900 dark:text-white">
            {importResult.status === 'cancelled' ? 'Import Cancelled' : importResult.imported > 0 || importResult.status === 'done' ? 'Import Complete' : 'Import Failed'}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {importResult.imported > 0 && (
              <span className="text-green-600 dark:text-green-400 font-medium">
                {importResult.imported} records imported
              </span>
            )}
            {importResult.autoCreated ? (
              <span className="text-blue-600 dark:text-blue-400 ml-2">
                {importResult.autoCreated} lookups auto-created
              </span>
            ) : null}
            {importResult.skipped > 0 && (
              <span className="text-amber-600 dark:text-amber-400 ml-2">
                {importResult.skipped} skipped
              </span>
            )}
            {(importResult.failed || 0) > 0 && (
              <span className="text-red-600 dark:text-red-400 ml-2">
                {importResult.failed} failed
              </span>
            )}
          </div>
          {importResult.status === 'cancelled' && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Import was cancelled; remaining rows were not imported.</div>
          )}
        </div>

        {jobId && importResult.skipped + (importResult.failed || 0) > 0 && (
          <button
            onClick={() => downloadErrors(jobId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600"
          >
            <Download size={14} /> Download rows not imported (CSV)
          </button>
        )}

        {importResult.errors.length > 0 && (
          <div className="text-left border border-red-200 dark:border-red-800 rounded p-3 bg-red-50 dark:bg-red-900/10">
            <div className="text-xs font-medium text-red-700 dark:text-red-300 mb-1">Errors</div>
            <div className="max-h-32 overflow-y-auto space-y-0.5">
              {importResult.errors.map((err, i) => (
                <div key={i} className="text-xs text-red-600 dark:text-red-400">
                  Row {err.row}: {err.message}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderFooter() {
    switch (step) {
      case 'select':
        return (
          <div className="flex justify-end gap-2">
            <button onClick={handleClose} className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600">
              Cancel
            </button>
            <button
              onClick={() => setStep('upload')}
              disabled={!entity}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        )
      case 'upload':
        return (
          <div className="flex justify-between">
            <button
              onClick={() => setStep('select')}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <ChevronLeft size={16} /> Back
            </button>
            <button
              onClick={handleParseHeaders}
              disabled={!file || loading}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? 'Analyzing...' : 'Next'} {!loading && <ChevronRight size={16} />}
            </button>
          </div>
        )
      case 'mapping':
        return (
          <div className="flex justify-between">
            <button
              onClick={() => { setStep('upload'); setHeaderData(null); setColumnMapping({}) }}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <ChevronLeft size={16} /> Back
            </button>
            <button
              onClick={handlePreview}
              disabled={!canProceedFromMapping() || loading}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? 'Validating...' : 'Next'} {!loading && <ChevronRight size={16} />}
            </button>
          </div>
        )
      case 'preview':
        return (
          <div className="flex justify-between">
            <button
              onClick={() => { setStep('mapping'); setPreviewData(null) }}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <ChevronLeft size={16} /> Back
            </button>
            <button
              onClick={handleImport}
              disabled={loading || (previewData?.validRows === 0)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {loading ? 'Starting...' : `Import ${previewData?.validRows || 0} Records`}
            </button>
          </div>
        )
      case 'importing': {
        const stalled = importProgress.status === 'interrupted' || importProgress.status === 'error'
        return (
          <div className="flex justify-between gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              Close
            </button>
            <div className="flex gap-2">
              {jobId && (importProgress.skipped + (importProgress.failed || 0)) > 0 && (
                <button
                  onClick={() => downloadErrors(jobId)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  <Download size={16} /> Errors CSV
                </button>
              )}
              {jobId && (
                <button
                  onClick={() => cancelJob(jobId)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 border border-red-300 dark:border-red-700 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <XCircle size={16} /> Cancel
                </button>
              )}
              {stalled && jobId ? (
                <button
                  onClick={() => resumeJob(jobId)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  <RotateCcw size={16} /> Resume
                </button>
              ) : (
                <button
                  disabled
                  className="px-4 py-2 text-sm text-white bg-blue-400 rounded cursor-not-allowed opacity-60"
                >
                  <Loader2 size={16} className="inline animate-spin mr-1.5" />
                  Importing...
                </button>
              )}
            </div>
          </div>
        )
      }
      case 'result':
        return (
          <div className="flex justify-end">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700"
            >
              Done
            </button>
          </div>
        )
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Import ${entityConfig?.label || 'Data'}`}
      size="lg"
      footer={renderFooter()}
    >
      {step === 'select' && renderSelectStep()}
      {step === 'upload' && renderUploadStep()}
      {step === 'mapping' && renderMappingStep()}
      {step === 'preview' && renderPreviewStep()}
      {step === 'importing' && renderImportingStep()}
      {step === 'result' && renderResultStep()}
    </Modal>
  )
}
