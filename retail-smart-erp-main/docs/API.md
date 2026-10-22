# POSLanka public API (v1)

Base URL: `https://<your-domain>/api/v1` · JSON over HTTPS · UTF-8.

The API lets other systems (web shop, accounting, BI, delivery apps) read the catalogue, stock,
customers and sales of **one company** and record sales. Everything runs through the same
business logic as the POS (tax, stock, accounting postings, numbering), and every request is
isolated to the company that owns the key (PostgreSQL row level security).

## Authentication

Create a key in **Settings → API Keys** (owner or manager). The full key is shown **once**:

```
plk_AbCdEfGh1234_9xQ...43 characters...
```

Send it on every request, either header works:

```
Authorization: Bearer plk_AbCdEfGh1234_...
X-API-Key: plk_AbCdEfGh1234_...
```

- POSLanka stores only a SHA-256 hash of the key; a lost key cannot be recovered — revoke it and create a new one.
- A key **acts as the user who created it** (shown as "<name> (API: <key name>)" in audit trails).
  It stops working immediately when it is revoked, when it expires, when that user is deactivated
  or is no longer an owner / manager, or when the company is suspended.
- Keys are limited to the **scopes** chosen at creation:

| Scope | Allows |
|---|---|
| `items:read` | `GET /items`, `GET /items/{id}` |
| `stock:read` | `GET /stock` |
| `customers:read` | `GET /customers` |
| `customers:write` | `POST /customers` |
| `sales:read` | `GET /sales`, `GET /sales/{id}` |
| `sales:write` | `POST /sales` |

## Rate limits

120 requests per minute per key (server setting `API_KEY_RATE_LIMIT_PER_MIN`). Every response
carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (seconds). Over the
limit → `429` with `Retry-After`. Repeated failed authentications from one IP (20 in 5 minutes)
are also answered with `429`.

## Errors

```json
{ "error": "Human readable message", "code": "MACHINE_CODE", "details": [ ... ] }
```

| Status | Typical `code` |
|---|---|
| 400 | `VALIDATION_ERROR`, `IDEMPOTENCY_KEY_REQUIRED`, `TOTAL_MISMATCH`, … (sale validation codes from the POS) |
| 401 | `MISSING_API_KEY`, `INVALID_API_KEY`, `API_KEY_REVOKED`, `API_KEY_EXPIRED`, `API_KEY_OWNER_INACTIVE` |
| 403 | `INSUFFICIENT_SCOPE`, `TENANT_INACTIVE` |
| 404 | `NOT_FOUND` |
| 409 | `IDEMPOTENCY_CONFLICT` |
| 429 | `RATE_LIMITED` |

## Conventions

- Lists: `?page=1&pageSize=50` (max 100; `/stock` max 500) →
  `{ "data": [...], "pagination": { "page", "pageSize", "total", "totalPages" } }`.
- Single objects: `{ "data": { ... } }`.
- Money and quantities are **strings** with the stored precision (`"400.00"`, `"12.000"`).
- Timestamps are ISO 8601 UTC. Filters taking a date accept ISO dates/timestamps.
- Cost / valuation prices are never exposed through the API.

## Endpoints

### `GET /items`

Query: `search` (name, code, SKU, barcode), `barcode` (exact), `categoryId`, `updatedSince`,
`includeInactive=true`, `page`, `pageSize`.

```json
{
  "data": [{
    "id": "…", "itemCode": "ITM-0001", "sku": null, "barcode": "4791234567890",
    "name": "Dhal 1kg", "description": null, "categoryId": "…", "categoryName": "Grocery",
    "brand": null, "unit": "pcs", "sellingPrice": "400.00", "taxTemplateId": null,
    "trackStock": true, "isActive": true, "isGiftCard": false,
    "totalStock": "57.000",
    "stock": [
      { "warehouseId": "…", "warehouseName": "Main", "currentStock": "50.000", "reservedStock": "0.000",
        "availableStock": "50.000", "minStock": "5.000", "updatedAt": "2026-10-22T04:10:00.000Z" }
    ],
    "createdAt": "…", "updatedAt": "…"
  }],
  "pagination": { "page": 1, "pageSize": 50, "total": 1, "totalPages": 1 }
}
```

### `GET /items/{id}`

One item, same shape (`{ "data": {...} }`).

### `GET /stock`

Stock rows per item and warehouse (stock-tracked items only).
Query: `warehouseId`, `itemId`, `updatedSince` (use for incremental sync), `page`, `pageSize` (≤ 500).

```json
{ "data": [{ "itemId": "…", "itemCode": "ITM-0001", "sku": null, "barcode": "…", "itemName": "Dhal 1kg",
  "warehouseId": "…", "warehouseName": "Main", "currentStock": "50.000", "reservedStock": "0.000",
  "availableStock": "50.000", "minStock": "5.000", "updatedAt": "…" }], "pagination": { … } }
```

### `GET /customers`

