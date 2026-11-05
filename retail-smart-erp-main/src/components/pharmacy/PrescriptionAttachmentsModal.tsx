'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'

interface Attachment {
  id: string
  fileName: string
  fileType: string | null
  fileSize: number | null
  createdAt: string
  uploadedBy: string | null
  url: string
}

/** Photos / scans of one prescription: view, add (camera on phones / tablets) and remove. */
export function PrescriptionAttachmentsModal({ prescriptionId, title, onClose, onChanged }: {
  prescriptionId: string
  title: string
  onClose: () => void
  onChanged?: (count: number) => void
}) {
  const [rows, setRows] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Attachment | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/pharmacy/prescriptions/${prescriptionId}/attachments`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Could not load the images')
      setRows(body.data)
      setPreview((p) => p ?? body.data[0] ?? null)
      onChanged?.(body.data.length)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the images')
    } finally {
      setLoading(false)
    }
  }, [prescriptionId, onChanged])

  useEffect(() => { void load() }, [load])

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return
    setBusy(true)
    try {
      for (const file of Array.from(list)) {
        const form = new FormData()
        form.append('file', file)
        const res = await fetch(`/api/pharmacy/prescriptions/${prescriptionId}/attachments`, { method: 'POST', body: form })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) toast.error(`${file.name}: ${body.error || 'upload failed'}`)
        else setPreview(body)
      }
      await load()
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
      if (cameraRef.current) cameraRef.current.value = ''
    }
  }

  async function remove(a: Attachment) {
    if (!window.confirm(`Remove ${a.fileName}?`)) return
    const res = await fetch(`/api/pharmacy/prescriptions/${prescriptionId}/attachments?attachmentId=${a.id}`, { method: 'DELETE' })
    if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error || 'Could not remove'); return }
    if (preview?.id === a.id) setPreview(null)
    await load()
  }

  return (
    <Modal isOpen onClose={onClose} title={title} size="3xl">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload scan / photo
        </button>
        <button type="button" disabled={busy} onClick={() => cameraRef.current?.click()} className="inline-flex items-center gap-1 rounded border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-700">
          <Camera size={14} /> Take photo
        </button>
        <span className="text-xs text-gray-500">JPEG, PNG, WebP or PDF up to 10 MB</span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[200px_1fr]">
        <ul className="space-y-1 text-sm">
          {loading ? <li className="text-gray-500">Loading…</li> : rows.length === 0 ? <li className="text-gray-500">No images yet.</li> : rows.map((a) => (
            <li key={a.id} className={`flex items-center justify-between gap-1 rounded border px-2 py-1 dark:border-gray-700 ${preview?.id === a.id ? 'border-blue-500' : ''}`}>
              <button type="button" className="flex min-w-0 items-center gap-1 text-left" onClick={() => setPreview(a)}>
                <FileText size={14} className="shrink-0 text-gray-400" />
                <span className="truncate">{a.fileName}</span>
              </button>
              <button type="button" aria-label={`Remove ${a.fileName}`} onClick={() => remove(a)} className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
        <div className="min-h-[300px] rounded border bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900">
          {preview ? (
            preview.fileType === 'application/pdf'
              ? <iframe title={preview.fileName} src={preview.url} className="h-[60vh] w-full" />
              // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked API stream
              : <img src={preview.url} alt={preview.fileName} className="mx-auto max-h-[60vh] object-contain" />
          ) : <p className="p-6 text-center text-sm text-gray-500">Pick an image to view it.</p>}
          {preview && <a href={preview.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-blue-600 hover:underline">Open full size</a>}
        </div>
      </div>
    </Modal>
  )
}
