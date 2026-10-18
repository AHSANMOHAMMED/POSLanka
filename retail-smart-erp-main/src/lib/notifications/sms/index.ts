import type { SmsSettings, SendSmsResult } from '../types'

/**
 * Format phone number with country code
 * Sri Lanka: 0771234567 → 94771234567
 */
function formatPhoneNumber(phone: string): string {
  // Remove spaces, dashes, parentheses
  let cleaned = phone.replace(/[\s\-\(\)]/g, '')

  // Remove leading + if present
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1)
  }

  // Sri Lankan number starting with 0 → add 94
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '94' + cleaned.substring(1)
  }

  return cleaned
}

/**
 * Send SMS using ERPNext-style generic HTTP gateway
 */
export async function sendSms(
  settings: SmsSettings,
  to: string,
  message: string
): Promise<SendSmsResult> {
  if (!settings.isEnabled) {
    return {
      success: false,
      errorMessage: 'SMS is not enabled',
    }
  }

  if (!settings.genericApiUrl) {
    return {
      success: false,
      errorMessage: 'SMS Gateway URL is not configured',
    }
  }

  // Format phone number with country code
  const formattedPhone = formatPhoneNumber(to)

  // Build parameters
  const params = new URLSearchParams()

  // Add static parameters first (API key, sender ID, etc.)
  const staticParams = settings.genericStaticParams as Array<{ key: string; value: string }> || []
  for (const param of staticParams) {
    if (param.key) {
      // Allow empty values (for flags like "sendsms")
      params.set(param.key, param.value || '')
    }
  }

  // Add message and recipient parameters
  const messageParam = settings.genericMessageParam || 'text'
  const recipientParam = settings.genericRecipientParam || 'to'
  params.set(recipientParam, formattedPhone)
  params.set(messageParam, message)

  try {
    const method = settings.genericMethod || 'POST'
    let url = settings.genericApiUrl
    const fetchOptions: RequestInit = { method }

    if (method === 'GET') {
      // GET: Append params to URL
      const separator = url.includes('?') ? '&' : '?'
      url = `${url}${separator}${params.toString()}`
    } else {
      // POST: Send as form-encoded body
      fetchOptions.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
      fetchOptions.body = params.toString()
    }

    const response = await fetch(url, fetchOptions)
    const responseText = await response.text()

    console.log('SMS Gateway Response:', responseText)

    // Try to parse as JSON
    let responseData: Record<string, unknown>
    try {
      responseData = JSON.parse(responseText)
    } catch {
      responseData = { raw: responseText }
    }

    // Check for success indicators
    // WebSMS.lk returns "1701" or "1701:messageId" for success
    // Other gateways may return JSON with status fields
    const isSuccess = response.ok && (
      // Plain text success codes
      responseText.startsWith('1701') ||
      responseText.toLowerCase().includes('success') ||
      responseText.toLowerCase() === 'ok' ||
      // JSON success indicators
      responseData.status === '1701' ||
      responseData.status === 1701 ||
      responseData.success === true ||
      responseData.code === 0 ||
      responseData.code === '0' ||
      // If HTTP 200 and no obvious error, assume success
      (response.ok && !responseText.toLowerCase().includes('error') && !responseText.toLowerCase().includes('fail'))
    )

    if (isSuccess) {
      // Look for common message ID fields
      const messageId =
        responseData.group_id ||  // WebSMS.lk
        responseData.id ||
        responseData.messageId ||
        responseData.message_id ||
        responseData.msgid ||
        responseData.smsid

      return {
        success: true,
        messageId: messageId ? String(messageId).trim() : undefined,
        segments: 1,
        providerResponse: responseData,
      }
    }

    // Error response
    const errorMessage =
      responseData.error ||
      responseData.message ||
      responseData.error_message ||
      responseText ||
      `HTTP ${response.status}: ${response.statusText}`

    return {
      success: false,
      errorMessage: String(errorMessage),
      providerResponse: responseData,
    }
  } catch (error) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Failed to send SMS',
      providerResponse: { error: String(error) },
    }
  }
}

/**
 * Test SMS gateway connection
 */
export async function testSmsConnection(settings: SmsSettings): Promise<{
  success: boolean
  message: string
}> {
  if (!settings.genericApiUrl) {
    return {
      success: false,
      message: 'SMS Gateway URL is not configured',
    }
  }

  try {
    // Just check if the endpoint is reachable
    const response = await fetch(settings.genericApiUrl, { method: 'HEAD' })
    return {
      success: true,
      message: `Gateway reachable. Status: ${response.status}`,
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    }
  }
}
