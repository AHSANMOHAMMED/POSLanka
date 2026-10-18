import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { recipes, recipeIngredients } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { validateBody, validateParams } from '@/lib/validation/helpers'
import { updateRecipeIngredientSchema } from '@/lib/validation/schemas/restaurant'
import { z } from 'zod'

// PUT update ingredient
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ingredientId: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), ingredientId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: recipeId, ingredientId } = paramsParsed.data
    const parsed = await validateBody(request, updateRecipeIngredientSchema)
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

      // Verify ingredient belongs to this recipe
      const existing = await db.query.recipeIngredients.findFirst({
        where: and(
          eq(recipeIngredients.id, ingredientId),
          eq(recipeIngredients.recipeId, recipeId)
        ),
      })

      if (!existing) {
        return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }

      if (ingredientItemId !== undefined) updateData.ingredientItemId = ingredientItemId
      if (quantity !== undefined) updateData.quantity = String(quantity)
      if (unit !== undefined) updateData.unit = unit || 'pcs'
      if (wastePercentage !== undefined) updateData.wastePercentage = String(wastePercentage)
      if (notes !== undefined) updateData.notes = notes || null
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder

      const [updated] = await db.update(recipeIngredients)
        .set(updateData)
        .where(and(
          eq(recipeIngredients.id, ingredientId),
          eq(recipeIngredients.recipeId, recipeId),
        ))
        .returning()

      if (!updated) {
        return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
      }

      // Update recipe's updatedAt
      await db.update(recipes)
        .set({ updatedAt: new Date() })
        .where(eq(recipes.id, recipeId))

      // Broadcast recipe change to connected clients
      logAndBroadcast(session!.user.tenantId, 'recipe', 'updated', recipeId)

      return NextResponse.json(updated)
    })
  } catch (error) {
    logError('api/recipes/[id]/ingredients/[ingredientId]', error)
    return NextResponse.json({ error: 'Failed to update recipe ingredient' }, { status: 500 })
  }
}

// DELETE remove ingredient from recipe
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ingredientId: string }> }
) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageItems')
    if (permError) return permError

    const paramsParsed = validateParams(await params, z.object({ id: z.string().uuid(), ingredientId: z.string().uuid() }))
    if (!paramsParsed.success) return paramsParsed.response
    const { id: recipeId, ingredientId } = paramsParsed.data
    const tenantId = session!.user.tenantId

    // Execute with RLS tenant context
    return await withTenant(tenantId, async (db) => {
      // Verify recipe exists (RLS scopes the query)
      const recipe = await db.query.recipes.findFirst({
        where: eq(recipes.id, recipeId),
      })

      if (!recipe) {
        return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
      }

      const [deleted] = await db.delete(recipeIngredients)
        .where(and(
          eq(recipeIngredients.id, ingredientId),
          eq(recipeIngredients.recipeId, recipeId),
        ))
        .returning()

      if (!deleted) {
        return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
      }

      // Update recipe's updatedAt
      await db.update(recipes)
        .set({ updatedAt: new Date() })
        .where(eq(recipes.id, recipeId))

      // Broadcast recipe change to connected clients
      logAndBroadcast(tenantId, 'recipe', 'updated', recipeId)

      return NextResponse.json({ success: true })
    })
  } catch (error) {
    logError('api/recipes/[id]/ingredients/[ingredientId]', error)
    return NextResponse.json({ error: 'Failed to delete recipe ingredient' }, { status: 500 })
  }
}
