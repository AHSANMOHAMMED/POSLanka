import { NextRequest, NextResponse } from 'next/server'
import { sql, eq, desc } from 'drizzle-orm'
import { authWithCompany } from '@/lib/auth'
import { withTenant } from '@/lib/db'
import { db as rawDb } from '@/lib/db'
import { generateText, isAIEnabledForTenant, getLastError } from '@/lib/ai/gemini'
import { SYSTEM_PROMPTS } from '@/lib/ai/prompts'
import { chatTools, getToolCatalog, findRelevantToolsByKeyword, parseToolSelection } from '@/lib/ai/chat-tools'
import { logError } from '@/lib/ai/error-logger'
import { hasPermission, ROLE_PERMISSIONS, type Permission } from '@/lib/auth/roles'
import { aiChatMessages, tenants } from '@/lib/db/schema'
import { validateBody } from '@/lib/validation/helpers'
import { aiChatSchema } from '@/lib/validation/schemas/ai'
import { requireQuota } from '@/lib/db/storage-quota'

export async function POST(request: NextRequest) {
  const session = await authWithCompany()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const quotaError = await requireQuota(session.user.tenantId, 'standard')
  if (quotaError) return quotaError

  if (!isAIEnabledForTenant(session)) {
    return NextResponse.json({
      response: 'AI features are not enabled for this company. An admin can enable AI in Settings.',
    })
  }

  const parsed = await validateBody(request, aiChatSchema)
  if (!parsed.success) return parsed.response
  const { message, context } = parsed.data

  const tenantId = session.user.tenantId
  const userId = session.user.id
  const userRole = session.user.role || 'cashier'
  const businessType = session.user.businessType || 'retail'
  const userName = session.user.name || 'User'
  const tenantSlug = session.user.tenantSlug || ''

  // Fetch company info (tenants table has no RLS, use raw db)
  let companyInfo = { name: session.user.tenantName || '', currency: '', plan: '', country: '' }
  try {
    const [tenant] = await rawDb.select({
      name: tenants.name,
      currency: tenants.currency,
      plan: tenants.plan,
      country: tenants.country,
    }).from(tenants).where(eq(tenants.id, tenantId))
    if (tenant) {
      companyInfo = {
        name: tenant.name || '',
        currency: tenant.currency || '',
        plan: tenant.plan || '',
        country: tenant.country || '',
      }
    }
  } catch { /* silent */ }

  // Build user permissions list
  const userPermissions: string[] = []
  for (const perm of Object.keys(ROLE_PERMISSIONS)) {
    if (hasPermission(userRole, perm as Permission)) {
      userPermissions.push(perm)
    }
  }

  return await withTenant(tenantId, async (db) => {
    // Fetch conversation history (last 10 messages)
    let conversationHistory: { role: string; content: string }[] = []
    try {
      const history = await db.select({
        role: aiChatMessages.role,
        content: aiChatMessages.content,
      }).from(aiChatMessages)
        .where(eq(aiChatMessages.userId, userId))
        .orderBy(desc(aiChatMessages.createdAt))
        .limit(10)

      conversationHistory = history.reverse()
    } catch { /* table might not exist yet */ }

    // Save user message
    try {
      await db.insert(aiChatMessages).values({
        tenantId,
        userId,
        role: 'user',
        content: message,
        metadata: { page: context?.page, businessType },
      })
    } catch { /* silent */ }

    // Prepare params for navigation/system tools
    const toolParams: Record<string, string> = {
      query: message,
      businessType,
      userRole,
      companyName: companyInfo.name,
      plan: companyInfo.plan,
      currency: companyInfo.currency,
      slug: tenantSlug,
    }

    // Step 1: Use LLM to select relevant tools, fallback to keyword matching
    let selectedTools = await selectToolsWithLLM(message, businessType, conversationHistory)

    if (selectedTools.length === 0) {
      selectedTools = findRelevantToolsByKeyword(message)
    }

    // Step 2: Execute selected tools in parallel
    const toolPromises = selectedTools.map(async (tool) => {
      try {
        const result = await tool.execute(db, toolParams)
        return `[${tool.name}]: ${result}`
      } catch (err) {
        logError('api/ai/chat', err)
        return null
      }
    })
    const toolResults = (await Promise.all(toolPromises)).filter(Boolean) as string[]

    // Step 3: Build enhanced prompt with full context
    const contextParts: string[] = []
    contextParts.push(`Company: ${companyInfo.name}`)
    contextParts.push(`Business type: ${businessType}`)
    contextParts.push(`Currency: ${companyInfo.currency || 'Not configured'}`)
    contextParts.push(`Plan: ${companyInfo.plan || 'free'}`)

    contextParts.push(`\nUser: ${userName}`)
    contextParts.push(`Role: ${userRole}`)
    contextParts.push(`Permissions: ${userPermissions.join(', ')}`)

    if (context?.page) {
      contextParts.push(`\nCurrent page: ${context.page}`)
    }

    if (conversationHistory.length > 0) {
      contextParts.push('\nRecent conversation:')
      conversationHistory.forEach(msg => {
        contextParts.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.slice(0, 300)}`)
      })
    }

    if (toolResults.length > 0) {
      contextParts.push(`\nData from database:\n${toolResults.join('\n\n')}`)
    }

    const prompt = contextParts.join('\n') + `\n\nUser question: ${message}`

    const aiResponse = await generateText(prompt, {
      systemPrompt: SYSTEM_PROMPTS.chatAssistant,
      maxTokens: 800,
      temperature: 0.7,
    })

    if (!aiResponse) {
      if (toolResults.length > 0) {
        const fallbackText = toolResults.map(r => r.replace(/^\[.*?\]:\s*/, '')).join('\n\n')
        try {
          await db.insert(aiChatMessages).values({
            tenantId, userId, role: 'assistant', content: fallbackText,
            toolsUsed: selectedTools.map(t => t.name),
          })
        } catch { /* silent */ }
        return NextResponse.json({
          response: fallbackText,
          toolsUsed: selectedTools.map(t => t.name),
          aiFallback: true,
        })
      }

      const errorHint = getLastError()
      const isQuota = errorHint?.includes('429') || errorHint?.includes('quota')
      const isRateLimit = errorHint?.includes('Rate limit')
      return NextResponse.json({
        response: isQuota
          ? 'AI quota limit reached. Please try again in a few minutes.'
          : isRateLimit
          ? 'Too many requests. Please wait a moment and try again.'
          : `I'm unable to process your request right now. ${errorHint ? `(${errorHint.slice(0, 80)})` : 'Please try again in a moment.'}`,
      })
    }

    // Save AI response
    try {
      await db.insert(aiChatMessages).values({
        tenantId, userId, role: 'assistant', content: aiResponse.text,
        toolsUsed: selectedTools.map(t => t.name),
      })
    } catch { /* silent */ }

    // Clean up old messages (keep last 100 per user, fire-and-forget)
    cleanupOldMessages(db, userId).catch(() => {})

    return NextResponse.json({
      response: aiResponse.text,
      toolsUsed: selectedTools.map(t => t.name),
    })
  })
}

