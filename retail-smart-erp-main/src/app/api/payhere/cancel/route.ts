import { NextRequest, NextResponse } from 'next/server'

// GET /api/payhere/cancel - Cancel URL for PayHere checkout
export async function GET(request: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const orderId = request.nextUrl.searchParams.get('order_id')

  const redirectUrl = new URL('/account', baseUrl)
  redirectUrl.searchParams.set('payment', 'cancelled')
  if (orderId) {
    redirectUrl.searchParams.set('order_id', orderId)
  }

  return NextResponse.redirect(redirectUrl.toString())
}
