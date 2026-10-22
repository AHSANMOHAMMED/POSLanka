/**
 * POSLanka console kit — shared UI for /sys-control and the sign-in pages.
 * Colours come from --adm-* tokens (src/app/admin-kit.css) and follow light/dark.
 *
 *   import { AdminPage, AdminCard, AdminTable, Button } from '@/components/admin/kit'
 */
export { Button, LinkButton, buttonClass, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button'
export {
  Field,
  Input,
  PasswordInput,
  SearchInput,
  Select,
  Textarea,
  Checkbox,
  Switch,
  SegmentedControl,
  type InputProps,
  type SegmentedOption,
} from './Form'
export { AdminPage, AdminCard, AdminSection, AdminToolbar, StatGrid, KeyValueList, type AdminPageProps, type AdminCardProps, type Crumb } from './Layout'
export { Badge, StatCard, EmptyState, Alert, Skeleton, StatusDot, statusTone, type Tone, type StatCardProps } from './Display'
export { AdminTable, type AdminColumn, type AdminTableProps } from './Table'
export { AdminModal, ConfirmDialog, type AdminModalProps } from './Modal'
export { AuthShell, AuthBrandPanel, AuthHeading, AuthResult, BrandMark, Divider } from './AuthShell'
export { LogoMark } from './LogoMark'
export * from './format'
