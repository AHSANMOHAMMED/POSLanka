import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { recipes, recipeIngredients } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { addRecipeIngredientSchema } from '@/lib/validation/schemas/restaurant'
import { idParamSchema } from '@/lib/validation/schemas/common'

// GET ingredients for a recipe
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
    const { id: recipeId } = paramsParsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Verify recipe exists (RLS scopes the query)
      const recipe = await db.query.recipes.findFirst({
        where: eq(recipes.id, recipeId),
      })

      if (!recipe) {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
      }

      // Get ingredients with ingredientItem relation
      const ingredients = await db.query.recipeIngredients.findMany({
        where: eq(recipeIngredients.recipeId, recipeId),
        with: {
          ingredientItem: true,
        },
        orderBy: (recipeIngredients, { asc }) => [asc(recipeIngredients.sortOrder)],
      })

      return NextResponse.json(ingredients)
    })
  } catch (error) {
    logError('api/recipes/[id]/ingredients', error)
    return NextResponse.json({ error: 'Failed to fetch recipe ingredients' }, { status: 500 })
  }
}

// POST add ingredient to recipe
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const paramsParsed = validateParams(await params, idParamSchema)
    if (!paramsParsed.success) return paramsParsed.response
    const { id: recipeId } = paramsParsed.data
    const parsed = await validateBody(request, addRecipeIngredientSchema)
    if (!parsed.success) return parsed.response
    const { ingredientItemId, quantity, unit, wastePercentage, notes, sortOrder } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      // Verify recipe exists (RLS scopes the query)
      const recipe = await db.query.recipes.findFirst({
        where: eq(recipes.id, recipeId),
      })

      if (!recipe) {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
      }

      const [newIngredient] = await db.insert(recipeIngredients).values({
        tenantId: session!.user.tenantId,
        recipeId,
        ingredientItemId,
        quantity: String(quantity),
        unit: unit || 'pcs',
        wastePercentage: wastePercentage !== undefined ? String(wastePercentage) : '0',
        notes: notes || null,
        sortOrder: sortOrder ?? 0,
      }).returning()

      // Update recipe's updatedAt
      await db.update(recipes)
        .set({ updatedAt: new Date() })
        .where(eq(recipes.id, recipeId))

      // Broadcast recipe change to connected clients
      logAndBroadcast(session!.user.tenantId, 'recipe', 'updated', recipeId)

      return NextResponse.json(newIngredient)
    })
  } catch (error) {
    logError('api/recipes/[id]/ingredients', error)
    return NextResponse.json({ error: 'Failed to add recipe ingredient' }, { status: 500 })
  }
}
