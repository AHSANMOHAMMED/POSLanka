import { NextResponse } from 'next/server'
import { stockErrorResponse } from '@/lib/purchasing/stock-cost'
import { toApiError } from '@/lib/db/errors'

/** Business errors thrown inside the print job routes → API responses (null = unexpected → 500). */
export function printJobErrorResponse(error: unknown): NextResponse | null {
  const message = error instanceof Error ? error.message : ''
  if (message === 'USER_NOT_FOUND') {
    return NextResponse.json({ error: 'User not found for this tenant. Please log out and log in again.' }, { status: 400 })
  }
  if (message === 'INVALID_ITEM') return NextResponse.json({ error: 'One of the items was not found' }, { status: 400 })
  if (message.startsWith('SIZE_REQUIRED:')) {
    return NextResponse.json({ error: `Enter the size (width × height) for "${message.slice('SIZE_REQUIRED:'.length)}"`, code: 'SIZE_REQUIRED' }, { status: 400 })
  }
  if (message === 'ALREADY_INVOICED') return NextResponse.json({ error: 'This job has already been invoiced' }, { status: 400 })
  if (message === 'INVALID_STATUS') return NextResponse.json({ error: 'The job cannot be changed in its current status' }, { status: 400 })
  if (message === 'CUSTOMER_REQUIRED') return NextResponse.json({ error: 'Select a saved customer to put the balance on account' }, { status: 400 })
  if (message === 'SERIAL_NOT_SUPPORTED') return NextResponse.json({ error: 'Serial-numbered items cannot be sold through a print job' }, { status: 400 })
  const stock = stockErrorResponse(error)
  if (stock) return stock
  return toApiError(error)
}
