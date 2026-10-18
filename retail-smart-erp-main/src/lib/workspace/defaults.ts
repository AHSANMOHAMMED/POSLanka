// Default workspace block configurations for each module
// These are used when a user hasn't customized their workspace yet

import type { WorkspaceConfig, WorkspaceBlock } from './types'

// Business-type-aware dashboard defaults
function getDashboardBlocks(businessType?: string): WorkspaceBlock[] {
  const isAutoService = businessType === 'auto_service'
  const isDealership = businessType === 'dealership'

  const numberCards: WorkspaceBlock[] = []
  if (isAutoService) {
    numberCards.push(
      { id: 'nc1', type: 'number_card', colSpan: 3, data: { label: "Today's Appointments", metricKey: 'today_appointments', color: 'blue', href: '/appointments', icon: 'Calendar' } },
      { id: 'nc2', type: 'number_card', colSpan: 3, data: { label: 'Draft Work Orders', metricKey: 'draft_work_orders', color: 'amber', href: '/work-orders?status=draft', icon: 'Clock' } },
      { id: 'nc3', type: 'number_card', colSpan: 3, data: { label: 'Pending Estimates', metricKey: 'pending_estimates', color: 'purple', href: '/insurance-estimates', icon: 'FileText' } },
      { id: 'nc4', type: 'number_card', colSpan: 3, data: { label: 'Low Stock Items', metricKey: 'low_stock_items', color: 'red', href: '/items?filter=low-stock', icon: 'AlertTriangle' } },
    )
  } else if (isDealership) {
    numberCards.push(
      { id: 'nc1', type: 'number_card', colSpan: 3, data: { label: 'Vehicle Inventory', metricKey: 'total_items', color: 'blue', href: '/items', icon: 'Car' } },
      { id: 'nc2', type: 'number_card', colSpan: 3, data: { label: 'Active Work Orders', metricKey: 'pending_work_orders', color: 'emerald', href: '/work-orders', icon: 'Wrench' } },
      { id: 'nc3', type: 'number_card', colSpan: 3, data: { label: 'This Month Sales', metricKey: 'month_sales_total', color: 'purple', href: '/sales', icon: 'TrendingUp' } },
      { id: 'nc4', type: 'number_card', colSpan: 3, data: { label: "Today's Appointments", metricKey: 'today_appointments', color: 'amber', href: '/appointments', icon: 'Calendar' } },
    )
  } else {
    numberCards.push(
      { id: 'nc1', type: 'number_card', colSpan: 3, data: { label: "Today's Sales", metricKey: 'today_sales_count', color: 'blue', href: '/sales', icon: 'ShoppingCart' } },
      { id: 'nc2', type: 'number_card', colSpan: 3, data: { label: 'Total Customers', metricKey: 'total_customers', color: 'green', href: '/customers', icon: 'Users' } },
      { id: 'nc3', type: 'number_card', colSpan: 3, data: { label: 'Total Items', metricKey: 'total_items', color: 'purple', href: '/items', icon: 'Package' } },
      { id: 'nc4', type: 'number_card', colSpan: 3, data: { label: 'Low Stock Items', metricKey: 'low_stock_items', color: 'red', href: '/items?filter=low-stock', icon: 'AlertTriangle' } },
    )
  }

  const shortcuts: WorkspaceBlock[] = [{
    id: 's1', type: 'shortcut', colSpan: 12, data: {
      shortcuts: [
        ...(isAutoService ? [
          { label: 'Point of Sale', href: '/pos', icon: 'ShoppingCart' },
          { label: 'Work Orders', href: '/work-orders', icon: 'Wrench' },
          { label: 'Appointments', href: '/appointments', icon: 'Calendar' },
        ] : isDealership ? [
          { label: 'Parts Counter', href: '/pos', icon: 'ShoppingCart' },
          { label: 'Vehicle Sales', href: '/dealership/sales', icon: 'Car' },
          { label: 'Work Orders', href: '/work-orders', icon: 'Wrench' },
          { label: 'Appointments', href: '/appointments', icon: 'Calendar' },
        ] : [
          { label: 'Point of Sale', href: '/pos', icon: 'ShoppingCart' },
        ]),
        { label: 'Items', href: '/items', icon: 'Package' },
        { label: 'Customers', href: '/customers', icon: 'Users' },
        { label: 'Sales History', href: '/sales', icon: 'Receipt' },
        { label: 'Print Barcode', href: '/barcode/print', icon: 'Barcode' },
      ],
    },
  }]

  const isServiceCapableBt = isAutoService || isDealership

  const charts: WorkspaceBlock[] = [
    { id: 'ch1', type: 'chart', colSpan: 8, data: { title: isDealership ? 'Vehicle Sales - Last 7 Days' : 'Sales - Last 7 Days', chartKey: 'sales_last_7_days', chartType: 'bar', color: isDealership ? 'cyan' : 'blue' } },
    ...(isServiceCapableBt
      ? [{ id: 'ch2', type: 'chart', colSpan: 4, data: { title: 'Work Orders by Status', chartKey: 'work_orders_by_status', chartType: 'doughnut' as const } } as WorkspaceBlock]
      : [{ id: 'ch2', type: 'chart', colSpan: 4, data: { title: 'Payment Methods', chartKey: 'sales_by_payment_method', chartType: 'pie' as const } } as WorkspaceBlock]
    ),
  ]

  const quickLists: WorkspaceBlock[] = [
    { id: 'ql1', type: 'quick_list', colSpan: 6, data: { title: isDealership ? 'Recent Vehicle Sales' : 'Recent Sales', listKey: 'recent_sales', limit: 5, href: '/sales' } },
    ...(isServiceCapableBt
      ? [{ id: 'ql2', type: 'quick_list', colSpan: 6, data: { title: 'Recent Work Orders', listKey: 'recent_work_orders', limit: 5, href: '/work-orders' } } as WorkspaceBlock]
      : [{ id: 'ql2', type: 'quick_list', colSpan: 6, data: { title: 'Recent Customers', listKey: 'recent_customers', limit: 5, href: '/customers' } } as WorkspaceBlock]
    ),
  ]

  return [...numberCards, ...shortcuts, ...charts, ...quickLists]
}

