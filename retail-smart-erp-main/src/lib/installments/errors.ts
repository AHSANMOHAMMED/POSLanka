/**
 * Map the errors hire purchase routes expect (plan rules, cheques, ledger set-up, stock) to a
 * JSON response; null for anything else (the route logs it and answers 500). Server-only.
 */
import { NextResponse } from 'next/server'
import { ChequeError } from '@/lib/cheques/cheques'
import { InstallmentError } from './service'

export function installmentErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof InstallmentError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  if (error instanceof ChequeError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  if (!(error instanceof Error)) return null
  const message = error.message
  // the ledger posting needs the accounting set-up (same rule as sale payments)
  if (message.includes('fiscal year') || message.startsWith('GL_ACCOUNTS_MISSING') || error.name === 'GLValidationError') {
    return NextResponse.json({ error: message.replace(/^GL_ACCOUNTS_MISSING:\s*/, ''), code: 'ACCOUNTING_CONFIG' }, { status: 400 })
  }
  if (message.startsWith('INSUFFICIENT_STOCK:') || message === 'ITEM_NOT_FOUND') {
    return NextResponse.json({ error: message.replace(/^INSUFFICIENT_STOCK:/, 'Not enough stock: '), code: 'STOCK' }, { status: 400 })
  }
  return null
}
