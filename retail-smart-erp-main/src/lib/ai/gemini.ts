import { GoogleGenerativeAI, type GenerateContentResult } from '@google/generative-ai'

// Lazy-loaded Gemini client
let genAI: GoogleGenerativeAI | null = null

function getGeminiClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return null
  if (!genAI) {
    genAI = new GoogleGenerativeAI(apiKey)
  }
  return genAI
}

/** Check if AI features are available (either DeepSeek or Gemini API key configured) */
export function isAIEnabled(): boolean {
  return !!(process.env.DEEPSEEK_API_KEY || process.env.GEMINI_API_KEY)
}

/** Check if AI features are enabled for a specific tenant (server keys + tenant opt-in) */
export function isAIEnabledForTenant(session: { user: { aiEnabled?: boolean } } | null): boolean {
  if (!isAIEnabled()) return false
  return session?.user?.aiEnabled === true
}

/** Get which AI provider is currently active */
export function getActiveProvider(): 'deepseek' | 'gemini' | null {
  if (process.env.DEEPSEEK_API_KEY) {
    // Check if DeepSeek is on cooldown
    const failedAt = failedModels.get('deepseek-chat')
    const onCooldown = failedAt && (Date.now() - failedAt < MODEL_COOLDOWN_MS)
    if (!onCooldown) return 'deepseek'
  }
  if (process.env.GEMINI_API_KEY) return 'gemini'
  return null
}

// Gemini model fallback chain
const GEMINI_MODEL_CHAIN = [
  'gemini-2.5-flash',
  'gemini-3-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
]

// Track which models are failing so we skip them temporarily
const failedModels = new Map<string, number>() // model -> timestamp when it failed
const MODEL_COOLDOWN_MS = 5 * 60 * 1000 // 5 minutes before retrying a failed model

function isModelAvailable(model: string): boolean {
  const failedAt = failedModels.get(model)
  if (!failedAt) return true
  if (Date.now() - failedAt > MODEL_COOLDOWN_MS) {
    failedModels.delete(model)
    return true
  }
  return false
}

function getAvailableGeminiModels(): string[] {
  return GEMINI_MODEL_CHAIN.filter(model => isModelAvailable(model))
}

// Simple in-memory rate limiter
const rateLimiter = {
  requests: [] as number[],
  maxPerMinute: 10,
  maxPerDay: 200,

  canMakeRequest(): boolean {
    const now = Date.now()
    // Clean old entries
    this.requests = this.requests.filter(t => t > now - 86400000)
    // Check daily limit
    if (this.requests.length >= this.maxPerDay) return false
    // Check per-minute limit
    const lastMinute = this.requests.filter(t => t > now - 60000)
    if (lastMinute.length >= this.maxPerMinute) return false
    return true
  },

  recordRequest(): void {
    this.requests.push(Date.now())
  },
}

// Token usage tracking
const tokenTracker = {
  daily: { input: 0, output: 0, date: '' },

  record(inputTokens: number, outputTokens: number): void {
    const today = new Date().toISOString().slice(0, 10)
    if (this.daily.date !== today) {
      this.daily = { input: 0, output: 0, date: today }
    }
    this.daily.input += inputTokens
    this.daily.output += outputTokens
  },

  getUsage() {
    return { ...this.daily }
  },
}

export interface AIResponse {
  text: string
  model?: string
  inputTokens?: number
  outputTokens?: number
}

// Track last error for diagnostics
let lastError: string | null = null
let currentModel: string | null = null
export function getLastError(): string | null { return lastError }
export function getCurrentModel(): string | null { return currentModel }

/**
 * Call DeepSeek API (OpenAI-compatible REST endpoint)
 */
async function callDeepSeek(
  prompt: string,
  options?: {
    systemPrompt?: string
    maxTokens?: number
    temperature?: number
  }
): Promise<AIResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured')

  const messages: Array<{ role: string; content: string }> = []
  if (options?.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }
  messages.push({ role: 'user', content: prompt })

  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      max_tokens: options?.maxTokens || 1024,
      temperature: options?.temperature ?? 0.7,
    }),
    signal: AbortSignal.timeout(30000), // 30s timeout
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`DeepSeek API error ${response.status}: ${errorBody}`)
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content || ''
  const inputTokens = data.usage?.prompt_tokens || 0
  const outputTokens = data.usage?.completion_tokens || 0

  return { text, model: 'deepseek-chat', inputTokens, outputTokens }
}

/**
 * Call Gemini API using the existing Google Generative AI SDK
 */
