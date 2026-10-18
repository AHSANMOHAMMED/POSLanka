// Country to currency mapping
export interface Country {
  code: string
  name: string
  currency: string
  currencySymbol: string
  dateFormat: string
  timeFormat: string
}

export const countries: Country[] = [
  { code: 'US', name: 'United States', currency: 'USD', currencySymbol: '$', dateFormat: 'MM/DD/YYYY', timeFormat: '12h' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', currencySymbol: '£', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'CA', name: 'Canada', currency: 'CAD', currencySymbol: 'C$', dateFormat: 'YYYY-MM-DD', timeFormat: '12h' },
  { code: 'AU', name: 'Australia', currency: 'AUD', currencySymbol: 'A$', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', currencySymbol: 'NZ$', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'IN', name: 'India', currency: 'INR', currencySymbol: '₹', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'LK', name: 'Sri Lanka', currency: 'LKR', currencySymbol: 'Rs', dateFormat: 'YYYY-MM-DD', timeFormat: '12h' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', currencySymbol: '₨', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', currencySymbol: '৳', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', currencySymbol: 'د.إ', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', currencySymbol: '﷼', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'QA', name: 'Qatar', currency: 'QAR', currencySymbol: 'ر.ق', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'KW', name: 'Kuwait', currency: 'KWD', currencySymbol: 'د.ك', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'BH', name: 'Bahrain', currency: 'BHD', currencySymbol: '.د.ب', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'OM', name: 'Oman', currency: 'OMR', currencySymbol: 'ر.ع.', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', currencySymbol: 'S$', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'MY', name: 'Malaysia', currency: 'MYR', currencySymbol: 'RM', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'TH', name: 'Thailand', currency: 'THB', currencySymbol: '฿', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', currencySymbol: 'Rp', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', currencySymbol: '₱', dateFormat: 'MM/DD/YYYY', timeFormat: '12h' },
  { code: 'VN', name: 'Vietnam', currency: 'VND', currencySymbol: '₫', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'JP', name: 'Japan', currency: 'JPY', currencySymbol: '¥', dateFormat: 'YYYY/MM/DD', timeFormat: '24h' },
  { code: 'KR', name: 'South Korea', currency: 'KRW', currencySymbol: '₩', dateFormat: 'YYYY-MM-DD', timeFormat: '24h' },
  { code: 'CN', name: 'China', currency: 'CNY', currencySymbol: '¥', dateFormat: 'YYYY-MM-DD', timeFormat: '24h' },
  { code: 'HK', name: 'Hong Kong', currency: 'HKD', currencySymbol: 'HK$', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'TW', name: 'Taiwan', currency: 'TWD', currencySymbol: 'NT$', dateFormat: 'YYYY/MM/DD', timeFormat: '24h' },
  { code: 'DE', name: 'Germany', currency: 'EUR', currencySymbol: '€', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'FR', name: 'France', currency: 'EUR', currencySymbol: '€', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'IT', name: 'Italy', currency: 'EUR', currencySymbol: '€', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'ES', name: 'Spain', currency: 'EUR', currencySymbol: '€', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'PT', name: 'Portugal', currency: 'EUR', currencySymbol: '€', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', currencySymbol: '€', dateFormat: 'DD-MM-YYYY', timeFormat: '24h' },
  { code: 'BE', name: 'Belgium', currency: 'EUR', currencySymbol: '€', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'AT', name: 'Austria', currency: 'EUR', currencySymbol: '€', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF', currencySymbol: 'CHF', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', currencySymbol: '€', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'SE', name: 'Sweden', currency: 'SEK', currencySymbol: 'kr', dateFormat: 'YYYY-MM-DD', timeFormat: '24h' },
  { code: 'NO', name: 'Norway', currency: 'NOK', currencySymbol: 'kr', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'DK', name: 'Denmark', currency: 'DKK', currencySymbol: 'kr', dateFormat: 'DD-MM-YYYY', timeFormat: '24h' },
  { code: 'FI', name: 'Finland', currency: 'EUR', currencySymbol: '€', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'PL', name: 'Poland', currency: 'PLN', currencySymbol: 'zł', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'CZ', name: 'Czech Republic', currency: 'CZK', currencySymbol: 'Kč', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'HU', name: 'Hungary', currency: 'HUF', currencySymbol: 'Ft', dateFormat: 'YYYY.MM.DD', timeFormat: '24h' },
  { code: 'RO', name: 'Romania', currency: 'RON', currencySymbol: 'lei', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'BG', name: 'Bulgaria', currency: 'BGN', currencySymbol: 'лв', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'GR', name: 'Greece', currency: 'EUR', currencySymbol: '€', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'RU', name: 'Russia', currency: 'RUB', currencySymbol: '₽', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'UA', name: 'Ukraine', currency: 'UAH', currencySymbol: '₴', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'TR', name: 'Turkey', currency: 'TRY', currencySymbol: '₺', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  { code: 'IL', name: 'Israel', currency: 'ILS', currencySymbol: '₪', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', currencySymbol: 'E£', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', currencySymbol: 'R', dateFormat: 'YYYY/MM/DD', timeFormat: '24h' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', currencySymbol: '₦', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'KE', name: 'Kenya', currency: 'KES', currencySymbol: 'KSh', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', currencySymbol: 'GH₵', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'TZ', name: 'Tanzania', currency: 'TZS', currencySymbol: 'TSh', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'UG', name: 'Uganda', currency: 'UGX', currencySymbol: 'USh', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', currencySymbol: 'MX$', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', currencySymbol: 'R$', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'AR', name: 'Argentina', currency: 'ARS', currencySymbol: 'AR$', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'CL', name: 'Chile', currency: 'CLP', currencySymbol: 'CL$', dateFormat: 'DD-MM-YYYY', timeFormat: '24h' },
  { code: 'CO', name: 'Colombia', currency: 'COP', currencySymbol: 'CO$', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'PE', name: 'Peru', currency: 'PEN', currencySymbol: 'S/', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'VE', name: 'Venezuela', currency: 'VES', currencySymbol: 'Bs.', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'EC', name: 'Ecuador', currency: 'USD', currencySymbol: '$', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'NP', name: 'Nepal', currency: 'NPR', currencySymbol: 'रू', dateFormat: 'YYYY-MM-DD', timeFormat: '12h' },
  { code: 'MM', name: 'Myanmar', currency: 'MMK', currencySymbol: 'K', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'KH', name: 'Cambodia', currency: 'KHR', currencySymbol: '៛', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
  { code: 'LA', name: 'Laos', currency: 'LAK', currencySymbol: '₭', dateFormat: 'DD/MM/YYYY', timeFormat: '24h' },
  { code: 'MV', name: 'Maldives', currency: 'MVR', currencySymbol: 'Rf', dateFormat: 'DD/MM/YYYY', timeFormat: '12h' },
].sort((a, b) => a.name.localeCompare(b.name))

export function getCountryByCode(code: string): Country | undefined {
  return countries.find(c => c.code === code)
}

export function getCountryName(code: string): string {
  return getCountryByCode(code)?.name || code || ''
}

export function getCurrencyByCountry(countryCode: string): string {
  const country = getCountryByCode(countryCode)
  return country?.currency || 'LKR'
}

export function getCountryDefaults(countryCode: string) {
  const country = getCountryByCode(countryCode)
  return {
    currency: country?.currency || 'LKR',
    currencySymbol: country?.currencySymbol || 'Rs',
    dateFormat: country?.dateFormat || 'DD/MM/YYYY',
    timeFormat: country?.timeFormat || '12h',
  }
}

// Common banknote denominations per currency (for POS quick-pay suggestions)
const currencyNotes: Record<string, number[]> = {
  USD: [1, 5, 10, 20, 50, 100],
  GBP: [5, 10, 20, 50],
  EUR: [5, 10, 20, 50, 100, 200],
  CAD: [5, 10, 20, 50, 100],
  AUD: [5, 10, 20, 50, 100],
  NZD: [5, 10, 20, 50, 100],
  INR: [10, 20, 50, 100, 200, 500],
  LKR: [20, 50, 100, 500, 1000, 5000],
  PKR: [10, 20, 50, 100, 500, 1000, 5000],
  BDT: [2, 5, 10, 20, 50, 100, 500, 1000],
  AED: [5, 10, 20, 50, 100, 200, 500, 1000],
  SAR: [1, 5, 10, 50, 100, 500],
  QAR: [1, 5, 10, 50, 100, 500],
  KWD: [0.25, 0.5, 1, 5, 10, 20],
  BHD: [0.5, 1, 5, 10, 20],
  OMR: [0.1, 0.5, 1, 5, 10, 20, 50],
  SGD: [2, 5, 10, 50, 100, 1000],
  MYR: [1, 5, 10, 20, 50, 100],
  THB: [20, 50, 100, 500, 1000],
  IDR: [1000, 2000, 5000, 10000, 20000, 50000, 100000],
  PHP: [20, 50, 100, 200, 500, 1000],
  VND: [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000],
  JPY: [1000, 5000, 10000],
  KRW: [1000, 5000, 10000, 50000],
  CNY: [1, 5, 10, 20, 50, 100],
  HKD: [10, 20, 50, 100, 500, 1000],
  TWD: [100, 200, 500, 1000, 2000],
  CHF: [10, 20, 50, 100, 200, 1000],
  SEK: [20, 50, 100, 200, 500, 1000],
  NOK: [50, 100, 200, 500, 1000],
  DKK: [50, 100, 200, 500, 1000],
  PLN: [10, 20, 50, 100, 200, 500],
  CZK: [100, 200, 500, 1000, 2000, 5000],
  HUF: [500, 1000, 2000, 5000, 10000, 20000],
  RON: [1, 5, 10, 50, 100, 200, 500],
  BGN: [2, 5, 10, 20, 50, 100],
  RUB: [50, 100, 200, 500, 1000, 2000, 5000],
  UAH: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000],
  TRY: [5, 10, 20, 50, 100, 200],
  ILS: [20, 50, 100, 200],
  EGP: [1, 5, 10, 20, 50, 100, 200],
  ZAR: [10, 20, 50, 100, 200],
  NGN: [5, 10, 20, 50, 100, 200, 500, 1000],
  KES: [50, 100, 200, 500, 1000],
  GHS: [1, 2, 5, 10, 20, 50, 100, 200],
  TZS: [500, 1000, 2000, 5000, 10000],
  UGX: [1000, 2000, 5000, 10000, 20000, 50000],
  MXN: [20, 50, 100, 200, 500, 1000],
  BRL: [2, 5, 10, 20, 50, 100, 200],
  ARS: [100, 200, 500, 1000, 2000, 10000],
  CLP: [1000, 2000, 5000, 10000, 20000],
  COP: [1000, 2000, 5000, 10000, 20000, 50000, 100000],
  PEN: [10, 20, 50, 100, 200],
  NPR: [5, 10, 20, 50, 100, 500, 1000],
  MMK: [50, 100, 200, 500, 1000, 5000, 10000],
  KHR: [100, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000],
  MVR: [5, 10, 20, 50, 100, 500],
}

/**
 * Get banknote denominations for a currency.
 * Returns note values sorted ascending.
 */
export function getCurrencyNotes(currencyCode: string): number[] {
  return currencyNotes[currencyCode] || currencyNotes['USD'] || [1, 5, 10, 20, 50, 100]
}

// Timezone to country mapping for auto-detection
const timezoneToCountry: Record<string, string> = {
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
  'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Phoenix': 'US',
  'Europe/London': 'GB', 'America/Toronto': 'CA', 'America/Vancouver': 'CA',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU',
  'Pacific/Auckland': 'NZ', 'Asia/Kolkata': 'IN', 'Asia/Colombo': 'LK',
  'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA',
  'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Asia/Bahrain': 'BH', 'Asia/Muscat': 'OM',
  'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Bangkok': 'TH',
  'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH', 'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Shanghai': 'CN', 'Asia/Hong_Kong': 'HK',
  'Asia/Taipei': 'TW', 'Europe/Berlin': 'DE', 'Europe/Paris': 'FR', 'Europe/Rome': 'IT',
  'Europe/Madrid': 'ES', 'Europe/Lisbon': 'PT', 'Europe/Amsterdam': 'NL', 'Europe/Brussels': 'BE',
  'Europe/Vienna': 'AT', 'Europe/Zurich': 'CH', 'Europe/Dublin': 'IE',
  'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI', 'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU', 'Europe/Bucharest': 'RO', 'Europe/Sofia': 'BG',
  'Europe/Athens': 'GR', 'Europe/Moscow': 'RU', 'Europe/Kiev': 'UA', 'Europe/Istanbul': 'TR',
  'Asia/Jerusalem': 'IL', 'Africa/Cairo': 'EG', 'Africa/Johannesburg': 'ZA',
  'Africa/Lagos': 'NG', 'Africa/Nairobi': 'KE', 'Africa/Accra': 'GH',
  'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kampala': 'UG',
  'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR',
  'America/Santiago': 'CL', 'America/Bogota': 'CO', 'America/Lima': 'PE',
  'America/Caracas': 'VE', 'America/Guayaquil': 'EC',
  'Asia/Kathmandu': 'NP', 'Asia/Yangon': 'MM', 'Asia/Phnom_Penh': 'KH',
  'Asia/Vientiane': 'LA', 'Indian/Maldives': 'MV',
  // Africa
  'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN',
  'Africa/Addis_Ababa': 'ET', 'Africa/Khartoum': 'SD', 'Africa/Maputo': 'MZ',
  'Africa/Windhoek': 'NA', 'Africa/Lusaka': 'ZM', 'Africa/Harare': 'ZW',
  'Africa/Luanda': 'AO', 'Africa/Kinshasa': 'CD', 'Africa/Douala': 'CM',
  'Africa/Abidjan': 'CI', 'Africa/Dakar': 'SN', 'Africa/Tripoli': 'LY',
  // Americas
  'America/Panama': 'PA', 'America/Costa_Rica': 'CR', 'America/Guatemala': 'GT',
  'America/Havana': 'CU', 'America/Jamaica': 'JM', 'America/Port_of_Spain': 'TT',
  'America/Santo_Domingo': 'DO', 'America/Montevideo': 'UY', 'America/Asuncion': 'PY',
  'America/La_Paz': 'BO', 'America/Tegucigalpa': 'HN', 'America/Managua': 'NI',
  // Europe
  'Europe/Belgrade': 'RS', 'Europe/Zagreb': 'HR', 'Europe/Ljubljana': 'SI',
  'Europe/Bratislava': 'SK', 'Europe/Tallinn': 'EE', 'Europe/Riga': 'LV',
  'Europe/Vilnius': 'LT', 'Europe/Luxembourg': 'LU', 'Europe/Malta': 'MT',
  'Atlantic/Reykjavik': 'IS',
  // Asia/Pacific
  'Asia/Tashkent': 'UZ', 'Asia/Almaty': 'KZ', 'Asia/Baku': 'AZ',
  'Asia/Tbilisi': 'GE', 'Asia/Yerevan': 'AM', 'Asia/Beirut': 'LB',
  'Asia/Amman': 'JO', 'Asia/Baghdad': 'IQ', 'Asia/Tehran': 'IR',
  'Asia/Kabul': 'AF', 'Asia/Brunei': 'BN', 'Asia/Makassar': 'ID',
  'Pacific/Fiji': 'FJ', 'Pacific/Guam': 'GU', 'Pacific/Port_Moresby': 'PG',
  'Indian/Mauritius': 'MU', 'Indian/Reunion': 'RE',
}

/**
 * Detect user's country from their browser timezone.
 * Returns the ISO 3166-1 alpha-2 country code, or null if not detected.
 * Only works in browser environments.
 */
export function detectCountryFromTimezone(): string | null {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return timezoneToCountry[timezone] || null
  } catch {
    return null
  }
}

// Date format options for user selection
export const dateFormats = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2024)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2024)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2024-12-31)' },
  { value: 'DD.MM.YYYY', label: 'DD.MM.YYYY (31.12.2024)' },
  { value: 'YYYY/MM/DD', label: 'YYYY/MM/DD (2024/12/31)' },
]

// Time format options for user selection
export const timeFormats = [
  { value: '12h', label: '12-hour (2:30 PM)' },
  { value: '24h', label: '24-hour (14:30)' },
]
