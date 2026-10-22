import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { accounts, accountTenants, conversations, messages, superAdmins, tenants } from '@/lib/db/schema'
import { adminAuthError, adminAudit, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { sysReplyMessageSchema, sysUpdateConversationSchema } from '@/lib/validation/schemas/sys-control'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'

const paramsSchema = z.object({ conversationId: z.string().uuid() })

// GET /api/sys-control/messages/[conversationId] — conversation, account (+ its businesses) and messages; marks it read
export async function GET(_request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }
    const p = validateParams(await params, paramsSchema)
    if (!p.success) return p.response
    const { conversationId } = p.data

    const [row] = await db.select({
      conversation: conversations,
      account: { id: accounts.id, email: accounts.email, fullName: accounts.fullName, phone: accounts.phone },
    })
      .from(conversations)
      .innerJoin(accounts, eq(accounts.id, conversations.accountId))
      .where(eq(conversations.id, conversationId))
    if (!row) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const [msgs, vendors] = await Promise.all([
      db.select().from(messages).where(eq(messages.conversationId, conversationId)).orderBy(asc(messages.createdAt)),
      db.select({ id: tenants.id, name: tenants.name, businessId: tenants.businessId, status: tenants.status, isOwner: accountTenants.isOwner })
        .from(accountTenants)
        .innerJoin(tenants, eq(tenants.id, accountTenants.tenantId))
        .where(and(eq(accountTenants.accountId, row.account.id), eq(accountTenants.isActive, true)))
        .orderBy(asc(tenants.name))
        .limit(20),
    ])

    if (row.conversation.unreadByAdmin) {
      await db.update(conversations).set({ unreadByAdmin: false }).where(eq(conversations.id, conversationId))
    }

    return NextResponse.json({ conversation: row.conversation, account: row.account, vendors, messages: msgs })
  } catch (error) {
    logError('api/sys-control/messages/[conversationId]', error)
    return NextResponse.json({ error: 'Failed to load the conversation' }, { status: 500 })
  }
}

// POST /api/sys-control/messages/[conversationId] — support reply (reopens a closed conversation)
export async function POST(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await validateAdminSession('messages')
    if (!session) {
      return adminAuthError()
    }
    const p = validateParams(await params, paramsSchema)
    if (!p.success) return p.response
    const { conversationId } = p.data
    const parsed = await validateBody(request, sysReplyMessageSchema)
    if (!parsed.success) return parsed.response
    const content = parsed.data.content.trim()

    const conversation = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    if (conversation.status === 'archived') {
      return NextResponse.json({ error: 'Restore the conversation before replying' }, { status: 409 })
    }
    const admin = await db.query.superAdmins.findFirst({ where: eq(superAdmins.id, session.superAdminId), columns: { fullName: true } })

    const now = new Date()
    const msg = await db.transaction(async (tx) => {
      const [m] = await tx.insert(messages).values({
        conversationId,
        senderType: 'admin',
        senderId: session.superAdminId,
        senderName: 'Support Team',
        content,
        metadata: { adminName: admin?.fullName ?? null },
      }).returning()
      await tx.update(conversations).set({
        lastMessageAt: now,
        lastMessagePreview: content.substring(0, 200),
        unreadByAccount: true,
        unreadByAdmin: false,
        updatedAt: now,
        ...(conversation.status === 'closed' ? { status: 'open', closedAt: null, closedBy: null } : {}),
      }).where(eq(conversations.id, conversationId))
      return m
    })

    // live update for the vendor's open account portal
    try { broadcastAccountChange(conversation.accountId, 'account-message', 'created', msg.id) } catch { /* best effort */ }

    return NextResponse.json(msg, { status: 201 })
  } catch (error) {
    logError('api/sys-control/messages/[conversationId]', error)
    return NextResponse.json({ error: 'Failed to send the reply' }, { status: 500 })
  }
}

// PUT /api/sys-control/messages/[conversationId] — close / reopen / archive, priority
export async function PUT(request: NextRequest, { params }: { params: Promise<{ conversationId: string }> }) {
  try {
    const session = await validateAdminSession('messages')
    if (!session) {
      return adminAuthError()
    }
    const p = validateParams(await params, paramsSchema)
    if (!p.success) return p.response
    const { conversationId } = p.data
    const parsed = await validateBody(request, sysUpdateConversationSchema)
    if (!parsed.success) return parsed.response
    const { status, priority, action } = parsed.data

    const conversation = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) })
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    const now = new Date()
    const update: Partial<typeof conversations.$inferInsert> = { updatedAt: now }
    if (action === 'close') Object.assign(update, { status: 'closed', closedAt: now, closedBy: 'admin' })
    else if (action === 'reopen') Object.assign(update, { status: 'open', closedAt: null, closedBy: null })
    else if (action === 'archive') update.status = 'archived'
    if (status) update.status = status
    if (priority) update.priority = priority

    const [updated] = await db.update(conversations).set(update).where(eq(conversations.id, conversationId)).returning()
    try { broadcastAccountChange(conversation.accountId, 'account-message', 'updated', conversationId) } catch { /* best effort */ }
    if (action || status) {
      await adminAudit.update(session.superAdminId, 'conversation', conversationId, { op: action ?? `status_${status}`, from: conversation.status, to: updated.status })
    }
    return NextResponse.json({ success: true, conversation: updated })
  } catch (error) {
    logError('api/sys-control/messages/[conversationId]', error)
    return NextResponse.json({ error: 'Failed to update the conversation' }, { status: 500 })
  }
}
