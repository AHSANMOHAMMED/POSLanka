# Form Patterns & Migration Guide

## Overview
This document provides standardized form patterns for the Retail Smart POS application. Many pages currently use native HTML inputs (`<input>`, `<textarea>`, `<select>`) which should be migrated to use the consistent form components (`FormInput`, `FormSelect`, `FormTextarea`) for better consistency, accessibility, and mobile responsiveness.

## Why Migrate to Form Components?

### Benefits
1. **Consistent Styling**: Uniform appearance across all forms
2. **Mobile Responsiveness**: Automatic touch target optimization
3. **Accessibility**: Built-in ARIA labels and keyboard navigation
4. **Error Handling**: Standardized error states and validation
5. **Maintainability**: Single source of truth for form styling

### Performance
- Form components are optimized with `React.memo` to prevent unnecessary re-renders
- Responsive size detection happens once per component tree
- Minimal bundle size impact

## Standard Form Patterns

### 1. Basic Text Input

#### ❌ Before (Native HTML)
```tsx
<input
  type="text"
  placeholder="Search by invoice number or customer..."
  value={search}
  onChange={(e) => setSearch(e.target.value)}
  className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
/>
```

#### ✅ After (FormInput)
```tsx
<FormInput
  type="text"
  placeholder="Search by invoice number or customer..."
  value={search}
  onChange={(e) => setSearch(e.target.value)}
  leftIcon={<Search size={16} />}
  inputSize="md"
/>
```

### 2. Number Input

#### ❌ Before (Native HTML)
```tsx
<input
  type="number"
  step="0.01"
  value={amount}
  onChange={(e) => setAmount(e.target.value)}
  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
/>
```

#### ✅ After (FormInput)
```tsx
<FormInput
  type="number"
  step="0.01"
  value={amount}
  onChange={(e) => setAmount(e.target.value)}
  inputSize="md"
/>
```

### 3. Search Input with Icon

#### ❌ Before (Native HTML)
```tsx
<div className="relative">
  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
  <input
    type="text"
    placeholder="Search..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
  />
</div>
```

#### ✅ After (FormInput)
```tsx
<FormInput
  type="text"
  placeholder="Search..."
  value={search}
  onChange={(e) => setSearch(e.target.value)}
  leftIcon={<Search size={16} />}
  inputSize="md"
/>
```

### 4. Select Dropdown

#### ❌ Before (Native HTML)
```tsx
<select
  value={status}
  onChange={(e) => setStatus(e.target.value)}
  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
>
  <option value="pending">Pending</option>
  <option value="completed">Completed</option>
</select>
```

#### ✅ After (FormSelect)
```tsx
<FormSelect
  value={status}
  onChange={(e) => setStatus(e.target.value)}
  selectSize="md"
>
  <option value="pending">Pending</option>
  <option value="completed">Completed</option>
</FormSelect>
```

### 5. Textarea

#### ❌ Before (Native HTML)
```tsx
<textarea
  value={notes}
  onChange={(e) => setNotes(e.target.value)}
  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
  rows={3}
/>
```

#### ✅ After (FormTextarea)
```tsx
<FormTextarea
  value={notes}
  onChange={(e) => setNotes(e.target.value)}
  textareaSize="md"
  rows={3}
/>
```

## Complete Form Examples

### Example 1: Search and Filter Bar

#### ❌ Before
```tsx
<div className="mb-4 flex gap-4">
  <div className="relative flex-1">
    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
    <input
      type="text"
      placeholder="Search by invoice number or customer..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      className="w-full pl-10 pr-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
  <div className="flex gap-1 bg-gray-100 p-1 rounded">
    <button
      onClick={() => setStatusFilter('all')}
      className={`px-3 py-1 rounded text-sm font-medium transition ${
        statusFilter === 'all' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
      }`}
    >
      All
    </button>
    <button
      onClick={() => setStatusFilter('pending')}
      className={`px-3 py-1 rounded text-sm font-medium transition ${
        statusFilter === 'pending' ? 'bg-orange-500 text-white shadow' : 'text-gray-600 hover:text-gray-900'
      }`}
    >
      Pending
    </button>
  </div>
</div>
```

#### ✅ After
```tsx
<div className="mb-4 flex gap-4">
  <div className="flex-1">
    <FormInput
      type="text"
      placeholder="Search by invoice number or customer..."
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      leftIcon={<Search size={16} />}
      inputSize="md"
    />
  </div>
  <div className="flex gap-2">
    <Button
      variant={statusFilter === 'all' ? 'default' : 'outline'}
      size="sm"
      onClick={() => setStatusFilter('all')}
    >
      All
    </Button>
    <Button
      variant={statusFilter === 'pending' ? 'default' : 'outline'}
      size="sm"
      onClick={() => setStatusFilter('pending')}
    >
      Pending
    </Button>
  </div>
</div>
```

### Example 2: Payment Modal Inputs

