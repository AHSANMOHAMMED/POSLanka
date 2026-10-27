'use client'

/**
 * Unit picker for a document line (kg / g / yard / box ...). Shows the item's
 * base unit, its own conversions and the standard units of the same measure;
 * renders plain text when the item has a single unit.
 */
import { normalizeUnit, unitPriceFor, type UnitOption } from '@/lib/units/conversions'
import { useItemUnitOptions, type LineUnitFields } from '@/hooks/useItemUnitOptions'

export interface LineUnitSelectProps {
  itemId: string | null | undefined
  baseUnit: string | null | undefined
  /** chosen unit code ('' / null = base unit) */
  value: string | null | undefined
  /** base price (selling or cost) of the item, used to compute the new unit price */
  basePrice: number
  /** purchase documents: ignore item_uoms selling prices and scale the cost by the factor */
  priceMode?: 'selling' | 'cost'
  onChange: (patch: Required<Pick<LineUnitFields, 'uom' | 'uomFactor' | 'uomIsItemUom'>> & { unitPrice: number }) => void
  disabled?: boolean
  className?: string
}

export function LineUnitSelect({ itemId, baseUnit, value, basePrice, priceMode = 'selling', onChange, disabled, className }: LineUnitSelectProps) {
  const { options, itemUomCodes } = useItemUnitOptions(itemId, baseUnit)
  const current = normalizeUnit(value || baseUnit || '')
  const selected = options.find((o) => normalizeUnit(o.uom) === current) || options[0]

  if (!itemId || options.length <= 1) {
    return <span className="text-xs text-gray-500 dark:text-gray-400">{baseUnit || 'pcs'}</span>
  }

  const pick = (o: UnitOption) => {
    const opt = priceMode === 'cost' ? { ...o, price: null } : o
    onChange({
      uom: o.isBase ? '' : o.uom,
      uomFactor: o.factor,
      uomIsItemUom: !o.isBase && itemUomCodes.has(normalizeUnit(o.uom)),
      unitPrice: unitPriceFor(opt, basePrice),
    })
  }

  return (
    <select
      value={selected?.uom || ''}
      disabled={disabled}
      onChange={(e) => {
        const o = options.find((x) => x.uom === e.target.value)
        if (o) pick(o)
      }}
      className={
        className ||
        'w-24 px-1.5 py-1 border border-gray-300 dark:border-gray-600 rounded text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-700 dark:text-white'
      }
      title="Unit for this line"
    >
      {options.map((o) => (
        <option key={o.uom} value={o.uom}>
          {o.isBase ? o.uom : o.label}
        </option>
      ))}
    </select>
  )
}
