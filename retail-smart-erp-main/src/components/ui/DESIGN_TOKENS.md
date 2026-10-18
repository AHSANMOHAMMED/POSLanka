# Design Tokens System

## Overview
This document describes the design token system used throughout the Retail Smart POS application. Design tokens are centralized values that define the visual design language, ensuring consistency across all UI components.

## Token Categories

### 1. Color Tokens

#### Primary Brand Colors
```typescript
primary: {
  50: '#eff6ff',  // Lightest blue
  100: '#dbeafe',
  200: '#bfdbfe',
  300: '#93c5fd',
  400: '#60a5fa',
  500: '#3b82f6',  // Primary brand color
  600: '#2563eb',
  700: '#1d4ed8',
  800: '#1e40af',
  900: '#1e3a8a',  // Darkest blue
}
```

#### Semantic Colors
- **Success**: Green shades for positive states
- **Warning**: Yellow/Orange shades for caution states
- **Danger**: Red shades for error/destructive states
- **Info**: Blue shades for informational states

#### Neutral Colors
- Gray scale from 50 (lightest) to 950 (darkest)
- Used for backgrounds, borders, and text

#### Status Color Mapping
```typescript
// Available status types:
draft, pending, submitted, approved, in_progress, completed,
cancelled, on_hold, overdue, paid, partial, unpaid, active, inactive

// Usage:
import { getStatusColor } from '@/lib/ui/tokens'
const colors = getStatusColor('completed')
// Returns: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' }
```

### 2. Spacing Scale
Based on 4px increments (0.25rem):
```typescript
0: '0',          // 0px
0.5: '0.125rem', // 2px
1: '0.25rem',    // 4px (base unit)
2: '0.5rem',     // 8px
3: '0.75rem',    // 12px
4: '1rem',       // 16px
5: '1.25rem',    // 20px
6: '1.5rem',     // 24px
8: '2rem',       // 32px
10: '2.5rem',    // 40px
12: '3rem',      // 48px
16: '4rem',      // 64px
20: '5rem',      // 80px
24: '6rem',      // 96px
```

### 3. Typography

#### Font Sizes
```typescript
xs: '0.75rem',    // 12px
sm: '0.875rem',   // 14px
base: '1rem',     // 16px (base)
lg: '1.125rem',   // 18px
xl: '1.25rem',    // 20px
'2xl': '1.5rem',  // 24px
'3xl': '1.875rem', // 30px
'4xl': '2.25rem', // 36px
```

#### Font Weights
```typescript
normal: '400',
medium: '500',
semibold: '600',
bold: '700',
```

#### Line Heights
```typescript
none: '1',
tight: '1.25',
snug: '1.375',
normal: '1.5',
relaxed: '1.625',
loose: '2',
```

### 4. Border Radius
```typescript
none: '0',
sm: '0.125rem',   // 2px
DEFAULT: '0.25rem', // 4px (default)
md: '0.375rem',   // 6px
lg: '0.5rem',     // 8px
xl: '0.75rem',    // 12px
'2xl': '1rem',    // 16px
'3xl': '1.5rem',  // 24px
full: '9999px',   // Fully rounded
```

### 5. Shadows
```typescript
none: 'none',
sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
'2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
```

### 6. Z-Index Scale
```typescript
auto: 'auto',
0: '0',
10: '10',      // Base elements
20: '20',      // Dropdowns
30: '30',      // Sticky headers
40: '40',      // Fixed elements
50: '50',      // Modals, dialogs
60: '60',      // Dropdowns on top of modals
70: '70',      // Tooltips
80: '80',      // Popovers
90: '90',      // Toast notifications
100: '100',    // Maximum layer
```

### 7. Transitions

#### Durations
```typescript
75: '75ms',
100: '100ms',
150: '150ms',
200: '200ms' (default),
300: '300ms',
500: '500ms',
700: '700ms',
1000: '1000ms',
```

#### Timing Functions
```typescript
linear: 'linear',
in: 'cubic-bezier(0.4, 0, 1, 1)',      // Accelerate
out: 'cubic-bezier(0, 0, 0.2, 1)',     // Decelerate
inOut: 'cubic-bezier(0.4, 0, 0.2, 1)', // Accelerate/Decelerate
```

### 8. Component Size Variants

#### Input Sizes
```typescript
sm: 'h-8 px-2 py-1 text-xs',
md: 'h-9 px-3 py-1.5 text-sm' (default),
lg: 'h-10 px-4 py-2 text-sm',
```

#### Button Sizes
```typescript
xs: 'h-7 px-2 text-xs',
sm: 'h-8 px-3 text-sm',
md: 'h-9 px-4 text-sm' (default),
lg: 'h-10 px-6 text-base',
xl: 'h-12 px-8 text-lg',
icon: 'h-9 w-9',
'mobile-lg': 'h-11 px-6 py-3 text-base',
'mobile-sm': 'h-10 px-4 py-2.5 text-sm',
```

