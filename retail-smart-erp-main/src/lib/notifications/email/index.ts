import { db } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { tenants } from '@/lib/db/schema'
import type { ResendConfig, SendEmailResult } from '../types'
import { sendWithResend } from './providers/resend'

/**
 * Send email via platform Resend account.
 * All tenant notification emails are sent from slug@retailsmarterp.com
 */
export async function sendEmail(
  tenantId: string,
  to: string | string[],
  subject: string,
  htmlBody: string,
  textBody?: string
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return {
      success: false,
      errorMessage: 'Platform email not configured (RESEND_API_KEY missing)',
    }
  }

  // Look up tenant for from address
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { slug: true, name: true, email: true },
  })

  if (!tenant) {
    return {
      success: false,
      errorMessage: 'Tenant not found',
    }
  }

  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'retailsmarterp.com'
  const config: ResendConfig = {
    apiKey,
    fromName: tenant.name,
    fromEmail: `${tenant.slug}@${baseDomain}`,
    replyTo: tenant.email,
  }

  return sendWithResend(config, to, subject, htmlBody, textBody)
}
