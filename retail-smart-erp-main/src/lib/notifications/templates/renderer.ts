import { db } from '@/lib/db'
import { eq } from 'drizzle-orm'
import {
  tenants,
  customers,
  vehicles,
  workOrders,
  appointments,
  sales,
  insuranceEstimates,
  insuranceCompanies,
} from '@/lib/db/schema'
import { formatCurrencyWithSymbol } from '@/lib/utils/currency'

/**
 * Template Renderer
 *
 * Replaces {{variable_name}} placeholders with actual values.
 */

export interface RenderContext {
  tenantId: string
  customerId?: string | null
  vehicleId?: string | null
  workOrderId?: string | null
  appointmentId?: string | null
  saleId?: string | null
  estimateId?: string | null
  // Direct values (override database lookups)
  variables?: Record<string, string>
}

/**
 * Render a template string with the given context
 */
export async function renderTemplate(template: string, context: RenderContext): Promise<string> {
  // Build the variables object from context
  const variables = await buildVariables(context)

  // Replace all {{variable_name}} placeholders
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] ?? match
  })
}

/**
 * Build variables object from context
 */
async function buildVariables(context: RenderContext): Promise<Record<string, string>> {
  const variables: Record<string, string> = {}

  // Start with any directly provided variables
  if (context.variables) {
    Object.assign(variables, context.variables)
  }

  // Add date/time variables
  const now = new Date()
  variables.current_date = formatDate(now)
  variables.current_time = formatTime(now)
  variables.current_year = now.getFullYear().toString()

  // Load tenant (business) info
  const tenant = await loadTenant(context.tenantId)
  const currency = tenant?.currency || 'LKR'
  if (tenant) {
    variables.business_name = tenant.name
    variables.business_phone = tenant.phone || ''
    variables.business_email = tenant.email || ''
    variables.business_address = tenant.address || ''
  }

  // Load customer info
  if (context.customerId) {
    const customer = await loadCustomer(context.customerId)
    if (customer) {
      variables.customer_name = customer.name
      variables.customer_first_name = customer.name.split(' ')[0]
      variables.customer_phone = customer.phone || ''
      variables.customer_email = customer.email || ''
    }
  }

  // Load vehicle info
  if (context.vehicleId) {
    const vehicle = await loadVehicle(context.vehicleId)
    if (vehicle) {
      variables.vehicle_plate = vehicle.licensePlate || ''
      variables.vehicle_make = vehicle.make || ''
      variables.vehicle_model = vehicle.model || ''
      variables.vehicle_year = vehicle.year?.toString() || ''
      variables.vehicle_color = vehicle.color || ''
      variables.vehicle_vin = vehicle.vin || ''

      // If we don't have customer yet, get from vehicle
      if (!context.customerId && vehicle.customerId) {
        const customer = await loadCustomer(vehicle.customerId)
        if (customer) {
          variables.customer_name = customer.name
          variables.customer_first_name = customer.name.split(' ')[0]
          variables.customer_phone = customer.phone || ''
          variables.customer_email = customer.email || ''
        }
      }
    }
  }

  // Load work order info
  if (context.workOrderId) {
    const workOrder = await loadWorkOrder(context.workOrderId)
    if (workOrder) {
      variables.work_order_no = workOrder.orderNo
      variables.work_order_status = formatStatus(workOrder.status)
      variables.work_order_total = formatCurrencyWithSymbol(parseFloat(workOrder.total || '0'), currency)
      variables.work_order_date = workOrder.createdAt ? formatDate(workOrder.createdAt) : ''
      variables.work_order_notes = workOrder.customerComplaint || ''

      // Get customer and vehicle from work order if not set
      if (!context.customerId && workOrder.customerId) {
        const customer = await loadCustomer(workOrder.customerId)
        if (customer) {
          variables.customer_name = customer.name
          variables.customer_first_name = customer.name.split(' ')[0]
          variables.customer_phone = customer.phone || ''
          variables.customer_email = customer.email || ''
        }
      }
      if (!context.vehicleId && workOrder.vehicleId) {
        const vehicle = await loadVehicle(workOrder.vehicleId)
        if (vehicle) {
          variables.vehicle_plate = vehicle.licensePlate || ''
          variables.vehicle_make = vehicle.make || ''
          variables.vehicle_model = vehicle.model || ''
          variables.vehicle_year = vehicle.year?.toString() || ''
        }
      }
    }
  }

  // Load appointment info
  if (context.appointmentId) {
    const appointment = await loadAppointment(context.appointmentId)
    if (appointment) {
      variables.appointment_date = appointment.scheduledDate ? formatDate(new Date(appointment.scheduledDate)) : ''
      variables.appointment_time = appointment.scheduledTime ? formatTime12h(appointment.scheduledTime) : ''
      variables.appointment_datetime = appointment.scheduledDate && appointment.scheduledTime
        ? `${formatDate(new Date(appointment.scheduledDate))} at ${formatTime12h(appointment.scheduledTime)}`
        : ''
      variables.appointment_type = appointment.serviceName || ''
      variables.appointment_notes = appointment.notes || ''

      // Get customer and vehicle from appointment if not set
      if (!context.customerId && appointment.customerId) {
        const customer = await loadCustomer(appointment.customerId)
        if (customer) {
          variables.customer_name = customer.name
          variables.customer_first_name = customer.name.split(' ')[0]
          variables.customer_phone = customer.phone || ''
          variables.customer_email = customer.email || ''
        }
      }
      if (!context.vehicleId && appointment.vehicleId) {
        const vehicle = await loadVehicle(appointment.vehicleId)
        if (vehicle) {
          variables.vehicle_plate = vehicle.licensePlate || ''
          variables.vehicle_make = vehicle.make || ''
          variables.vehicle_model = vehicle.model || ''
        }
      }
    }
  }

  // Load sale info
  if (context.saleId) {
    const sale = await loadSale(context.saleId)
    if (sale) {
      variables.invoice_no = sale.invoiceNo || ''
      variables.sale_total = formatCurrencyWithSymbol(parseFloat(sale.total || '0'), currency)
      variables.sale_subtotal = formatCurrencyWithSymbol(parseFloat(sale.subtotal || '0'), currency)
      variables.sale_tax = formatCurrencyWithSymbol(parseFloat(sale.taxAmount || '0'), currency)
      variables.sale_discount = formatCurrencyWithSymbol(parseFloat(sale.discountAmount || '0'), currency)
      variables.sale_date = sale.createdAt ? formatDate(sale.createdAt) : ''
      variables.payment_method = sale.paymentMethod || ''
      variables.amount_paid = formatCurrencyWithSymbol(parseFloat(sale.paidAmount || '0'), currency)
      variables.balance_due = formatCurrencyWithSymbol(
        parseFloat(sale.total || '0') - parseFloat(sale.paidAmount || '0'),
        currency
      )

      // Get customer from sale if not set
      if (!context.customerId && sale.customerId) {
        const customer = await loadCustomer(sale.customerId)
        if (customer) {
          variables.customer_name = customer.name
          variables.customer_first_name = customer.name.split(' ')[0]
          variables.customer_phone = customer.phone || ''
          variables.customer_email = customer.email || ''
        }
      }
    }
  }

  // Load estimate info
  if (context.estimateId) {
    const estimate = await loadEstimate(context.estimateId)
    if (estimate) {
      variables.estimate_no = estimate.estimateNo
      variables.estimate_status = formatStatus(estimate.status)
      variables.estimate_total = formatCurrencyWithSymbol(parseFloat(estimate.originalTotal || '0'), currency)
      variables.estimate_approved_amount = formatCurrencyWithSymbol(parseFloat(estimate.approvedTotal || '0'), currency)
      variables.claim_no = estimate.claimNumber || ''

      if (estimate.insuranceCompanyId) {
        const company = await loadInsuranceCompany(estimate.insuranceCompanyId)
        variables.insurance_company = company?.name || ''
      }

      // Get customer and vehicle from estimate if not set
      if (!context.customerId && estimate.customerId) {
        const customer = await loadCustomer(estimate.customerId)
        if (customer) {
          variables.customer_name = customer.name
          variables.customer_first_name = customer.name.split(' ')[0]
          variables.customer_phone = customer.phone || ''
          variables.customer_email = customer.email || ''
        }
      }
      if (!context.vehicleId && estimate.vehicleId) {
        const vehicle = await loadVehicle(estimate.vehicleId)
        if (vehicle) {
          variables.vehicle_plate = vehicle.licensePlate || ''
          variables.vehicle_make = vehicle.make || ''
          variables.vehicle_model = vehicle.model || ''
        }
      }
    }
  }

  return variables
}

