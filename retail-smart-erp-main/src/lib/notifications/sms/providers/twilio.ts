import type { TwilioConfig, SendSmsResult } from '../../types'

/**
 * Twilio SMS Provider
 *
 * API Documentation: https://www.twilio.com/docs/sms/api
 *
 * Features:
 * - International SMS support
 * - Delivery status callbacks
 * - MMS support (not implemented)
 */
export async function sendWithTwilio(
  config: TwilioConfig,
  to: string,
  message: string
): Promise<SendSmsResult> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`

  // Format phone number to E.164 format
  const formattedPhone = formatE164(to)
  if (!formattedPhone) {
    return {
      success: false,
      errorMessage: 'Invalid phone number format. Must be a valid international number.',
    }
  }

  // Calculate segments (approximate)
  const segments = calculateSegments(message)

  const formData = new URLSearchParams({
    To: formattedPhone,
    From: config.phoneNumber,
    Body: message,
  })

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${config.accountSid}:${config.authToken}`),
      },
      body: formData.toString(),
    })

    const data = await response.json()

    if (response.ok && data.sid) {
      // Success
      return {
        success: true,
        messageId: data.sid,
        segments,
        cost: data.price ? Math.abs(parseFloat(data.price)) : undefined,
        providerResponse: data,
      }
    }

    // Handle error
    return {
      success: false,
      errorMessage: data.message || 'Failed to send SMS via Twilio',
      providerResponse: data,
    }
  } catch (error) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : 'Failed to send SMS via Twilio',
      providerResponse: {
        error: String(error),
      },
    }
  }
}

/**
 * Test Twilio connection by verifying account
 */
export async function testTwilioConnection(config: TwilioConfig): Promise<{
  success: boolean
  message: string
  balance?: number
}> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}.json`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + btoa(`${config.accountSid}:${config.authToken}`),
      },
    })

    const data = await response.json()

    if (response.ok && data.status === 'active') {
      // Fetch balance
      const balanceUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Balance.json`
      const balanceResponse = await fetch(balanceUrl, {
        method: 'GET',
        headers: {
          'Authorization': 'Basic ' + btoa(`${config.accountSid}:${config.authToken}`),
        },
      })

      let balance: number | undefined
      if (balanceResponse.ok) {
        const balanceData = await balanceResponse.json()
        balance = parseFloat(balanceData.balance || '0')
      }

      return {
        success: true,
        message: `Connection successful. Account: ${data.friendly_name}`,
        balance,
      }
    }

    return {
      success: false,
      message: data.message || 'Account verification failed',
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Connection failed',
    }
  }
}

/**
 * Format phone number to E.164 format (+XXXXXXXXXXXX)
 */
function formatE164(phone: string): string | null {
  // Remove all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '')

  // If starts with +, keep it
  if (cleaned.startsWith('+')) {
    if (cleaned.length >= 10 && cleaned.length <= 16) {
      return cleaned
    }
    return null
  }

  // If starts with 00, replace with +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.substring(2)
    if (cleaned.length >= 10 && cleaned.length <= 16) {
      return cleaned
    }
    return null
  }

  // Assume number needs country code - return as is with +
  // In production, you might want to apply a default country code
  if (cleaned.length >= 10 && cleaned.length <= 15) {
    return '+' + cleaned
  }

  return null
}

/**
 * Calculate approximate number of SMS segments
 */
function calculateSegments(message: string): number {
  // Check if message contains non-GSM characters
  const isUnicode = /[^\x20-\x7E\n\r]/.test(message)
  const length = message.length

  if (isUnicode) {
    if (length <= 70) return 1
    return Math.ceil(length / 67)
  } else {
    if (length <= 160) return 1
    return Math.ceil(length / 153)
  }
}
