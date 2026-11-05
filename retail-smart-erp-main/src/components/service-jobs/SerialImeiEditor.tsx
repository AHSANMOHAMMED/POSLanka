'use client'

import { useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { imeiWarning } from '@/lib/utils/imei'
import { WarrantyCardButton } from './WarrantyCardButton'

/**
 * IMEI / IMEI 2 of a serial-numbered unit (0193) with a check-digit warning (the unit still
 * saves), and the warranty card once the unit is sold. Shown in the serial-number page's row.
 */
export function SerialImeiEditor({ serialId, imei, imei2, sold, onSaved }: {
  serialId: string; imei: string | null; imei2: string | null; sold: boolean; onSaved?: () => void
}) {
  const [v1, setV1] = useState(imei || '')
  const [v2, setV2] = useState(imei2 || '')
  const [saving, setSaving] = useState(false)
  const w1 = imeiWarning(v1)
  const w2 = imeiWarning(v2)
  const cls = 'h-8 w-44 px-2 text-sm font-mono rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white'

  async function save() {
    setSaving(true)
    try {
      const body = !v1.trim() && !v2.trim() ? { clearImei: true } : { imei: v1.trim() || undefined, imei2: v2.trim() || undefined }
      const res = await fetch(`/api/serial-numbers/${serialId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || 'Could not save the IMEI'); return }
      toast.success(w1 || w2 ? 'Saved — please re-check the IMEI digits' : 'IMEI saved')
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-3 mb-3" onClick={(e) => e.stopPropagation()}>
      <label className="text-xs text-gray-500">IMEI
        <input className={`${cls} block mt-0.5`} inputMode="numeric" value={v1} onChange={(e) => setV1(e.target.value)} placeholder="15 digits" />
        {w1 && <span className="block text-[11px] text-amber-600 max-w-[11rem]">{w1}</span>}
      </label>
      <label className="text-xs text-gray-500">IMEI 2
        <input className={`${cls} block mt-0.5`} inputMode="numeric" value={v2} onChange={(e) => setV2(e.target.value)} placeholder="dual SIM" />
        {w2 && <span className="block text-[11px] text-amber-600 max-w-[11rem]">{w2}</span>}
      </label>
      <button type="button" onClick={save} disabled={saving} className="mt-4 flex items-center gap-1 h-8 px-3 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save IMEI
      </button>
      {sold && <WarrantyCardButton serialNumberId={serialId} className="mt-4" />}
    </div>
  )
}
