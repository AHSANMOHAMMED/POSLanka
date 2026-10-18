import type { GenericHttpConfig, SendSmsResult } from '../../types'

/**
 * Generic HTTP SMS Gateway Provider (ERPNext-style)
 *
 * Allows integration with any SMS provider that has an HTTP API.
 * Uses simple parameter-based configuration:
 * - staticParams: Fixed parameters (API key, sender ID, etc.)
 * - messageParam: Parameter name for message content
 * - recipientParam: Parameter name for phone number
 */
export async function sendWithGenericHttp(
  config: GenericHttpConfig,
  to: string,
  message: string
): Promise<SendSmsResult> {
  // Prepare headers
  const headers: Record<string, string> = {
    ...config.headers,
  }

  // Add authentication (if using header-based auth)
  switch (config.authType) {
    case 'basic':
      headers['Authorization'] = 'Basic ' + btoa(config.authValue)
      break
    case 'bearer':
      headers['Authorization'] = `Bearer ${config.authValue}`
      break
    case 'api_key':
      const [headerName, apiKey] = config.authValue.split(':')
      if (headerName && apiKey) {
        headers[headerName] = apiKey
      }
      break
  }

  // Build parameters from ERPNext-style config
  const params = new URLSearchParams()

  // Add static parameters first (API key, sender ID, etc.)
  if (config.staticParams && config.staticParams.length > 0) {
    for (const param of config.staticParams) {
      if (param.key && param.value) {
        params.set(param.key, param.value)
      }
    }
  }

  // Add message and recipient parameters
  const messageParamName = config.messageParam || 'text'
  const recipientParamName = config.recipientParam || 'to'
  params.set(recipientParamName, to)
  params.set(messageParamName, message)

  try {
    let url = config.apiUrl
    const fetchOptions: RequestInit = {
      method: config.method,
      headers,
    }

    if (config.method === 'GET') {
      // GET: Append params to URL
      const separator = config.apiUrl.includes('?') ? '&' : '?'
      url = `${config.apiUrl}${separator}${params.toString()}`
    } else {
      // POST/PUT: Send as form-encoded body
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      fetchOptions.body = params.toString()
    }

    const response = await fetch(url, fetchOptions)
    const responseText = await response.text()

    // Try to parse as JSON
    let responseData: Record<string, unknown>
    try {
      responseData = JSON.parse(responseText)
    } catch {
      responseData = { raw: responseText }
    }

    // Determine success based on HTTP status
    if (response.ok) {
      // Look for common message ID fields
      const messageId =
        responseData.id ||
        responseData.messageId ||
        responseData.message_id ||
        responseData.msgid ||
        responseData.smsid

      return {
        success: true,
        messageId: messageId ? String(messageId) : undefined,
        segments: 1,
        providerResponse: responseData,
      }
    }

    // Error response
    const errorMessage =
      responseData.error ||
      responseData.message ||
      responseData.error_message ||
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
      providerResponse: {
        error: String(error),
      },
    }
  }
}

/**
 * Test generic HTTP gateway connection
 * Performs a dry-run request to verify connectivity
 */
export async function testGenericHttpConnection(
  config: GenericHttpConfig
): Promise<{
  success: boolean
  message: string
}> {
  // Prepare test headers
  const headers: Record<string, string> = {
    ...config.headers,
  }

  switch (config.authType) {
    case 'basic':
      headers['Authorization'] = 'Basic ' + btoa(config.authValue)
      break
    case 'bearer':
      headers['Authorization'] = `Bearer ${config.authValue}`
      break
    case 'api_key':
      const [headerName, apiKey] = config.authValue.split(':')
      if (headerName && apiKey) {
        headers[headerName] = apiKey
      }
      break
  }

  try {
    // Just check if the endpoint is reachable
    // We don't actually send a message during test
    const response = await fetch(config.apiUrl, {
      method: 'HEAD',
      headers,
    })

    // Even 4xx/5xx means the server is reachable
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
