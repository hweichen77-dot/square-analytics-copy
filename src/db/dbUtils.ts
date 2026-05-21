import { db } from './database'
import type { SalesTransaction, CatalogueProduct, ProductCostData, CategoryOverride, OpexEntry, RestockLog, StoreEvent, ProductBundle, StaffWage } from '../types/models'

export async function upsertStaffWage(staffName: string, hourlyWage: number): Promise<void> {
  const existing = await db.staffWages.where('staffName').equals(staffName).first()
  if (existing) {
    await db.staffWages.update(existing.id!, { hourlyWage })
  } else {
    await db.staffWages.add({ staffName, hourlyWage })
  }
}

export async function upsertTransactions(transactions: Omit<SalesTransaction, 'id'>[]): Promise<number> {
  if (transactions.length === 0) return 0
  const ids = transactions.map(t => t.transactionID)
  const existing = new Set(
    (await db.salesTransactions.where('transactionID').anyOf(ids).toArray()).map(t => t.transactionID)
  )
  const toAdd = transactions.filter(t => !existing.has(t.transactionID))
  if (toAdd.length === 0) return 0
  // bulkAdd throws on unique constraint violations — use bulkPut to handle any
  // duplicate transactionIDs that slipped through the pre-filter (e.g., concurrent syncs).
  try {
    await db.salesTransactions.bulkAdd(toAdd)
  } catch {
    // Fall back to one-by-one put to maximise rows saved on partial conflict
    let added = 0
    for (const tx of toAdd) {
      try { await db.salesTransactions.add(tx); added++ } catch { /* duplicate — skip */ }
    }
    return added
  }
  return toAdd.length
}

export async function upsertCatalogueProducts(products: Omit<CatalogueProduct, 'id'>[]): Promise<void> {
  await db.transaction('rw', db.catalogueProducts, async () => {
    for (const p of products) {
      const existing = await db.catalogueProducts.where('name').equals(p.name).first()
      if (existing) {
        await db.catalogueProducts.update(existing.id!, p)
      } else {
        await db.catalogueProducts.add(p)
      }
    }
  })
}

export async function upsertProductCosts(costs: Omit<ProductCostData, 'id'>[]): Promise<void> {
  await db.transaction('rw', db.productCostData, async () => {
    for (const c of costs) {
      const existing = await db.productCostData.where('productName').equals(c.productName).first()
      if (existing) {
        await db.productCostData.update(existing.id!, c)
      } else {
        await db.productCostData.add(c)
      }
    }
  })
}

// Removes CSV-sourced transactions that fall within date range where API data exists.
// Fixes double-counting: Square CSV uses paymentID, API uses orderID → same sale stored twice.
export async function removeCsvDuplicates(): Promise<number> {
  const apiTxs = await db.salesTransactions.filter(t => t.source === 'api').toArray()
  if (apiTxs.length === 0) return 0
  const apiMin = apiTxs.reduce((m, t) => t.date < m ? t.date : m, apiTxs[0].date)
  const apiMax = apiTxs.reduce((m, t) => t.date > m ? t.date : m, apiTxs[0].date)
  const csvInRange = await db.salesTransactions
    .where('date').between(apiMin, apiMax, true, true)
    .filter(t => t.source === 'csv')
    .toArray()
  if (csvInRange.length === 0) return 0
  await db.salesTransactions.bulkDelete(csvInRange.map(t => t.id!))
  return csvInRange.length
}

export async function clearAllData(): Promise<void> {
  await db.transaction('rw',
    [db.salesTransactions, db.categoryOverrides, db.restockLogs,
    db.productCostData, db.storeEvents, db.productBundles, db.catalogueProducts,
    db.opexEntries, db.staffWages],
    async () => {
      await Promise.all([
        db.salesTransactions.clear(),
        db.categoryOverrides.clear(),
        db.restockLogs.clear(),
        db.productCostData.clear(),
        db.storeEvents.clear(),
        db.productBundles.clear(),
        db.catalogueProducts.clear(),
        db.opexEntries.clear(),
        db.staffWages.clear(),
      ])
    }
  )
}

export async function exportAllData(): Promise<string> {
  const [transactions, catalogue, costData, overrides, opexEntries, restockLogs, storeEvents, productBundles, staffWages] = await Promise.all([
    db.salesTransactions.toArray(),
    db.catalogueProducts.toArray(),
    db.productCostData.toArray(),
    db.categoryOverrides.toArray(),
    db.opexEntries.toArray(),
    db.restockLogs.toArray(),
    db.storeEvents.toArray(),
    db.productBundles.toArray(),
    db.staffWages.toArray(),
  ])
  return JSON.stringify({
    version: 2,
    exportedAt: new Date().toISOString(),
    data: { transactions, catalogue, costData, overrides, opexEntries, restockLogs, storeEvents, productBundles, staffWages },
  })
}

