import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { validateBody } from '@/lib/validation/helpers'
import { contactFormSchema } from '@/lib/validation/schemas/public'
import { consumeRateLimit } from '@/lib/auth/rate-limit'
import { fetchWithTimeout } from '@/lib/utils/fetch-timeout'

// Rate limiting: 3 submissions per hour per IP (database-backed, shared by all instances)
const CONTACT_RATE_LIMIT = { maxAttempts: 3, windowMs: 60 * 60 * 1000, category: 'contact_form' }

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

    if ((await consumeRateLimit(ip, CONTACT_RATE_LIMIT)).limited) {
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
      await fetchWithTimeout('https://api.resend.com/emails', {
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