#### ❌ Before
```tsx
<input
  type="number"
  value={paymentData.amount}
  onChange={(e) => {
    let val = e.target.value
    if (paymentData.method !== 'cash' && parseFloat(val) > remainingAfterCredit) {
      val = String(remainingAfterCredit)
    }
    setPaymentData(prev => ({ ...prev, amount: val }))
  }}
  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
  step="0.01"
/>
```

#### ✅ After
```tsx
<FormInput
  type="number"
  value={paymentData.amount}
  onChange={(e) => {
    let val = e.target.value
    if (paymentData.method !== 'cash' && parseFloat(val) > remainingAfterCredit) {
      val = String(remainingAfterCredit)
    }
    setPaymentData(prev => ({ ...prev, amount: val }))
  }}
  inputSize="lg"
  step="0.01"
/>
```

## Migration Checklist

### Step 1: Identify Native Inputs
1. Search for `type="text"` in component files
2. Search for `type="number"` in component files  
3. Search for `<textarea` in component files
4. Search for `<select` in component files

### Step 2: Update Imports
Add import statement at the top of the file:
```tsx
import { FormInput, FormSelect, FormTextarea } from '@/components/ui/form-elements'
```

### Step 3: Replace Components
Replace native HTML elements with corresponding form components:
- `<input type="text">` → `<FormInput type="text">`
- `<input type="number">` → `<FormInput type="number">`
- `<textarea>` → `<FormTextarea>`
- `<select>` → `<FormSelect>`

### Step 4: Remove Custom Styling
Remove inline `className` attributes as form components have built-in styling. Use component props instead:
- Use `inputSize="md"` instead of custom height classes
- Use `error={true}` instead of custom border colors
- Use `leftIcon`/`rightIcon` instead of manual icon positioning

### Step 5: Test Responsive Behavior
1. Test on mobile screen sizes
2. Verify touch targets are adequate (minimum 44px height)
3. Check keyboard navigation
4. Test screen reader compatibility

## Component Props Reference

### FormInput Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `type` | string | 'text' | Input type (text, number, email, etc.) |
| `inputSize` | 'sm' \| 'md' \| 'lg' \| 'mobile' | 'md' | Responsive size variant |
| `error` | boolean | false | Error state styling |
| `leftIcon` | ReactNode | undefined | Icon displayed on left side |
| `rightIcon` | ReactNode | undefined | Icon displayed on right side |
| `className` | string | undefined | Additional CSS classes |

### FormSelect Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `selectSize` | 'sm' \| 'md' \| 'lg' \| 'mobile' | 'md' | Responsive size variant |
| `error` | boolean | false | Error state styling |
| `className` | string | undefined | Additional CSS classes |

### FormTextarea Props
| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `textareaSize` | 'sm' \| 'md' \| 'lg' \| 'mobile' | 'md' | Responsive size variant |
| `error` | boolean | false | Error state styling |
| `className` | string | undefined | Additional CSS classes |

## Responsive Size Mapping

### Desktop → Mobile
- `sm` (32px) → `sm` (32px) *no change on mobile*
- `md` (36px) → `mobile` (44px) *optimized for touch*
- `lg` (40px) → `mobile` (44px) *optimized for touch*
- `mobile` (44px) → `mobile` (44px) *always mobile-optimized*

## Common Migration Challenges & Solutions

### Challenge 1: Custom Styling Requirements
**Solution**: Use `className` prop to add custom styles, but try to use component props first.

### Challenge 2: Complex Icon Positioning
**Solution**: Use `leftIcon` and `rightIcon` props instead of manual positioning.

### Challenge 3: Different Input Types
**Solution**: FormInput supports all standard HTML input types:
- `type="text"` (default)
- `type="number"`
- `type="email"`
- `type="password"`
- `type="tel"`
- `type="date"`
- `type="time"`
- `type="datetime-local"`
- `type="url"`

### Challenge 4: Form Field Layout
**Solution**: Use `FormField` wrapper for consistent label, input, and error handling:
```tsx
<FormField
  label="Email Address"
  required
  error={errors.email}
  hint="Enter your email address"
>
  <FormInput
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
  />
</FormField>
```

## Quality Assurance Checklist

After migration, verify:

1. [ ] Visual appearance matches design system
2. [ ] Mobile responsive behavior works correctly
3. [ ] Keyboard navigation is functional
4. [ ] Screen readers announce labels correctly
5. [ ] Error states display properly
6. [ ] Form validation still works
7. [ ] Performance is not degraded
8. [ ] All unit tests pass
9. [ ] Browser compatibility maintained

## Next Steps

1. **Start with high-traffic pages**: Sales, POS, Customers
2. **Use automated tools**: ESLint rules to prevent regression
3. **Document patterns**: Add to team knowledge base
4. **Train team members**: Share this guide with all developers

## See Also

- [COMPONENT_USAGE_GUIDE.md](./COMPONENT_USAGE_GUIDE.md) - Complete component library documentation
- [DESIGN_TOKENS.md](./DESIGN_TOKENS.md) - Design token system reference
- [Form Elements Source](./form-elements.tsx) - Component implementation details