'use client'

import { useState } from 'react'
import { FileText, X } from 'lucide-react'
import { useEscapeKey } from '@/hooks/useEscapeKey'

export interface PrescriptionForm {
  doctorName: string
  doctorRegNo?: string
  hospital?: string
  prescriptionNo?: string
  prescriptionDate?: string
  patientName?: string
  patientAge?: string
  patientPhone?: string
  notes?: string
}

export type RxLevel = 'none' | 'prescription' | 'controlled'

/** What is missing for this level (null = fine); mirrors src/lib/pharmacy/prescriptions.ts */
export function prescriptionMissing(level: RxLevel, p: PrescriptionForm | null): string | null {
  if (level === 'none') return null
  if (!p || p.doctorName.trim().length < 2) return 'Enter the doctor’s name.'
  if (level === 'controlled') {
    if (!p.doctorRegNo?.trim()) return 'Controlled drugs need the doctor’s SLMC registration number.'
    if (!p.patientName?.trim()) return 'Controlled drugs need the patient’s name.'
  }
  return null
}

/**
 * Pharmacy POS: prescription / controlled medicines in the cart → capture the prescription before
 * payment. Saved on the sale (prescription register); the server checks the same rule.
 */
export function PrescriptionModal({ level, items, initial, customerName, customerPhone, onSave, onClose }: {
  level: Exclude<RxLevel, 'none'>
  items: Array<{ id: string; name: string; drugSchedule: string }>
  initial: PrescriptionForm | null
  customerName?: string | null
  customerPhone?: string | null
  onSave: (p: PrescriptionForm) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<PrescriptionForm>(() => initial ?? {
    doctorName: '',
    patientName: customerName || '',
    patientPhone: customerPhone || '',
    prescriptionDate: new Date().toISOString().slice(0, 10),
  })
  const [error, setError] = useState<string | null>(null)
  useEscapeKey(true, onClose)
  const controlled = level === 'controlled'
  const set = (k: keyof PrescriptionForm, v: string) => setForm((f) => ({ ...f, [k]: v }))

  function save() {
    const missing = prescriptionMissing(level, form)
    if (missing) { setError(missing); return }
    onSave(form)
  }

  const field = (k: keyof PrescriptionForm, label: string, opts: { required?: boolean; type?: string; placeholder?: string } = {}) => (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">{label}{opts.required && <span className="text-red-600"> *</span>}</span>
      <input
        type={opts.type || 'text'}
        value={form[k] || ''}
        onChange={(e) => set(k, e.target.value)}
        placeholder={opts.placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
      />
    </label>
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="rx-title">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl dark:bg-gray-800">
        <div className="flex items-start justify-between gap-3 border-b p-5 dark:border-gray-700">
          <div className="flex items-start gap-3">
            <span className={`flex h-10 w-10 items-center justify-center rounded-full ${controlled ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}><FileText size={20} /></span>
            <div>
              <h2 id="rx-title" className="text-lg font-semibold text-gray-900 dark:text-white">{controlled ? 'Controlled drug — prescription required' : 'Prescription required'}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">{items.map((i) => i.name).join(', ')}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          {field('doctorName', 'Doctor’s name', { required: true, placeholder: 'Dr. N. Perera' })}
          {field('doctorRegNo', 'SLMC reg. no.', { required: controlled })}
          {field('hospital', 'Hospital / clinic')}
          {field('prescriptionNo', 'Prescription no.')}
          {field('prescriptionDate', 'Prescription date', { type: 'date' })}
          {field('patientName', 'Patient name', { required: controlled })}
          {field('patientAge', 'Patient age')}
          {field('patientPhone', 'Patient phone', { type: 'tel' })}
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium text-gray-700 dark:text-gray-300">Notes</span>
            <textarea value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
          </label>
        </div>
        {error && <p className="px-5 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 border-t p-5 dark:border-gray-700">
          <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-medium dark:border-gray-600">Cancel</button>
          <button type="button" onClick={save} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Continue to payment</button>
        </div>
      </div>
    </div>
  )
}
