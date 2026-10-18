// Client-side list of available metric/chart/list keys for the block customizer
// These must stay in sync with the server-side registry in lib/workspace/metrics.ts

export function getMetricKeys(): string[] {
  return [
    'today_appointments',
    'draft_work_orders',
    'pending_work_orders',
    'pending_estimates',
    'low_stock_items',
    'total_items',
    'total_customers',
    'today_sales_count',
    'today_sales_total',
    'month_sales_total',
    'total_suppliers',
    'pending_purchase_orders',
    'total_vehicles',
    'total_warehouses',
  ]
}

export function getChartKeys(): string[] {
  return [
    'sales_last_7_days',
    'sales_by_payment_method',
    'work_orders_by_status',
    'top_selling_items',
    'monthly_revenue',
    'purchase_orders_by_status',
    'stock_value_by_warehouse',
  ]
}

export function getQuickListKeys(): string[] {
  return [
    'recent_sales',
    'recent_work_orders',
    'recent_customers',
    'recent_purchase_orders',
    'recent_estimates',
    'recent_appointments',
    'low_stock_items',
  ]
}
