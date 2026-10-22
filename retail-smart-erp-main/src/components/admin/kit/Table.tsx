import type { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { EmptyState, Skeleton } from './Display'
import { Inbox } from 'lucide-react'

export interface AdminColumn<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  align?: 'left' | 'right' | 'center'
  /** Fixed/min width for the table column, e.g. '120px'. */
  width?: string
  className?: string
  /** Hide this column in the table layout below a breakpoint (still shown in phone cards unless `mobileHidden`). */
  hideBelow?: 'md' | 'lg' | 'xl'
  /** Used as the card title in the stacked phone layout (first `primary` column wins). */
  primary?: boolean
  /** Omit from the stacked phone layout. */
  mobileHidden?: boolean
  /** Label in the phone card (defaults to `header`). */
  mobileLabel?: ReactNode
}

export interface AdminTableProps<T> {
  columns: AdminColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Make each row a link. */
  rowHref?: (row: T) => string | undefined
  onRowClick?: (row: T) => void
  loading?: boolean
  /** Rendered when `rows` is empty and not loading. */
  empty?: ReactNode
  /**
   * Phone (< md) layout. 'cards' (default) stacks each row as a card;
   * 'scroll' keeps the table and scrolls it horizontally inside its own box.
   */
  mobile?: 'cards' | 'scroll'
  /** Minimum table width before horizontal scrolling kicks in. */
  minWidth?: number
  /** Cap the height and scroll inside (sticky header). */
  maxHeight?: number | string
  className?: string
  /** Extra classes for a row. */
  rowClassName?: (row: T) => string | undefined
}

const hideCls = { md: 'hidden md:table-cell', lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' } as const
const alignCls = { left: 'text-left', right: 'text-right', center: 'text-center' } as const

/**
 * Responsive data table. Never makes the page scroll sideways: wide tables scroll
 * inside their own container, and on phones rows become stacked cards by default.
 * Place inside `<AdminCard flush>` for a framed table.
 */
export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  onRowClick,
  loading,
  empty,
  mobile = 'cards',
  minWidth = 640,
  maxHeight,
  className,
  rowClassName,
}: AdminTableProps<T>) {
  if (loading && rows.length === 0) {
    return (
      <div className={cn('space-y-2 p-4', className)} aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  if (rows.length === 0) {
    return <div className={className}>{empty ?? <EmptyState icon={Inbox} title="Nothing to show yet" compact />}</div>
  }

  const primaryCol = columns.find((c) => c.primary) ?? columns[0]
  const interactive = Boolean(rowHref || onRowClick)

  return (
    <div className={cn('min-w-0', className)}>
      {/* Table layout */}
      <div
        className={cn('adm-scroll overflow-x-auto', mobile === 'cards' && 'hidden md:block', maxHeight !== undefined && 'overflow-y-auto')}
        style={maxHeight !== undefined ? { maxHeight } : undefined}
      >
        <table className="adm-table" style={{ minWidth }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={c.width ? { width: c.width } : undefined}
                  className={cn(alignCls[c.align ?? 'left'], c.hideBelow && hideCls[c.hideBelow])}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = rowHref?.(row)
              return (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(interactive && 'cursor-pointer', rowClassName?.(row))}
                >
                  {columns.map((c, ci) => (
                    <td key={c.key} className={cn(alignCls[c.align ?? 'left'], c.hideBelow && hideCls[c.hideBelow], c.className)}>
                      {href && ci === 0 ? (
                        <Link href={href} className="adm-focus font-medium text-adm-fg hover:text-adm-primary">
                          {c.cell(row)}
                        </Link>
                      ) : (
                        c.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Phone layout: stacked cards */}
      {mobile === 'cards' && (
        <ul className="divide-y divide-[var(--adm-border)] md:hidden">
          {rows.map((row) => {
            const href = rowHref?.(row)
            const inner = (
              <>
                <div className="mb-1.5 min-w-0 text-[14px] font-medium text-adm-fg">{primaryCol.cell(row)}</div>
                <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
                  {columns
                    .filter((c) => c !== primaryCol && !c.mobileHidden)
                    .map((c) => (
                      <div key={c.key} className="contents">
                        <dt className="text-adm-subtle">{c.mobileLabel ?? c.header}</dt>
                        <dd className="min-w-0 break-words text-right text-adm-fg">{c.cell(row)}</dd>
                      </div>
                    ))}
                </dl>
              </>
            )
            return (
              <li key={rowKey(row)} className={rowClassName?.(row)}>
                {href ? (
                  <Link href={href} className="adm-focus block px-4 py-3 hover:bg-adm-surface-2">{inner}</Link>
                ) : onRowClick ? (
                  <button type="button" onClick={() => onRowClick(row)} className="adm-focus block w-full px-4 py-3 text-left hover:bg-adm-surface-2">
                    {inner}
                  </button>
                ) : (
                  <div className="px-4 py-3">{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
