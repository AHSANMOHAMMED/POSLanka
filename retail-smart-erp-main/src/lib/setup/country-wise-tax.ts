// Country-wise tax database inspired by ERPNext's setup wizard
// Provides default tax rates for countries around the world

// Country code to name mapping (simplified to avoid import issues)
// Includes all countries from the tax database plus additional ones
const countryCodeToName: Record<string, string> = {
  // Core countries from existing system (also in tax database)
  'US': 'United States',
  'GB': 'United Kingdom',
  'AU': 'Australia',
  'NZ': 'New Zealand',
  'IN': 'India',
  'LK': 'Sri Lanka',
  'PK': 'Pakistan',
  'BD': 'Bangladesh',
  'AE': 'United Arab Emirates',
  'SA': 'Saudi Arabia',
  'QA': 'Qatar',
  'KW': 'Kuwait',
  'BH': 'Bahrain',
  'OM': 'Oman',
  'SG': 'Singapore',
  'MY': 'Malaysia',
  'TH': 'Thailand',
  'ID': 'Indonesia',
  'PH': 'Philippines',
  'VN': 'Vietnam',
  'JP': 'Japan',
  'KR': 'South Korea',
  'CN': 'China',
  'HK': 'Hong Kong',
  'TW': 'Taiwan',
  'DE': 'Germany',
  'FR': 'France',
  'IT': 'Italy',
  'ES': 'Spain',
  'PT': 'Portugal',
  'NL': 'Netherlands',
  'BE': 'Belgium',
  'CH': 'Switzerland',
  'SE': 'Sweden',
  'NO': 'Norway',
  'DK': 'Denmark',
  'FI': 'Finland',
  'PL': 'Poland',
  'CZ': 'Czech Republic',
  'HU': 'Hungary',
  'RO': 'Romania',
  'BG': 'Bulgaria',
  'GR': 'Greece',
  'RU': 'Russia',
  'UA': 'Ukraine',
  'TR': 'Turkey',
  'EG': 'Egypt',
  'ZA': 'South Africa',
  'KE': 'Kenya',
  'TZ': 'Tanzania',
  'UG': 'Uganda',
  'MX': 'Mexico',
  'BR': 'Brazil',
  'AR': 'Argentina',
  'CL': 'Chile',
  'CO': 'Colombia',
  'VE': 'Venezuela',
  'MM': 'Myanmar',
  'KH': 'Cambodia',
  'MV': 'Maldives',
  'CA': 'Canada',
  
  // Additional countries from tax database (ensure no duplicates)
  'AL': 'Albania',
  'DZ': 'Algeria',
  'AD': 'Andorra',
  'AO': 'Angola',
  'AG': 'Antigua And Barbuda',
  'AM': 'Armenia',
  'AW': 'Aruba',
  'AZ': 'Azerbaijan',
  'BS': 'Bahamas',
  'BY': 'Belarus',
  'BZ': 'Belize',
  'BJ': 'Benin',
  'BT': 'Bhutan',
  'BO': 'Bolivia',
  'BA': 'Bosnia and Herzegovina',
  'BW': 'Botswana',
  'BN': 'Brunei',
  'BF': 'Burkina Faso',
  'BI': 'Burundi',
  'CV': 'Cape Verde',
  'CF': 'Central African Republic',
  'TD': 'Chad',
  'KM': 'Comoros',
  'CG': 'Congo',
  'CR': 'Costa Rica',
  'HR': 'Croatia',
  'CY': 'Cyprus',
  'DJ': 'Djibouti',
  'DM': 'Dominica',
  'DO': 'Dominican Republic',
  'TL': 'East Timor',
  'SV': 'El Salvador',
  'GQ': 'Equatorial Guinea',
  'ER': 'Eritrea',
  'EE': 'Estonia',
  'SZ': 'Eswatini',
  'ET': 'Ethiopia',
  'FJ': 'Fiji',
  'GA': 'Gabon',
  'GM': 'Gambia',
  'GE': 'Georgia',
  'GD': 'Grenada',
  'GT': 'Guatemala',
  'GN': 'Guinea',
  'GW': 'Guinea-Bissau',
  'GY': 'Guyana',
  'HT': 'Haiti',
  'HN': 'Honduras',
  'IS': 'Iceland',
  'IR': 'Iran',
  'IQ': 'Iraq',
  'JM': 'Jamaica',
  'JO': 'Jordan',
  'KZ': 'Kazakhstan',
  'KI': 'Kiribati',
  'XK': 'Kosovo',
  'KG': 'Kyrgyzstan',
  'LV': 'Latvia',
  'LB': 'Lebanon',
  'LS': 'Lesotho',
  'LR': 'Liberia',
  'LY': 'Libya',
  'LI': 'Liechtenstein',
  'LT': 'Lithuania',
  'LU': 'Luxembourg',
  'MG': 'Madagascar',
  'MW': 'Malawi',
  'ML': 'Mali',
  'MT': 'Malta',
  'MH': 'Marshall Islands',
  'MR': 'Mauritania',
  'MU': 'Mauritius',
  'FM': 'Micronesia',
  'MD': 'Moldova',
  'MC': 'Monaco',
  'MN': 'Mongolia',
  'ME': 'Montenegro',
  'MA': 'Morocco',
  'MZ': 'Mozambique',
  'NA': 'Namibia',
  'NR': 'Nauru',
  'NI': 'Nicaragua',
  'NE': 'Niger',
  'MK': 'North Macedonia',
  'PW': 'Palau',
  'PA': 'Panama',
  'PG': 'Papua New Guinea',
  'PY': 'Paraguay',
  'RW': 'Rwanda',
  'KN': 'Saint Kitts and Nevis',
  'LC': 'Saint Lucia',
  'VC': 'Saint Vincent and the Grenadines',
  'WS': 'Samoa',
  'SM': 'San Marino',
  'ST': 'Sao Tome and Principe',
  'SN': 'Senegal',
  'RS': 'Serbia',
  'SC': 'Seychelles',
  'SL': 'Sierra Leone',
  'SK': 'Slovakia',
  'SI': 'Slovenia',
  'SB': 'Solomon Islands',
  'SO': 'Somalia',
  'SS': 'South Sudan',
  'SD': 'Sudan',
  'SR': 'Suriname',
  'SY': 'Syria',
  'TJ': 'Tajikistan',
  'TG': 'Togo',
  'TO': 'Tonga',
  'TT': 'Trinidad and Tobago',
  'TN': 'Tunisia',
  'TM': 'Turkmenistan',
  'TV': 'Tuvalu',
  'UY': 'Uruguay',
  'UZ': 'Uzbekistan',
  'VU': 'Vanuatu',
  'VA': 'Vatican City',
  'YE': 'Yemen',
  'ZM': 'Zambia',
  'ZW': 'Zimbabwe'
}

