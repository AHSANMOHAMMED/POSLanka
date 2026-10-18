import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { validateBody } from '@/lib/validation/helpers'
import { contactFormSchema } from '@/lib/validation/schemas/public'

// --- In-memory rate limiting ---
// Maps IP address to an array of submission timestamps (in ms)
const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const RATE_LIMIT_MAX = 3 // max submissions per window

// Periodically clean up expired entries every 10 minutes
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000
let lastCleanup = Date.now()

function cleanupExpiredEntries() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now

  for (const [ip, timestamps] of rateLimitMap.entries()) {
    const valid = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
    if (valid.length === 0) {
      rateLimitMap.delete(ip)
    } else {
      rateLimitMap.set(ip, valid)
    }
  }
}

function isRateLimited(ip: string): boolean {
  cleanupExpiredEntries()

  const now = Date.now()
  const timestamps = rateLimitMap.get(ip) || []
  // Keep only timestamps within the window
  const valid = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)

  if (valid.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(ip, valid)
    return true
  }

  valid.push(now)
  rateLimitMap.set(ip, valid)
  return false
}

// --- HTML escaping ---
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(request: Request) {
  try {
    // Rate limiting by IP
    const headersList = await headers()
    const forwarded = headersList.get('x-forwarded-for')
    const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown'

    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: 'Too many submissions. Please try again later.' },
        { status: 429 }
      )
    }

    const parsed = await validateBody(request, contactFormSchema)
    if (!parsed.success) return parsed.response
    const { name, email, message, company, businessType } = parsed.data

    // Escape all user inputs for safe HTML insertion
    const safeName = escapeHtml(name.trim())
    const safeEmail = escapeHtml(email.trim())
    const safeMessage = escapeHtml(message.trim())
    const safeCompany = company ? escapeHtml(String(company).trim()) : ''
    const safeBusinessType = businessType ? escapeHtml(String(businessType).trim()) : ''

    // If Resend API key is configured, send email
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      const emailFrom = process.env.SYSTEM_EMAIL_FROM || 'noreply@retailsmarterp.com'
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: emailFrom,
          to: 'hello@retailsmarterp.com',
          subject: `Contact Form: ${safeName}${safeCompany ? ` (${safeCompany})` : ''}`,
          html: `
            <h2>New Contact Form Submission</h2>
            <p><strong>Name:</strong> ${safeName}</p>
            <p><strong>Email:</strong> ${safeEmail}</p>
            ${safeCompany ? `<p><strong>Company:</strong> ${safeCompany}</p>` : ''}
            ${safeBusinessType ? `<p><strong>Business Type:</strong> ${safeBusinessType}</p>` : ''}
            <hr />
            <p><strong>Message:</strong></p>
            <p>${safeMessage.replace(/\n/g, '<br />')}</p>
          `,
          reply_to: email.trim(),
        }),
      })
    } else {
      // Log to console when no email provider configured
      console.log('[Contact Form]', { name, email, company, businessType, message })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Contact form error:', error)
    return NextResponse.json({ error: 'Failed to process contact form' }, { status: 500 })
  }
}
