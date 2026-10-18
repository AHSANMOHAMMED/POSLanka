'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Home, ChevronRight, ArrowLeft, Plus, Pencil, Trash2,
  ChefHat, Clock, DollarSign, Save, Package
} from 'lucide-react'
import { useRealtimeData } from '@/hooks'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormInput, FormLabel, FormSelect, FormTextarea } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { DocumentCommentsAndActivity } from '@/components/ui/document-comments'
import { formatCurrency } from '@/lib/utils/currency'
import { ConfirmModal } from '@/components/ui/confirm-modal'
import { useCompany } from '@/components/providers/CompanyContextProvider'

// ============================================
// TYPES
// ============================================

interface RecipeIngredient {
  id: string
  itemId: string
  itemName: string
  quantity: string
  unit: string
  wastePercent: string
  costPerUnit: string
  totalCost: string
}

interface Recipe {
  id: string
  name: string
  description: string | null
  yieldQuantity: string
  yieldUnit: string
  preparationTime: number | null
  instructions: string | null
  menuItemId: string | null
  menuItemName: string | null
  menuItemPrice: string | null
  ingredients: RecipeIngredient[]
  totalCost: string
  foodCostPercent: string | null
  createdAt: string
  updatedAt: string | null
}

interface RecipeFormData {
  name: string
  description: string
  yieldQuantity: string
  yieldUnit: string
  preparationTime: string
  instructions: string
}

interface IngredientFormData {
  itemId: string
  itemName: string
  quantity: string
  unit: string
  wastePercent: string
  costPerUnit: string
}

interface ItemOption {
  value: string
  label: string
  data?: {
    costPrice?: string
    unit?: string
  }
}

const YIELD_UNITS = [
  'serving',
  'portion',
  'batch',
  'piece',
  'kg',
  'g',
  'L',
  'mL',
  'cup',
  'dozen',
]

const INGREDIENT_UNITS = [
  'kg', 'g', 'mg', 'L', 'mL', 'piece', 'cup', 'tbsp', 'tsp', 'oz', 'lb', 'bunch', 'slice', 'sheet',
]

const INITIAL_INGREDIENT: IngredientFormData = {
  itemId: '',
  itemName: '',
  quantity: '',
  unit: 'g',
  wastePercent: '0',
  costPerUnit: '',
}

// ============================================
// MAIN COMPONENT
// ============================================

