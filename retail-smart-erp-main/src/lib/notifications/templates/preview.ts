/**
 * Client-safe template preview function
 * This file has no server dependencies and can be used in client components
 */

/**
 * Preview template with sample data (client-safe)
 * @param currencyCode - Optional currency code for formatting (defaults to 'LKR')
 */
export function previewTemplate(template: string, currencyCode: string = 'LKR'): string {
  const sampleData: Record<string, string> = {
    business_name: 'Auto Care Center',
    business_phone: '0112345678',
    business_email: 'info@autocare.lk',
    business_address: '123 Main St, Colombo',
    customer_name: 'John Doe',
    customer_first_name: 'John',
    customer_phone: '0771234567',
    customer_email: 'john@example.com',
    vehicle_plate: 'ABC-1234',
    vehicle_make: 'Toyota',
    vehicle_model: 'Corolla',
    vehicle_year: '2020',
    vehicle_color: 'White',
    work_order_no: 'WO-2024-0001',
    work_order_status: 'In Progress',
    work_order_total: formatCurrencyForPreview(25000, currencyCode),
    work_order_date: 'Jan 15, 2024',
    appointment_date: 'Jan 20, 2024',
    appointment_time: '10:00 AM',
    appointment_datetime: 'Jan 20, 2024 at 10:00 AM',
    appointment_type: 'Oil Change',
    invoice_no: 'INV-2024-0042',
    sale_total: formatCurrencyForPreview(15500, currencyCode),
    sale_date: 'Jan 15, 2024',
    estimate_no: 'EST-2024-0015',
    estimate_status: 'Approved',
    estimate_total: formatCurrencyForPreview(150000, currencyCode),
    current_date: new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }),
    current_time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
    current_year: new Date().getFullYear().toString(),
  }

  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return sampleData[key] ?? `[${key}]`
  })
}

/**
 * Helper function to format currency for preview
 * This avoids importing the full currency module which may have server dependencies
 */
function formatCurrencyForPreview(amount: number, currencyCode: string): string {
  const currencySymbols: Record<string, string> = {
    LKR: 'Rs',
    USD: '$',
    EUR: '€',
    GBP: '£',
    INR: '₹',
    AUD: 'A$',
    CAD: 'C$',
    JPY: '¥',
    CNY: '¥',
    SGD: 'S$',
    AED: 'د.إ',
    MYR: 'RM',
    THB: '฿',
    PHP: '₱',
    PKR: '₨',
    BDT: '৳',
    ZAR: 'R',
    NGN: '₦',
    BRL: 'R$',
    KRW: '₩',
    NZD: 'NZ$',
    SEK: 'kr',
    NOK: 'kr',
    DKK: 'kr',
    CHF: 'CHF',
    MXN: '$',
    SAR: '﷼',
    NPR: 'रू',
    KES: 'KSh',
  }

  const symbol = currencySymbols[currencyCode] || currencyCode
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  
  return `${symbol} ${formatted}`
}
