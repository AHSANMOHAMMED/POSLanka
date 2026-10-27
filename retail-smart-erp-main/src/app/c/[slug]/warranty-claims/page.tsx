'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, ShieldCheck, ShieldOff, X } from 'lucide-react'
import { usePaginatedData, useTerminology, useDateFormat } from '@/hooks'
import { useCurrency } from '@/hooks/useCurrency'
import { Pagination } from '@/components/ui/pagination'
import { PageLoading } from '@/components/ui/loading-spinner'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { BranchSelect } from '@/components/ui/branch-select'
import { FormInput, FormLabel, FormSelect, FormTextarea } from '@/components/ui/form-elements'
import { useCompany } from '@/components/providers/CompanyContextProvider'
import { ListPageLayout } from '@/components/layout/ListPageLayout'
import { WARRANTY_STATUS_COLORS, WARRANTY_STATUS_LABELS } from '@/lib/installments/constants'

interface ClaimRow {
  id: string; claimNo: string; status: string; itemName: string; serialNumber: string | null
  customerName: string; customerPhone: string | null; inWarranty: boolean; warrantyUntil: string | null
  complaint: string; technicianName: string | null; expectedDate: string | null; finalCharge: string; estimatedCharge: string
  invoiceNo: string | null; createdAt: string
}

interface LookupLine {
  saleItemId: string; itemId: string | null; itemName: string; quantity: number
  serialNumbers: Array<{ id: string; serialNumber: string; warrantyEndDate: string | null }>
  matched: boolean; warrantyEnd: string | null; inWarranty: boolean
}
interface LookupResult {
  sale: null | { id: string; invoiceNo: string; saleDate: string; warehouseName: string | null; customerId: string | null; customerName: string | null; customerPhone: string | null; lines: LookupLine[] }
  serial: null | { id: string; serialNumber: string; itemId: string; itemName: string; status: string; warrantyEnd: string | null; inWarranty: boolean }
}

