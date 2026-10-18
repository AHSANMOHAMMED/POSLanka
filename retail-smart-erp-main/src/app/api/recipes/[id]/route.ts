import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { recipes } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateRecipeSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET single recipe with ingredients
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

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      const recipe = await db.query.recipes.findFirst({
        where: eq(recipes.id, id),
        with: {
          item: true,
          ingredients: {
            with: {
              ingredientItem: true,
            },
            orderBy: (recipeIngredients, { asc }) => [asc(recipeIngredients.sortOrder)],
          },
        },
      })

      if (!recipe) {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
      }

      // Calculate totalCost from ingredients
      const totalCost = recipe.ingredients.reduce((sum, ingredient) => {
        const ingredientCost = parseFloat(ingredient.ingredientItem?.costPrice || '0')
        const qty = parseFloat(ingredient.quantity)
        const wastePercent = parseFloat(ingredient.wastePercentage || '0')
        const effectiveQty = wastePercent > 0 ? qty / (1 - wastePercent / 100) : qty
        return sum + (ingredientCost * effectiveQty)
      }, 0)

      return NextResponse.json({
        ...recipe,
        totalCost: totalCost.toFixed(2),
      })
    })
  } catch (error) {
    logError('api/recipes/[id]', error)
    return NextResponse.json({ error: 'Failed to fetch recipe' }, { status: 500 })
  }
}

// PUT update recipe
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const parsed = await validateBody(request, updateRecipeSchema)
    if (!parsed.success) return parsed.response
    const { name, description, itemId, yieldQuantity, yieldUnit, preparationTime, instructions, isActive } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify recipe exists (RLS scopes the query)
      const existing = await db.query.recipes.findFirst({
        where: eq(recipes.id, id),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
      }

      const [updated] = await db.update(recipes)
        .set({
          name,
          description: description !== undefined ? (description || null) : undefined,
          itemId: itemId !== undefined ? (itemId || null) : undefined,
          yieldQuantity: yieldQuantity ? String(yieldQuantity) : undefined,
          yieldUnit: yieldUnit !== undefined ? (yieldUnit || 'portion') : undefined,
          preparationTime: preparationTime !== undefined ? (preparationTime ?? null) : undefined,
          instructions: instructions !== undefined ? (instructions || null) : undefined,
          isActive: isActive !== undefined ? isActive : undefined,
          updatedAt: new Date(),
        })
        .where(eq(recipes.id, id))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'recipe', 'updated', id)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/recipes/[id]', error)
    return NextResponse.json({ error: 'Failed to update recipe' }, { status: 500 })
  }
}

// DELETE recipe
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id } = paramsParsed.data
    const tenantId = session!.user.tenantId

    // Execute with RLS tenant context
    return await withTenant(tenantId, async (db) => {
      const [deleted] = await db.delete(recipes)
        .where(eq(recipes.id, id))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
      }

      // Broadcast the change to connected clients
      logAndBroadcast(tenantId, 'recipe', 'deleted', id)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/recipes/[id]', error)
    return NextResponse.json({ error: 'Failed to delete recipe' }, { status: 500 })
  }
}
