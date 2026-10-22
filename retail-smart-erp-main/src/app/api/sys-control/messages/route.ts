import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { db } from '@/lib/db'
import { accounts, conversations, messages, superAdmins, tenants, users } from '@/lib/db/schema'
import { escapeLikePattern } from '@/lib/utils/sql'
import { adminAuthError, adminAudit, validateAdminSession } from '@/lib/admin'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateSearchParams } from '@/lib/validation/helpers'
import { normalizeBusinessId } from '@/lib/tenant/business-id'
import { broadcastAccountChange } from '@/lib/websocket/broadcast'

const blank = (v: unknown) => (v === '' || v === 'all' ? undefined : v)

const listSchema = z.object({
  status: z.preprocess(blank, z.enum(['open', 'closed', 'archived']).optional()),
  priority: z.preprocess(blank, z.enum(['low', 'normal', 'high', 'urgent']).optional()),
  unread: z.preprocess(blank, z.enum(['1', 'true']).optional()),
  search: z.preprocess(blank, z.string().trim().max(100).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

/**
 * GET /api/sys-control/messages — support conversations with vendor accounts, most recent first,
 * plus counts for the status tabs (open / waiting on support / closed).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await validateAdminSession('read')
    if (!session) {
      return adminAuthError()
    }
    const parsed = validateSearchParams(request, listSchema)
    if (!parsed.success) return parsed.response
    const { status, priority, unread, search, page, pageSize } = parsed.data

    const conds: SQL[] = []
    if (status) conds.push(eq(conversations.status, status))
    if (priority) conds.push(eq(conversations.priority, priority))
    if (unread) conds.push(eq(conversations.unreadByAdmin, true))
    if (search) {
      const p = `%${escapeLikePattern(search)}%`
      conds.push(or(
        ilike(conversations.subject, p),
        ilike(conversations.lastMessagePreview, p),
        ilike(accounts.email, p),
        ilike(accounts.fullName, p),
      )!)
    }
    const where = conds.length ? and(...conds) : undefined

    const [rows, [count], [counts]] = await Promise.all([
      db.select({
        id: conversations.id,
        subject: conversations.subject,
        status: conversations.status,
        priority: conversations.priority,
        category: conversations.category,
        lastMessageAt: conversations.lastMessageAt,
        lastMessagePreview: conversations.lastMessagePreview,
        unreadByAdmin: conversations.unreadByAdmin,
        unreadByAccount: conversations.unreadByAccount,
        createdAt: conversations.createdAt,
        account: { id: accounts.id, email: accounts.email, fullName: accounts.fullName },
      })
        .from(conversations)
        .innerJoin(accounts, eq(conversations.accountId, accounts.id))
        .where(where)
        .orderBy(desc(conversations.unreadByAdmin), desc(conversations.lastMessageAt), desc(conversations.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ total: sql<number>`count(*)::int` }).from(conversations).innerJoin(accounts, eq(conversations.accountId, accounts.id)).where(where),
      db.select({
        open: sql<number>`count(*) filter (where ${conversations.status} = 'open')::int`,
        unread: sql<number>`count(*) filter (where ${conversations.unreadByAdmin} and ${conversations.status} <> 'archived')::int`,
        closed: sql<number>`count(*) filter (where ${conversations.status} = 'closed')::int`,
        archived: sql<number>`count(*) filter (where ${conversations.status} = 'archived')::int`,
        all: sql<number>`count(*)::int`,
      }).from(conversations),
    ])

    return NextResponse.json({
      data: rows,
      counts,
      pagination: { page, pageSize, total: count?.total ?? 0, totalPages: Math.ceil((count?.total ?? 0) / pageSize) },
    })
  } catch (error) {
    logError('api/sys-control/messages', error)
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 })
  }
}

const createSchema = z.object({
  /** Who to write to: an account id, or a vendor's Business ID (its owner's account is used). */
  accountId: z.string().uuid().optional(),
  businessId: z.string().trim().max(20).optional(),
  subject: z.string().trim().min(3, 'Enter a subject of at least 3 characters').max(255),
  category: z.enum(['general', 'billing', 'technical', 'feature_request', 'bug_report']).default('general'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  message: z.string().trim().min(1, 'Message is required').max(5000),
}).refine((v) => !!v.accountId || !!v.businessId, { message: 'Choose who to write to', path: ['businessId'] })

/** POST /api/sys-control/messages — start a conversation with a vendor's account (shown in its account portal). */
export async function POST(request: NextRequest) {
  try {
    const session = await validateAdminSession('messages')
    if (!session) {
      return adminAuthError()
    }
    const parsed = await validateBody(request, createSchema)
    if (!parsed.success) return parsed.response
    const { subject, category, priority, message: content } = parsed.data

    let accountId = parsed.data.accountId ?? null
    let vendorName: string | null = null
    if (!accountId && parsed.data.businessId) {
      const bid = normalizeBusinessId(parsed.data.businessId)
      if (!bid) return NextResponse.json({ error: 'That is not a valid Business ID' }, { status: 400 })
      const [owner] = await db.select({ accountId: users.accountId, vendorName: tenants.name })
        .from(tenants)
        .innerJoin(users, and(eq(users.tenantId, tenants.id), eq(users.role, 'owner')))
        .where(and(eq(tenants.businessId, bid)))
        .orderBy(desc(users.isActive), asc(users.createdAt))
        .limit(1)
      if (!owner) return NextResponse.json({ error: 'No vendor with that Business ID' }, { status: 404 })
      if (!owner.accountId) return NextResponse.json({ error: 'This vendor’s owner has no account portal login to message' }, { status: 409 })
      accountId = owner.accountId
      vendorName = owner.vendorName
    }
    const account = await db.query.accounts.findFirst({ where: eq(accounts.id, accountId!), columns: { id: true, email: true, fullName: true } })
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    const admin = await db.query.superAdmins.findFirst({ where: eq(superAdmins.id, session.superAdminId), columns: { fullName: true } })

    const result = await db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({
        accountId: account.id,
        subject,
        category,
        priority,
        lastMessagePreview: content.substring(0, 200),
        unreadByAdmin: false,
        unreadByAccount: true,
      }).returning()
      const [msg] = await tx.insert(messages).values({
        conversationId: conversation.id,
        senderType: 'admin',
        senderId: session.superAdminId,
        senderName: 'Support Team',
        content,
        metadata: { adminName: admin?.fullName ?? null },
      }).returning()
      return { conversation, message: msg }
    })

    try { broadcastAccountChange(account.id, 'account-message', 'created', result.message.id) } catch { /* best effort */ }
    await adminAudit.create(session.superAdminId, 'conversation', result.conversation.id, {
      op: 'start_conversation', accountEmail: account.email, vendorName, subject,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    logError('api/sys-control/messages', error)
    return NextResponse.json({ error: 'Failed to start the conversation' }, { status: 500 })
  }
}
