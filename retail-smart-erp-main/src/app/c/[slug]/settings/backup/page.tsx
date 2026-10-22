'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Breadcrumb } from '@/components/ui/page-header'
import { toast } from '@/components/ui/toast'
import { useCompany } from '@/components/providers/CompanyContextProvider'

export default function BackupPage() {
  const { role } = useCompany()
  const [starting, setStarting] = useState(false)

  async function download() {
    setStarting(true)
    try {
      // Errors (403 / 429 / 409) come back as JSON before any archive bytes.
      const res = await fetch('/api/export/backup')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Backup failed')
        return
      }
      const disposition = res.headers.get('content-disposition') || ''
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] || 'poslanka-backup.zip'
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Backup downloaded')
    } catch {
      toast.error('Backup download was interrupted')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: 'Settings' }, { label: 'Backup' }]} />
      <div>
        <h2 className="text-lg font-semibold">Company backup</h2>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Download every record of this company (items, stock, sales, customers, accounting, settings…) as one ZIP
          of JSON Lines files. Passwords, PINs and integration secrets are removed. Uploaded files (images,
          attachments) are listed but not included. The download is recorded in the activity log; at most 3 per hour.
        </p>
      </div>
      {role === 'owner' ? (
        <button
          type="button"
          onClick={() => void download()}
          disabled={starting}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          {starting ? 'Preparing backup…' : 'Download full backup'}
        </button>
      ) : (
        <p className="text-sm text-gray-600">Only the company owner can download a full backup.</p>
      )}
    </div>
  )
}
