# UI Component Library Usage Guide

## Overview
This document provides guidelines for using the UI component library in the Retail Smart POS application. The library follows ERPNext-style patterns with mobile-first responsive design.

## Core Principles

1. **Consistency**: Use the same components for similar functionality across modules
2. **Accessibility**: All components must be accessible (keyboard navigation, screen reader support)
3. **Responsive Design**: Components adapt to mobile, tablet, and desktop screens
4. **Performance**: Minimal re-renders, efficient component composition
5. **Maintainability**: Clear API boundaries, well-documented props

## Component Categories

### 1. Button Components (`button.tsx`)

#### Variants
- `default`: Primary action buttons
- `destructive`: Delete, remove, dangerous actions
- `outline`: Secondary actions, less prominent
- `secondary`: Alternative actions
- `ghost`: Minimal visual weight, inline actions
- `link`: Text-only links styled as buttons

#### Sizes
- `sm`: Small buttons for dense interfaces
- `default`: Standard button size
- `lg`: Large buttons for prominent actions
- `icon`: Square buttons for icons
- `mobile-lg`: Optimized for mobile touch targets (44px height)
- `mobile-sm`: Small mobile variant

#### Usage Examples
```tsx
// Primary action
<Button onClick={handleSubmit}>Save Changes</Button>

// Destructive action
<Button variant="destructive" onClick={handleDelete}>Delete</Button>

// Outline button
<Button variant="outline" onClick={handleCancel}>Cancel</Button>

// Mobile-optimized button
<Button size="mobile-lg" onClick={handleCheckout}>Checkout</Button>
```

### 2. Form Components (`form-elements.tsx`)

#### Responsive Sizes
- `sm`: 32px height (desktop only)
- `md`: 36px height (responsive to mobile)
- `lg`: 40px height (responsive to mobile)
- `mobile`: 44px minimum height (mobile optimized)

#### Available Components
- `FormInput`: Text input with responsive sizing
- `FormSelect`: Dropdown select
- `FormTextarea`: Multi-line text input
- `FormCheckbox`: Checkbox with label support
- `FormRadio`: Radio button
- `FormLabel`: Input labels with required/optional indicators
- `FormField`: Complete field wrapper (label, input, error)
- `FormSection`: Group related form fields
- `FormActions`: Action buttons for forms
- `InlineEditInput`: Editable text field

#### Usage Examples
```tsx
// Complete form field with validation
<FormField
  label="Email Address"
  required
  error={errors.email}
>
  <FormInput
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    inputSize="md"
    leftIcon={<Mail size={16} />}
  />
</FormField>

// Form section with multiple fields
<FormSection
  title="Personal Information"
  description="Enter your personal details"
  columns={2}
>
  <FormField label="First Name" required>
    <FormInput placeholder="John" />
  </FormField>
  <FormField label="Last Name" required>
    <FormInput placeholder="Doe" />
  </FormField>
</FormSection>
```

### 3. Data Display Components

#### Data Table (`data-table.tsx`)
- Full-featured table with sorting, pagination, selection
- Responsive design with mobile optimizations
- Built-in loading states and empty states

#### Badge Components (`badge.tsx`)
- `Badge`: Customizable badge with variants
- `StatusBadge`: Automatic status color mapping
- `CountBadge`: Numeric badge for notifications
- `LabelBadge`: Color-coded tags/labels

#### Card Components (`card.tsx`)
- Standard card with header, content, footer
- Responsive padding based on screen size

#### Section Card (`section-card.tsx`)
- Collapsible sections for organizing content
- Field display components for detail views
- Info cards and stat cards for dashboards

### 4. Navigation & Layout

#### Page Header (`page-header.tsx`)
- Breadcrumbs, page titles, and actions
- Filter bars and search inputs
- Tab-based navigation

#### Responsive Table (`ResponsiveTable.tsx`)
- Table that transforms to cards on mobile
- Maintains functionality across breakpoints

### 5. Feedback Components

#### Toast Notifications (`toast.tsx`)
- Success, error, warning, and info toasts
- Configurable duration and position

#### Loading States
- `LoadingSpinner`: Circular progress indicator
- `Skeleton`: Content placeholders
- `PageLoading`: Full-page loading overlay

#### Modal Dialogs (`dialog.tsx`, `modal.tsx`)
- `Dialog`: Standard modal dialog
- `ConfirmDialog`: Confirmation prompts
- `AlertDialog`: Alert messages
- `Drawer`: Side panel for mobile

## Responsive Design Guidelines

