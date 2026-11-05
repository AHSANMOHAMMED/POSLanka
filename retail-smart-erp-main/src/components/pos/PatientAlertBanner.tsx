'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { toast } from '@/components/ui/toast'

/**
 * Pharmacy POS: red warning strip when the selected customer has allergies / medical notes
 * (customers.allergies, customers.medical_notes — edited on Patient Medication History).
 */
export function PatientAlertBanner({ customerId, slug }: { customerId: string | null | undefined; slug: string }) {
  const [info, setInfo] = useState<{ id: string; name: string; allergies: string | null; medicalNotes: string | null } | null>(null)

  useEffect(() => {
    if (!customerId || (typeof navigator !== 'undefined' && !navigator.onLine)) return
    let cancelled = false
    fetch(`/api/pharmacy/patients/${customerId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (cancelled || !c?.hasWarning) return
        setInfo(c)
        if (c.allergies) toast.warning(`${c.name}: allergic to ${c.allergies}`)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [customerId])

  // Only the warning of the customer selected now (a previous customer's lookup is ignored)
  if (!info || info.id !== customerId) return null
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-red-300 bg-red-50 px-4 py-1.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
      <span className="flex items-center gap-1 font-bold"><AlertTriangle size={16} /> {info.name}</span>
      {info.allergies && <span><b>Allergies:</b> {info.allergies}</span>}
      {info.medicalNotes && <span><b>Notes:</b> {info.medicalNotes}</span>}
      <Link href={`/c/${slug}/pharmacy/patients?customerId=${info.id}`} target="_blank" className="ml-auto text-xs underline">Medication history</Link>
    </div>
  )
}
