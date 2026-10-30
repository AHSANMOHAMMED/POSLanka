/** Icons of the Vendor data console: one per well-known table, otherwise the icon of its section. */
import {
  ArrowLeftRight, Banknote, BarChart3, Barcode, Bell, Boxes, Building2, Calculator, Calendar, Car, ChefHat, ClipboardList,
  CreditCard, Database, FileText, FolderOpen, Gift, HandCoins, History, IdCard, KeyRound, Landmark, Layers, MessageSquare,
  Package, Percent, Printer, Receipt, RotateCcw, Scale, Settings, ShoppingBag, ShoppingCart, Sparkles, Store, Tag, Truck,
  UserCog, Users, UtensilsCrossed, Wallet, Warehouse, Wrench, type LucideIcon,
} from 'lucide-react'

const GROUP_ICONS: Record<string, LucideIcon> = {
  'Business & settings': Settings,
  'POS & shifts': Store,
  Sales: ShoppingCart,
  'Customers & loyalty': Users,
  'Items & stock': Boxes,
  'Purchasing & suppliers': Truck,
  Accounting: Calculator,
  'HR & payroll': IdCard,
  Restaurant: UtensilsCrossed,
  'Vehicles & workshop': Car,
  'Files & messages': FolderOpen,
}

/** First match wins, so the specific names come before the broad ones */
const TABLE_ICONS: Array<[RegExp, LucideIcon]> = [
  [/^business_profile$/, Building2],
  [/^warehouse_stock$|^stock_/, Warehouse],
  [/^warehouses$/, Store],
  [/^items$/, Package],
  [/barcode/, Barcode],
  [/^categories$|categor/, Tag],
  [/batch|serial/, Layers],
  [/^units$|uom|measure/, Scale],
  [/price|promotion|coupon|discount/, Percent],
  [/return|refund|credit_note|debit_note/, RotateCcw],
  [/^sale_items$|quotation/, ClipboardList],
  [/^sales$|held_sales/, Receipt],
  [/gift_card/, Gift],
  [/loyalty/, Sparkles],
  [/^customers?|customer_/, Users],
  [/^suppliers?|supplier_/, Truck],
  [/^purchase/, ShoppingBag],
  [/payroll|salary|advance_recovery/, Wallet],
  [/^employee/, IdCard],
  [/^users$|custom_roles|role_|user_/, UserCog],
  [/api_keys|account_sessions/, KeyRound],
  [/^payments?$|payment_|modes_of_payment/, CreditCard],
  [/cheque/, Banknote],
  [/expense/, HandCoins],
  [/^bank_/, Landmark],
  [/gl_entries|journal|chart_of_accounts/, Calculator],
  [/transfer/, ArrowLeftRight],
  [/print|label_templates|letter_heads/, Printer],
  [/kitchen|recipe/, ChefHat],
  [/work_order|inspection|labor|service_type/, Wrench],
  [/vehicle/, Car],
  [/appointment|reservation|attendance/, Calendar],
  [/notification|alert/, Bell],
  [/chat|message|sms|email/, MessageSquare],
  [/report|usage/, BarChart3],
  [/log|history|audit|tombstone/, History],
  [/document|invoice/, FileText],
]

export function groupIcon(group: string): LucideIcon {
  return GROUP_ICONS[group] ?? Database
}

export function tableIcon(name: string, group: string): LucideIcon {
  return TABLE_ICONS.find(([re]) => re.test(name))?.[1] ?? groupIcon(group)
}
