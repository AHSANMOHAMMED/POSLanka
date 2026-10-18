import type { ResendConfig, SendEmailResult } from '../../types'

/**
 * Resend Email Provider
 *
 * API Documentation: https://resend.com/docs/api-reference
 *
 * Features:
 * - Modern API design
 * - Developer friendly
 * - Good deliverability
 */
export async function sendWithResend(
  config: ResendConfig,
  to: string | string[],
  subject: string,
  htmlBody: string,
  textBody?: string
): Promise<SendEmailResult> {
  const url = 'https://api.resend.com/emails'

  const payload = {
    from: `${config.fromName} <${config.fromEmail}>`,
    to: Array.isArray(to) ? to : [to],
    reply_to: config.replyTo,
    subject,
    html: htmlBody,
    text: textBody || stripHtml(htmlBody),
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (response.ok && data.id) {
      return {
        success: true,
        messageId: data.id,
        providerResponse: data,
      }
    }

    // Error handling
    const errorMessage = data.message || data.error || 'Failed to send email'

    return {
      success: false,
      errorMessage,
      providerResponse: data,
    }
  } catch (error) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Failed to send email via Resend',
      providerResponse: {
        error: String(error),
      },
    }
  }
}

/**
 * Test Resend API connection
 */
export async function testResendConnection(config: ResendConfig): Promise<{
  success: boolean
  message: string
}> {
  // Verify API key by fetching domains
  const url = 'https://api.resend.com/domains'

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
    })

    if (response.ok) {
      const data = await response.json()
      const domains = data.data || []
      const verifiedDomains = domains.filter((d: { status: string }) => d.status === 'verified')

      if (verifiedDomains.length > 0) {
        return {
          success: true,
          message: `Connected. ${verifiedDomains.length} verified domain(s)`,
        }
      }

      return {
        success: true,
        message: 'Connected. No verified domains yet.',
      }
    }

    if (response.status === 401) {
      return {
        success: false,
        message: 'Invalid API key',
      }
    }

    return {
      success: false,
      message: `Connection failed: HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    }
  }
}

/**
 * Strip HTML tags from content for plain text version
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '  - ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