export async function restoreAllData(json: string): Promise<{ transactions: number; catalogue: number }> {
  // Parse and validate structure BEFORE touching existing data
  let backup: {
    version: number
    data: {
      transactions?: Record<string, unknown>[]
      catalogue?: Record<string, unknown>[]
      costData?: Record<string, unknown>[]
      overrides?: Record<string, unknown>[]
      opexEntries?: Record<string, unknown>[]
      restockLogs?: Record<string, unknown>[]
      storeEvents?: Record<string, unknown>[]
      productBundles?: Record<string, unknown>[]
      staffWages?: Record<string, unknown>[]
      // v1 used salesTransactions/catalogueProducts keys
      salesTransactions?: Record<string, unknown>[]
      catalogueProducts?: Record<string, unknown>[]
      productCostData?: Record<string, unknown>[]
      categoryOverrides?: Record<string, unknown>[]
    }
  }

  try {
    backup = JSON.parse(json)
  } catch {
    throw new Error('Invalid backup file — file is not valid JSON.')
  }

  if (!backup?.data || typeof backup.data !== 'object') {
    throw new Error('Invalid backup file — missing data field. Is this a Walley\'s Analytics backup?')
  }

  const d = backup.data
  // Support both v1 and v2 key names
  const txRaw = d.transactions ?? d.salesTransactions ?? []
  const catRaw = d.catalogue ?? d.catalogueProducts ?? []
  const costRaw = d.costData ?? d.productCostData ?? []
  const overridesRaw = d.overrides ?? d.categoryOverrides ?? []

  // Strip IDs and fix Date fields — validate dates before clearing existing data
  function stripId<T extends Record<string, unknown>>(rec: T): Omit<T, 'id'> {
    const { id: _id, ...rest } = rec
    return rest as Omit<T, 'id'>
  }

  function safeDate(val: unknown, field: string): Date {
    const d = new Date(val as string)
    if (isNaN(d.getTime())) throw new Error(`Invalid date in backup field "${field}": ${val}`)
    return d
  }

  // Pre-validate all rows with dates before any destructive operation
  const txToAdd = txRaw.map((r, i) => {
    try { return { ...stripId(r), date: safeDate(r.date, `transactions[${i}].date`) }
    } catch (e) { throw new Error(`Backup validation failed: ${(e as Error).message}`) }
  })
  const catToAdd = catRaw.map((r, i) => {
    try { return { ...stripId(r), importedAt: safeDate(r.importedAt, `catalogue[${i}].importedAt`) }
    } catch { return { ...stripId(r), importedAt: new Date() } }
  })
  const costToAdd = costRaw.map((r, i) => {
    try { return { ...stripId(r), lastUpdated: safeDate(r.lastUpdated, `costData[${i}].lastUpdated`) }
    } catch { return { ...stripId(r), lastUpdated: new Date() } }
  })
  const restockToAdd = (d.restockLogs ?? []).map((r, i) => {
    try { return { ...stripId(r), date: safeDate(r.date, `restockLogs[${i}].date`) }
    } catch { return { ...stripId(r), date: new Date() } }
  })
  const eventsToAdd = (d.storeEvents ?? []).map((r, i) => {
    const start = new Date(r.startDate as string)
    const end = new Date(r.endDate as string)
    // Silently skip rows with invalid dates to avoid storing corrupted Date objects.
    if (isNaN(start.getTime())) throw new Error(`Invalid startDate in storeEvents[${i}]: ${r.startDate}`)
    if (isNaN(end.getTime())) throw new Error(`Invalid endDate in storeEvents[${i}]: ${r.endDate}`)
    return { ...stripId(r), startDate: start, endDate: end }
  })
  const bundlesToAdd = (d.productBundles ?? []).map(r => ({
    ...stripId(r),
    // r.createdDate may be a serialized ISO string or absent; fall back to current time.
    createdDate: r.createdDate ? new Date(r.createdDate as string) : new Date(),
  }))

  // All validation passed — now it's safe to clear and restore
  await clearAllData()

  if (txToAdd.length) await db.salesTransactions.bulkPut(txToAdd as unknown as SalesTransaction[])
  // bulkPut handles re-restores cleanly: if the user restores from backup a second time,
  // catalogue rows with the same unique &name constraint won't throw a ConstraintError.
  if (catToAdd.length) await db.catalogueProducts.bulkPut(catToAdd as unknown as CatalogueProduct[])
  if (costToAdd.length) await db.productCostData.bulkAdd(costToAdd as unknown as ProductCostData[])
  if (overridesRaw.length) await db.categoryOverrides.bulkAdd(overridesRaw.map(stripId) as unknown as CategoryOverride[])
  if (d.opexEntries?.length) await db.opexEntries.bulkAdd(d.opexEntries.map(stripId) as unknown as OpexEntry[])
  if (restockToAdd.length) await db.restockLogs.bulkAdd(restockToAdd as unknown as RestockLog[])
  if (eventsToAdd.length) await db.storeEvents.bulkAdd(eventsToAdd as unknown as StoreEvent[])
  if (bundlesToAdd.length) await db.productBundles.bulkAdd(bundlesToAdd as unknown as ProductBundle[])
  if (d.staffWages?.length) await db.staffWages.bulkAdd(d.staffWages.map(stripId) as unknown as StaffWage[])

  return { transactions: txRaw.length, catalogue: catRaw.length }
}

export async function getTransactionCount(): Promise<number> {
  return db.salesTransactions.count()
}
