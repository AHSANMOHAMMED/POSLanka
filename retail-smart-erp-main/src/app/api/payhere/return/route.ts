import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { payhereTransactions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// GET /api/payhere/return - Return URL after PayHere checkout
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('order_id')
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  if (!orderId) {
    return NextResponse.redirect(`${baseUrl}/account?error=missing_order`)
  }

  // Check transaction status
  const transaction = await db.query.payhereTransactions.findFirst({
    where: eq(payhereTransactions.orderId, orderId),
  })

  if (!transaction) {
    return NextResponse.redirect(`${baseUrl}/account?error=transaction_not_found`)
  }

  // The notify webhook may not have arrived yet, so we show a pending/success page
  const status = transaction.status
  const redirectUrl = new URL('/account', baseUrl)

  if (status === 'success') {
    redirectUrl.searchParams.set('payment', 'success')
    redirectUrl.searchParams.set('order_id', orderId)
  } else if (status === 'failed' || status === 'cancelled') {
    redirectUrl.searchParams.set('payment', 'failed')
    redirectUrl.searchParams.set('order_id', orderId)
  } else {
    // Still pending - webhook hasn't arrived yet
    redirectUrl.searchParams.set('payment', 'processing')
    redirectUrl.searchParams.set('order_id', orderId)
  }

  return NextResponse.redirect(redirectUrl.toString())
}
