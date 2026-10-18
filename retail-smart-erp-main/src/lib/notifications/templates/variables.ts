/**
 * Template Variables System
 *
 * Defines available variables for each entity type that can be
 * used in notification templates.
 */

export interface TemplateVariable {
  key: string
  label: string
  description: string
  example: string
}

export interface TemplateVariableGroup {
  name: string
  description: string
  variables: TemplateVariable[]
}

// Business variables (always available)
export const businessVariables: TemplateVariableGroup = {
  name: 'Business',
  description: 'Your business information',
  variables: [
    { key: 'business_name', label: 'Business Name', description: 'Your company name', example: 'Auto Care Center' },
    { key: 'business_phone', label: 'Business Phone', description: 'Your contact number', example: '0112345678' },
    { key: 'business_email', label: 'Business Email', description: 'Your email address', example: 'info@autocare.lk' },
    { key: 'business_address', label: 'Business Address', description: 'Your business address', example: '123 Main St, Colombo' },
  ],
}

// Customer variables
export const customerVariables: TemplateVariableGroup = {
  name: 'Customer',
  description: 'Customer information',
  variables: [
    { key: 'customer_name', label: 'Customer Name', description: 'Full name of the customer', example: 'John Doe' },
    { key: 'customer_first_name', label: 'First Name', description: 'Customer first name', example: 'John' },
    { key: 'customer_phone', label: 'Customer Phone', description: 'Customer phone number', example: '0771234567' },
    { key: 'customer_email', label: 'Customer Email', description: 'Customer email address', example: 'john@example.com' },
  ],
}

// Vehicle variables
export const vehicleVariables: TemplateVariableGroup = {
  name: 'Vehicle',
  description: 'Vehicle information',
  variables: [
    { key: 'vehicle_plate', label: 'Plate Number', description: 'Vehicle registration number', example: 'ABC-1234' },
    { key: 'vehicle_make', label: 'Make', description: 'Vehicle manufacturer', example: 'Toyota' },
    { key: 'vehicle_model', label: 'Model', description: 'Vehicle model', example: 'Corolla' },
    { key: 'vehicle_year', label: 'Year', description: 'Manufacturing year', example: '2020' },
    { key: 'vehicle_color', label: 'Color', description: 'Vehicle color', example: 'White' },
    { key: 'vehicle_vin', label: 'VIN', description: 'Vehicle identification number', example: 'JTDKN3DU5A1234567' },
  ],
}

// Work Order variables
export const workOrderVariables: TemplateVariableGroup = {
  name: 'Work Order',
  description: 'Work order details',
  variables: [
    { key: 'work_order_no', label: 'Work Order #', description: 'Work order number', example: 'WO-2024-0001' },
    { key: 'work_order_status', label: 'Status', description: 'Current status', example: 'In Progress' },
    { key: 'work_order_total', label: 'Total Amount', description: 'Total cost', example: 'LKR 25,000.00' },
    { key: 'work_order_date', label: 'Date', description: 'Work order date', example: '2024-01-15' },
    { key: 'work_order_services', label: 'Services', description: 'List of services', example: 'Oil Change, Brake Inspection' },
    { key: 'work_order_notes', label: 'Notes', description: 'Additional notes', example: 'Customer requested pickup by 5pm' },
  ],
}

// Appointment variables
export const appointmentVariables: TemplateVariableGroup = {
  name: 'Appointment',
  description: 'Appointment details',
  variables: [
    { key: 'appointment_date', label: 'Date', description: 'Appointment date', example: '2024-01-20' },
    { key: 'appointment_time', label: 'Time', description: 'Appointment time', example: '10:00 AM' },
    { key: 'appointment_datetime', label: 'Date & Time', description: 'Full date and time', example: 'Jan 20, 2024 at 10:00 AM' },
    { key: 'appointment_type', label: 'Type', description: 'Service type', example: 'Oil Change' },
    { key: 'appointment_notes', label: 'Notes', description: 'Additional notes', example: 'Please bring previous service records' },
  ],
}