#### Icon Sizes (in pixels)
```typescript
xs: 14,
sm: 16,
md: 18,
lg: 20,
xl: 24,
```

### 9. Breakpoints
```typescript
sm: '640px',   // Mobile
md: '768px',   // Tablet
lg: '1024px',  // Desktop
xl: '1280px',  // Large desktop
'2xl': '1536px', // Extra large desktop
```

### 10. Modal Sizes
```typescript
xs: 'max-w-xs',      // 320px
sm: 'max-w-sm',      // 384px
md: 'max-w-md',      // 448px (default)
lg: 'max-w-lg',      // 512px
xl: 'max-w-xl',      // 576px
'2xl': 'max-w-2xl',  // 672px
'3xl': 'max-w-3xl',  // 768px
'4xl': 'max-w-4xl',  // 896px
'5xl': 'max-w-5xl',  // 1024px
'6xl': 'max-w-6xl',  // 1152px
'7xl': 'max-w-7xl',  // 1280px
full: 'max-w-full',
```

## Usage Guidelines

### Importing Tokens
```typescript
import { colors, spacing, typography, getStatusColor } from '@/lib/ui/tokens'

// Use in components
const style = {
  backgroundColor: colors.primary[500],
  padding: spacing[4],
  fontSize: typography.fontSize.lg,
}
```

### Tailwind CSS Integration
The design tokens are integrated with Tailwind CSS via the `tailwind.config.js` file. Most tokens are available as Tailwind classes:

```html
<!-- Using Tailwind classes derived from tokens -->
<div class="bg-primary-500 p-4 text-lg">
  Content using design tokens
</div>

<!-- Status badge using token mapping -->
<div class={`${getStatusColor('completed').bg} ${getStatusColor('completed').text}`}>
  Completed
</div>
```

### Responsive Design
Always use mobile-first responsive utilities:
```html
<!-- Base mobile, larger on desktop -->
<div class="text-sm sm:text-base lg:text-lg">
  Responsive text size
</div>

<!-- Stack on mobile, grid on desktop -->
<div class="flex flex-col sm:grid sm:grid-cols-2 lg:grid-cols-3">
  Responsive layout
</div>
```

### Dark Mode Support
All color tokens have dark mode equivalents:
```html
<div class="bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
  Dark mode compatible
</div>

<!-- Status badges automatically support dark mode -->
<div class="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
  Success message
</div>
```

## Customization

### Extending Tokens
To extend or modify tokens, update the `src/lib/ui/tokens.ts` file:

```typescript
// Add new color
export const colors = {
  ...existingColors,
  custom: {
    50: '#fefce8',
    100: '#fef9c3',
    500: '#eab308',
    900: '#713f12',
  },
}

// Add new status type
export const statusColors: Record<StatusType, { bg: string; text: string; dot: string }> = {
  ...existingStatusColors,
  custom_status: {
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    text: 'text-purple-700 dark:text-purple-300',
    dot: 'bg-purple-500',
  },
}
```

### Adding Component Variants
When creating new components, use the existing token system:

```typescript
// Use spacing tokens
const Component = () => (
  <div style={{ padding: spacing[4] }}>
    Content
  </div>
)

// Use color tokens
const StyledComponent = () => (
  <div className={colors.primary[500]}>
    Styled content
  </div>
)
```

## Best Practices

### 1. Consistency
- Always use design tokens instead of hardcoded values
- Follow the established scale for spacing, typography, etc.
- Use semantic color names (primary, success, danger) rather than hex values

### 2. Accessibility
- Ensure sufficient color contrast (4.5:1 for text)
- Use status indicators with both color and text/icon
- Maintain focus states for interactive elements

### 3. Performance
- Use Tailwind's utility classes for optimal performance
- Minimize custom CSS by leveraging the token system
- Use responsive design tokens for all layouts

### 4. Maintenance
- Document new tokens when added
- Update this guide when token system changes
- Run accessibility tests when modifying color tokens

## Troubleshooting

### Missing Tokens
If a token is missing:
1. Check if it exists in `src/lib/ui/tokens.ts`
2. Consider if it should be added to the token system
3. Add it with proper documentation

### Inconsistent Styling
If styles are inconsistent:
1. Verify all components use design tokens
2. Check for hardcoded values in components
3. Update components to use the token system

### Dark Mode Issues
If dark mode doesn't work properly:
1. Ensure colors have dark mode variants
2. Check for missing `dark:` prefixes
3. Test with both light and dark themes

## Related Resources

- [Component Usage Guide](./COMPONENT_USAGE_GUIDE.md)
- [Tailwind CSS Configuration](../../../../tailwind.config.js)
- [Global CSS Styles](../../../app/globals.css)
- [Figma Design System](https://figma.com/design-system-link) (if available)