'use client'

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Activity, RefreshCw, Shapes, Store, Wallet } from 'lucide-react'
import {
  AdminCard,
  AdminPage,
  Alert,
  Badge,
  Button,
  Skeleton,
  StatCard,
  StatGrid,
  fmtCompact,
  fmtLKR,
  fmtNumber,
  statusTone,
} from '@/components/admin/kit'
import { VENDOR_STATUS_LABEL, adminFetch, labelFor } from '@/components/admin/console-helpers'
import {
  businessTypeHref,
  BusinessTypeIcon,
  pctOf,
  type BusinessTypeOverview,
  type BusinessTypeSummary,
} from '@/components/admin/business-types-shared'
import { featureAppliesTo, type FeatureFlag } from '@/lib/features/flags'
import { cn } from '@/lib/utils'

/** Cell background: stronger primary tint the more vendors have the switch on. */
function shade(pct: number): CSSProperties | undefined {
  if (pct <= 0) return undefined
  const alpha = 0.08 + (pct / 100) * 0.5
  return { backgroundColor: `color-mix(in srgb, var(--adm-primary) ${Math.round(alpha * 100)}%, transparent)` }
}

function TypeCard({ t, usageDays }: { t: BusinessTypeSummary; usageDays: number }) {
  const statuses = Object.entries(t.statusCounts).sort((a, b) => b[1] - a[1])
  return (
    <Link
      href={businessTypeHref(t.type)}
      className="adm-focus block min-w-0 rounded-xl border border-adm-border bg-adm-surface p-4 shadow-[var(--adm-shadow)] transition-colors hover:border-adm-border-strong hover:bg-adm-surface-2"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-adm-primary-soft text-adm-primary-soft-fg">
          <BusinessTypeIcon type={t.type} size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-adm-fg">{t.label}</p>
          <p className="text-[12.5px] text-adm-subtle">
            {t.presetOverridden.length > 0 ? `${t.presetOverridden.length} new-vendor default${t.presetOverridden.length === 1 ? '' : 's'} changed` : 'Built-in new-vendor defaults'}
          </p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-[12.5px]">
        <div className="min-w-0">
          <dt className="text-adm-subtle">Vendors</dt>
          <dd className="adm-num text-[17px] font-semibold text-adm-fg">{fmtNumber(t.tenantCount)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-adm-subtle">Active {usageDays}d</dt>
          <dd className="adm-num text-[17px] font-semibold text-adm-fg">{fmtNumber(t.activeTenants30d)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-adm-subtle">Sales {usageDays}d</dt>
          <dd className="adm-num truncate text-[17px] font-semibold text-adm-fg" title={fmtLKR(t.netSales30d, 2)}>{fmtCompact(t.netSales30d)}</dd>
        </div>
      </dl>
      <div className="mt-3 flex min-h-6 flex-wrap gap-1.5 border-t border-adm-border pt-2.5">
        {statuses.length === 0 ? (
          <span className="text-[12.5px] text-adm-subtle">No vendors yet</span>
        ) : (
          statuses.map(([status, n]) => (
            <Badge key={status} tone={statusTone(status)} dot>
              {labelFor(VENDOR_STATUS_LABEL, status)} {n}
            </Badge>
          ))
        )}
      </div>
    </Link>
  )
}

function FeatureMatrix({ data }: { data: BusinessTypeOverview }) {
  const router = useRouter()
  const groups = data.groups.map((g) => ({ group: g, features: data.features.filter((f) => f.group === g) })).filter((g) => g.features.length)
  return (
    <AdminCard
      title="Features × business types"
      description="Each cell: share of that type's vendors with the switch on. ● = new vendors start with it on; ✎ = the new-vendor default was changed here. — = the switch does not apply to that type. Click a column for the type's page."
      flush
    >
      <div className="adm-scroll max-h-[70vh] overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-[12.5px]" style={{ minWidth: 220 + data.types.length * 92 }}>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 top-0 z-[3] border-b border-r border-adm-border bg-adm-surface-2 px-3 py-2 text-left text-[12px] font-semibold text-adm-muted">
                Feature
              </th>
              {data.types.map((t) => {
                return (
                  <th key={t.type} scope="col" className="sticky top-0 z-[2] border-b border-adm-border bg-adm-surface-2 px-1.5 py-2 align-bottom font-semibold">
                    <Link
                      href={businessTypeHref(t.type)}
                      className="adm-focus flex flex-col items-center gap-1 rounded-md px-1 py-0.5 text-center text-[11.5px] leading-tight text-adm-muted hover:bg-adm-surface hover:text-adm-primary"
                      title={`${t.label} — ${t.tenantCount} vendor${t.tenantCount === 1 ? '' : 's'}`}
                    >
                      <BusinessTypeIcon type={t.type} size={15} aria-hidden />
                      <span className="line-clamp-2">{t.label}</span>
                      <span className="adm-num font-normal text-adm-subtle">{fmtNumber(t.tenantCount)}</span>
                    </Link>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {groups.map(({ group, features }) => (
              <Fragment key={group}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={data.types.length + 1}
                    className="border-b border-adm-border bg-adm-surface px-3 pb-1.5 pt-3 text-left text-[11.5px] font-semibold uppercase tracking-wide text-adm-subtle"
                  >
                    <span className="sticky left-3">{group}</span>
                  </th>
                </tr>
                {features.map((f) => (
                  <tr key={f.key} className="group">
                    <th scope="row" className="sticky left-0 z-[1] max-w-[220px] border-b border-r border-adm-border bg-adm-surface px-3 py-1.5 text-left font-medium text-adm-fg group-hover:bg-adm-surface-2">
                      <span className="block truncate" title={f.label}>{f.label}</span>
                    </th>
                    {data.types.map((t) => {
                      const applies = featureAppliesTo(f.key as FeatureFlag, t.type)
                      const on = t.enabledCounts[f.key] ?? 0
                      const pct = pctOf(on, t.tenantCount)
                      const presetOn = !!t.preset[f.key]
                      const changed = t.presetOverridden.includes(f.key)
                      const title = applies
                        ? `${t.label} · ${f.label}: on for ${on} of ${t.tenantCount} vendors. New vendors start ${presetOn ? 'on' : 'off'}${changed ? ' (changed from the built-in default)' : ''}.`
                        : `${f.label} does not apply to ${t.label}`
                      return (
                        <td
                          key={t.type}
                          className={cn('cursor-pointer border-b border-adm-border px-1 py-1.5 text-center group-hover:brightness-95', !applies && 'bg-adm-surface-2/50')}
                          style={applies ? shade(pct) : undefined}
                          title={title}
                          onClick={() => router.push(businessTypeHref(t.type))}
                        >
                          {applies ? (
                            <span className="inline-flex items-center gap-1">
                              <span className={cn('adm-num', t.tenantCount === 0 ? 'text-adm-subtle' : pct >= 60 ? 'font-semibold text-adm-fg' : 'text-adm-muted')}>
                                {t.tenantCount === 0 ? '·' : `${pct}%`}
                              </span>
                              <span className={cn('text-[9px] leading-none', presetOn ? 'text-adm-primary' : 'text-adm-border-strong')} aria-label={presetOn ? 'New vendors start on' : 'New vendors start off'}>
                                {presetOn ? '●' : '○'}
                              </span>
                              {changed && <span className="text-[10px] leading-none text-adm-warning" aria-label="New-vendor default changed">✎</span>}
                            </span>
                          ) : (
                            <span className="text-adm-subtle">—</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </AdminCard>
  )
}

export default function BusinessTypesOverviewPage() {
  const [data, setData] = useState<BusinessTypeOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await adminFetch<BusinessTypeOverview>('/api/sys-control/business-types'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load business types')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const days = data?.usageDays ?? 30
  const typesWithVendors = useMemo(() => data?.types.filter((t) => t.tenantCount > 0).length ?? 0, [data])

  return (
    <AdminPage
      title="Business types"
      description="Every business type with its vendors and feature switches. Open a type to see which features its vendors use and to turn features on or off for all of them at once."
      breadcrumbs={[{ label: 'Business types' }]}
      actions={<Button variant="ghost" icon={RefreshCw} onClick={load} loading={loading && !!data}>Refresh</Button>}
    >
      {error && (
        <Alert tone="danger" title="Could not load business types" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>
      )}

      <StatGrid>
        <StatCard label="Vendors" value={fmtNumber(data?.totals.tenants)} icon={Store} loading={!data && !error} hint={data ? `${typesWithVendors} of ${data.types.length} types in use` : undefined} />
        <StatCard label={`Active in ${days} days`} value={fmtNumber(data?.totals.activeTenants30d)} icon={Activity} tone="success" loading={!data && !error} hint="At least one sale" />
        <StatCard label={`Net sales ${days} days`} value={fmtCompact(data?.totals.netSales30d)} icon={Wallet} tone="info" loading={!data && !error} hint={data ? fmtLKR(data.totals.netSales30d) : undefined} />
        <StatCard label="Business types" value={fmtNumber(data?.types.length)} icon={Shapes} tone="neutral" loading={!data && !error} hint={data ? `${data.features.length} feature switches` : undefined} />
      </StatGrid>

      {!data && !error ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[168px] w-full rounded-xl" />)}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
            {data.types.map((t) => <TypeCard key={t.type} t={t} usageDays={days} />)}
          </div>
          <FeatureMatrix data={data} />
        </>
      ) : null}
    </AdminPage>
  )
}
