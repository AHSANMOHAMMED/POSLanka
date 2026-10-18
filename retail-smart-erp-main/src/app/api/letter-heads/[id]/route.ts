import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withAuthTenant } from '@/lib/db'
import { letterHeads } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logError } from '@/lib/ai/error-logger'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { validateBody, validateParams } from '@/lib/validation'
import { idParamSchema } from '@/lib/validation/schemas/common'
import { updateLetterHeadSchema } from '@/lib/validation/schemas/settings'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const paramsParsed = validateParams(await params, idParamSchema)
  if (!paramsParsed.success) return paramsParsed.response
  const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const [letterHead] = await db.select().from(letterHeads)
      .where(and(eq(letterHeads.id, id), eq(letterHeads.tenantId, session.user.tenantId)))
    return letterHead || undefined
  })

  if (result === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!result) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(result)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  const permError = requirePermission(session, 'managePrintTemplates')
  if (permError) return permError

  const paramsParsed = validateParams(await params, idParamSchema)
  if (!paramsParsed.success) return paramsParsed.response
  const { id } = paramsParsed.data

  try {
    const parsed = await validateBody(request, updateLetterHeadSchema)
    if (!parsed.success) return parsed.response
    const { name, headerHtml, footerHtml, headerImage, footerImage, headerHeight, footerHeight, alignment, isDefault, isActive } = parsed.data

    const result = await withAuthTenant(async (session, db) => {
      // If setting as default, unset other defaults
      if (isDefault) {
        await db.update(letterHeads)
          .set({ isDefault: false })
          .where(eq(letterHeads.tenantId, session.user.tenantId))
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }
      if (name !== undefined) updateData.name = name
      if (headerHtml !== undefined) updateData.headerHtml = headerHtml
      if (footerHtml !== undefined) updateData.footerHtml = footerHtml
      if (headerImage !== undefined) updateData.headerImage = headerImage
      if (footerImage !== undefined) updateData.footerImage = footerImage
      if (headerHeight !== undefined) updateData.headerHeight = headerHeight
      if (footerHeight !== undefined) updateData.footerHeight = footerHeight
      if (alignment !== undefined) updateData.alignment = alignment
      if (isDefault !== undefined) updateData.isDefault = isDefault
      if (isActive !== undefined) updateData.isActive = isActive

      const [updated] = await db.update(letterHeads)
        .set(updateData)
        .where(and(eq(letterHeads.id, id), eq(letterHeads.tenantId, session.user.tenantId)))
        .returning()

      return updated || undefined
    })

    if (result === null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!result) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    logAndBroadcast(result.tenantId, 'letter-head', 'updated', result.id, { userId: session!.user.id, entityName: result.name })
    return NextResponse.json(result)
  } catch (error) {
    logError('api/letter-heads/[id]', error)
    return NextResponse.json({ error: 'Failed to update letter head' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  const permError = requirePermission(session, 'managePrintTemplates')
  if (permError) return permError

  const paramsParsed = validateParams(await params, idParamSchema)
  if (!paramsParsed.success) return paramsParsed.response
  const { id } = paramsParsed.data

  const result = await withAuthTenant(async (session, db) => {
    const [deleted] = await db.delete(letterHeads)
      .where(and(eq(letterHeads.id, id), eq(letterHeads.tenantId, session.user.tenantId)))
      .returning()
    return deleted || undefined
  })

  if (result === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (result) {
    logAndBroadcast(result.tenantId, 'letter-head', 'deleted', result.id, { userId: session!.user.id, entityName: result.name })
  }
  return NextResponse.json({ success: true })
}