async function callGemini(
  client: GoogleGenerativeAI,
  modelName: string,
  prompt: string,
  options?: {
    systemPrompt?: string
    maxTokens?: number
    temperature?: number
  }
): Promise<AIResponse> {
  const model = client.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: options?.maxTokens || 1024,
      temperature: options?.temperature ?? 0.7,
    },
    ...(options?.systemPrompt ? { systemInstruction: options.systemPrompt } : {}),
  })

  const result: GenerateContentResult = await model.generateContent(prompt)
  const response = result.response
  const text = response.text()

  const inputTokens = response.usageMetadata?.promptTokenCount || 0
  const outputTokens = response.usageMetadata?.candidatesTokenCount || 0

  return { text, model: modelName, inputTokens, outputTokens }
}

/**
 * Generate text using DeepSeek (primary) with Gemini fallback.
 * Tries DeepSeek first, then each Gemini model in the chain until one succeeds.
 * Returns null if all providers fail or AI is not available.
 */
export async function generateText(
  prompt: string,
  options?: {
    systemPrompt?: string
    maxTokens?: number
    temperature?: number
  }
): Promise<AIResponse | null> {
  if (!isAIEnabled()) return null

  if (!rateLimiter.canMakeRequest()) {
    console.warn('[AI] Rate limit reached, skipping request')
    lastError = 'Rate limit reached. Please wait a moment before trying again.'
    return null
  }

  rateLimiter.recordRequest()

  // 1. Try DeepSeek first (if configured and not on cooldown)
  if (process.env.DEEPSEEK_API_KEY && isModelAvailable('deepseek-chat')) {
    try {
      const result = await callDeepSeek(prompt, options)
      tokenTracker.record(result.inputTokens || 0, result.outputTokens || 0)
      currentModel = 'deepseek-chat'
      lastError = null
      console.log('[AI] Success with deepseek-chat')
      return result
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const isQuotaError = msg.includes('429') || msg.includes('quota') || msg.includes('402')
      const isRecoverable = isQuotaError || msg.includes('503') || msg.includes('502')

      lastError = `deepseek-chat: ${msg.slice(0, 120)}`
      if (isRecoverable) {
        failedModels.set('deepseek-chat', Date.now())
        console.warn(`[AI] deepseek-chat failed (${msg.slice(0, 80)}), falling back to Gemini...`)
      } else {
        // Non-recoverable error — still try Gemini as fallback
        console.error(`[AI] deepseek-chat error: ${msg.slice(0, 120)}`)
      }
    }
  }

  // 2. Try Gemini models (if configured)
  const geminiClient = getGeminiClient()
  if (geminiClient) {
    const models = getAvailableGeminiModels()
    if (models.length === 0) {
      console.warn('[AI] All Gemini models are on cooldown')
    } else {
      for (const modelName of models) {
        try {
          const result = await callGemini(geminiClient, modelName, prompt, options)
          tokenTracker.record(result.inputTokens || 0, result.outputTokens || 0)
          currentModel = modelName
          lastError = null
          console.log(`[AI] Success with ${modelName}`)
          return result
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          const isQuotaError = msg.includes('429') || msg.includes('quota')
          const isModelError = msg.includes('404') || msg.includes('not found')

          if (isQuotaError || isModelError) {
            failedModels.set(modelName, Date.now())
            console.warn(`[AI] ${modelName} failed (${isQuotaError ? 'quota' : 'not found'}), trying next model...`)
            continue
          }

          // Non-recoverable Gemini error
          lastError = msg
          console.error(`[AI] ${modelName} error:`, msg)
          return null
        }
      }
    }
  }

  // All providers failed
  lastError = 'All AI providers failed (quota exceeded or unavailable)'
  console.error('[AI] All providers exhausted')
  return null
}

/**
 * Generate structured JSON output from AI
 */
export async function generateJSON<T>(
  prompt: string,
  options?: {
    systemPrompt?: string
    maxTokens?: number
    temperature?: number
  }
): Promise<T | null> {
  const response = await generateText(prompt, {
    ...options,
    systemPrompt: (options?.systemPrompt || '') + '\n\nRespond ONLY with valid JSON. No markdown, no code fences, no explanation.',
  })

  if (!response) return null

  try {
    // Strip markdown code fences if present
    let jsonText = response.text.trim()
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }
    return JSON.parse(jsonText) as T
  } catch {
    console.error('[AI] Failed to parse JSON response:', response.text.slice(0, 200))
    return null
  }
}

/** Get current token usage stats */
export function getTokenUsage() {
  return tokenTracker.getUsage()
}
