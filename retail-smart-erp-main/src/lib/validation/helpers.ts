import { NextResponse } from 'next/server'
import type { ZodType, ZodError } from 'zod'

type ValidationSuccess<T> = { success: true; data: T }
type ValidationFailure = { success: false; response: NextResponse }
type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

/**
 * Parse and validate JSON request body against a Zod schema.
 * Returns discriminated union for clean error handling in API routes.
 *
 * Preprocesses the JSON body to convert null values to undefined so that
 * Zod `.optional()` fields accept them. JSON has no `undefined` — only `null` —
 * so frontends sending `{ field: null }` would otherwise be rejected by
 * `.optional()` (which only allows `undefined`).  This conversion is safe
 * because API routes already use `value || null` / `value ?? null` when
 * writing to the database, so the distinction is not relied upon.
 *
 * Usage:
 *   const parsed = await validateBody(request, createCustomerSchema)
 *   if (!parsed.success) return parsed.response
 *   const { name, email } = parsed.data
 */
export async function validateBody<T>(
  request: Request,
  schema: ZodType<T>
): Promise<ValidationResult<T>> {
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return {
      success: false,
      response: NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      ),
    }
  }

  // Convert null → undefined so Zod `.optional()` fields accept JSON nulls
  const preprocessed = stripNullValues(rawBody)

  const result = schema.safeParse(preprocessed)
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Validation failed',
          details: formatZodErrors(result.error),
        },
        { status: 400 }
      ),
    }
  }

  return { success: true, data: result.data }
}

/**
 * Parse and validate URL search params against a Zod schema.
 * Use z.coerce.number() in schemas to auto-convert string params to numbers.
 *
 * Usage:
 *   const parsed = validateSearchParams(request, customersListSchema)
 *   if (!parsed.success) return parsed.response
 *   const { page, pageSize, search } = parsed.data
 */
export function validateSearchParams<T>(
  request: Request,
  schema: ZodType<T>
): ValidationResult<T> {
  const url = new URL(request.url)
  const params: Record<string, string> = {}
  url.searchParams.forEach((value, key) => {
    params[key] = value
  })

  const result = schema.safeParse(params)
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: formatZodErrors(result.error),
        },
        { status: 400 }
      ),
    }
  }

  return { success: true, data: result.data }
}

/**
 * Validate dynamic route path params (e.g., { id: string }).
 *
 * Usage:
 *   const parsed = validateParams(params, idParamSchema)
 *   if (!parsed.success) return parsed.response
 *   const { id } = parsed.data
 */
export function validateParams<T>(
  params: Record<string, string>,
  schema: ZodType<T>
): ValidationResult<T> {
  const result = schema.safeParse(params)
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Invalid path parameters',
          details: formatZodErrors(result.error),
        },
        { status: 400 }
      ),
    }
  }

  return { success: true, data: result.data }
}

function formatZodErrors(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }))
}

/**
 * Recursively remove null and empty-string keys from objects so that Zod sees
 * them as missing (i.e. `undefined`).  This handles two common frontend
 * patterns that clash with Zod validation:
 *
 *   1. `null` from `JSON.stringify({ field: someValue || null })`
 *      — Zod `.optional()` rejects null (only accepts undefined)
 *
 *   2. `""` from HTML inputs / selects that initialize to empty string
 *      — Zod `.email()`, `.uuid()`, `.min(N)`, `.enum()` reject ""
 *
 * Both are safe to strip because API routes use `value || null` when writing
 * to the database, treating undefined and null/empty identically.
 *
 * Array elements are NOT stripped — only object properties.
 */
export function stripNullValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNullValues)
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === '') continue  // skip → key absent → Zod sees undefined
      out[k] = stripNullValues(v)           // recurse into nested objects/arrays
    }
    return out
  }
  return value
}
