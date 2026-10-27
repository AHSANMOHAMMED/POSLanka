'use client'

import type { ChangeEvent } from 'react'
import { FormInput, FormLabel } from '@/components/ui/form-elements'

/** Cheque details for an installment / down payment by cheque (goes to the cheques register) */
export interface ChequeDraft { chequeNo: string; bankName: string; branchName: string; chequeDate: string }

export const emptyCheque = (date: string): ChequeDraft => ({ chequeNo: '', bankName: '', branchName: '', chequeDate: date })

export function chequeMissing(c: ChequeDraft): string | null {
  if (!c.chequeNo.trim()) return 'Enter the cheque number'
  if (!c.bankName.trim()) return 'Enter the bank'
  if (!c.chequeDate) return 'Enter the cheque date'
  return null
}

export function chequePayload(c: ChequeDraft) {
  return { chequeNo: c.chequeNo.trim(), bankName: c.bankName.trim(), branchName: c.branchName.trim() || null, chequeDate: c.chequeDate }
}

export function ChequeFields({ value, onChange }: { value: ChequeDraft; onChange: (v: ChequeDraft) => void }) {
  const set = (k: keyof ChequeDraft) => (e: ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value })
  return (
    <div className="grid grid-cols-2 gap-2 rounded border border-dashed p-2 dark:border-gray-600">
      <div><FormLabel required>Cheque no</FormLabel><FormInput value={value.chequeNo} onChange={set('chequeNo')} maxLength={50} /></div>
      <div><FormLabel required>Cheque date</FormLabel><FormInput type="date" value={value.chequeDate} onChange={set('chequeDate')} /></div>
      <div><FormLabel required>Bank</FormLabel><FormInput value={value.bankName} onChange={set('bankName')} maxLength={100} /></div>
      <div><FormLabel>Branch</FormLabel><FormInput value={value.branchName} onChange={set('branchName')} maxLength={100} /></div>
      <p className="col-span-2 text-xs text-gray-500">Recorded in the cheques register. If it bounces, the installments become unpaid again.</p>
    </div>
  )
}