export default function RecipeDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug: _slug, id } = use(params)
  const router = useRouter()
  const { tenantSlug, currency } = useCompany()

  // Core data
  const [recipe, setRecipe] = useState<Recipe | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Edit recipe details modal
  const [showEditModal, setShowEditModal] = useState(false)
  const [editFormData, setEditFormData] = useState<RecipeFormData>({
    name: '',
    description: '',
    yieldQuantity: '1',
    yieldUnit: 'serving',
    preparationTime: '',
    instructions: '',
  })

  // Add ingredient modal
  const [showIngredientModal, setShowIngredientModal] = useState(false)
  const [ingredientForm, setIngredientForm] = useState<IngredientFormData>(INITIAL_INGREDIENT)
  const [savingIngredient, setSavingIngredient] = useState(false)

  // Item search for ingredients
  const [itemSearchQuery, setItemSearchQuery] = useState('')
  const [itemSearchResults, setItemSearchResults] = useState<ItemOption[]>([])
  const [searchingItems, setSearchingItems] = useState(false)
  const [showItemDropdown, setShowItemDropdown] = useState(false)

  // Delete ingredient confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean; id: string | null; name: string }>({
    open: false, id: null, name: '',
  })

  // ============================================
  // FETCH DATA
  // ============================================

  const fetchRecipe = useCallback(async () => {
    try {
      const res = await fetch(`/api/recipes/${id}`)
      if (res.ok) {
        const data = await res.json()
        setRecipe(data)
      } else if (res.status === 404) {
        toast.error('Recipe not found')
        router.push(`/c/${tenantSlug}/restaurant/recipes`)
      } else {
        toast.error('Failed to load recipe')
      }
    } catch (error) {
      console.error('Error fetching recipe:', error)
      toast.error('Failed to load recipe')
    } finally {
      setLoading(false)
    }
  }, [id, router, tenantSlug])

  useEffect(() => {
    fetchRecipe()
  }, [fetchRecipe])

  // Real-time updates
  useRealtimeData(fetchRecipe, {
    entityType: 'recipe',
    refreshOnMount: false,
  })

  // ============================================
  // ITEM SEARCH
  // ============================================

  const searchItems = useCallback(async (query: string) => {
    if (!query.trim()) {
      setItemSearchResults([])
      return
    }
    setSearchingItems(true)
    try {
      const params = new URLSearchParams({ pageSize: '15', search: query })
      const res = await fetch(`/api/items?${params}`)
      if (res.ok) {
        const result = await res.json()
        const data = result.data || result
        setItemSearchResults(
          data.map((item: { id: string; name: string; costPrice?: string; unit?: string }) => ({
            value: item.id,
            label: item.name,
            data: { costPrice: item.costPrice, unit: item.unit },
          }))
        )
      }
    } catch (error) {
      console.error('Error searching items:', error)
    } finally {
      setSearchingItems(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (itemSearchQuery) {
        searchItems(itemSearchQuery)
        setShowItemDropdown(true)
      } else {
        setItemSearchResults([])
        setShowItemDropdown(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [itemSearchQuery, searchItems])

  // ============================================
  // EDIT RECIPE HANDLERS
  // ============================================

  function handleOpenEdit() {
    if (!recipe) return
    setEditFormData({
      name: recipe.name,
      description: recipe.description || '',
      yieldQuantity: recipe.yieldQuantity,
      yieldUnit: recipe.yieldUnit,
      preparationTime: recipe.preparationTime?.toString() || '',
      instructions: recipe.instructions || '',
    })
    setShowEditModal(true)
  }

  async function handleSaveRecipe(e: React.FormEvent) {
    e.preventDefault()
    if (!editFormData.name.trim()) {
      toast.error('Recipe name is required')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/recipes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editFormData.name.trim(),
          description: editFormData.description.trim() || null,
          yieldQuantity: parseFloat(editFormData.yieldQuantity) || 1,
          yieldUnit: editFormData.yieldUnit,
          preparationTime: editFormData.preparationTime ? parseInt(editFormData.preparationTime) : null,
          instructions: editFormData.instructions.trim() || null,
        }),
      })

      if (res.ok) {
        toast.success('Recipe updated')
        setShowEditModal(false)
        fetchRecipe()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to update recipe')
      }
    } catch (error) {
      console.error('Error updating recipe:', error)
      toast.error('Failed to update recipe')
    } finally {
      setSaving(false)
    }
  }

  // ============================================
  // INGREDIENT HANDLERS
  // ============================================

  function handleOpenAddIngredient() {
    setIngredientForm(INITIAL_INGREDIENT)
    setItemSearchQuery('')
    setItemSearchResults([])
    setShowItemDropdown(false)
    setShowIngredientModal(true)
  }

  function handleSelectItem(option: ItemOption) {
    setIngredientForm(prev => ({
      ...prev,
      itemId: option.value,
      itemName: option.label,
      costPerUnit: option.data?.costPrice || '',
      unit: option.data?.unit || prev.unit,
    }))
    setItemSearchQuery(option.label)
    setShowItemDropdown(false)
  }

  async function handleAddIngredient(e: React.FormEvent) {
    e.preventDefault()
    if (!ingredientForm.itemId) {
      toast.error('Please select an item')
      return
    }
    if (!ingredientForm.quantity || parseFloat(ingredientForm.quantity) <= 0) {
      toast.error('Quantity must be greater than 0')
      return
    }

    setSavingIngredient(true)
    try {
      const res = await fetch(`/api/recipes/${id}/ingredients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: ingredientForm.itemId,
          quantity: parseFloat(ingredientForm.quantity),
          unit: ingredientForm.unit,
          wastePercent: parseFloat(ingredientForm.wastePercent) || 0,
          costPerUnit: parseFloat(ingredientForm.costPerUnit) || 0,
        }),
      })

      if (res.ok) {
        toast.success('Ingredient added')
        setShowIngredientModal(false)
        fetchRecipe()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to add ingredient')
      }
    } catch (error) {
      console.error('Error adding ingredient:', error)
      toast.error('Failed to add ingredient')
    } finally {
      setSavingIngredient(false)
    }
  }

  async function handleDeleteIngredient() {
    if (!deleteConfirm.id) return

    try {
      const res = await fetch(`/api/recipes/${id}/ingredients/${deleteConfirm.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        toast.success('Ingredient removed')
        fetchRecipe()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to remove ingredient')
      }
    } catch (error) {
      console.error('Error deleting ingredient:', error)
      toast.error('Failed to remove ingredient')
    } finally {
      setDeleteConfirm({ open: false, id: null, name: '' })
    }
  }

  // ============================================
  // COMPUTED VALUES
  // ============================================

  const totalRecipeCost = recipe?.ingredients.reduce((sum, ing) => {
    return sum + parseFloat(ing.totalCost || '0')
  }, 0) || 0

  const menuItemPrice = recipe?.menuItemPrice ? parseFloat(recipe.menuItemPrice) : null
  const foodCostPercent = menuItemPrice && menuItemPrice > 0
    ? (totalRecipeCost / menuItemPrice) * 100
    : null

  // ============================================
  // RENDER
  // ============================================

  if (loading) {
    return <PageLoading text="Loading recipe..." />
  }

  if (!recipe) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500 dark:text-gray-400">Recipe not found</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col -m-5">
      {/* Breadcrumb */}
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-sm">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Link href={`/c/${tenantSlug}/dashboard`} className="hover:text-blue-600 dark:hover:text-blue-400">
            <Home size={14} />
          </Link>
          <ChevronRight size={14} />
          <Link href={`/c/${tenantSlug}/restaurant`} className="hover:text-blue-600 dark:hover:text-blue-400">
            Restaurant
          </Link>
          <ChevronRight size={14} />
          <Link href={`/c/${tenantSlug}/restaurant/recipes`} className="hover:text-blue-600 dark:hover:text-blue-400">
            Recipes
          </Link>
          <ChevronRight size={14} />
          <span className="text-gray-900 dark:text-white font-medium">{recipe.name}</span>
        </div>
      </div>

      {/* Title Bar */}
      <div className="px-4 py-3 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/c/${tenantSlug}/restaurant/recipes`)}
              className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              aria-label="Back to recipes"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center">
                <ChefHat className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{recipe.name}</h1>
                {recipe.description && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{recipe.description}</p>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={handleOpenEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
          >
            <Pencil size={14} />
            Edit Details
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 bg-gray-50 dark:bg-gray-900 space-y-4">
        {/* Recipe Info Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
              <Package size={14} />
              Yield
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {recipe.yieldQuantity} {recipe.yieldUnit}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
              <Clock size={14} />
              Prep Time
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {recipe.preparationTime ? `${recipe.preparationTime} min` : '--'}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
              <DollarSign size={14} />
              Total Recipe Cost
            </div>
            <div className="text-lg font-semibold text-gray-900 dark:text-white">
              {formatCurrency(totalRecipeCost, currency)}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
              <DollarSign size={14} />
              Food Cost %
            </div>
            <div className="text-lg font-semibold">
              {foodCostPercent !== null ? (
                <span className={
                  foodCostPercent <= 30
                    ? 'text-green-600 dark:text-green-400'
                    : foodCostPercent <= 35
                    ? 'text-yellow-600 dark:text-yellow-400'
                    : 'text-red-600 dark:text-red-400'
                }>
                  {foodCostPercent.toFixed(1)}%
                </span>
              ) : (
                <span className="text-gray-400 dark:text-gray-500">--</span>
              )}
            </div>
            {menuItemPrice !== null && (
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Menu price: {formatCurrency(menuItemPrice, currency)}
              </div>
            )}
          </div>
        </div>

        {/* Instructions */}
        {recipe.instructions && (
          <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 p-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Instructions</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{recipe.instructions}</p>
          </div>
        )}

        {/* Ingredients Table */}
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">
              Ingredients ({recipe.ingredients.length})
            </h3>
            <button
              onClick={handleOpenAddIngredient}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
            >
              <Plus size={14} />
              Add Ingredient
            </button>
          </div>

          {recipe.ingredients.length === 0 ? (
            <div className="p-8 text-center">
              <Package size={32} className="mx-auto text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">No ingredients added yet</p>
              <button
                onClick={handleOpenAddIngredient}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Add your first ingredient
              </button>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <caption className="sr-only">Recipe ingredients</caption>
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Ingredient
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Quantity
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Unit
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Waste %
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Cost/Unit
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Total Cost
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-16">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {recipe.ingredients.map((ingredient) => (
                      <tr key={ingredient.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="px-4 py-2.5 text-sm font-medium text-gray-900 dark:text-white">
                          {ingredient.itemName}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 text-right">
                          {parseFloat(ingredient.quantity).toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 text-center">
                          {ingredient.unit}
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 text-right">
                          {parseFloat(ingredient.wastePercent).toFixed(1)}%
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-400 text-right">
                          {formatCurrency(ingredient.costPerUnit, currency)}
                        </td>
                        <td className="px-4 py-2.5 text-sm font-medium text-gray-900 dark:text-white text-right">
                          {formatCurrency(ingredient.totalCost, currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => setDeleteConfirm({
                              open: true,
                              id: ingredient.id,
                              name: ingredient.itemName,
                            })}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/50 rounded transition-colors"
                            aria-label={`Remove ${ingredient.itemName}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 dark:bg-gray-900 border-t-2 border-gray-300 dark:border-gray-600">
                      <td colSpan={5} className="px-4 py-2.5 text-sm font-semibold text-gray-900 dark:text-white text-right">
                        Total Recipe Cost
                      </td>
                      <td className="px-4 py-2.5 text-sm font-bold text-gray-900 dark:text-white text-right">
                        {formatCurrency(totalRecipeCost, currency)}
                      </td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      <DocumentCommentsAndActivity
        documentType="recipe"
        documentId={id}
        entityType="recipe"
      />

      {/* Edit Recipe Modal */}
      <Modal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Edit Recipe"
        size="lg"
        footer={
          <ModalFooter>
            <button
              type="button"
              onClick={() => setShowEditModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveRecipe}
              disabled={saving || !editFormData.name.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Save size={14} />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </ModalFooter>
        }
      >
        <form onSubmit={handleSaveRecipe} className="space-y-4">
          <div>
            <FormLabel required>Recipe Name</FormLabel>
            <FormInput
              value={editFormData.name}
              onChange={(e) => setEditFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Margherita Pizza"
            />
          </div>

          <div>
            <FormLabel optional>Description</FormLabel>
            <FormTextarea
              value={editFormData.description}
              onChange={(e) => setEditFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Brief description of the recipe..."
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FormLabel required>Yield Quantity</FormLabel>
              <FormInput
                type="number"
                min="0.01"
                step="0.01"
                value={editFormData.yieldQuantity}
                onChange={(e) => setEditFormData(prev => ({ ...prev, yieldQuantity: e.target.value }))}
              />
            </div>
            <div>
              <FormLabel required>Yield Unit</FormLabel>
              <FormSelect
                value={editFormData.yieldUnit}
                onChange={(e) => setEditFormData(prev => ({ ...prev, yieldUnit: e.target.value }))}
              >
                {YIELD_UNITS.map(unit => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </FormSelect>
            </div>
          </div>

          <div>
            <FormLabel optional>Preparation Time (minutes)</FormLabel>
            <FormInput
              type="number"
              min="0"
              step="1"
              value={editFormData.preparationTime}
              onChange={(e) => setEditFormData(prev => ({ ...prev, preparationTime: e.target.value }))}
              placeholder="e.g., 30"
              leftIcon={<Clock size={14} />}
            />
          </div>

          <div>
            <FormLabel optional>Instructions</FormLabel>
            <FormTextarea
              value={editFormData.instructions}
              onChange={(e) => setEditFormData(prev => ({ ...prev, instructions: e.target.value }))}
              placeholder="Step-by-step preparation instructions..."
              rows={4}
            />
          </div>
        </form>
      </Modal>

      {/* Add Ingredient Modal */}
      <Modal
        isOpen={showIngredientModal}
        onClose={() => setShowIngredientModal(false)}
        title="Add Ingredient"
        size="md"
        footer={
          <ModalFooter>
            <button
              type="button"
              onClick={() => setShowIngredientModal(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddIngredient}
              disabled={savingIngredient || !ingredientForm.itemId || !ingredientForm.quantity}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {savingIngredient ? 'Adding...' : 'Add Ingredient'}
            </button>
          </ModalFooter>
        }
      >
        <form onSubmit={handleAddIngredient} className="space-y-4">
          {/* Item Search */}
          <div className="relative">
            <FormLabel required>Ingredient (Item)</FormLabel>
            <FormInput
              value={itemSearchQuery}
              onChange={(e) => {
                setItemSearchQuery(e.target.value)
                if (!e.target.value) {
                  setIngredientForm(prev => ({ ...prev, itemId: '', itemName: '' }))
                }
              }}
              onFocus={() => {
                if (itemSearchResults.length > 0) setShowItemDropdown(true)
              }}
              placeholder="Search items..."
              autoComplete="off"
            />
            {ingredientForm.itemId && (
              <div className="mt-1 text-xs text-green-600 dark:text-green-400">
                Selected: {ingredientForm.itemName}
              </div>
            )}
            {showItemDropdown && itemSearchResults.length > 0 && (
              <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-48 overflow-y-auto">
                {itemSearchResults.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    onClick={() => handleSelectItem(item)}
                  >
                    <span className="text-gray-900 dark:text-white">{item.label}</span>
                    {item.data?.costPrice && (
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                        Cost: {formatCurrency(item.data.costPrice, currency)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {searchingItems && (
              <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg p-3 text-center text-sm text-gray-500">
                Searching...
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FormLabel required>Quantity</FormLabel>
              <FormInput
                type="number"
                min="0.001"
                step="0.001"
                value={ingredientForm.quantity}
                onChange={(e) => setIngredientForm(prev => ({ ...prev, quantity: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div>
              <FormLabel required>Unit</FormLabel>
              <FormSelect
                value={ingredientForm.unit}
                onChange={(e) => setIngredientForm(prev => ({ ...prev, unit: e.target.value }))}
              >
                {INGREDIENT_UNITS.map(unit => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </FormSelect>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FormLabel optional>Waste %</FormLabel>
              <FormInput
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={ingredientForm.wastePercent}
                onChange={(e) => setIngredientForm(prev => ({ ...prev, wastePercent: e.target.value }))}
                placeholder="0"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Percentage lost during preparation
              </p>
            </div>
            <div>
              <FormLabel required>Cost per Unit</FormLabel>
              <FormInput
                type="number"
                min="0"
                step="0.01"
                value={ingredientForm.costPerUnit}
                onChange={(e) => setIngredientForm(prev => ({ ...prev, costPerUnit: e.target.value }))}
                placeholder="0.00"
                leftIcon={<DollarSign size={14} />}
              />
            </div>
          </div>

          {/* Preview total */}
          {ingredientForm.quantity && ingredientForm.costPerUnit && (
            <div className="bg-gray-50 dark:bg-gray-900 rounded-md p-3 text-sm">
              <div className="flex justify-between text-gray-600 dark:text-gray-400">
                <span>Base cost:</span>
                <span>{formatCurrency(parseFloat(ingredientForm.quantity) * parseFloat(ingredientForm.costPerUnit), currency)}</span>
              </div>
              {parseFloat(ingredientForm.wastePercent) > 0 && (
                <div className="flex justify-between text-gray-600 dark:text-gray-400 mt-1">
                  <span>With waste ({ingredientForm.wastePercent}%):</span>
                  <span className="font-medium text-gray-900 dark:text-white">
                    {formatCurrency(
                      (parseFloat(ingredientForm.quantity) * parseFloat(ingredientForm.costPerUnit)) /
                      (1 - parseFloat(ingredientForm.wastePercent) / 100),
                      currency
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete Ingredient Confirmation */}
      <ConfirmModal
        isOpen={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, id: null, name: '' })}
        onConfirm={handleDeleteIngredient}
        title="Remove Ingredient"
        message={`Are you sure you want to remove "${deleteConfirm.name}" from this recipe?`}
        confirmText="Remove"
        variant="danger"
      />
    </div>
  )
}