// Business-type-aware selling defaults
function getSellingBlocks(businessType?: string): WorkspaceBlock[] {
  const isAutoService = businessType === 'auto_service'
  const isDealership = businessType === 'dealership'
  const isRestaurant = businessType === 'restaurant'

  // Number cards
  const numberCards: WorkspaceBlock[] = []
  if (isAutoService) {
    numberCards.push(
      { id: 'nc1', type: 'number_card', colSpan: 3, data: { label: "Today's Sales", metricKey: 'today_sales_count', color: 'green', href: '/sales', icon: 'Receipt' } },
      { id: 'nc2', type: 'number_card', colSpan: 3, data: { label: "Today's Revenue", metricKey: 'today_sales_total', color: 'blue', href: '/sales', icon: 'DollarSign', prefix: 'Rs' } },
      { id: 'nc3', type: 'number_card', colSpan: 3, data: { label: 'Active Work Orders', metricKey: 'pending_work_orders', color: 'emerald', href: '/work-orders', icon: 'Wrench' } },
      { id: 'nc4', type: 'number_card', colSpan: 3, data: { label: "Today's Appointments", metricKey: 'today_appointments', color: 'amber', href: '/appointments', icon: 'Calendar' } },
    )
  } else if (isDealership) {
    numberCards.push(
      { id: 'nc1', type: 'number_card', colSpan: 3, data: { label: "Today's Sales", metricKey: 'today_sales_count', color: 'green', href: '/sales', icon: 'Receipt' } },
      { id: 'nc2', type: 'number_card', colSpan: 3, data: { label: 'Vehicle Sales (Month)', metricKey: 'month_sales_total', color: 'blue', href: '/dealership/sales', icon: 'Car', prefix: 'Rs' } },
      { id: 'nc3', type: 'number_card', colSpan: 3, data: { label: 'Active Work Orders', metricKey: 'pending_work_orders', color: 'emerald', href: '/work-orders', icon: 'Wrench' } },
      { id: 'nc4', type: 'number_card', colSpan: 3, data: { label: "Today's Appointments", metricKey: 'today_appointments', color: 'amber', href: '/appointments', icon: 'Calendar' } },
    )
  } else if (isRestaurant) {
    numberCards.push(
      { id: 'nc1', type: 'number_card', colSpan: 3, data: { label: "Today's Sales", metricKey: 'today_sales_count', color: 'green', href: '/sales', icon: 'Receipt' } },
      { id: 'nc2', type: 'number_card', colSpan: 3, data: { label: "Today's Revenue", metricKey: 'today_sales_total', color: 'blue', href: '/sales', icon: 'DollarSign', prefix: 'Rs' } },
      { id: 'nc3', type: 'number_card', colSpan: 3, data: { label: 'Active Orders', metricKey: 'active_restaurant_orders', color: 'emerald', href: '/restaurant/orders', icon: 'ClipboardList' } },
      { id: 'nc4', type: 'number_card', colSpan: 3, data: { label: 'Reservations Today', metricKey: 'today_reservations', color: 'amber', href: '/restaurant/reservations', icon: 'CalendarCheck' } },
    )
  } else {
    // retail / supermarket (default)
    numberCards.push(
      { id: 'nc1', type: 'number_card', colSpan: 3, data: { label: "Today's Sales", metricKey: 'today_sales_count', color: 'green', href: '/sales', icon: 'Receipt' } },
      { id: 'nc2', type: 'number_card', colSpan: 3, data: { label: "Today's Revenue", metricKey: 'today_sales_total', color: 'blue', href: '/sales', icon: 'DollarSign', prefix: 'Rs' } },
      { id: 'nc3', type: 'number_card', colSpan: 3, data: { label: 'Month Revenue', metricKey: 'month_sales_total', color: 'purple', href: '/sales', icon: 'TrendingUp', prefix: 'Rs' } },
      { id: 'nc4', type: 'number_card', colSpan: 3, data: { label: 'Total Customers', metricKey: 'total_customers', color: 'amber', href: '/customers', icon: 'Users' } },
    )
  }

  // Shortcuts
  const shortcuts: WorkspaceBlock[] = [{
    id: 's1', type: 'shortcut', colSpan: 12, data: {
      shortcuts: isAutoService ? [
        { label: 'Point of Sale', href: '/pos', icon: 'ShoppingCart' },
        { label: 'Work Orders', href: '/work-orders', icon: 'Wrench' },
        { label: 'Appointments', href: '/appointments', icon: 'Calendar' },
        { label: 'Sales History', href: '/sales', icon: 'Receipt' },
        { label: 'Customers', href: '/customers', icon: 'Users' },
      ] : isDealership ? [
        { label: 'Parts Counter', href: '/pos', icon: 'ShoppingCart' },
        { label: 'Vehicle Sales', href: '/dealership/sales', icon: 'Car' },
        { label: 'Work Orders', href: '/work-orders', icon: 'Wrench' },
        { label: 'Sales History', href: '/sales', icon: 'Receipt' },
        { label: 'Customers', href: '/customers', icon: 'Users' },
      ] : isRestaurant ? [
        { label: 'Point of Sale', href: '/pos', icon: 'ShoppingCart' },
        { label: 'Orders', href: '/restaurant/orders', icon: 'ClipboardList' },
        { label: 'Kitchen Display', href: '/restaurant/kitchen', icon: 'UtensilsCrossed' },
        { label: 'Deliveries', href: '/restaurant/deliveries', icon: 'Truck' },
        { label: 'Customers', href: '/customers', icon: 'Users' },
      ] : [
        { label: 'Point of Sale', href: '/pos', icon: 'ShoppingCart' },
        { label: 'Sales History', href: '/sales', icon: 'Receipt' },
        { label: 'Customers', href: '/customers', icon: 'Users' },
        { label: 'POS Profiles', href: '/settings/pos-profiles', icon: 'Monitor' },
        { label: 'Loyalty', href: '/settings/loyalty', icon: 'Star' },
      ],
    },
  }]

  // Charts
  const isServiceCapableBt = isAutoService || isDealership
  const charts: WorkspaceBlock[] = [
    { id: 'ch1', type: 'chart', colSpan: 8, data: { title: 'Sales - Last 7 Days', chartKey: 'sales_last_7_days', chartType: 'bar', color: 'green' } },
    ...(isServiceCapableBt
      ? [{ id: 'ch2', type: 'chart', colSpan: 4, data: { title: 'Work Orders by Status', chartKey: 'work_orders_by_status', chartType: 'doughnut' as const } } as WorkspaceBlock]
      : [{ id: 'ch2', type: 'chart', colSpan: 4, data: { title: 'Payment Methods', chartKey: 'sales_by_payment_method', chartType: 'pie' as const } } as WorkspaceBlock]
    ),
  ]

  // Quick lists
  const quickLists: WorkspaceBlock[] = [
    ...(isDealership
      ? [{ id: 'ql1', type: 'quick_list', colSpan: 6, data: { title: 'Recent Vehicle Sales', listKey: 'recent_sales', limit: 5, href: '/dealership/sales' } } as WorkspaceBlock]
      : [{ id: 'ql1', type: 'quick_list', colSpan: 6, data: { title: 'Recent Sales', listKey: 'recent_sales', limit: 5, href: '/sales' } } as WorkspaceBlock]
    ),
    ...(isAutoService
      ? [{ id: 'ql2', type: 'quick_list', colSpan: 6, data: { title: 'Recent Work Orders', listKey: 'recent_work_orders', limit: 5, href: '/work-orders' } } as WorkspaceBlock]
      : isDealership
      ? [{ id: 'ql2', type: 'quick_list', colSpan: 6, data: { title: 'Recent Work Orders', listKey: 'recent_work_orders', limit: 5, href: '/work-orders' } } as WorkspaceBlock]
      : isRestaurant
      ? [{ id: 'ql2', type: 'quick_list', colSpan: 6, data: { title: 'Recent Orders', listKey: 'recent_restaurant_orders', limit: 5, href: '/restaurant/orders' } } as WorkspaceBlock]
      : [{ id: 'ql2', type: 'quick_list', colSpan: 6, data: { title: 'Recent Customers', listKey: 'recent_customers', limit: 5, href: '/customers' } } as WorkspaceBlock]
    ),
  ]

  // Card links
  const cardLinks: WorkspaceBlock[] = isAutoService ? [
    { id: 'c1', type: 'card', colSpan: 6, data: { title: 'Masters', links: [
      { label: 'Customer', href: '/customers' },
      { label: 'Sale', href: '/sales' },
      { label: 'Work Order', href: '/work-orders' },
      { label: 'Insurance Estimate', href: '/insurance-estimates' },
    ] } },
    { id: 'c2', type: 'card', colSpan: 6, data: { title: 'Transactions', links: [
      { label: 'Point of Sale', href: '/pos' },
      { label: 'Sales History', href: '/sales' },
      { label: 'Work Orders', href: '/work-orders' },
    ] } },
  ] : isDealership ? [
    { id: 'c1', type: 'card', colSpan: 6, data: { title: 'Masters', links: [
      { label: 'Customer', href: '/customers' },
      { label: 'Sale', href: '/sales' },
      { label: 'Vehicle Sale', href: '/dealership/sales' },
    ] } },
    { id: 'c2', type: 'card', colSpan: 6, data: { title: 'Transactions', links: [
      { label: 'Parts Counter', href: '/pos' },
      { label: 'Sales History', href: '/sales' },
      { label: 'Vehicle Sales', href: '/dealership/sales' },
    ] } },
  ] : isRestaurant ? [
    { id: 'c1', type: 'card', colSpan: 6, data: { title: 'Masters', links: [
      { label: 'Customer', href: '/customers' },
      { label: 'Sale', href: '/sales' },
      { label: 'Order', href: '/restaurant/orders' },
    ] } },
    { id: 'c2', type: 'card', colSpan: 6, data: { title: 'Transactions', links: [
      { label: 'Point of Sale', href: '/pos' },
      { label: 'Sales History', href: '/sales' },
      { label: 'Orders', href: '/restaurant/orders' },
      { label: 'Deliveries', href: '/restaurant/deliveries' },
    ] } },
  ] : [
    { id: 'c1', type: 'card', colSpan: 6, data: { title: 'Masters', links: [
      { label: 'Customer', href: '/customers' },
      { label: 'Sale', href: '/sales' },
      { label: 'POS Profile', href: '/settings/pos-profiles' },
      { label: 'Loyalty Program', href: '/settings/loyalty' },
    ] } },
    { id: 'c2', type: 'card', colSpan: 6, data: { title: 'Transactions', links: [
      { label: 'Point of Sale', href: '/pos' },
      { label: 'Sales History', href: '/sales' },
    ] } },
  ]

  return [...numberCards, ...shortcuts, ...charts, ...quickLists, ...cardLinks]
}

