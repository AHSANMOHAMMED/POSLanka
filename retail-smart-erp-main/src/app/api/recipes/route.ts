import { NextRequest, NextResponse } from 'next/server'
import { authWithCompany } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/roles'
import { withTenant } from '@/lib/db'
import { recipes } from '@/lib/db/schema'
import { ilike, sql, or } from 'drizzle-orm'
import { escapeLikePattern } from '@/lib/utils/sql'
import { logAndBroadcast } from '@/lib/websocket/broadcast'
import { logError } from '@/lib/ai/error-logger'
import { requireQuota } from '@/lib/db/storage-quota'
import { validateSearchParams, validateBody } from '@/lib/validation/helpers'
import { recipesListSchema, createRecipeSchema } from '@/lib/validation/schemas/restaurant'

// GET all recipes for the tenant (with pagination)
export async function GET(request: NextRequest) {
  try {
    const session = await authWithCompany()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = validateSearchParams(request, recipesListSchema)
    if (!parsed.success) return parsed.response
    const { search, page, pageSize, all } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session.user.tenantId, async (db) => {
      // Build where clause (tenantId filter handled by RLS)
      const escaped = search ? escapeLikePattern(search) : ''
      const whereClause = search
        ? or(
            ilike(recipes.name, `%${escaped}%`),
            ilike(recipes.description, `%${escaped}%`)
          )
        : undefined

      // Get total count for pagination
      const [{ count: totalCount }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(recipes)
        .where(whereClause)

      // Calculate pagination
      const limit = all ? 1000 : Math.min(pageSize, 100)
      const offset = all ? undefined : (page - 1) * pageSize

      // Get recipes with relations
      const result = await db.query.recipes.findMany({
        where: whereClause,
        with: {
          item: true,
          ingredients: {
            with: {
              ingredientItem: true,
            },
            orderBy: (recipeIngredients, { asc }) => [asc(recipeIngredients.sortOrder)],
          },
        },
        orderBy: (recipes, { asc }) => [asc(recipes.name)],
        limit,
        offset,
      })

      // Calculate totalCost for each recipe from ingredients
      const recipesWithCost = result.map(recipe => {
        const totalCost = recipe.ingredients.reduce((sum, ingredient) => {
          const ingredientCost = parseFloat(ingredient.ingredientItem?.costPrice || '0')
          const qty = parseFloat(ingredient.quantity)
          const wastePercent = parseFloat(ingredient.wastePercentage || '0')
          // Adjust quantity for waste: effective qty = qty / (1 - waste%)
          const effectiveQty = wastePercent > 0 ? qty / (1 - wastePercent / 100) : qty
          return sum + (ingredientCost * effectiveQty)
        }, 0)

        return {
          ...recipe,
          totalCost: totalCost.toFixed(2),
        }
      })

      // Return paginated response (or just array for backward compatibility with all=true)
      if (all) {
        return NextResponse.json(recipesWithCost)
      }

      return NextResponse.json({
        data: recipesWithCost,
        pagination: {
          page,
          pageSize,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
        }
      })
    })
  } catch (error) {
    logError('api/recipes', error)
    return NextResponse.json({ error: 'Failed to fetch recipes' }, { status: 500 })
  }
}

// POST create new recipe
export async function POST(request: NextRequest) {
  try {
    const session = await authWithCompany()
    const permError = requirePermission(session, 'manageRestaurantOrders')
    if (permError) return permError

    const quotaError = await requireQuota(session!.user.tenantId, 'standard')
    if (quotaError) return quotaError

    const parsed = await validateBody(request, createRecipeSchema)
    if (!parsed.success) return parsed.response
    const { name, description, itemId, yieldQuantity, yieldUnit, preparationTime, instructions } = parsed.data

    // Execute with RLS tenant context
    return await withTenant(session!.user.tenantId, async (db) => {
      const [newRecipe] = await db.insert(recipes).values({
        tenantId: session!.user.tenantId,
        name,
        description: description || null,
        itemId: itemId || null,
        yieldQuantity: yieldQuantity ? String(yieldQuantity) : '1',
        yieldUnit: yieldUnit || 'portion',
        preparationTime: preparationTime ?? null,
        instructions: instructions || null,
        isActive: true,
      }).returning()

      // Broadcast the change to connected clients
      logAndBroadcast(session!.user.tenantId, 'recipe', 'created', newRecipe.id)

      return NextResponse.json(newRecipe)
    })
  } catch (error) {
    logError('api/recipes', error)
    return NextResponse.json({ error: 'Failed to create recipe' }, { status: 500 })
  }
}