export default function WarrantyClaimsPage() {
  const t = useTerminology()
  const router = useRouter()
  const { tenantSlug } = useCompany()
  const { fDate } = useDateFormat()
  const { fCurrency } = useCurrency()
  const [status, setStatus] = useState('open')
  const [newOpen, setNewOpen] = useState(false)
  const additionalParams = useMemo(() => (status ? { status } : { status: 'all' }), [status])
  const { data, pagination, loading, search, setSearch, setPage, setPageSize, refresh } = usePaginatedData<ClaimRow>({
    endpoint: '/api/warranty-claims',
    entityType: 'warranty-claim',
    storageKey: 'warranty-claims-page-size',
    additionalParams,
  })
  if (loading && data.length === 0) return <PageLoading text="Loading warranty claims..." />

  return (
    <ListPageLayout
      module={t.sellingModule}
      moduleHref="/selling"
      title="Warranty Claims & Service"
      actionButton={{ label: 'New Claim', onClick: () => setNewOpen(true) }}
      search={search}
      setSearch={setSearch}
      onRefresh={refresh}
      searchPlaceholder={`Claim no, ${t.serialNumber || 'serial'}, item, customer, phone, invoice...`}
      filterContent={
        <>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded dark:bg-gray-700 dark:text-white">
            <option value="open">Open</option>
            <option value="">All</option>
            {Object.entries(WARRANTY_STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {status !== 'open' && <button onClick={() => setStatus('open')} className="text-xs text-gray-500 hover:text-red-600 px-2" aria-label="Reset filter"><X size={14} /></button>}
        </>
      }
    >
      <div className="bg-white dark:bg-gray-800 rounded border dark:border-gray-700 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300"><tr>
            <th className="px-4 py-3 text-left font-medium">Claim #</th>
            <th className="px-4 py-3 text-left font-medium">Item / {t.serialNumber || 'serial'}</th>
            <th className="px-4 py-3 text-left font-medium">Customer</th>
            <th className="px-4 py-3 text-left font-medium hidden lg:table-cell">Fault</th>
            <th className="px-4 py-3 text-left font-medium">Warranty</th>
            <th className="px-4 py-3 text-left font-medium hidden md:table-cell">Technician</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
          </tr></thead>
          <tbody>
            {data.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">{search ? 'No claims match your search' : 'No claims. Receive a unit with “New Claim”.'}</td></tr>
            ) : data.map((c) => (
              <tr key={c.id} onClick={() => router.push(`/c/${tenantSlug}/warranty-claims/${c.id}`)} className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
                <td className="px-4 py-3"><div className="font-medium text-blue-600 dark:text-blue-400">{c.claimNo}</div><div className="text-xs text-gray-500">{fDate(c.createdAt)}</div></td>
                <td className="px-4 py-3"><div className="text-gray-900 dark:text-white">{c.itemName}</div>{c.serialNumber && <div className="text-xs text-gray-500 font-mono">{c.serialNumber}</div>}</td>
                <td className="px-4 py-3"><div>{c.customerName}</div>{c.customerPhone && <div className="text-xs text-gray-500">{c.customerPhone}</div>}</td>
                <td className="px-4 py-3 hidden lg:table-cell max-w-xs truncate text-gray-600 dark:text-gray-300">{c.complaint}</td>
                <td className="px-4 py-3">
                  {c.inWarranty
                    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400"><ShieldCheck size={13} />In warranty</span>
                    : <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600"><ShieldOff size={13} />Out{Number(c.finalCharge || c.estimatedCharge) > 0 ? ` · ${fCurrency(Number(c.finalCharge) || Number(c.estimatedCharge))}` : ''}</span>}
                </td>
                <td className="px-4 py-3 hidden md:table-cell text-gray-600 dark:text-gray-300">{c.technicianName || '—'}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${WARRANTY_STATUS_COLORS[c.status]}`}>{WARRANTY_STATUS_LABELS[c.status]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={pagination.page} pageSize={pagination.pageSize} total={pagination.total} totalPages={pagination.totalPages}
          onPageChange={setPage} onPageSizeChange={setPageSize} className="border-t dark:border-gray-700 px-4" />
      </div>
      {newOpen && <NewClaimModal onClose={() => setNewOpen(false)} onCreated={(id) => { setNewOpen(false); router.push(`/c/${tenantSlug}/warranty-claims/${id}`) }} />}
    </ListPageLayout>
  )
}

function NewClaimModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const t = useTerminology()
  const { fDate } = useDateFormat()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<LookupResult[] | null>(null)
  const [openClaims, setOpenClaims] = useState<Array<{ id: string; claim_no: string; status: string; item_name: string }>>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<{ saleId?: string; saleItemId?: string; itemId?: string | null; serialNumberId?: string; serialNumber?: string; itemName: string; customerId?: string | null; customerName: string; customerPhone: string; purchaseDate?: string | null; warrantyUntil?: string | null; inWarranty: boolean } | null>(null)
  const [manual, setManual] = useState(false)
  const [warehouseId, setWarehouseId] = useState('')
  const [complaint, setComplaint] = useState('')
  const [accessories, setAccessories] = useState('')
  const [conditionNotes, setConditionNotes] = useState('')
  const [estimatedCharge, setEstimatedCharge] = useState('0')
  const [expectedDate, setExpectedDate] = useState('')
  const [technicianId, setTechnicianId] = useState('')
  const [staff, setStaff] = useState<Array<{ id: string; fullName: string; role: string }>>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/users?activeOnly=true').then((r) => (r.ok ? r.json() : [])).then((d) => setStaff(Array.isArray(d) ? d : d.data || [])).catch(() => {})
  }, [])

  async function lookup() {
    if (q.trim().length < 2) return
    setSearching(true)
    try {
      const res = await fetch(`/api/warranty-claims/lookup?q=${encodeURIComponent(q.trim())}`)
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Lookup failed'); return }
      setResults(data.results)
      setOpenClaims(data.openClaims || [])
    } finally { setSearching(false) }
  }

  function pickLine(r: LookupResult, l: LookupLine) {
    const unit = r.serial && l.matched ? l.serialNumbers.find((s) => s.id === r.serial!.id) : l.serialNumbers.length === 1 ? l.serialNumbers[0] : undefined
    setPicked({
      saleId: r.sale!.id, saleItemId: l.saleItemId, itemId: l.itemId, serialNumberId: unit?.id, serialNumber: unit?.serialNumber,
      itemName: l.itemName, customerId: r.sale!.customerId, customerName: r.sale!.customerName || '', customerPhone: r.sale!.customerPhone || '',
      purchaseDate: r.sale!.saleDate, warrantyUntil: l.warrantyEnd, inWarranty: l.inWarranty,
    })
  }

  async function save() {
    if (!picked) return
    if (!picked.customerName.trim()) { toast.error('Enter the customer name'); return }
    if (complaint.trim().length < 3) { toast.error('Describe the fault'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/warranty-claims', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...picked, warehouseId: picked.saleId ? null : warehouseId || null,
          complaint, accessories, conditionNotes, estimatedCharge: Number(estimatedCharge) || 0,
          expectedDate: expectedDate || null, technicianId: technicianId || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error || 'Could not save the claim'); return }
      toast.success(`Claim ${data.claimNo} created`)
      onCreated(data.id)
    } finally { setSaving(false) }
  }

  return (
    <Modal isOpen onClose={onClose} title="Receive unit for warranty / repair" size="xl" footer={picked ? (
      <div className="flex justify-end gap-2"><button onClick={() => setPicked(null)} className="px-3 py-2 border rounded text-sm dark:border-gray-600">Back</button>
        <button onClick={save} disabled={saving} className="px-3 py-2 rounded bg-blue-600 text-white text-sm disabled:opacity-50">{saving ? 'Saving…' : 'Create claim'}</button></div>
    ) : undefined}>
      {!picked ? (
        <div className="space-y-3 text-sm">
          <div className="flex gap-2">
            <FormInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') lookup() }}
              placeholder={`${t.serialNumber || 'Serial'} / IMEI, invoice number or customer phone`} />
            <button onClick={lookup} disabled={searching} className="px-3 rounded bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50"><Search size={14} />Find</button>
          </div>
          {openClaims.length > 0 && (
            <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-900/30 p-2">
              Open claims: {openClaims.map((c) => `${c.claim_no} (${c.item_name}, ${WARRANTY_STATUS_LABELS[c.status]})`).join('; ')}
            </div>
          )}
          {results && results.length === 0 && <div className="text-gray-500">Nothing found. Check the number, or <button className="text-blue-600" onClick={() => { setManual(true); setPicked({ itemName: '', customerName: '', customerPhone: '', inWarranty: false }) }}>enter the unit by hand</button>.</div>}
          {results?.map((r, idx) => (
            <div key={idx} className="rounded border dark:border-gray-700 p-2 space-y-1">
              {r.serial && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{r.serial.serialNumber}</span><span>{r.serial.itemName}</span>
                  <WarrantyBadge inWarranty={r.serial.inWarranty} end={r.serial.warrantyEnd} fDate={fDate} />
                  {!r.sale && <button className="ml-auto text-blue-600" onClick={() => setPicked({ itemId: r.serial!.itemId, serialNumberId: r.serial!.id, serialNumber: r.serial!.serialNumber, itemName: r.serial!.itemName, customerName: '', customerPhone: '', warrantyUntil: r.serial!.warrantyEnd, inWarranty: r.serial!.inWarranty })}>Use (no sale found)</button>}
                </div>
              )}
              {r.sale && (
                <>
                  <div className="text-gray-600 dark:text-gray-300">{r.sale.invoiceNo} · {fDate(r.sale.saleDate)} · {r.sale.customerName || 'Walk-in'}{r.sale.customerPhone ? ` · ${r.sale.customerPhone}` : ''}{r.sale.warehouseName ? ` · ${r.sale.warehouseName}` : ''}</div>
                  {r.sale.lines.filter((l) => !r.serial || l.matched).map((l) => (
                    <div key={l.saleItemId} className="flex flex-wrap items-center gap-2 pl-2">
                      <span>{l.quantity} × {l.itemName}</span>
                      {l.serialNumbers.length > 0 && <span className="text-xs text-gray-500 font-mono">{l.serialNumbers.map((s) => s.serialNumber).join(', ')}</span>}
                      <WarrantyBadge inWarranty={l.inWarranty} end={l.warrantyEnd} fDate={fDate} />
                      <button className="ml-auto px-2 py-0.5 rounded border text-blue-600 dark:border-gray-600" onClick={() => pickLine(r, l)}>Select</button>
                    </div>
                  ))}
                </>
              )}
            </div>
          ))}
          {!results && <button className="text-blue-600" onClick={() => { setManual(true); setPicked({ itemName: '', customerName: '', customerPhone: '', inWarranty: false }) }}>Enter a unit without an invoice</button>}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 rounded bg-gray-50 dark:bg-gray-700 p-2">
            <WarrantyBadge inWarranty={picked.inWarranty} end={picked.warrantyUntil ?? null} fDate={fDate} />
            {picked.purchaseDate && <span>Bought {fDate(picked.purchaseDate)}</span>}
            {!picked.inWarranty && <span className="text-red-600">Repair charges apply</span>}
          </div>
          {manual && <BranchSelect value={warehouseId} onChange={setWarehouseId} />}
          <div className="grid grid-cols-2 gap-2">
            <div><FormLabel required>Item</FormLabel><FormInput value={picked.itemName} disabled={!!picked.saleItemId} onChange={(e) => setPicked({ ...picked, itemName: e.target.value })} /></div>
            <div><FormLabel>{t.serialNumber || 'Serial number'}</FormLabel><FormInput value={picked.serialNumber || ''} disabled={!!picked.serialNumberId} onChange={(e) => setPicked({ ...picked, serialNumber: e.target.value })} /></div>
            <div><FormLabel required>Customer</FormLabel><FormInput value={picked.customerName} onChange={(e) => setPicked({ ...picked, customerName: e.target.value })} /></div>
            <div><FormLabel>Phone</FormLabel><FormInput value={picked.customerPhone} onChange={(e) => setPicked({ ...picked, customerPhone: e.target.value })} /></div>
            {manual && <div><FormLabel>Purchase date</FormLabel><FormInput type="date" value={picked.purchaseDate || ''} onChange={(e) => setPicked({ ...picked, purchaseDate: e.target.value || null })} /></div>}
            {manual && <div><FormLabel>Warranty until</FormLabel><FormInput type="date" value={picked.warrantyUntil || ''} onChange={(e) => setPicked({ ...picked, warrantyUntil: e.target.value || null, inWarranty: !!e.target.value && e.target.value >= new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }) })} /></div>}
          </div>
          <div><FormLabel required>Complaint / fault</FormLabel><FormTextarea rows={3} value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="Not cooling, no display, does not power on…" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><FormLabel>Accessories received</FormLabel><FormInput value={accessories} onChange={(e) => setAccessories(e.target.value)} placeholder="Remote, charger, box, stand…" /></div>
            <div><FormLabel>Condition</FormLabel><FormInput value={conditionNotes} onChange={(e) => setConditionNotes(e.target.value)} placeholder="Scratches, cracked screen, dents…" /></div>
            <div><FormLabel>Technician</FormLabel><FormSelect value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
              <option value="">— Not assigned —</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
            </FormSelect></div>
            <div><FormLabel>Expected ready</FormLabel><FormInput type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></div>
            {!picked.inWarranty && <div><FormLabel>Estimated charge</FormLabel><FormInput type="number" min={0} value={estimatedCharge} onChange={(e) => setEstimatedCharge(e.target.value)} /></div>}
          </div>
        </div>
      )}
    </Modal>
  )
}

function WarrantyBadge({ inWarranty, end, fDate }: { inWarranty: boolean; end: string | null; fDate: (d: string) => string }) {
  return inWarranty
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200 text-xs font-medium"><ShieldCheck size={12} />In warranty{end ? ` until ${fDate(end)}` : ''}</span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 text-xs font-medium"><ShieldOff size={12} />{end ? `Warranty ended ${fDate(end)}` : 'No warranty on record'}</span>
}