### Mobile-First Approach
1. **Touch Targets**: Minimum 44px height for interactive elements
2. **Font Sizes**: Base font size 16px on mobile
3. **Spacing**: Consistent use of spacing scale (4px increments)
4. **Breakpoints**:
   - Mobile: < 640px
   - Tablet: 640px - 1024px
   - Desktop: > 1024px

### Responsive Utilities
```tsx
import { useIsMobile } from '@/hooks/useResponsive'

function Component() {
  const isMobile = useIsMobile()
  
  return (
    <Button size={isMobile ? 'mobile-lg' : 'lg'}>
      {isMobile ? 'Save' : 'Save Changes'}
    </Button>
  )
}
```

## Accessibility Guidelines

### Keyboard Navigation
1. **Focus Management**: Ensure logical tab order
2. **Focus Rings**: Visible focus indicators for all interactive elements
3. **Keyboard Shortcuts**: Common shortcuts (Enter, Escape, Space)

### Screen Reader Support
1. **ARIA Labels**: Provide descriptive labels for interactive elements
2. **Live Regions**: Announce dynamic content changes
3. **Semantic HTML**: Use appropriate HTML elements

### Color Contrast
1. **Text**: Minimum 4.5:1 contrast ratio
2. **Interactive Elements**: Minimum 3:1 contrast ratio
3. **Status Indicators**: Use both color and text/icon

## Design Tokens

### Colors
- Primary: Blue (brand color)
- Secondary: Gray (neutral)
- Success: Green
- Warning: Yellow/Orange
- Danger: Red
- Info: Blue (lighter)

### Typography
- Font Family: System fonts (Inter/SF Pro)
- Font Sizes: Responsive scale (12px - 24px)
- Font Weights: 400 (normal), 500 (medium), 600 (semibold), 700 (bold)

### Spacing
- Base Unit: 4px
- Scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128

### Shadows
- Small: `shadow-sm` for subtle elevation
- Medium: `shadow` for cards and modals
- Large: `shadow-lg` for dropdowns and popovers

## Performance Best Practices

### Component Optimization
1. **Memoization**: Use `React.memo` for pure components
2. **Callback Optimization**: Use `useCallback` for event handlers
3. **State Management**: Lift state up when appropriate

### Bundle Size
1. **Tree Shaking**: Import only needed components
2. **Code Splitting**: Lazy load non-critical components
3. **Icon Optimization**: Use dynamic imports for large icon sets

## Testing Guidelines

### Component Testing
1. **Render Tests**: Verify component renders correctly
2. **Interaction Tests**: Test user interactions
3. **Accessibility Tests**: Verify ARIA attributes and keyboard navigation

### Visual Regression
1. **Snapshot Tests**: Detect unexpected visual changes
2. **Responsive Tests**: Verify all breakpoints

## Common Patterns

### Form Validation
```tsx
function ExampleForm() {
  const [errors, setErrors] = useState({})
  
  return (
    <form onSubmit={handleSubmit}>
      <FormField
        label="Email"
        required
        error={errors.email}
        hint="Enter a valid email address"
      >
        <FormInput
          type="email"
          error={!!errors.email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (errors.email) setErrors({...errors, email: undefined})
          }}
        />
      </FormField>
    </form>
  )
}
```

### Loading States
```tsx
function DataTableWithLoading() {
  const { data, isLoading } = useQuery()
  
  if (isLoading) {
    return <SkeletonTable rows={5} columns={4} />
  }
  
  return <DataTable data={data} />
}
```

### Empty States
```tsx
function ListWithEmptyState() {
  const items = []
  
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Package size={24} />}
        title="No items found"
        description="Add your first item to get started"
        action={<Button>Add Item</Button>}
      />
    )
  }
  
  return <DataTable data={items} />
}
```

## Migration Notes

### Legacy Components
- Use `FormInput` instead of `Input` for new code
- Use `FormLabel` instead of `Label` for new code
- `ConfirmModal` and `AlertModal` are deprecated in favor of `ConfirmDialog` and `AlertDialog`

### Breaking Changes
- Check component prop interfaces before updates
- Test responsive behavior on all breakpoints
- Verify accessibility after changes

## Troubleshooting

### Common Issues
1. **Missing Styles**: Ensure Tailwind classes are included in content config
2. **Responsive Issues**: Test on actual mobile devices, not just dev tools
3. **Accessibility Errors**: Use axe DevTools for automated testing
4. **Performance Problems**: Check for unnecessary re-renders with React DevTools

### Getting Help
1. **Component Documentation**: Refer to this guide
2. **Design System**: Check Figma/Sketch files
3. **Code Examples**: Review existing implementations in the codebase
4. **Team Support**: Consult with UI/UX team members