// Business-type-aware reports workspace defaults
function getReportsBlocks(businessType?: string): WorkspaceBlock[] {
  const isAutoService = businessType === 'auto_service'
  const isDealership = businessType === 'dealership'
  const isRestaurant = businessType === 'restaurant'
  const isSupermarket = businessType === 'supermarket'

  // Top shortcuts - most used reports
  const shortcuts: WorkspaceBlock[] = [
    { id: 's1', type: 'shortcut', colSpan: 12, data: { shortcuts: [
      { label: 'Sales Summary', href: '/accounting/reports/sales-summary', icon: 'BarChart3', color: 'blue' },
      { label: 'Profit & Loss', href: '/accounting/reports/profit-and-loss', icon: 'TrendingUp', color: 'green' },
      { label: 'Stock Balance', href: '/accounting/reports/stock-balance', icon: 'Boxes', color: 'purple' },
      { label: 'Daily Sales', href: '/accounting/reports/daily-sales', icon: 'CalendarDays', color: 'amber' },
      { label: 'Activity Log', href: '/activity-log', icon: 'Activity', color: 'slate' },
    ] } },
  ]

  // Financial Reports card
  const cards: WorkspaceBlock[] = [
    { id: 'c1', type: 'card', colSpan: 6, data: { title: 'Financial Reports', links: [
      { label: 'Trial Balance', href: '/accounting/reports/trial-balance' },
      { label: 'Profit & Loss', href: '/accounting/reports/profit-and-loss' },
      { label: 'Balance Sheet', href: '/accounting/reports/balance-sheet' },
      { label: 'Cash Flow', href: '/accounting/reports/cash-flow' },
      { label: 'General Ledger', href: '/accounting/reports/general-ledger' },
      { label: 'Day Book', href: '/accounting/reports/day-book' },
      { label: 'Expense Report', href: '/accounting/reports/expense-report' },
      { label: 'Accounts Receivable', href: '/accounting/reports/accounts-receivable' },
      { label: 'Accounts Payable', href: '/accounting/reports/accounts-payable' },
    ] } },
    { id: 'c2', type: 'card', colSpan: 6, data: { title: 'Sales Reports', links: [
      { label: 'Sales Summary', href: '/accounting/reports/sales-summary' },
      { label: 'Sales by Item', href: '/accounting/reports/sales-by-item' },
      { label: 'Sales by Customer', href: '/accounting/reports/sales-by-customer' },
      { label: 'Daily Sales', href: '/accounting/reports/daily-sales' },
      { label: 'Payment Collection', href: '/accounting/reports/payment-collection' },
      { label: 'Tax Report', href: '/accounting/reports/tax-report' },
    ] } },
    { id: 'c3', type: 'card', colSpan: 6, data: { title: 'Inventory Reports', links: [
      { label: 'Stock Balance', href: '/accounting/reports/stock-balance' },
      { label: 'Stock Movement', href: '/accounting/reports/stock-movement' },
      { label: 'Purchase Summary', href: '/accounting/reports/purchase-summary' },
      { label: 'Purchase by Supplier', href: '/accounting/reports/purchase-by-supplier' },
      { label: 'Item Profitability', href: '/accounting/reports/item-profitability' },
      { label: 'Shrinkage Report', href: '/accounting/reports/shrinkage-report' },
      { label: 'Margin Analysis', href: '/accounting/reports/margin-analysis' },
    ] } },
    { id: 'c4', type: 'card', colSpan: 6, data: { title: 'Other', links: [
      { label: 'Activity Log', href: '/activity-log' },
      { label: 'Saved Reports', href: '/accounting/reports/saved' },
      { label: 'Aged Payables', href: '/reports/aged-payables' },
      { label: 'Supplier Performance', href: '/reports/supplier-performance' },
    ] } },
  ]

  // Business-type-specific report cards
  if (isAutoService || isDealership) {
    cards.push({ id: 'c5', type: 'card', colSpan: 6, data: { title: 'Auto Service Reports', links: [
      { label: 'Service Revenue', href: '/accounting/reports/service-revenue' },
      { label: 'Technician Performance', href: '/accounting/reports/technician-performance' },
      { label: 'Job Card Profitability', href: '/accounting/reports/job-card-profitability' },
      { label: 'Parts Usage', href: '/accounting/reports/parts-usage' },
      { label: 'Warranty Tracker', href: '/accounting/reports/warranty-tracker' },
    ] } })
  }
  if (isRestaurant) {
    cards.push({ id: 'c5', type: 'card', colSpan: 6, data: { title: 'Restaurant Reports', links: [
      { label: 'Table Turnover', href: '/accounting/reports/table-turnover' },
      { label: 'Menu Performance', href: '/accounting/reports/menu-performance' },
      { label: 'Food Cost Analysis', href: '/accounting/reports/food-cost-analysis' },
      { label: 'Waste Analysis', href: '/accounting/reports/waste-analysis' },
      { label: 'Peak Hours', href: '/accounting/reports/peak-hours' },
    ] } })
  }
  if (isDealership) {
    cards.push({ id: 'c6', type: 'card', colSpan: 6, data: { title: 'Dealership Reports', links: [
      { label: 'Vehicle Aging', href: '/accounting/reports/vehicle-aging' },
      { label: 'Sales Pipeline', href: '/accounting/reports/sales-pipeline' },
    ] } })
  }
  if (isSupermarket) {
    cards.push({ id: 'c5', type: 'card', colSpan: 6, data: { title: 'Supermarket Reports', links: [
      { label: 'Category Sales', href: '/accounting/reports/category-sales' },
      { label: 'Item Velocity', href: '/accounting/reports/item-velocity' },
    ] } })
  }

  return [...shortcuts, ...cards]
}