export interface CountryTaxTemplate {
  taxName: string
  taxRate: number
  accountName?: string
  isDefault?: boolean
  /** VAT treatment (tax_templates.tax_category); defaults to 'standard'. */
  taxCategory?: 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope'
  /** Display name of the seeded tax template (defaults to the map key). */
  templateName?: string
  /** Offered in setup / tax settings but never made the default template. */
  optional?: boolean
}

export interface CountryTaxData {
  [countryName: string]: {
    [taxTemplateName: string]: CountryTaxTemplate
  }
}

/**
 * Country-wise tax database with default VAT/GST/Sales tax rates
 * Based on ERPNext's country_wise_tax.json but simplified for this system
 */
export const countryWiseTax: CountryTaxData = {
  "Albania": {
    "Albania VAT": {
      taxName: "VAT",
      taxRate: 20.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Algeria": {
    "Algeria TVA 19%": {
      taxName: "TVA 19%",
      taxRate: 19.00,
      accountName: "TVA 19%",
      isDefault: true
    },
    "Algeria TVA 9%": {
      taxName: "TVA 9%",
      taxRate: 9.00,
      accountName: "TVA 9%"
    }
  },
  "Andorra": {
    "Andorra VAT": {
      taxName: "VAT",
      taxRate: 4.50,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Angola": {
    "Angola VAT": {
      taxName: "VAT",
      taxRate: 10.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Antigua And Barbuda": {
    "Antigua & Barbuda Sales Tax": {
      taxName: "ABST",
      taxRate: 15.00,
      accountName: "ABST",
      isDefault: true
    }
  },
  "Argentina": {
    "Argentina Tax": {
      taxName: "VAT",
      taxRate: 21.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Armenia": {
    "Armenia Tax": {
      taxName: "VAT",
      taxRate: 20.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Aruba": {
    "Aruba Tax": {
      taxName: "VAT",
      taxRate: 1.50,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Australia": {
    "Australia GST": {
      taxName: "GST",
      taxRate: 10.00,
      accountName: "GST Collected",
      isDefault: true
    }
  },
  "Austria": {
    "Austria VAT": {
      taxName: "VAT",
      taxRate: 20.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Bahrain": {
    "Bahrain VAT": {
      taxName: "VAT",
      taxRate: 10.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Bangladesh": {
    "Bangladesh VAT": {
      taxName: "VAT",
      taxRate: 15.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Belgium": {
    "Belgium VAT": {
      taxName: "VAT",
      taxRate: 21.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Brazil": {
    "Brazil ICMS": {
      taxName: "ICMS",
      taxRate: 18.00,
      accountName: "ICMS",
      isDefault: true
    }
  },
  "Bulgaria": {
    "Bulgaria VAT": {
      taxName: "VAT",
      taxRate: 20.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Canada": {
    "Canada GST/HST": {
      taxName: "GST/HST",
      taxRate: 5.00,
      accountName: "GST/HST",
      isDefault: true
    }
  },
  "Chile": {
    "Chile VAT": {
      taxName: "VAT",
      taxRate: 19.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "China": {
    "China VAT": {
      taxName: "VAT",
      taxRate: 13.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Colombia": {
    "Colombia VAT": {
      taxName: "VAT",
      taxRate: 19.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Croatia": {
    "Croatia VAT": {
      taxName: "VAT",
      taxRate: 25.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Cyprus": {
    "Cyprus VAT": {
      taxName: "VAT",
      taxRate: 19.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Czech Republic": {
    "Czech Republic VAT": {
      taxName: "VAT",
      taxRate: 21.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Denmark": {
    "Denmark VAT": {
      taxName: "VAT",
      taxRate: 25.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Egypt": {
    "Egypt VAT": {
      taxName: "VAT",
      taxRate: 14.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Estonia": {
    "Estonia VAT": {
      taxName: "VAT",
      taxRate: 20.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Finland": {
    "Finland VAT": {
      taxName: "VAT",
      taxRate: 24.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "France": {
    "France VAT": {
      taxName: "VAT",
      taxRate: 20.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Germany": {
    "Germany VAT": {
      taxName: "VAT",
      taxRate: 19.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Ghana": {
    "Ghana VAT": {
      taxName: "VAT",
      taxRate: 15.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Greece": {
    "Greece VAT": {
      taxName: "VAT",
      taxRate: 24.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Hong Kong": {
    "Hong Kong Profits Tax": {
      taxName: "Profits Tax",
      taxRate: 16.50,
      accountName: "Profits Tax",
      isDefault: true
    }
  },
  "Hungary": {
    "Hungary VAT": {
      taxName: "VAT",
      taxRate: 27.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Iceland": {
    "Iceland VAT": {
      taxName: "VAT",
      taxRate: 24.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "India": {
    "India GST": {
      taxName: "GST",
      taxRate: 18.00,
      accountName: "GST",
      isDefault: true
    }
  },
  "Indonesia": {
    "Indonesia VAT": {
      taxName: "VAT",
      taxRate: 11.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Ireland": {
    "Ireland VAT": {
      taxName: "VAT",
      taxRate: 23.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Israel": {
    "Israel VAT": {
      taxName: "VAT",
      taxRate: 17.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Italy": {
    "Italy VAT": {
      taxName: "VAT",
      taxRate: 22.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Japan": {
    "Japan Consumption Tax": {
      taxName: "Consumption Tax",
      taxRate: 10.00,
      accountName: "Consumption Tax",
      isDefault: true
    }
  },
  "Kenya": {
    "Kenya VAT": {
      taxName: "VAT",
      taxRate: 16.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Latvia": {
    "Latvia VAT": {
      taxName: "VAT",
      taxRate: 21.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Lithuania": {
    "Lithuania VAT": {
      taxName: "VAT",
      taxRate: 21.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Luxembourg": {
    "Luxembourg VAT": {
      taxName: "VAT",
      taxRate: 17.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Malaysia": {
    "Malaysia SST": {
      taxName: "SST",
      taxRate: 10.00,
      accountName: "SST",
      isDefault: true
    }
  },
  "Malta": {
    "Malta VAT": {
      taxName: "VAT",
      taxRate: 18.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Mexico": {
    "Mexico VAT": {
      taxName: "VAT",
      taxRate: 16.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Netherlands": {
    "Netherlands VAT": {
      taxName: "VAT",
      taxRate: 21.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "New Zealand": {
    "New Zealand GST": {
      taxName: "GST",
      taxRate: 15.00,
      accountName: "GST",
      isDefault: true
    }
  },
  "Nigeria": {
    "Nigeria VAT": {
      taxName: "VAT",
      taxRate: 7.50,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Norway": {
    "Norway VAT": {
      taxName: "VAT",
      taxRate: 25.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Pakistan": {
    "Pakistan Sales Tax": {
      taxName: "Sales Tax",
      taxRate: 17.00,
      accountName: "Sales Tax",
      isDefault: true
    }
  },
  "Philippines": {
    "Philippines VAT": {
      taxName: "VAT",
      taxRate: 12.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Poland": {
    "Poland VAT": {
      taxName: "VAT",
      taxRate: 23.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Portugal": {
    "Portugal VAT": {
      taxName: "VAT",
      taxRate: 23.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Qatar": {
    "Qatar VAT": {
      taxName: "VAT",
      taxRate: 5.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Romania": {
    "Romania VAT": {
      taxName: "VAT",
      taxRate: 19.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Russia": {
    "Russia VAT": {
      taxName: "VAT",
      taxRate: 20.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Saudi Arabia": {
    "Saudi Arabia VAT": {
      taxName: "VAT",
      taxRate: 15.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Singapore": {
    "Singapore GST": {
      taxName: "GST",
      taxRate: 9.00,
      accountName: "GST",
      isDefault: true
    }
  },
  "Slovakia": {
    "Slovakia VAT": {
      taxName: "VAT",
      taxRate: 20.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Slovenia": {
    "Slovenia VAT": {
      taxName: "VAT",
      taxRate: 22.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "South Africa": {
    "South Africa VAT": {
      taxName: "VAT",
      taxRate: 15.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "South Korea": {
    "South Korea VAT": {
      taxName: "VAT",
      taxRate: 10.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Spain": {
    "Spain VAT": {
      taxName: "VAT",
      taxRate: 21.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  // VAT 18% since 1 January 2024 (VAT (Amendment) Act No. 32 of 2023); NBT was abolished on
  // 1 December 2019. SSCL (2.5% on turnover) is a levy borne by the business and usually not
  // itemised on invoices, so it is offered but never the default.
  "Sri Lanka": {
    "Sri Lanka VAT": {
      taxName: "VAT",
      taxRate: 18.00,
      accountName: "VAT",
      isDefault: true,
      taxCategory: "standard",
      templateName: "VAT 18%"
    },
    "Sri Lanka VAT Zero-rated": {
      taxName: "VAT",
      taxRate: 0,
      accountName: "VAT",
      isDefault: false,
      taxCategory: "zero_rated",
      templateName: "VAT 0% Zero-rated"
    },
    "Sri Lanka VAT Exempt": {
      taxName: "VAT",
      taxRate: 0,
      accountName: "VAT",
      isDefault: false,
      taxCategory: "exempt",
      templateName: "VAT Exempt"
    },
    "Sri Lanka SSCL": {
      taxName: "SSCL",
      taxRate: 2.50,
      accountName: "SSCL",
      isDefault: false,
      taxCategory: "standard",
      templateName: "SSCL 2.5%",
      optional: true
    }
  },
  "Sweden": {
    "Sweden VAT": {
      taxName: "VAT",
      taxRate: 25.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Switzerland": {
    "Switzerland VAT": {
      taxName: "VAT",
      taxRate: 7.70,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Taiwan": {
    "Taiwan VAT": {
      taxName: "VAT",
      taxRate: 5.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Thailand": {
    "Thailand VAT": {
      taxName: "VAT",
      taxRate: 7.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Turkey": {
    "Turkey VAT": {
      taxName: "VAT",
      taxRate: 20.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "United Arab Emirates": {
    "UAE VAT": {
      taxName: "VAT",
      taxRate: 5.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "United Kingdom": {
    "UK VAT": {
      taxName: "VAT",
      taxRate: 20.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "United States": {
    "US Sales Tax (Avg)": {
      taxName: "Sales Tax",
      taxRate: 7.25,
      accountName: "Sales Tax",
      isDefault: true
    }
  },
  "Uruguay": {
    "Uruguay VAT": {
      taxName: "VAT",
      taxRate: 22.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Vietnam": {
    "Vietnam VAT": {
      taxName: "VAT",
      taxRate: 10.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Zambia": {
    "Zambia VAT": {
      taxName: "VAT",
      taxRate: 16.00,
      accountName: "VAT",
      isDefault: true
    }
  },
  "Zimbabwe": {
    "Zimbabwe VAT": {
      taxName: "VAT",
      taxRate: 14.50,
      accountName: "VAT",
      isDefault: true
    }
  }
}

/**
 * Get default tax rate for a country
 * Returns the default tax rate or 0 if not found
 */
export function getDefaultTaxRate(countryName: string): number {
  const countryData = countryWiseTax[countryName]
  if (!countryData) return 0
  
  // Find the default tax template
  for (const templateName in countryData) {
    const template = countryData[templateName]
    if (template.isDefault) {
      return template.taxRate
    }
  }
  
  // If no default, return the first tax rate
  const firstTemplate = Object.values(countryData)[0]
  return firstTemplate?.taxRate || 0
}

/**
 * Get tax data for a country
 * Returns all tax templates for the country or empty array if not found
 */
export function getTaxDataForCountry(countryName: string): CountryTaxTemplate[] {
  const countryData = countryWiseTax[countryName]
  if (!countryData) return []
  
  return Object.values(countryData)
}

/**
 * Get tax-inclusive preference for a country
 * Some countries typically use tax-inclusive pricing
 */
export function isTaxInclusiveCountry(countryName: string): boolean {
  // These countries typically use tax-inclusive pricing
  const taxInclusiveCountries = [
    'Australia', 'New Zealand', 'United Kingdom', 'Ireland',
    'Singapore', 'Malaysia', 'South Africa', 'Israel'
  ]
  
  return taxInclusiveCountries.includes(countryName)
}

/**
 * Get comprehensive tax suggestion for a country
 */
export interface TaxSuggestion {
  taxRate: number
  taxInclusive: boolean
  taxNote: string
}

export function getTaxSuggestionForCountry(countryName: string, businessType?: string): TaxSuggestion {
  const taxRate = getDefaultTaxRate(countryName)
  const taxInclusive = isTaxInclusiveCountry(countryName)
  
  let taxNote = ''
  
  if (taxRate > 0) {
    const countryData = countryWiseTax[countryName]
    let taxType = 'tax'
    
    if (countryData) {
      const defaultTemplate = Object.values(countryData).find(t => t.isDefault) || Object.values(countryData)[0]
      if (defaultTemplate) {
        taxType = defaultTemplate.taxName
      }
    }
    
    taxNote = `${countryName} standard ${taxType} rate is ${taxRate}%.`
    
    if (taxInclusive) {
      taxNote += ` Prices in ${countryName} are typically tax-inclusive.`
    } else {
      taxNote += ` Prices in ${countryName} are typically tax-exclusive.`
    }
    
    if (businessType) {
      taxNote += ` For ${businessType} businesses, this rate may vary by product category.`
    }
  } else {
    taxNote = `No standard tax rate found for ${countryName}. Please consult local tax authorities.`
  }
  
  return {
    taxRate,
    taxInclusive,
    taxNote
  }
}

/**
 * Get tax suggestion for a country code (ISO 3166-1 alpha-2)
 * Maps country code to country name first
 */
export function getTaxSuggestionForCountryCode(countryCode: string, businessType?: string): TaxSuggestion {
  const countryName = countryCodeToName[countryCode]
  if (!countryName) {
    return {
      taxRate: 0,
      taxInclusive: false,
      taxNote: `Country code ${countryCode} not recognized. Please check local tax regulations.`
    }
  }
  
  return getTaxSuggestionForCountry(countryName, businessType)
}

/** Country name for an ISO 3166-1 alpha-2 code (undefined when unknown). */
export function getCountryNameForCode(countryCode: string | null | undefined): string | undefined {
  return countryCode ? countryCodeToName[countryCode.toUpperCase()] : undefined
}

/**
 * Tax templates to seed for a country code, in display order (default first).
 * `includeOptional` adds levies such as Sri Lanka SSCL that are available but not default.
 */
export function getCountryTaxTemplatesForCode(
  countryCode: string,
  includeOptional = false
): Array<CountryTaxTemplate & { templateName: string }> {
  const name = getCountryNameForCode(countryCode)
  const data = name ? countryWiseTax[name] : undefined
  if (!data) return []
  return Object.entries(data)
    .filter(([, t]) => includeOptional || !t.optional)
    .map(([key, t]) => ({ ...t, templateName: t.templateName || key }))
    .sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault))
}
