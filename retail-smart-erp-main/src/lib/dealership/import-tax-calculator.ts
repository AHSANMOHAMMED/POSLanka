import {
  DEFAULT_CID_RATES,
  DEFAULT_SURCHARGE_RATE,
  DEFAULT_EXCISE_DUTY_RATES,
  DEFAULT_LUXURY_TAX_RATES,
  DEFAULT_VAT_RATE,
  DEFAULT_VAT_CIF_MARKUP,
  DEFAULT_PAL_RATE,
  DEFAULT_CESS_RATE,
} from './tax-rates'

export interface ImportTaxInput {
  fobValue: number          // FOB price in original currency
  freightCost: number       // Freight in original currency
  insuranceCost: number     // Insurance in original currency
  exchangeRate: number      // Exchange rate to LKR
  engineCapacityCc: number  // Engine displacement in CC
  enginePowerKw?: number    // For electric vehicles
  fuelType: 'petrol' | 'diesel' | 'hybrid' | 'electric'
  vehicleType: 'car' | 'suv' | 'van' | 'truck' | 'bus' | 'motorcycle'
  condition: 'new' | 'used'
  yearOfManufacture: number
  // Optional rate overrides (tenant-level customization)
  overrides?: Partial<TaxRateOverrides>
}

export interface TaxRateOverrides {
  cidRate: number
  surchargeRate: number
  exciseDutyRate: number
  luxuryTaxRate: number
  vatRate: number
  vatCifMarkup: number
  palRate: number
  cessRate: number
}

export interface ImportTaxBreakdown {
  // CIF
  fobValue: number
  freightCost: number
  insuranceCost: number
  cifValueOriginal: number    // CIF in original currency
  exchangeRate: number
  cifValueLkr: number         // CIF in LKR
  // Taxes
  customsImportDuty: number
  customsImportDutyRate: number
  surcharge: number
  surchargeRate: number
  exciseDuty: number
  exciseDutyRate: number
  luxuryTax: number
  luxuryTaxRate: number
  palCharge: number
  palRate: number
  cessFee: number
  cessRate: number
  vatBase: number             // Base amount for VAT calculation
  vatAmount: number
  vatRate: number
  // Totals
  totalTaxes: number
  additionalCosts: number     // placeholder for port handling, etc.
  totalLandedCost: number     // CIF(LKR) + totalTaxes
}

/**
 * Get the CID (Customs Import Duty) rate based on vehicle attributes
 */
function getCidRate(input: ImportTaxInput): number {
  if (input.overrides?.cidRate !== undefined) return input.overrides.cidRate

  const { fuelType, condition, vehicleType } = input
  const key = `${vehicleType === 'suv' ? 'car' : vehicleType}_${fuelType}_${condition}` as keyof typeof DEFAULT_CID_RATES

  return DEFAULT_CID_RATES[key] ?? DEFAULT_CID_RATES.default
}

/**
 * Get the Excise Duty rate based on engine capacity/power and fuel type
 */
function getExciseDutyRate(input: ImportTaxInput): number {
  if (input.overrides?.exciseDutyRate !== undefined) return input.overrides.exciseDutyRate

  const { fuelType, engineCapacityCc, enginePowerKw } = input

  if (fuelType === 'electric') {
    const kw = enginePowerKw || 0
    const brackets = DEFAULT_EXCISE_DUTY_RATES.electric
    for (const bracket of brackets) {
      if (kw <= bracket.maxKw) return bracket.rate
    }
    return brackets[brackets.length - 1].rate
  }

  const cc = engineCapacityCc || 0
  const fuelBrackets = DEFAULT_EXCISE_DUTY_RATES[fuelType] || DEFAULT_EXCISE_DUTY_RATES.petrol
  for (const bracket of fuelBrackets) {
    if ('maxCc' in bracket && cc <= bracket.maxCc) return bracket.rate
  }
  return 0
}

/**
 * Get the Luxury Tax rate based on CIF value in LKR
 */
function getLuxuryTaxRate(cifValueLkr: number, overrideRate?: number): number {
  if (overrideRate !== undefined) return overrideRate

  for (const bracket of DEFAULT_LUXURY_TAX_RATES) {
    if (cifValueLkr <= bracket.maxCifLkr) return bracket.rate
  }
  return DEFAULT_LUXURY_TAX_RATES[DEFAULT_LUXURY_TAX_RATES.length - 1].rate
}

/**
 * Calculate the full Sri Lanka import tax breakdown for a vehicle
 *
 * Calculation order:
 * 1. CIF = FOB + Freight + Insurance (converted to LKR)
 * 2. CID = CIF(LKR) x CID rate
 * 3. Surcharge = CID x surcharge rate
 * 4. Excise Duty = (CIF + CID + Surcharge) x excise rate
 * 5. Luxury Tax = CIF(LKR) x luxury rate
 * 6. PAL = CIF(LKR) x PAL rate
 * 7. CESS = (CID + Surcharge) x CESS rate
 * 8. VAT = (CIF x (100% + markup%) + CID + Surcharge + Excise + Luxury + PAL + CESS) x VAT rate
 * 9. Total Landed Cost = CIF(LKR) + all taxes
 */
