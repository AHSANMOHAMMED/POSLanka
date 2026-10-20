import { NextResponse } from 'next/server'

/** Normalised view of a PostgreSQL error (drizzle wraps the pg error in `cause`). */
export interface PgErrorInfo {
  code?: string
  constraint?: string
  detail?: string
  message?: string
}

/** Unique index / constraint name → API field name. */
export const CONSTRAINT_FIELDS: Record<string, string> = {
  items_tenant_sku_unique: 'sku',
  items_tenant_barcode_unique: 'barcode',
  items_tenant_item_code_unique: 'itemCode',
  items_tenant_plu_unique: 'pluCode',
  idx_warehouse_stock_unique: 'stock',
  stock_movements_tenant_idem_unique: 'idempotency',
}

/**
 * Unwrap a pg error (possibly nested in drizzle's `cause` chain).
 * Returns null when the error carries no SQLSTATE code.
 */
export function getPgError(err: unknown): PgErrorInfo | null {
  let cur: unknown = err
  for (let depth = 0; depth < 5 && cur && typeof cur === 'object'; depth++) {
    const e = cur as { code?: unknown; constraint?: unknown; detail?: unknown; message?: unknown; cause?: unknown }
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return {
        code: e.code,
        constraint: typeof e.constraint === 'string' ? e.constraint : undefined,
        detail: typeof e.detail === 'string' ? e.detail : undefined,
        message: typeof e.message === 'string' ? e.message : undefined,
      }
    }
    cur = e.cause
  }
  return null
}

/** Extract the duplicated value from a 23505 detail: `Key (tenant_id, sku)=(…, ABC) already exists.` */
function duplicateValueFromDetail(detail?: string): string | undefined {
  if (!detail) return undefined
  const m = detail.match(/\)=\((.*)\) already exists/)
  if (!m) return undefined
  const parts = m[1].split(', ')
  return parts[parts.length - 1]
}

/** Thrown by createItem / item updates when a user-supplied identifier is already taken. */
export class DuplicateError extends Error {
  readonly code = 'DUPLICATE'
  constructor(
    public readonly field: string,
    public readonly existingId?: string | null,
    public readonly value?: string | null,
  ) {
    super(`Duplicate ${field}`)
    this.name = 'DuplicateError'
  }
}

export const RETRYABLE_PG_CODES = new Set(['40P01', '40001', '55P03'])

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const pg = getPgError(err)
  if (!pg || pg.code !== '23505') return false
  return constraint ? pg.constraint === constraint : true
}

/**
 * Map a database error to an API response. Returns null for errors that should
 * be handled as a generic 500 by the caller.
 *  - DuplicateError / 23505 → 409 { error, code:'DUPLICATE', field, value, existingId? }
 *  - deadlock / serialization / lock timeout → 409 { code:'CONFLICT_RETRY', retryable:true }
 *  - FK / check violation → 422
 */
export function toApiError(err: unknown): NextResponse | null {
  if (err instanceof DuplicateError) {
    return NextResponse.json({
      error: `Duplicate ${err.field}`,
      code: 'DUPLICATE',
      field: err.field,
      value: err.value ?? undefined,
      existingId: err.existingId ?? undefined,
    }, { status: 409 })
  }
  const pg = getPgError(err)
  if (!pg) return null
  switch (pg.code) {
    case '23505': {
      const field = (pg.constraint && CONSTRAINT_FIELDS[pg.constraint]) || pg.constraint || 'value'
      return NextResponse.json({
        error: `Duplicate ${field}`,
        code: 'DUPLICATE',
        field,
        value: duplicateValueFromDetail(pg.detail),
      }, { status: 409 })
    }
    case '40P01':
    case '40001':
    case '55P03':
      return NextResponse.json({
        error: 'The record is busy. Please retry.',
        code: 'CONFLICT_RETRY',
        retryable: true,
      }, { status: 409 })
    case '23503':
      return NextResponse.json({
        error: 'Referenced record does not exist',
        code: 'INVALID_REFERENCE',
        constraint: pg.constraint,
      }, { status: 422 })
    case '23514':
      return NextResponse.json({
        error: 'Value violates a data rule',
        code: 'CHECK_VIOLATION',
        constraint: pg.constraint,
      }, { status: 422 })
    default:
      return null
  }
}
