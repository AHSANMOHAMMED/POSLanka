import { NextResponse } from 'next/server'
import { toApiError } from '@/lib/db/errors'
import { SaleFlowError } from './returns'

/**
 * Map errors thrown by the returns / exchange library (and the stock ledger) to API responses.
 * Returns null for unexpected errors (caller answers 500).
 */
export function saleFlowErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof SaleFlowError) {
    return NextResponse.json({ error: error.message, code: error.code, ...(error.details || {}) }, { status: error.status })
  }
  const message = error instanceof Error ? error.message : ''
  if (message === 'USER_NOT_FOUND') {
    return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
  }
  if (message.startsWith('INSUFFICIENT_STOCK:')) {
    return NextResponse.json({ error: `Insufficient stock: ${message.replace('INSUFFICIENT_STOCK:', '')}`, code: 'INSUFFICIENT_STOCK' }, { status: 400 })
  }
  if (message.startsWith('SERIAL_MISMATCH:')) {
    return NextResponse.json({ error: message.replace('SERIAL_MISMATCH:', ''), code: 'SERIAL_MISMATCH' }, { status: 400 })
  }
  if (/^Serial numbers (not found|not available|do not belong|not in expected)/.test(message)) {
    return NextResponse.json({ error: message, code: 'SERIAL_INVALID' }, { status: 400 })
  }
  if (message.startsWith('GL_ACCOUNTS_MISSING')) {
    return NextResponse.json({ error: message.replace(/^GL_ACCOUNTS_MISSING:\s*/, ''), code: 'GL_ACCOUNTS_MISSING' }, { status: 400 })
  }
  return toApiError(error)
}
