// Import from tenant-context directly to avoid bundling auth module in server.js
import { withoutTenant, withTenant, type TenantDb } from '@/lib/db/tenant-context'
import { aiErrorLogs, tenants } from '@/lib/db/schema'
import { generateText, isAIEnabled } from './gemini'
import { SYSTEM_PROMPTS, formatErrorForPrompt } from './prompts'
import { eq, and, gte, sql } from 'drizzle-orm'
import crypto from 'crypto'

export type ErrorSource = 'system' | 'user_report' | 'frontend'

interface ErrorContext {
  userId?: string
  tenantId?: string
  method?: string
  path?: string
  body?: unknown
  params?: Record<string, string>
  url?: string
  userAgent?: string
  browserInfo?: Record<string, unknown>
  errorSource?: ErrorSource
  // Allow additional debug context properties
  [key: string]: unknown
}

/**
 * Log an error to the database with optional AI analysis.
 * Non-blocking: fire-and-forget pattern (same as broadcastChange).
 * Deduplicates by fingerprint — increments occurrenceCount for same error within 24h.
 */
export function logError(
  source: string,
  error: unknown,
  context?: ErrorContext
): void {
  // Fire-and-forget — don't block the API route
  _logErrorAsync(source, error, context).catch(err => {
    console.error('[AI ErrorLogger] Failed to log error:', err)
  })
}

/** Log a warning */
export function logWarning(
  source: string,
  message: string,
  context?: ErrorContext
): void {
  _logAsync('warning', source, message, undefined, context).catch(err => {
    console.error('[AI ErrorLogger] Failed to log warning:', err)
  })
}

/** Log info */
export function logInfo(
  source: string,
  message: string,
  context?: ErrorContext
): void {
  _logAsync('info', source, message, undefined, context).catch(err => {
    console.error('[AI ErrorLogger] Failed to log info:', err)
  })
}

async function _logErrorAsync(
  source: string,
  error: unknown,
  context?: ErrorContext
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  await _logAsync('error', source, message, stack, context)
}

async function _logAsync(
  level: 'error' | 'warning' | 'info',
  source: string,
  message: string,
  stack?: string,
  context?: ErrorContext
): Promise<void> {
  // Generate group hash for similar error grouping
  const groupHash = generateGroupHash(source, message)

  // Generate fingerprint for deduplication (more specific than groupHash)
  const fingerprint = generateFingerprint(source, message, stack)

  // Sanitize context — remove sensitive fields
  const safeContext = context ? sanitizeContext(context) : null

  const errorSource = context?.errorSource || 'system'
  const tenantId = context?.tenantId

  // Try deduplication: if same fingerprint exists within 24h, increment count
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  
  const performDbOperation = async (dbInstance: TenantDb) => {
    const [existing] = await dbInstance
      .update(aiErrorLogs)
      .set({
        occurrenceCount: sql`COALESCE(${aiErrorLogs.occurrenceCount}, 1) + 1`,
        lastOccurredAt: new Date(),
        stack: stack || undefined, // update stack if available
      })
      .where(and(
        eq(aiErrorLogs.errorFingerprint, fingerprint),
        gte(aiErrorLogs.createdAt, twentyFourHoursAgo),
      ))
      .returning({ id: aiErrorLogs.id })

    if (existing) {
      return { deduplicated: true }
    }

    // Insert new log entry
    const [logEntry] = await dbInstance.insert(aiErrorLogs).values({
      tenantId: tenantId || null,
      level,
      source,
      message,
      stack: stack || null,
      context: safeContext,
      groupHash,
      errorSource,
      errorFingerprint: fingerprint,
      occurrenceCount: 1,
      lastOccurredAt: new Date(),
      reportedUrl: context?.url || null,
      userAgent: context?.userAgent || null,
      browserInfo: context?.browserInfo || null,
    }).returning()

    return { deduplicated: false, logEntry }
  }

  let result
  if (tenantId) {
    // Use withTenant for tenant-scoped errors
    result = await withTenant(tenantId, performDbOperation)
  } else {
    // Use withoutTenant for system-wide errors (no tenant context)
    result = await withoutTenant(performDbOperation)
  }

  if (result.deduplicated) {
    return // Deduplicated — just incremented count
  }

  // Queue AI analysis asynchronously (only for errors, respecting tenant AI opt-in)
  if (level === 'error' && result.logEntry && isAIEnabled()) {
    // Skip AI analysis if tenant has AI disabled
    const shouldAnalyze = tenantId
      ? await withTenant(tenantId, async (dbInst) => {
          const [t] = await dbInst.select({ aiEnabled: tenants.aiEnabled }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
          return t?.aiEnabled ?? false
        })
      : true // System errors (no tenant) still get AI analysis

    if (shouldAnalyze) {
      analyzeErrorAsync(result.logEntry.id, source, message, stack, context?.method, context?.path, result.logEntry.tenantId).catch(() => {
        // Silently ignore AI analysis failures
      })
    }
  }
}

async function analyzeErrorAsync(
  logId: string,
  source: string,
  message: string,
  stack?: string,
  method?: string,
  path?: string,
  tenantId?: string | null
): Promise<void> {
  const prompt = formatErrorForPrompt({ message, stack, source, method, path })

  const result = await generateText(prompt, {
    systemPrompt: SYSTEM_PROMPTS.errorAnalysis,
    maxTokens: 300,
    temperature: 0.3,
  })

  if (result) {
    // Parse AI response into analysis and suggestion
    const lines = result.text.split('\n').filter(l => l.trim())
    const analysis = lines.slice(0, 2).join(' ')
    const suggestion = lines.slice(2).join(' ') || null

    const updateOperation = async (dbInstance: TenantDb) => {
      await dbInstance.update(aiErrorLogs)
        .set({
          aiAnalysis: analysis,
          aiSuggestion: suggestion,
        })
        .where(eq(aiErrorLogs.id, logId))
    }

    if (tenantId) {
      await withTenant(tenantId, updateOperation)
    } else {
      await withoutTenant(updateOperation)
    }
  }
}

/** Generate a hash for grouping similar errors (loose — normalizes dynamic values) */
function generateGroupHash(source: string, message: string): string {
  const normalized = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\b\d+\b/g, '<N>')
    .replace(/"[^"]*"/g, '"<STR>"')

  return crypto
    .createHash('sha256')
    .update(`${source}:${normalized}`)
    .digest('hex')
    .slice(0, 16)
}

/** Generate a fingerprint for deduplication (tighter — includes first stack frame) */
function generateFingerprint(source: string, message: string, stack?: string): string {
  const firstFrame = stack?.split('\n').find(line => line.trim().startsWith('at '))?.trim() || ''
  const normalized = message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\b\d+\b/g, '<N>')

  return crypto
    .createHash('sha256')
    .update(`${source}:${normalized}:${firstFrame}`)
    .digest('hex')
    .slice(0, 32)
}

/** Remove sensitive data from context before storing */
function sanitizeContext(context: ErrorContext): Record<string, unknown> {
  const safe: Record<string, unknown> = {}

  if (context.userId) safe.userId = context.userId
  if (context.tenantId) safe.tenantId = context.tenantId
  if (context.method) safe.method = context.method
  if (context.path) safe.path = context.path
  if (context.params) safe.params = context.params

  // Don't store request body — may contain passwords/tokens
  return safe
}