export function calculateImportTax(input: ImportTaxInput): ImportTaxBreakdown {
  const overrides = input.overrides || {}

  // Step 1: CIF calculation
  const cifValueOriginal = input.fobValue + input.freightCost + input.insuranceCost
  const cifValueLkr = Math.round(cifValueOriginal * input.exchangeRate * 100) / 100

  // Step 2: Customs Import Duty (CID)
  const cidRate = getCidRate(input)
  const customsImportDuty = Math.round(cifValueLkr * cidRate / 100 * 100) / 100

  // Step 3: Surcharge (percentage of CID)
  const surchargeRate = overrides.surchargeRate ?? DEFAULT_SURCHARGE_RATE
  const surcharge = Math.round(customsImportDuty * surchargeRate / 100 * 100) / 100

  // Step 4: Excise Duty
  const exciseDutyRate = getExciseDutyRate(input)
  const exciseBase = cifValueLkr + customsImportDuty + surcharge
  const exciseDuty = Math.round(exciseBase * exciseDutyRate / 100 * 100) / 100

  // Step 5: Luxury Tax
  const luxuryTaxRate = getLuxuryTaxRate(cifValueLkr, overrides.luxuryTaxRate)
  const luxuryTax = Math.round(cifValueLkr * luxuryTaxRate / 100 * 100) / 100

  // Step 6: PAL (Ports Authority Levy)
  const palRate = overrides.palRate ?? DEFAULT_PAL_RATE
  const palCharge = Math.round(cifValueLkr * palRate / 100 * 100) / 100

  // Step 7: CESS
  const cessRate = overrides.cessRate ?? DEFAULT_CESS_RATE
  const cessFee = Math.round((customsImportDuty + surcharge) * cessRate / 100 * 100) / 100

  // Step 8: VAT
  const vatRate = overrides.vatRate ?? DEFAULT_VAT_RATE
  const vatCifMarkup = overrides.vatCifMarkup ?? DEFAULT_VAT_CIF_MARKUP
  const cifForVat = cifValueLkr * (100 + vatCifMarkup) / 100
  const vatBase = cifForVat + customsImportDuty + surcharge + exciseDuty + luxuryTax + palCharge + cessFee
  const vatAmount = Math.round(vatBase * vatRate / 100 * 100) / 100

  // Step 9: Totals
  const totalTaxes = Math.round((
    customsImportDuty + surcharge + exciseDuty + luxuryTax +
    palCharge + cessFee + vatAmount
  ) * 100) / 100

  const totalLandedCost = Math.round((cifValueLkr + totalTaxes) * 100) / 100

  return {
    fobValue: input.fobValue,
    freightCost: input.freightCost,
    insuranceCost: input.insuranceCost,
    cifValueOriginal,
    exchangeRate: input.exchangeRate,
    cifValueLkr,
    customsImportDuty,
    customsImportDutyRate: cidRate,
    surcharge,
    surchargeRate,
    exciseDuty,
    exciseDutyRate,
    luxuryTax,
    luxuryTaxRate,
    palCharge,
    palRate,
    cessFee,
    cessRate,
    vatBase,
    vatAmount,
    vatRate,
    totalTaxes,
    additionalCosts: 0,
    totalLandedCost,
  }
}

/**
 * Format a tax breakdown into a human-readable summary
 */
export function formatTaxSummary(breakdown: ImportTaxBreakdown): string {
  const lines = [
    `CIF Value: LKR ${breakdown.cifValueLkr.toLocaleString()}`,
    `  (FOB: ${breakdown.fobValue.toLocaleString()} x ${breakdown.exchangeRate} + Freight: ${breakdown.freightCost.toLocaleString()} + Insurance: ${breakdown.insuranceCost.toLocaleString()})`,
    ``,
    `Customs Import Duty (${breakdown.customsImportDutyRate}%): LKR ${breakdown.customsImportDuty.toLocaleString()}`,
    `Surcharge (${breakdown.surchargeRate}% of CID): LKR ${breakdown.surcharge.toLocaleString()}`,
    `Excise Duty (${breakdown.exciseDutyRate}%): LKR ${breakdown.exciseDuty.toLocaleString()}`,
    `Luxury Tax (${breakdown.luxuryTaxRate}%): LKR ${breakdown.luxuryTax.toLocaleString()}`,
    `PAL (${breakdown.palRate}%): LKR ${breakdown.palCharge.toLocaleString()}`,
    `CESS (${breakdown.cessRate}%): LKR ${breakdown.cessFee.toLocaleString()}`,
    `VAT (${breakdown.vatRate}%): LKR ${breakdown.vatAmount.toLocaleString()}`,
    ``,
    `Total Taxes: LKR ${breakdown.totalTaxes.toLocaleString()}`,
    `Total Landed Cost: LKR ${breakdown.totalLandedCost.toLocaleString()}`,
  ]
  return lines.join('\n')
}
