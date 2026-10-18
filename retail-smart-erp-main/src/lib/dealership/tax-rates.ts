// Sri Lanka Vehicle Import Tax Rates (Default)
// These rates can be overridden at the tenant level via settings

// Customs Import Duty (CID) rates by HS code category
export const DEFAULT_CID_RATES = {
  // Motor cars and vehicles for transport of persons (HS 8703)
  car_petrol_new: 20,      // % of CIF
  car_petrol_used: 30,     // % of CIF
  car_diesel_new: 20,
  car_diesel_used: 30,
  car_hybrid_new: 10,
  car_hybrid_used: 20,
  car_electric_new: 0,
  car_electric_used: 10,
  // Commercial vehicles
  van_new: 20,
  van_used: 30,
  truck_new: 10,
  truck_used: 15,
  bus_new: 10,
  bus_used: 15,
  // Two-wheelers
  motorcycle_new: 20,
  motorcycle_used: 30,
  // Default
  default: 20,
} as const

// Surcharge rate (applied to CID amount)
export const DEFAULT_SURCHARGE_RATE = 50 // % of CID

// Excise Duty rates by engine capacity (CC) and fuel type
// Rates are percentage of (CIF + CID + Surcharge)
export const DEFAULT_EXCISE_DUTY_RATES = {
  petrol: [
    { maxCc: 1000, rate: 50 },
    { maxCc: 1500, rate: 100 },
    { maxCc: 1800, rate: 125 },
    { maxCc: 2000, rate: 150 },
    { maxCc: 2500, rate: 200 },
    { maxCc: 3000, rate: 250 },
    { maxCc: Infinity, rate: 300 },
  ],
  diesel: [
    { maxCc: 1500, rate: 75 },
    { maxCc: 2000, rate: 125 },
    { maxCc: 2500, rate: 175 },
    { maxCc: 3000, rate: 225 },
    { maxCc: Infinity, rate: 275 },
  ],
  hybrid: [
    { maxCc: 1000, rate: 25 },
    { maxCc: 1500, rate: 50 },
    { maxCc: 1800, rate: 75 },
    { maxCc: 2000, rate: 100 },
    { maxCc: Infinity, rate: 150 },
  ],
  electric: [
    { maxKw: 100, rate: 10 },
    { maxKw: 200, rate: 25 },
    { maxKw: Infinity, rate: 50 },
  ],
} as const

// Luxury Tax rates (based on CIF value in LKR)
export const DEFAULT_LUXURY_TAX_RATES = [
  { maxCifLkr: 3_000_000, rate: 0 },
  { maxCifLkr: 6_000_000, rate: 10 },
  { maxCifLkr: 10_000_000, rate: 15 },
  { maxCifLkr: 20_000_000, rate: 20 },
  { maxCifLkr: Infinity, rate: 25 },
] as const

// VAT rate
export const DEFAULT_VAT_RATE = 18 // %

// VAT calculation: VAT is applied on (CIF x 110% + CID + Surcharge + Excise + Luxury)
// The 110% markup on CIF is a standard Sri Lanka customs practice
export const DEFAULT_VAT_CIF_MARKUP = 10 // additional % markup on CIF for VAT base

// Ports Authority Levy (PAL)
export const DEFAULT_PAL_RATE = 7.5 // % of CIF

// CESS (Social Responsibility Levy)
export const DEFAULT_CESS_RATE = 2.5 // % of (CID + Surcharge)

// Common currencies for vehicle imports
export const IMPORT_CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'EUR', name: 'Euro' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'AUD', name: 'Australian Dollar' },
] as const

// Common ports of entry in Sri Lanka
export const SRI_LANKA_PORTS = [
  'Colombo Port',
  'Hambantota Port',
  'Trincomalee Port',
  'Galle Port',
] as const
