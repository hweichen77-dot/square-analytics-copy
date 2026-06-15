import Dexie from 'dexie'
import type {
  SalesTransaction,
  CategoryOverride,
  RestockLog,
  ProductCostData,
  StoreEvent,
  ProductBundle,
  CatalogueProduct,
  OpexEntry,
  StaffWage,
} from '../types/models'
import { splitItemVariation } from '../types/models'

class WalleysDB extends Dexie {
  salesTransactions!: Dexie.Table<SalesTransaction, number>
  categoryOverrides!: Dexie.Table<CategoryOverride, number>
  restockLogs!: Dexie.Table<RestockLog, number>
  productCostData!: Dexie.Table<ProductCostData, number>
  storeEvents!: Dexie.Table<StoreEvent, number>
  productBundles!: Dexie.Table<ProductBundle, number>
  catalogueProducts!: Dexie.Table<CatalogueProduct, number>
  opexEntries!: Dexie.Table<OpexEntry, number>
  staffWages!: Dexie.Table<StaffWage, number>

  constructor() {
    super('WalleysDB')
    this.version(1).stores({
      salesTransactions: '++id, &transactionID, date, staffName, paymentMethod, dayOfWeek, hour',
      categoryOverrides: '++id, &productName',
      restockLogs: '++id, productName, date',
      productCostData: '++id, &productName',
      storeEvents: '++id, startDate, endDate',
      productBundles: '++id, name',
      catalogueProducts: '++id, &name, sku, category, enabled',
    })

    // Version 2: retroactively normalize paymentMethod for cash transactions.
    // Old imports stored raw card reference codes (e.g. "A3KX9P2QM") directly
    // instead of "Cash". Run the same heuristic from csvParser to fix them.
    this.version(2).stores({
      salesTransactions: '++id, &transactionID, date, staffName, paymentMethod, dayOfWeek, hour',
      categoryOverrides: '++id, &productName',
      restockLogs: '++id, productName, date',
      productCostData: '++id, &productName',
      storeEvents: '++id, startDate, endDate',
      productBundles: '++id, name',
      catalogueProducts: '++id, &name, sku, category, enabled',
    }).upgrade(async tx => {
      const KNOWN_BRANDS = /visa|mastercard|master\s*card|amex|american express|discover|jcb|diners|unionpay|eftpos|interac/i
      function looksLikeCashRef(v: string): boolean {
        return /[A-Za-z]/.test(v) && /[0-9]/.test(v) && !/\s/.test(v) && v.length >= 4
      }
      await tx.table('salesTransactions').toCollection().modify((t: Partial<SalesTransaction>) => {
        const pm = (t.paymentMethod ?? '').trim()
        if (pm && looksLikeCashRef(pm) && !KNOWN_BRANDS.test(pm)) {
          t.paymentMethod = 'Cash'
        }
      })
    })

    // Version 3: add itemName + variationName fields to catalogueProducts
    this.version(3).stores({
      salesTransactions: '++id, &transactionID, date, staffName, paymentMethod, dayOfWeek, hour',
      categoryOverrides: '++id, &productName',
      restockLogs: '++id, productName, date',
      productCostData: '++id, &productName',
      storeEvents: '++id, startDate, endDate',
      productBundles: '++id, name',
      catalogueProducts: '++id, &name, itemName, variationName, sku, category, enabled',
    }).upgrade(async tx => {
      await tx.table('catalogueProducts').toCollection().modify((p: Partial<CatalogueProduct>) => {
        if (!p.itemName || !p.variationName) {
          const { itemName, variationName } = splitItemVariation(p.name ?? '')
          p.itemName = itemName
          p.variationName = variationName
        }
      })
    })

    // Version 4: add opexEntries table for manual operating expense tracking.
    this.version(4).stores({
      salesTransactions: '++id, &transactionID, date, staffName, paymentMethod, dayOfWeek, hour',
      categoryOverrides: '++id, &productName',
      restockLogs: '++id, productName, date',
      productCostData: '++id, &productName',
      storeEvents: '++id, startDate, endDate',
      productBundles: '++id, name',
      catalogueProducts: '++id, &name, itemName, variationName, sku, category, enabled',
      opexEntries: '++id, month, category',
    })

    // Version 5: add staffWages table for Staff ROI feature.
    this.version(5).stores({
      salesTransactions: '++id, &transactionID, date, staffName, paymentMethod, dayOfWeek, hour',
      categoryOverrides: '++id, &productName',
      restockLogs: '++id, productName, date',
      productCostData: '++id, &productName',
      storeEvents: '++id, startDate, endDate',
      productBundles: '++id, name',
      catalogueProducts: '++id, &name, itemName, variationName, sku, category, enabled',
      opexEntries: '++id, month, category',
      staffWages: '++id, &staffName',
    })

    // Version 6: add Payments API enrichment fields (processingFee, paymentSourceType,
    // cardBrand, cardLastFour) to salesTransactions. All fields are optional so no
    // data migration is required — existing rows simply lack these fields.
    this.version(6).stores({
      salesTransactions: '++id, &transactionID, date, staffName, paymentMethod, dayOfWeek, hour',
      categoryOverrides: '++id, &productName',
      restockLogs: '++id, productName, date',
      productCostData: '++id, &productName',
      storeEvents: '++id, startDate, endDate',
      productBundles: '++id, name',
      catalogueProducts: '++id, &name, itemName, variationName, sku, category, enabled',
      opexEntries: '++id, month, category',
      staffWages: '++id, &staffName',
    }).upgrade(_tx => {
      // No data migration needed — new fields are optional and default to undefined
    })
  }
}

export const db = new WalleysDB()
