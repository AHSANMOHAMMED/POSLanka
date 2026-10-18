/**
 * UI Components Index
 * ERPNext-style component library
 */

// Badge components
export { Badge, StatusBadge, CountBadge, LabelBadge } from './badge'

// Button components
export { Button, buttonVariants } from './button'

// Card components
export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } from './card'

// Dialog components
export { Dialog, DialogContent, DialogFooter, ConfirmDialog, AlertDialog, FormDialog, DeleteDialog } from './dialog'

// Form elements
export {
  FormInput,
  FormSelect,
  FormTextarea,
  FormCheckbox,
  FormRadio,
  FormLabel,
  FormField,
  FormSection,
  FormActions,
  InlineEditInput,
} from './form-elements'

// Input (legacy - use FormInput for new code)
export { Input } from './input'

// Label (legacy - use FormLabel for new code)
export { Label } from './label'

// Section card components
export { SectionCard, Field, FieldGrid, InfoCard, StatCard, EmptyState } from './section-card'

// Page header components
export {
  PageHeader,
  ListPageHeader,
  DetailPageHeader,
  Breadcrumb,
  PageTabs,
  FilterBar,
  FilterButtonGroup,
  SearchInput,
} from './page-header'

// Data table components
export { DataTable, ActionMenu } from './data-table'
export { ResponsiveTable, useResponsiveTableConfig } from './ResponsiveTable'

// Modal components
export { Modal, ModalFooter, ModalBody, Drawer } from './modal'

// Pagination component
export { Pagination } from './pagination'

// Timeline components
export { Timeline, ActivityFeed, ActivityList } from './timeline'

// Loading states
export { LoadingSpinner, PageLoading, ButtonSpinner } from './loading-spinner'
export {
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTable,
  SkeletonForm,
  SkeletonListItem,
  SkeletonList,
  PageSkeleton,
} from './skeleton'

// Other UI components
export { toast, ToastContainer, useToastStore } from './toast'
export { LinkField } from './link-field'
export { CreatableSelect } from './creatable-select'
export { WarehouseSelector } from './warehouse-selector'
export { ConnectionStatus } from './connection-status'
export { ThemeToggle } from './theme-toggle'
export { EditableItemsGrid } from './editable-items-grid'
export { EditableGrid } from './editable-grid'
export type { ColumnDef, ColumnType, EditableGridProps } from './editable-grid'


// Legacy components (backwards compatibility)
export { ConfirmModal } from './confirm-modal'
export { AlertModal } from './alert-modal'
