/**
 * Offline POS queue using IndexedDB (browser).
 * Stores catalog snapshot + pending sales for sync when online.
 */

const DB_NAME = 'poslanka-offline'
const DB_VERSION = 1
const STORE_SALES = 'pending_sales'
const STORE_CATALOG = 'catalog'

export type PendingSale = {
  clientSaleId: string
  payload: Record<string, unknown>
  createdAt: string
  attempts: number
  lastError?: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_SALES)) {
        db.createObjectStore(STORE_SALES, { keyPath: 'clientSaleId' })
      }
      if (!db.objectStoreNames.contains(STORE_CATALOG)) {
        db.createObjectStore(STORE_CATALOG, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function enqueuePendingSale(sale: PendingSale): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SALES, 'readwrite')
    tx.objectStore(STORE_SALES).put(sale)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function listPendingSales(): Promise<PendingSale[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SALES, 'readonly')
    const req = tx.objectStore(STORE_SALES).getAll()
    req.onsuccess = () => resolve(req.result as PendingSale[])
    req.onerror = () => reject(req.error)
  })
}

export async function removePendingSale(clientSaleId: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_SALES, 'readwrite')
    tx.objectStore(STORE_SALES).delete(clientSaleId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function saveCatalogSnapshot(items: unknown[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_CATALOG, 'readwrite')
    tx.objectStore(STORE_CATALOG).put({
      key: 'items',
      items,
      savedAt: new Date().toISOString(),
    })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Merge items into the catalog snapshot by id (keeps items from other pages/searches). */
export async function mergeCatalogSnapshot(items: unknown[]): Promise<void> {
  const existing = await loadCatalogSnapshot()
  const byId = new Map<string, unknown>()
  for (const it of existing?.items || []) {
    const id = (it as { id?: string })?.id
    if (id) byId.set(id, it)
  }
  for (const it of items) {
    const id = (it as { id?: string })?.id
    if (id) byId.set(id, it)
  }
  await saveCatalogSnapshot(Array.from(byId.values()))
}

export async function loadCatalogSnapshot(): Promise<{ items: unknown[]; savedAt: string } | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CATALOG, 'readonly')
    const req = tx.objectStore(STORE_CATALOG).get('items')
    req.onsuccess = () => resolve((req.result as { items: unknown[]; savedAt: string }) || null)
    req.onerror = () => reject(req.error)
  })
}

/** Sync pending sales to API when online */
export async function syncPendingSales(
  postSale: (payload: Record<string, unknown>) => Promise<Response>
): Promise<{ synced: number; failed: number }> {
  const pending = await listPendingSales()
  let synced = 0
  let failed = 0

  for (const sale of pending) {
    try {
      const res = await postSale({ ...sale.payload, clientSaleId: sale.clientSaleId })
      if (res.ok || res.status === 409) {
        await removePendingSale(sale.clientSaleId)
        synced++
      } else {
        failed++
        const db = await openDb()
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_SALES, 'readwrite')
          tx.objectStore(STORE_SALES).put({
            ...sale,
            attempts: sale.attempts + 1,
            lastError: `HTTP ${res.status}`,
          })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      }
    } catch (error) {
      failed++
      console.warn('[offline] sync failed', error)
    }
  }

  return { synced, failed }
}
