'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ChefHat, Clock } from 'lucide-react'
import { usePaginatedData } from '@/hooks'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { Pagination } from '@/components/ui/pagination'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { FormInput, FormLabel, FormSelect, FormTextarea } from '@/components/ui/form-elements'
import { toast } from '@/components/ui/toast'
import { PageLoading } from '@/components/ui/loading-spinner'
import { formatCurrency } from '@/lib/utils/currency'
import { EmptyState, Button } from '@/components/ui'
import { useCompany } from '@/components/providers/CompanyContextProvider'

// ============================================
// TYPES
// ============================================

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
  ingredientCount: number
  totalCost: string
  foodCostPercent: string | null
  createdAt: string
}

interface RecipeFormData {
  name: string
  description: string
  yieldQuantity: string
  yieldUnit: string
  preparationTime: string
  instructions: string
}

const INITIAL_FORM_DATA: RecipeFormData = {
  name: '',
  description: '',
  yieldQuantity: '1',
  yieldUnit: 'serving',
  preparationTime: '',
  instructions: '',
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

// ============================================
// MAIN COMPONENT
// ============================================

export default function RecipesPage() {
  const router = useRouter()
  const { tenantSlug, currency } = useCompany()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [formData, setFormData] = useState<RecipeFormData>(INITIAL_FORM_DATA)
  const [saving, setSaving] = useState(false)

  const {
    data: recipes,
    pagination,
    loading,
    search,
    setSearch,
    setPage,
    setPageSize,
    refresh,
  } = usePaginatedData<Recipe>({
    endpoint: '/api/recipes',
    entityType: 'recipe',
    storageKey: 'recipes-page-size',
  })

  // ============================================
  // HANDLERS
  // ============================================

  function handleOpenCreate() {
    setFormData(INITIAL_FORM_DATA)
    setShowCreateModal(true)
  }

  function handleCloseCreate() {
    setShowCreateModal(false)
    setFormData(INITIAL_FORM_DATA)
  }

  async function handleCreateRecipe(e: React.FormEvent) {
    e.preventDefault()

    if (!formData.name.trim()) {
      toast.error('Recipe name is required')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/recipes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          yieldQuantity: parseFloat(formData.yieldQuantity) || 1,
          yieldUnit: formData.yieldUnit,
          preparationTime: formData.preparationTime ? parseInt(formData.preparationTime) : null,
          instructions: formData.instructions.trim() || null,
        }),
      })

      if (res.ok) {
        const recipe = await res.json()
        toast.success('Recipe created')
        handleCloseCreate()
        refresh()
        // Navigate to the new recipe detail page
        router.push(`/c/${tenantSlug}/restaurant/recipes/${recipe.id}`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create recipe')
      }
    } catch (error) {
      console.error('Error creating recipe:', error)
      toast.error('Failed to create recipe')
    } finally {
      setSaving(false)
    }
  }

  function handleRowClick(recipe: Recipe) {
    router.push(`/c/${tenantSlug}/restaurant/recipes/${recipe.id}`)
  }

  // ============================================
  // RENDER
  // ============================================

  if (loading && recipes.length === 0) {
    return <PageLoading text="Loading recipes..." />
  }

  return (
    <ListPageLayout
      module="Restaurant"
      moduleHref="/restaurant"
      title="Recipes"
      actionButton={{ label: 'New Recipe', onClick: handleOpenCreate }}
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder="Search recipes..."
    >
      <div className="flex-1 overflow-auto p-4">
        <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 list-container-xl">
          <table className="w-full">
            <caption className="sr-only">List of recipes</caption>
            <thead className="bg-gray-50 dark:bg-gray-900 table-sticky-header">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Recipe Name
                </th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Menu Item
                </th>
                <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Ingredients
                </th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Food Cost
                </th>
                <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Food Cost %
                </th>
                <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Prep Time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {recipes.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={<ChefHat size={24} />}
                      title={search ? 'No recipes found' : 'No recipes yet'}
                      description={search ? 'Try adjusting your search terms' : 'Create your first recipe to track food costs'}
                      action={
                        !search && (
                          <Button onClick={handleOpenCreate} size="sm">
                            <Plus size={16} className="mr-1" />
                            New Recipe
                          </Button>
                        )
                      }
                    />
                  </td>
                </tr>
              ) : (
                recipes.map((recipe) => (
                  <tr
                    key={recipe.id}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                    onClick={() => handleRowClick(recipe)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-orange-100 dark:bg-orange-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                          <ChefHat className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-white">{recipe.name}</div>
                          {recipe.description && (
                            <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-xs">
                              {recipe.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {recipe.menuItemName || <span className="text-gray-400 dark:text-gray-500">Not linked</span>}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-400">
                      {recipe.ingredientCount}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {formatCurrency(recipe.totalCost, currency)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {recipe.foodCostPercent ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          parseFloat(recipe.foodCostPercent) <= 30
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : parseFloat(recipe.foodCostPercent) <= 35
                            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                          {parseFloat(recipe.foodCostPercent).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-gray-500">--</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600 dark:text-gray-400">
                      {recipe.preparationTime ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock size={14} className="text-gray-400" />
                          {recipe.preparationTime} min
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">--</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          <Pagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            total={pagination.total}
            totalPages={pagination.totalPages}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            className="border-t dark:border-gray-700 px-4"
          />
        </div>
      </div>

      {/* Create Recipe Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={handleCloseCreate}
        title="New Recipe"
        size="lg"
        footer={
          <ModalFooter>
            <button
              type="button"
              onClick={handleCloseCreate}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateRecipe}
              disabled={saving || !formData.name.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Creating...' : 'Create Recipe'}
            </button>
          </ModalFooter>
        }
      >
        <form onSubmit={handleCreateRecipe} className="space-y-4">
          <div>
            <FormLabel required>Recipe Name</FormLabel>
            <FormInput
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="e.g., Margherita Pizza"
              autoFocus
            />
          </div>

          <div>
            <FormLabel optional>Description</FormLabel>
            <FormTextarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
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
                value={formData.yieldQuantity}
                onChange={(e) => setFormData(prev => ({ ...prev, yieldQuantity: e.target.value }))}
                placeholder="1"
              />
            </div>
            <div>
              <FormLabel required>Yield Unit</FormLabel>
              <FormSelect
                value={formData.yieldUnit}
                onChange={(e) => setFormData(prev => ({ ...prev, yieldUnit: e.target.value }))}
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
              value={formData.preparationTime}
              onChange={(e) => setFormData(prev => ({ ...prev, preparationTime: e.target.value }))}
              placeholder="e.g., 30"
              leftIcon={<Clock size={14} />}
            />
          </div>

          <div>
            <FormLabel optional>Instructions</FormLabel>
            <FormTextarea
              value={formData.instructions}
              onChange={(e) => setFormData(prev => ({ ...prev, instructions: e.target.value }))}
              placeholder="Step-by-step preparation instructions..."
              rows={4}
            />
          </div>
        </form>
      </Modal>
    </ListPageLayout>
  )
}
