/**
 * Validation utilities for form inputs
 */

/**
 * Validates non-negative numbers (>= 0)
 * Use for prices, rates, etc. where 0 is a valid value
 */
export function isValidPositiveNumber(value: string): boolean {
  if (!value || value.trim() === '') return false
  const num = parseFloat(value)
  return !isNaN(num) && num >= 0
}

/**
 * Validates strictly positive numbers (> 0)
 * Use for hours, durations, etc. where 0 is NOT a valid value
 */
export function isValidStrictlyPositiveNumber(value: string): boolean {
  if (!value || value.trim() === '') return false
  const num = parseFloat(value)
  return !isNaN(num) && num > 0
}

export function isValidPositiveInteger(value: string): boolean {
  if (!value || value.trim() === '') return false
  const num = parseInt(value)
  return !isNaN(num) && num >= 0 && Number.isInteger(parseFloat(value))
}

export function isValidPrice(value: string): boolean {
  if (!value || value.trim() === '') return false
  const num = parseFloat(value)
  return !isNaN(num) && num >= 0
}

export function isValidQuantity(value: string): boolean {
  if (!value || value.trim() === '') return false
  const num = parseFloat(value)
  return !isNaN(num) && num > 0
}

export function sanitizeNumericInput(value: string): string {
  // Remove any non-numeric characters except decimal point and minus sign
  return value.replace(/[^0-9.-]/g, '')
}

/**
 * @deprecated Use `formatCurrency` from `@/lib/utils/currency` instead.
 * Kept for backward compatibility — do not add new callers.
 */
export function formatCurrencySimple(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function parseNumericInput(value: string): number {
  const cleaned = sanitizeNumericInput(value)
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

/**
 * Validates a form field and returns an error message if invalid
 */
export function validateField(
  value: string,
  rules: {
    required?: boolean
    min?: number
    max?: number
    isNumber?: boolean
    isPositive?: boolean
    isInteger?: boolean
  }
): string | null {
  if (rules.required && (!value || value.trim() === '')) {
    return 'This field is required'
  }

  if (rules.isNumber) {
    const num = parseFloat(value)
    if (isNaN(num)) {
      return 'Please enter a valid number'
    }

    if (rules.isPositive && num < 0) {
      return 'Value must be positive'
    }

    if (rules.isInteger && !Number.isInteger(num)) {
      return 'Value must be a whole number'
    }

    if (rules.min !== undefined && num < rules.min) {
      return `Value must be at least ${rules.min}`
    }

    if (rules.max !== undefined && num > rules.max) {
      return `Value must be at most ${rules.max}`
    }
  }

  return null
}

/**
 * Validates password strength server-side.
 * Returns null if valid, or an error message string.
 */
export function validatePasswordStrength(password: string): string | null {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long'
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter'
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter'
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number'
  }
  return null
}
