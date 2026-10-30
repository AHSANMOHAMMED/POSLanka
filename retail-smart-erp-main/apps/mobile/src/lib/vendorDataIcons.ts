// Icons of the vendor data tiles; the web console's list is src/lib/admin/vendor-data-icons.ts.
import type { ComponentProps } from 'react'
import type { Ionicons } from '@expo/vector-icons'

type IconName = ComponentProps<typeof Ionicons>['name']

const GROUP_ICONS: Record<string, IconName> = {
  'Business & settings': 'settings-outline',
  'POS & shifts': 'storefront-outline',
  Sales: 'cart-outline',
  'Customers & loyalty': 'people-outline',
  'Items & stock': 'cube-outline',
  'Purchasing & suppliers': 'car-outline',
  Accounting: 'calculator-outline',
  'HR & payroll': 'id-card-outline',
  Restaurant: 'restaurant-outline',
  'Vehicles & workshop': 'car-sport-outline',
  'Files & messages': 'folder-open-outline',
}

/** First match wins, so the specific names come before the broad ones */
const TABLE_ICONS: Array<[RegExp, IconName]> = [
  [/^business_profile$/, 'business-outline'],
  [/^warehouse_stock$|^stock_/, 'file-tray-stacked-outline'],
  [/^warehouses$/, 'storefront-outline'],
  [/^items$/, 'cube-outline'],
  [/barcode/, 'barcode-outline'],
  [/^categories$|categor/, 'pricetag-outline'],
  [/batch|serial/, 'layers-outline'],
  [/^units$|uom|measure/, 'scale-outline'],
  [/price|promotion|coupon|discount/, 'pricetags-outline'],
  [/return|refund|credit_note|debit_note/, 'return-down-back-outline'],
  [/^sale_items$|quotation/, 'list-outline'],
  [/^sales$|held_sales/, 'receipt-outline'],
  [/gift_card/, 'gift-outline'],
  [/loyalty/, 'sparkles-outline'],
  [/^customers?|customer_/, 'people-outline'],
  [/^suppliers?|supplier_/, 'bus-outline'],
  [/^purchase/, 'bag-handle-outline'],
  [/payroll|salary|advance_recovery/, 'wallet-outline'],
  [/^employee/, 'id-card-outline'],
  [/^users$|custom_roles|role_|user_/, 'person-circle-outline'],
  [/api_keys|account_sessions/, 'key-outline'],
  [/^payments?$|payment_|modes_of_payment/, 'card-outline'],
  [/cheque/, 'cash-outline'],
  [/expense/, 'cash-outline'],
  [/^bank_/, 'library-outline'],
  [/gl_entries|journal|chart_of_accounts/, 'calculator-outline'],
  [/transfer/, 'swap-horizontal-outline'],
  [/print|label_templates|letter_heads/, 'print-outline'],
  [/kitchen|recipe/, 'restaurant-outline'],
  [/work_order|inspection|labor|service_type/, 'construct-outline'],
  [/vehicle/, 'car-sport-outline'],
  [/appointment|reservation|attendance/, 'calendar-outline'],
  [/notification|alert/, 'notifications-outline'],
  [/chat|message|sms|email/, 'chatbubble-outline'],
  [/report|usage/, 'bar-chart-outline'],
  [/log|history|audit|tombstone/, 'time-outline'],
  [/document|invoice/, 'document-text-outline'],
]

export function groupIcon(group: string): IconName {
  return GROUP_ICONS[group] ?? 'server-outline'
}

export function tableIcon(name: string, group: string): IconName {
  return TABLE_ICONS.find(([re]) => re.test(name))?.[1] ?? groupIcon(group)
}