// Sale/Invoice variables
export const saleVariables: TemplateVariableGroup = {
  name: 'Sale/Invoice',
  description: 'Sales and invoice details',
  variables: [
    { key: 'invoice_no', label: 'Invoice #', description: 'Invoice number', example: 'INV-2024-0042' },
    { key: 'sale_total', label: 'Total', description: 'Invoice total', example: 'LKR 15,500.00' },
    { key: 'sale_subtotal', label: 'Subtotal', description: 'Before tax', example: 'LKR 15,000.00' },
    { key: 'sale_tax', label: 'Tax', description: 'Tax amount', example: 'LKR 500.00' },
    { key: 'sale_discount', label: 'Discount', description: 'Discount amount', example: 'LKR 1,000.00' },
    { key: 'sale_date', label: 'Date', description: 'Sale date', example: '2024-01-15' },
    { key: 'sale_items', label: 'Items', description: 'List of items', example: '2x Oil Filter, 5L Engine Oil' },
    { key: 'payment_method', label: 'Payment Method', description: 'How it was paid', example: 'Cash' },
    { key: 'amount_paid', label: 'Amount Paid', description: 'Payment received', example: 'LKR 15,500.00' },
    { key: 'balance_due', label: 'Balance Due', description: 'Remaining amount', example: 'LKR 0.00' },
  ],
}

// Insurance Estimate variables
export const estimateVariables: TemplateVariableGroup = {
  name: 'Insurance Estimate',
  description: 'Insurance estimate details',
  variables: [
    { key: 'estimate_no', label: 'Estimate #', description: 'Estimate number', example: 'EST-2024-0015' },
    { key: 'estimate_status', label: 'Status', description: 'Current status', example: 'Approved' },
    { key: 'estimate_total', label: 'Total', description: 'Estimate total', example: 'LKR 150,000.00' },
    { key: 'estimate_approved_amount', label: 'Approved Amount', description: 'Insurance approved', example: 'LKR 140,000.00' },
    { key: 'insurance_company', label: 'Insurance Co.', description: 'Insurance company name', example: 'Sri Lanka Insurance' },
    { key: 'claim_no', label: 'Claim #', description: 'Insurance claim number', example: 'CLM-2024-1234' },
  ],
}

// Date/Time utility variables
export const dateTimeVariables: TemplateVariableGroup = {
  name: 'Date & Time',
  description: 'Current date and time',
  variables: [
    { key: 'current_date', label: 'Current Date', description: 'Today\'s date', example: '2024-01-15' },
    { key: 'current_time', label: 'Current Time', description: 'Current time', example: '2:30 PM' },
    { key: 'current_year', label: 'Current Year', description: 'Current year', example: '2024' },
  ],
}

// All variable groups
export const allVariableGroups: TemplateVariableGroup[] = [
  businessVariables,
  customerVariables,
  vehicleVariables,
  workOrderVariables,
  appointmentVariables,
  saleVariables,
  estimateVariables,
  dateTimeVariables,
]

// Get variables by entity type
export function getVariablesForEntity(entityType: string): TemplateVariableGroup[] {
  const groups: TemplateVariableGroup[] = [businessVariables, dateTimeVariables]

  switch (entityType) {
    case 'work_order':
      groups.push(customerVariables, vehicleVariables, workOrderVariables)
      break
    case 'appointment':
      groups.push(customerVariables, vehicleVariables, appointmentVariables)
      break
    case 'sale':
      groups.push(customerVariables, saleVariables)
      break
    case 'estimate':
      groups.push(customerVariables, vehicleVariables, estimateVariables)
      break
    case 'customer':
      groups.push(customerVariables)
      break
    case 'vehicle':
      groups.push(customerVariables, vehicleVariables)
      break
    default:
      // Return all for general templates
      return allVariableGroups
  }

  return groups
}

// Flatten all variables to a simple key-label map
export function getAllVariableKeys(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const group of allVariableGroups) {
    for (const v of group.variables) {
      result[v.key] = v.label
    }
  }
  return result
}