export const DEFAULT_WORKSPACES: Record<string, WorkspaceConfig> = {
  dashboard: {
    key: 'dashboard',
    title: 'Dashboard',
    description: 'Quick access to all modules',
    icon: 'LayoutDashboard',
    colorScheme: 'blue',
    blocks: getDashboardBlocks('auto_service'), // Will be overridden at runtime
  },

  stock: {
    key: 'stock',
    title: 'Stock',
    description: 'Manage your inventory, items, categories, and warehouses',
    icon: 'Package',
    colorScheme: 'violet',
    blocks: [
      { id: 'nc1', type: 'number_card', colSpan: 4, data: { label: 'Total Items', metricKey: 'total_items', color: 'violet', href: '/items', icon: 'Package' } },
      { id: 'nc2', type: 'number_card', colSpan: 4, data: { label: 'Low Stock', metricKey: 'low_stock_items', color: 'red', href: '/items?filter=low-stock', icon: 'AlertTriangle' } },
      { id: 'nc3', type: 'number_card', colSpan: 4, data: { label: 'Warehouses', metricKey: 'total_warehouses', color: 'blue', href: '/settings/warehouses', icon: 'Warehouse' } },

      { id: 's1', type: 'shortcut', colSpan: 12, data: { shortcuts: [
        { label: 'Items', href: '/items', icon: 'Package' },
        { label: 'Categories', href: '/categories', icon: 'FolderTree' },
        { label: 'Warehouses', href: '/settings/warehouses', icon: 'Warehouse' },
        { label: 'Stock Transfers', href: '/stock-transfers', icon: 'ArrowRightLeft' },
        { label: 'Low Stock', href: '/items?filter=low-stock', icon: 'AlertTriangle', countMetricKey: 'low_stock_items' },
      ] } },

      { id: 'ch1', type: 'chart', colSpan: 6, data: { title: 'Stock Value by Warehouse', chartKey: 'stock_value_by_warehouse', chartType: 'bar', color: 'violet' } },
      { id: 'ql1', type: 'quick_list', colSpan: 6, data: { title: 'Low Stock Items', listKey: 'low_stock_items', limit: 5, href: '/items?filter=low-stock' } },

      { id: 'c1', type: 'card', colSpan: 6, data: { title: 'Masters', links: [
        { label: 'Item', href: '/items' },
        { label: 'Item Category', href: '/categories' },
        { label: 'Warehouse', href: '/settings/warehouses' },
        { label: 'Stock Transfer', href: '/stock-transfers' },
      ] } },
      { id: 'c2', type: 'card', colSpan: 6, data: { title: 'Reports', links: [
        { label: 'Low Stock Items', href: '/items?filter=low-stock' },
      ] } },
    ],
  },

  selling: {
    key: 'selling',
    title: 'Selling',
    description: 'Point of sale, sales history, and customer management',
    icon: 'ShoppingCart',
    colorScheme: 'green',
    blocks: getSellingBlocks(), // Will be overridden at runtime with businessType
  },

  buying: {
    key: 'buying',
    title: 'Buying',
    description: 'Manage suppliers, purchase orders, and purchase invoices',
    icon: 'Truck',
    colorScheme: 'amber',
    blocks: [
      { id: 'nc1', type: 'number_card', colSpan: 4, data: { label: 'Total Suppliers', metricKey: 'total_suppliers', color: 'amber', href: '/suppliers', icon: 'Truck' } },
      { id: 'nc2', type: 'number_card', colSpan: 4, data: { label: 'Pending POs', metricKey: 'pending_purchase_orders', color: 'blue', href: '/purchase-orders', icon: 'ClipboardList' } },
      { id: 'nc3', type: 'number_card', colSpan: 4, data: { label: 'Total Items', metricKey: 'total_items', color: 'violet', href: '/items', icon: 'Package' } },

      { id: 's1', type: 'shortcut', colSpan: 12, data: { shortcuts: [
        { label: 'Suppliers', href: '/suppliers', icon: 'Truck' },
        { label: 'Purchase Orders', href: '/purchase-orders', icon: 'ClipboardList' },
        { label: 'Purchase Invoices', href: '/purchases', icon: 'CreditCard' },
      ] } },

      { id: 'ch1', type: 'chart', colSpan: 6, data: { title: 'Purchase Orders by Status', chartKey: 'purchase_orders_by_status', chartType: 'doughnut' } },
      { id: 'ql1', type: 'quick_list', colSpan: 6, data: { title: 'Recent Purchase Orders', listKey: 'recent_purchase_orders', limit: 5, href: '/purchase-orders' } },

      { id: 'c1', type: 'card', colSpan: 6, data: { title: 'Masters', links: [
        { label: 'Supplier', href: '/suppliers' },
        { label: 'Purchase Order', href: '/purchase-orders' },
        { label: 'Purchase Invoice', href: '/purchases' },
      ] } },
      { id: 'c2', type: 'card', colSpan: 6, data: { title: 'Transactions', links: [
        { label: 'Purchase Orders', href: '/purchase-orders' },
        { label: 'Purchase Invoices', href: '/purchases' },
      ] } },
    ],
  },

  'auto-service': {
    key: 'auto-service',
    title: 'Auto Service',
    description: 'Work orders, estimates, appointments, and vehicle management',
    icon: 'Wrench',
    colorScheme: 'emerald',
    blocks: [
      { id: 'nc1', type: 'number_card', colSpan: 3, data: { label: "Today's Appointments", metricKey: 'today_appointments', color: 'blue', href: '/appointments', icon: 'Calendar' } },
      { id: 'nc2', type: 'number_card', colSpan: 3, data: { label: 'Active Work Orders', metricKey: 'pending_work_orders', color: 'emerald', href: '/work-orders', icon: 'Wrench' } },
      { id: 'nc3', type: 'number_card', colSpan: 3, data: { label: 'Pending Estimates', metricKey: 'pending_estimates', color: 'purple', href: '/insurance-estimates', icon: 'FileText' } },
      { id: 'nc4', type: 'number_card', colSpan: 3, data: { label: 'Total Vehicles', metricKey: 'total_vehicles', color: 'amber', href: '/vehicles', icon: 'Car' } },

      { id: 's1', type: 'shortcut', colSpan: 12, data: { shortcuts: [
        { label: 'Work Orders', href: '/work-orders', icon: 'Wrench' },
        { label: 'Estimates', href: '/insurance-estimates', icon: 'FileText' },
        { label: 'Appointments', href: '/appointments', icon: 'Calendar' },
        { label: 'Vehicles', href: '/vehicles', icon: 'Car' },
        { label: 'Service Types', href: '/service-types', icon: 'Settings2' },
        { label: 'Insurance', href: '/insurance-companies', icon: 'Building2' },
      ] } },

      { id: 'ch1', type: 'chart', colSpan: 6, data: { title: 'Work Orders by Status', chartKey: 'work_orders_by_status', chartType: 'doughnut' } },
      { id: 'ql1', type: 'quick_list', colSpan: 6, data: { title: 'Recent Work Orders', listKey: 'recent_work_orders', limit: 5, href: '/work-orders' } },

      { id: 'ql2', type: 'quick_list', colSpan: 6, data: { title: 'Upcoming Appointments', listKey: 'recent_appointments', limit: 5, href: '/appointments' } },
      { id: 'ql3', type: 'quick_list', colSpan: 6, data: { title: 'Recent Estimates', listKey: 'recent_estimates', limit: 5, href: '/insurance-estimates' } },

      { id: 'c1', type: 'card', colSpan: 6, data: { title: 'Masters', links: [
        { label: 'Work Order', href: '/work-orders' },
        { label: 'Insurance Estimate', href: '/insurance-estimates' },
        { label: 'Appointment', href: '/appointments' },
        { label: 'Vehicle', href: '/vehicles' },
        { label: 'Service Type', href: '/service-types' },
        { label: 'Insurance Company', href: '/insurance-companies' },
      ] } },
      { id: 'c2', type: 'card', colSpan: 6, data: { title: 'Reports', links: [
        { label: 'Draft Work Orders', href: '/work-orders?status=draft' },
        { label: 'Pending Estimates', href: '/insurance-estimates?status=pending' },
      ] } },
    ],
  },

  reports: {
    key: 'reports',
    title: 'Reports',
    description: 'Activity logs, reports, and business analytics',
    icon: 'BarChart3',
    colorScheme: 'indigo',
    blocks: [], // Populated by getReportsBlocks()
  },

  settings: {
    key: 'settings',
    title: 'Settings',
    description: 'Configure your business settings and preferences',
    icon: 'Settings',
    colorScheme: 'slate',
    blocks: [
      { id: 's1', type: 'shortcut', colSpan: 12, data: { shortcuts: [
        { label: 'Staff', href: '/settings/staff', icon: 'Users' },
        { label: 'Notifications', href: '/settings/notifications', icon: 'Bell' },
        { label: 'File Manager', href: '/settings/files', icon: 'FolderTree' },
      ] } },
      { id: 'sc1', type: 'settings_content', colSpan: 12, data: { section: 'business_type' } },
      { id: 'sc2', type: 'settings_content', colSpan: 12, data: { section: 'service_config' } },
      { id: 'sc3', type: 'settings_content', colSpan: 12, data: { section: 'staff' } },
      { id: 'sc4', type: 'settings_content', colSpan: 12, data: { section: 'account_info' } },
      { id: 'sc5', type: 'settings_content', colSpan: 12, data: { section: 'subscription' } },
      { id: 'sc6', type: 'settings_content', colSpan: 12, data: { section: 'print_settings' } },
      { id: 'sc7', type: 'settings_content', colSpan: 12, data: { section: 'session' } },
    ],
  },
}

/**
 * Get workspace config with business-type-aware defaults
 */
export function getDefaultWorkspace(key: string, businessType?: string): WorkspaceConfig | null {
  const config = DEFAULT_WORKSPACES[key]
  if (!config) return null

  // Dashboard, Selling, and Reports have business-type-specific blocks
  if (key === 'dashboard') {
    return { ...config, blocks: getDashboardBlocks(businessType) }
  }
  if (key === 'selling') {
    return { ...config, blocks: getSellingBlocks(businessType) }
  }
  if (key === 'reports') {
    return { ...config, blocks: getReportsBlocks(businessType) }
  }

  return config
}
