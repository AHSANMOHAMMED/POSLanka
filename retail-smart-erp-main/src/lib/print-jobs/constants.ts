// Print job labels / colours (client-safe)

export const PRINT_JOB_STATUS_LABELS: Record<string, string> = {
  received: 'Received',
  designing: 'Designing',
  proof_sent: 'Proof sent',
  approved: 'Approved',
  printing: 'Printing',
  finishing: 'Finishing',
  ready: 'Ready',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export const PRINT_JOB_STATUS_COLORS: Record<string, string> = {
  received: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100',
  designing: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  proof_sent: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  approved: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  printing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  finishing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200',
  ready: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  delivered: 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

/** Production pipeline in order (cancelled is off the line). */
export const PRINT_JOB_PIPELINE = ['received', 'designing', 'proof_sent', 'approved', 'printing', 'finishing', 'ready', 'delivered'] as const

export const PROOF_STATUS_LABELS: Record<string, string> = {
  not_needed: 'No proof needed',
  pending: 'Proof pending',
  sent: 'Proof sent',
  approved: 'Proof approved',
  changes_requested: 'Changes requested',
}

export const PROOF_STATUS_COLORS: Record<string, string> = {
  not_needed: 'text-gray-500',
  pending: 'text-amber-600',
  sent: 'text-blue-600',
  approved: 'text-green-600',
  changes_requested: 'text-red-600',
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', credit: 'On account', gift_card: 'Gift card',
}

/** Common media / materials offered in the line's material box (free text allowed). */
export const PRINT_MATERIALS = [
  'Flex (normal)', 'Flex (star / backlit)', 'Vinyl (glossy)', 'Vinyl (matte)', 'One-way vision', 'Reflective vinyl',
  'Photo paper (glossy)', 'Photo paper (luster)', 'Canvas', 'Art board 300gsm', 'Bond paper 80gsm', 'Sticker paper',
  'PVC foam board', 'Acrylic', 'Sublimation (mug)', 'Sublimation (T-shirt)', 'DTF (T-shirt)',
]
