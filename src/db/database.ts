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
      await tx.table('catalogueProducts').toCollection().modify((p: any) => {
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

    // Version 2: retroactively normalize paymentMethod for cash transactions.
    // Old imports stored raw card reference codes (e.g. "A3KX9P2QM") directly
    // instead of "Cash". Run the same heuristic from csvParser to fix them.
    this.version(2).upgrade(async tx => {
      const KNOWN_BRANDS = /visa|mastercard|master\s*card|amex|american express|discover|jcb|diners|unionpay|eftpos|interac/i
      function looksLikeCashRef(v: string): boolean {
        return /[A-Za-z]/.test(v) && /[0-9]/.test(v) && !/\s/.test(v) && v.length >= 4
      }
      await tx.table('salesTransactions').toCollection().modify((t: any) => {
        const pm = (t.paymentMethod ?? '').trim()
        if (pm && looksLikeCashRef(pm) && !KNOWN_BRANDS.test(pm)) {
          t.paymentMethod = 'Cash'
        }
      })
    })
  }
}

export const db = new WalleysDB()
