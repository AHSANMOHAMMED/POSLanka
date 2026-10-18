import type { WebSmsConfig, SendSmsResult } from '../../types'

/**
 * WebSMS.lk / Newsletters.lk SMS Provider
 *
 * API Documentation: https://app.newsletters.lk/smsapi
 *
 * Features:
 * - Supports Unicode (Sinhala/Tamil) messages
 * - Automatic message segmentation
 * - Delivery reports
 */
export async function sendWithWebSms(
  config: WebSmsConfig,
  to: string,
  message: string
): Promise<SendSmsResult> {
  const url = 'https://app.newsletters.lk/smsAPI'

  // Format phone number for Sri Lanka (must be 94xxxxxxxxx format)
  const formattedPhone = formatSriLankanPhone(to)
  if (!formattedPhone) {
    return {
      success: false,
      errorMessage: 'Invalid phone number format. Must be a valid Sri Lankan number.',
    }
  }

  // Detect if message contains non-ASCII characters (Sinhala/Tamil)
  const isUnicode = /[^\x00-\x7F]/.test(message)
  const messageType = isUnicode ? 'unicode' : 'sms'

  // Calculate segments
  const segments = calculateSegments(message, isUnicode)

  const formData = new URLSearchParams({
    sendsms: '',
    apikey: config.apiKey,
    apitoken: config.apiToken,
    type: messageType,
    from: config.senderId,
    to: formattedPhone,
    text: message,
  })

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    })

    const responseText = await response.text()

    // Parse WebSMS response
    // Success: "0|MessageID|Credits Used"
    // Error: "Error code|Error message"
    const parts = responseText.split('|')
    const statusCode = parts[0]?.trim()

    if (statusCode === '0') {
      // Success
      const messageId = parts[1]?.trim()
      const creditsUsed = parseFloat(parts[2]?.trim() || '0')

      return {
        success: true,
        messageId,
        segments,
        cost: creditsUsed,
        providerResponse: {
          raw: responseText,
          statusCode,
          messageId,
          creditsUsed,
        },
      }
    }

    // Handle known error codes
    const errorMessage = getWebSmsErrorMessage(statusCode, parts[1])

    return {
      success: false,
      errorMessage,
      providerResponse: {
        raw: responseText,
        statusCode,
      },
    }
  } catch (error) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Failed to send SMS via WebSMS.lk',
      providerResponse: {
        error: String(error),
      },
    }
  }
}

/**
 * Test WebSMS.lk connection
 */
export async function testWebSmsConnection(config: WebSmsConfig): Promise<{
  success: boolean
  message: string
  balance?: number
}> {
  const url = 'https://app.newsletters.lk/smsAPI'

  const formData = new URLSearchParams({
    balance: '',
    apikey: config.apiKey,
    apitoken: config.apiToken,
  })

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    })

    const responseText = await response.text()
    const parts = responseText.split('|')
    const statusCode = parts[0]?.trim()

    if (statusCode === '0') {
      const balance = parseFloat(parts[1]?.trim() || '0')
      return {
        success: true,
        message: `Connection successful. Credit balance: ${balance}`,
        balance,
      }
    }

    return {
      success: false,
      message: getWebSmsErrorMessage(statusCode, parts[1]),
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    }
  }
}

/**
 * Format phone number for Sri Lankan network
 * Converts various formats to 94xxxxxxxxx
 */
function formatSriLankanPhone(phone: string): string | null {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '')

  // Handle different formats
  if (cleaned.startsWith('94') && cleaned.length === 11) {
    // Already in correct format: 94xxxxxxxxx
    return cleaned
  }

  if (cleaned.startsWith('0') && cleaned.length === 10) {
    // Local format: 0xxxxxxxxx -> 94xxxxxxxxx
    return '94' + cleaned.substring(1)
  }

  if (cleaned.length === 9 && !cleaned.startsWith('0')) {
    // Without leading zero: xxxxxxxxx -> 94xxxxxxxxx
    return '94' + cleaned
  }

  // Invalid format
  return null
}

/**
 * Calculate number of SMS segments based on content
 */
function calculateSegments(message: string, isUnicode: boolean): number {
  const length = message.length

  if (isUnicode) {
    // Unicode: 70 chars per segment, 67 for multipart
    if (length <= 70) return 1
    return Math.ceil(length / 67)
  } else {
    // GSM-7: 160 chars per segment, 153 for multipart
    if (length <= 160) return 1
    return Math.ceil(length / 153)
  }
}

/**
 * Get human-readable error message from WebSMS status code
 */
function getWebSmsErrorMessage(statusCode: string, additionalInfo?: string): string {
  const errorMessages: Record<string, string> = {
    '1': 'Invalid API key',
    '2': 'Invalid API token',
    '3': 'Sender ID not found',
    '4': 'Invalid sender ID',
    '5': 'Message content is empty',
    '6': 'Invalid recipient number',
    '7': 'Insufficient credits',
    '8': 'Invalid message type',
    '9': 'Account suspended',
    '10': 'Rate limit exceeded',
  }

  return errorMessages[statusCode] || additionalInfo || `Unknown error (code: ${statusCode})`
}
