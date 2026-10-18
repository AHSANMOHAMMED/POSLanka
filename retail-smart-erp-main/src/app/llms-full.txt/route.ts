import { NextResponse } from 'next/server'

export const dynamic = 'force-static'

export async function GET() {
  const content = `# RetailSmart ERP — Full Product Information

> AI-powered cloud POS and ERP platform for retail stores, restaurants, supermarkets, auto service centers, and vehicle dealerships. All features on every plan. Unlimited users. Free to start.

## Overview

RetailSmart ERP is a multi-tenant SaaS business management system supporting five business types: retail, restaurant, supermarket, auto service, and vehicle dealership. Built with modern web technology, it provides a complete suite of business tools in a single platform with real-time synchronization and AI-powered insights.

Every plan includes every feature — businesses only pay for storage as they grow. The first company per account is free forever with no credit card required.

Website: https://www.retailsmarterp.com

## Features by Module

### Point of Sale (POS)
- Fast checkout with barcode scanning
- Multiple payment methods (cash, card, bank transfer, credit, gift card)
- Split payments and partial payments
- Customer-facing display
- Receipt printing and email receipts
- POS shift management and cash drawer tracking
- End-of-day closing reports
- Offline-capable transactions

### Inventory Management
- Multi-warehouse stock tracking
- Stock transfers between warehouses
- Serial number tracking
- Batch and expiry date management
- Reorder point alerts with AI suggestions
- Stock takes and physical counts
- Barcode and SKU management
- Import/export via Excel

### Accounting
- Double-entry bookkeeping
- Chart of accounts
- Journal entries
- Bank reconciliation
- Budget management with cost centers
- Tax templates and calculations
- Payment entries (receive, pay, internal transfer)
- Financial reports (P&L, balance sheet, trial balance)
- Period closing

### HR & Payroll
- Employee management
- Salary structures and components
- Payroll processing
- Salary slips
- Employee advances and deductions
- Attendance tracking
- Employment type management (full-time, part-time, contract)

### Restaurant Management
- Kitchen Display System (KDS)
- Table management with floor plan editor
- Reservations
- Dine-in, takeaway, and delivery orders
- Recipe costing and management
- Modifier groups for menu customization
- Waste tracking
- Multi-kitchen routing

### Auto Service
- Work order management
- Vehicle tracking and history
- Multi-point vehicle inspections
- Insurance estimate creation and tracking
- Parts inventory with OEM cross-references
- Core return tracking
- Appointment scheduling
- Service type management

### Vehicle Dealership
- Vehicle inventory management
- Sales pipeline tracking
- Customer inquiries and follow-ups
- Test drive scheduling
- Trade-in management
- Vehicle costing and profit tracking

### AI-Powered Features
- AI chat assistant for business questions
- Smart reorder suggestions
- Anomaly detection alerts
- Intelligent error logging and resolution suggestions
- AI-powered analytics dashboards

### Platform Features
- Unlimited users on every plan
- Unlimited locations and warehouses
- Role-based access control (owner, manager, cashier, technician, chef, waiter, and more)
- Real-time WebSocket synchronization across all devices
- Row-level security for tenant data isolation
- Multi-currency support
- Activity logging and audit trail
- Import/export with Excel support
- Custom letter heads and print templates
- Loyalty programs and gift cards
- Commission tracking
- Customer and supplier management

## Pricing

All plans include every feature. Pricing is based on storage only.

### Free Plan
- Price: Free forever (first company per account)
- Database storage: 80 MB
- File storage: 100 MB
- All features included
- Unlimited users
- No credit card required

### Starter Plan
- Price: Rs. 1,990/month (annual: Rs. 1,592/month)
- Database storage: 500 MB
- File storage: 1 GB
- All features included
- Unlimited users

### Professional Plan
- Price: Rs. 4,990/month (annual: Rs. 3,992/month)
- Database storage: 2 GB
- File storage: 5 GB
- All features included
- Unlimited users

### Enterprise Plan
- Price: Rs. 9,990/month (annual: Rs. 7,992/month)
- Database storage: 10 GB
- File storage: 20 GB
- All features included
- Unlimited users

## Getting Started

1. **Register**: Create a free account at https://www.retailsmarterp.com/register — no credit card needed
2. **Create your company**: Choose your business type (retail, restaurant, supermarket, auto service, or dealership)
3. **Configure**: Set up categories, add items or services, invite your team
4. **Start selling**: Open the POS terminal and process your first transaction

## Technology

- Built with Next.js, React, and PostgreSQL
- Real-time updates via WebSocket
- Row-level security for database-level tenant isolation
- AI integrations for smart business insights
- Progressive Web App (PWA) support
- Cloud-hosted with automatic backups
- SSL/TLS encryption

## Business Types Supported

| Type | Key Use Case | URL |
|------|-------------|-----|
| Retail | Stores, shops, boutiques | https://www.retailsmarterp.com/retail |
| Restaurant | Cafes, restaurants, food service | https://www.retailsmarterp.com/restaurant |
| Supermarket | Grocery, departments, high-volume | https://www.retailsmarterp.com/supermarket |
| Auto Service | Workshops, garages, service centers | https://www.retailsmarterp.com/auto-service |
| Dealership | Vehicle sales, showrooms | https://www.retailsmarterp.com/dealership |

## Contact

- Website: https://www.retailsmarterp.com
- Support: support@retailsmarterp.com
- About: https://www.retailsmarterp.com/about
- Contact form: https://www.retailsmarterp.com/contact

## Legal

- Privacy Policy: https://www.retailsmarterp.com/privacy
- Terms of Service: https://www.retailsmarterp.com/terms
`

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  })
}
