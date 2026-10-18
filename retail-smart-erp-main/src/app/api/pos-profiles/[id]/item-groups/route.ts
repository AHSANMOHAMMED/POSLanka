import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { posProfiles, posProfileItemGroups, categories } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody } from '@/lib/validation'
import { posProfileItemGroupsSchema, posProfileAddCategorySchema } from '@/lib/validation/schemas/pos'
import { validateParams } from '@/lib/validation/helpers'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET item groups (categories) for a POS profile
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify profile exists
      const profile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
      })

      if (!profile) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      const itemGroups = await db.query.posProfileItemGroups.findMany({
        where: eq(posProfileItemGroups.posProfileId, id),
        with: {
          category: true,
        },
      })

      return NextResponse.json(itemGroups)
    })
  } catch (error) {
    logError('api/pos-profiles/[id]/item-groups', error)
    return NextResponse.json({ error: 'Failed to fetch item groups' }, { status: 500 })
  }
}

// POST - Replace all item groups for a POS profile
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const quotaError = await requireQuota(session.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, posProfileItemGroupsSchema)
    if (!parsed.success) return parsed.response
    const { categoryIds } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify profile exists
      const profile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
      })

      if (!profile) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      // Verify categories exist
      if (categoryIds.length > 0) {
        const validCategories = await db.query.categories.findMany({
          where: inArray(categories.id, categoryIds),
        })
        if (validCategories.length !== categoryIds.length) {
          return NextResponse.json({ error: 'One or more categories not found' }, { status: 400 })
        }
      }

      // withTenant already wraps in a transaction — no nested db.transaction() which resets SET LOCAL RLS context.
      await db.delete(posProfileItemGroups)
        .where(eq(posProfileItemGroups.posProfileId, id))

      if (categoryIds.length > 0) {
        const catValues = categoryIds.map((categoryId) => ({
          tenantId: session.user.tenantId,
          posProfileId: id,
          categoryId,
        }))
        await db.insert(posProfileItemGroups).values(catValues)
      }

      // Fetch updated
      const updated = await db.query.posProfileItemGroups.findMany({
        where: eq(posProfileItemGroups.posProfileId, id),
        with: {
          category: true,
        },
      })

      logAndBroadcast(session.user.tenantId, 'pos-profile', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/pos-profiles/[id]/item-groups', error)
    return NextResponse.json({ error: 'Failed to update item groups' }, { status: 500 })
  }
}

// PUT - Add a single category to a profile
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, posProfileAddCategorySchema)
    if (!parsed.success) return parsed.response
    const { categoryId } = parsed.data

    return await withTenant(session.user.tenantId, async (db) => {
      // Verify profile exists
      const profile = await db.query.posProfiles.findFirst({
        where: eq(posProfiles.id, id),
      })

      if (!profile) {
        return NextResponse.json({ error: 'POS profile not found' }, { status: 404 })
      }

      // Check if category already assigned
      const existing = await db.query.posProfileItemGroups.findFirst({
        where: and(
          eq(posProfileItemGroups.posProfileId, id),
          eq(posProfileItemGroups.categoryId, categoryId)
        ),
      })

      if (existing) {
        return NextResponse.json({ message: 'Category already assigned' })
      }

      // Add category
      await db.insert(posProfileItemGroups).values({
        tenantId: session.user.tenantId,
        posProfileId: id,
        categoryId,
      })

      logAndBroadcast(session.user.tenantId, 'pos-profile', 'updated', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/pos-profiles/[id]/item-groups', error)
    return NextResponse.json({ error: 'Failed to add category to profile' }, { status: 500 })
  }
}

// DELETE - Remove a category from a profile
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const permError = requirePermission(session, 'manageSettings')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const { searchParams } = new URL(request.url)
    const categoryId = searchParams.get('categoryId')

    if (!categoryId) {
      return NextResponse.json({ error: 'categoryId query parameter is required' }, { status: 400 })
    }

    return await withTenant(session.user.tenantId, async (db) => {
      await db.delete(posProfileItemGroups)
        .where(and(
          eq(posProfileItemGroups.posProfileId, id),
          eq(posProfileItemGroups.categoryId, categoryId)
        ))

      logAndBroadcast(session.user.tenantId, 'pos-profile', 'updated', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/pos-profiles/[id]/item-groups', error)
    return NextResponse.json({ error: 'Failed to remove category from profile' }, { status: 500 })
  }
}