Query: `search` (name, phone, mobile, email), `updatedSince`, `page`, `pageSize`.
Returns id, names, contact and address fields, `taxId`, `customerType`, `loyaltyPoints`,
`storeCreditBalance`, timestamps.

### `POST /customers`

```json
{ "name": "Kamala Silva", "phone": "0719998887", "email": "kamala@example.lk",
  "addressLine1": "12 Galle Road", "city": "Colombo" }
```

Allowed fields: `name` (required), `firstName`, `lastName`, `companyName`, `email`, `phone`,
`mobilePhone`, `addressLine1`, `addressLine2`, `city`, `postalCode`, `country`, `taxId`, `notes`.
Unknown fields are rejected (credit limits and tax exemptions are set by staff in the app).
A duplicate phone number → `400`. Success → `201 { "data": customer }`.

### `GET /sales`

Query: `from`, `to` (created at, `to` exclusive), `status` (`pending|partial|completed|void`),
`customerId`, `includeLines=true`, `page`, `pageSize`. Newest first.

### `GET /sales/{id}`

```json
{ "data": {
  "id": "…", "invoiceNo": "INV-000123", "clientSaleId": "…", "status": "completed", "isReturn": false,
  "returnAgainst": null, "customerId": "…", "customerName": "Nimal Perera", "warehouseId": "…",
  "subtotal": "600.00", "discountAmount": "0.00", "taxAmount": "0.00", "total": "600.00",
  "paidAmount": "600.00", "paymentMethod": "cash", "offlineRef": null, "voidedAt": null, "createdAt": "…",
  "lines": [{ "id": "…", "itemId": "…", "itemName": "Sugar 1kg", "quantity": "2.000", "unitPrice": "300.00",
    "discount": "0.00", "taxRate": "0.00", "taxAmount": "0.00", "total": "600.00" }],
  "payments": [{ "id": "…", "method": "cash", "amount": "600.00", "reference": null, "createdAt": "…", "voidedAt": null }]
} }
```

### `POST /sales`

Records a completed (or credit) sale exactly like the POS: stock is deducted (batches / serials),
tax is re-calculated and checked, accounting entries are posted and an invoice number is assigned.

Headers: **`Idempotency-Key: <8–255 printable ASCII>`** (required) — use your order id. Sending the
same key again (retry after a timeout, duplicate webhook) returns the **same sale** with `200` and
`Idempotent-Replayed: true` instead of creating a second one. The key is scoped to your company.

```json
{
  "customerId": "…",                     // optional; required for credit sales
  "warehouseId": "…",                    // optional; default warehouse otherwise
  "cartItems": [
    { "itemId": "…", "quantity": 2, "unitPrice": 300, "discount": 0 }
  ],
  "paymentMethod": "cash",               // cash | card | bank_transfer | credit
  "paymentSplits": [ { "method": "card", "amount": 600, "reference": "AUTH123" } ],   // optional
  "subtotal": 600,
  "discount": 0, "discountType": "fixed",
  "tax": 0,
  "total": 600,
  "amountPaid": 600,
  "creditAmount": 0                      // store credit used
}
```

Line fields: `itemId`, `quantity` (> 0), `unitPrice`, optional `name` (defaults to the catalogue
name), `discount`, `discountType`, `taxRate`, `taxTemplateId`, `taxAmount`, `batchNumber`,
`serialNumberIds`, `notes`. `subtotal`, `tax` and `total` are re-computed by the server from the
lines, the company's tax settings and the discount; a total that does not match → `400 TOTAL_MISMATCH`.
Not available through the API: returns / refunds, gift cards, loyalty redemption, work /
restaurant orders, POS shifts. Success → `201 { "data": sale }` (shape as `GET /sales/{id}`).

## Example

```bash
KEY=plk_AbCdEfGh1234_...
curl -s https://app.poslanka.lk/api/v1/items?search=dhal -H "Authorization: Bearer $KEY"

curl -s -X POST https://app.poslanka.lk/api/v1/sales \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Idempotency-Key: webshop-order-10045" \
  -d '{"cartItems":[{"itemId":"…","quantity":1,"unitPrice":400}],"paymentMethod":"card","subtotal":400,"total":400,"amountPaid":400}'
```

## Implementation notes (for maintainers)

- Keys: `api_keys` (migration `0160_api_keys.sql`), helpers in `src/lib/auth/api-keys.ts`.
- `/api/v1` handlers call `withApiKey()`, which authenticates the key and installs an API-key
  principal (`src/lib/auth/api-key-context.ts`, AsyncLocalStorage). `authWithCompany()` returns
  that principal while it is set, so `POST /api/v1/sales` and `POST /api/v1/customers` run the
  existing `POST /api/sales` / `POST /api/customers` handlers unchanged. Nothing else sets a
  principal, so cookie and mobile sessions are unaffected.
- Tests: `scripts/tests/h4-platform.ts`.