// Database loaders (cached for single render)
async function loadTenant(id: string) {
  const [result] = await db.select().from(tenants).where(eq(tenants.id, id))
  return result
}

async function loadCustomer(id: string) {
  const [result] = await db.select().from(customers).where(eq(customers.id, id))
  return result
}

async function loadVehicle(id: string) {
  const [result] = await db.select().from(vehicles).where(eq(vehicles.id, id))
  return result
}

async function loadWorkOrder(id: string) {
  const [result] = await db.select().from(workOrders).where(eq(workOrders.id, id))
  return result
}

async function loadAppointment(id: string) {
  const [result] = await db.select().from(appointments).where(eq(appointments.id, id))
  return result
}

async function loadSale(id: string) {
  const [result] = await db.select().from(sales).where(eq(sales.id, id))
  return result
}

async function loadEstimate(id: string) {
  const [result] = await db.select().from(insuranceEstimates).where(eq(insuranceEstimates.id, id))
  return result
}

async function loadInsuranceCompany(id: string) {
  const [result] = await db.select().from(insuranceCompanies).where(eq(insuranceCompanies.id, id))
  return result
}

// Formatters
function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatTime12h(time: string): string {
  // Convert HH:mm to 12h format
  const [hours, minutes] = time.split(':').map(Number)
  const period = hours >= 12 ? 'PM' : 'AM'
  const hour12 = hours % 12 || 12
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Note: previewTemplate has been moved to ./preview.ts for client-side usage
// Import from '@/lib/notifications/templates/preview' for client components