async function selectToolsWithLLM(
  question: string,
  businessType: string,
  history: { role: string; content: string }[] = []
) {
  try {
    const catalog = getToolCatalog()
    let historyContext = ''
    if (history.length > 0) {
      historyContext = '\nRecent conversation:\n' + history.slice(-4).map(m =>
        `${m.role}: ${m.content.slice(0, 150)}`
      ).join('\n') + '\n'
    }

    const selectionPrompt = `Given this user question and available tools, select 1-5 most relevant tools to answer the question.
Consider the conversation history for context (the user might be following up on a previous question).

Business type: ${businessType}
${historyContext}
User question: "${question}"

Available tools:
${catalog}

Return ONLY a JSON array of tool names, e.g. ["get_today_sales", "find_page"]. No other text.`

    const result = await generateText(selectionPrompt, {
      maxTokens: 200,
      temperature: 0.1,
    })

    if (!result?.text) return []

    const toolNames = parseToolSelection(result.text)
    return toolNames
      .map(name => chatTools.find(t => t.name === name))
      .filter(Boolean)
      .slice(0, 5) as typeof chatTools
  } catch {
    return []
  }
}

async function cleanupOldMessages(db: Parameters<Parameters<typeof withTenant>[1]>[0], userId: string) {
  try {
    await db.delete(aiChatMessages).where(
      sql`${aiChatMessages.userId} = ${userId} AND ${aiChatMessages.id} IN (
        SELECT id FROM ai_chat_messages
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
        OFFSET 100
      )`
    )
  } catch { /* silent cleanup */ }
}
