/** Major Sri Lankan banks for transfer references and bank account setup */
export const SRI_LANKAN_BANKS = [
  { code: 'BOC', name: 'Bank of Ceylon' },
  { code: 'PB', name: "People's Bank" },
  { code: 'COMB', name: 'Commercial Bank' },
  { code: 'HNB', name: 'Hatton National Bank' },
  { code: 'SAMP', name: 'Sampath Bank' },
  { code: 'NTB', name: 'Nations Trust Bank' },
  { code: 'DFCC', name: 'DFCC Bank' },
  { code: 'SEY', name: 'Seylan Bank' },
  { code: 'NDB', name: 'NDB Bank' },
  { code: 'UB', name: 'Union Bank' },
] as const

export type SriLankanBankCode = (typeof SRI_LANKAN_BANKS)[number]['code']

export const SRI_LANKAN_BANK_NAMES = SRI_LANKAN_BANKS.map((b) => b.name)

export function isSriLankanBankName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return SRI_LANKAN_BANKS.some((b) => b.name.toLowerCase() === normalized)
}
