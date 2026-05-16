import type { CatalogueProduct } from '../types/models'
import { MERCH_KEYWORDS } from './categoryClassifier'

export type AuditSeverity = 'error' | 'warning' | 'info'

export interface AuditIssue {
  id: string            // unique stable key for React
  productId?: number    // db id for auto-fixing
  productName: string
  issue: string
  detail: string
  severity: AuditSeverity
  fixType?: AuditFixType
  fixValue?: unknown    // value to apply when auto-fixing
}

export type AuditFixType =
  | 'set_taxable_true'
  | 'set_taxable_false'
  | 'set_quantity_zero'
  | 'set_category'

// ---------------------------------------------------------------------------
// Tax rules
// Merch items MUST be taxable. Food and beverage items are non-taxable.
// ---------------------------------------------------------------------------

function isMerch(product: CatalogueProduct): boolean {
  const cat = (product.category ?? '').toLowerCase()
  if (cat.includes('merch') || cat.includes('apparel') || cat.includes('clothing')) return true
  const lower = product.name.toLowerCase()
  return MERCH_KEYWORDS.some(k => lower.includes(k))
}

function shouldBeTaxed(product: CatalogueProduct): boolean {
  return isMerch(product)
}

// ---------------------------------------------------------------------------
// Category label rules
// "Prepared Goods" is a common mis-labeling for food/beverage items in Square.
// The correct Square category for taxable prepared food/drinks is
// "Prepared Food and Beverage".
// ---------------------------------------------------------------------------

const WRONG_PREPARED_LABELS = [
  'prepared goods',
  'prepared food',
  'prepared meals',
]

const CORRECT_PREPARED_LABEL = 'Prepared Food and Beverage'

// ---------------------------------------------------------------------------
// Main audit function
// ---------------------------------------------------------------------------

export interface AuditResult {
  issues: AuditIssue[]
  errorCount: number
  warningCount: number
  infoCount: number
}

export function auditCatalogue(
  products: CatalogueProduct[],
  salesNames?: Set<string>,           // product names that appear in sales data
  avgPrices?: Map<string, number>,     // name → avg sold price
): AuditResult {
  const issues: AuditIssue[] = []
  let idx = 0
  const nextId = () => `issue-${idx++}`

  // -- Build lookup maps -------------------------------------------------------
  const nameCount = new Map<string, number>()
  const skuCount  = new Map<string, number>()

  for (const p of products) {
    nameCount.set(p.name, (nameCount.get(p.name) ?? 0) + 1)
    if (p.sku) {
      skuCount.set(p.sku, (skuCount.get(p.sku) ?? 0) + 1)
    }
  }

  // -- Per-product checks ------------------------------------------------------
  for (const p of products) {
    const id = p.id
    const name = p.name

    // 1. Merch must be taxable
    if (shouldBeTaxed(p) && !p.taxable) {
      issues.push({
        id: nextId(),
        productId: id,
        productName: name,
        issue: 'Merch not taxed',
        detail: `"${name}" is a merch item and must be marked taxable. Category: "${p.category || 'none'}"`,
        severity: 'error',
        fixType: 'set_taxable_true',
      })
    }

    // 2. Non-merch item is taxed but should not be
    if (p.taxable && !shouldBeTaxed(p)) {
      issues.push({
        id: nextId(),
        productId: id,
        productName: name,
        issue: 'Incorrectly taxed',
        detail: `"${name}" is marked taxable but food and beverage items are non-taxable. Category: "${p.category || 'none'}"`,
        severity: 'error',
        fixType: 'set_taxable_false',
      })
    }

    // 3. Negative quantity
    if (p.quantity !== null && p.quantity !== undefined && p.quantity < 0) {
      issues.push({
        id: nextId(),
        productId: id,
        productName: name,
        issue: 'Negative stock',
        detail: `"${name}" has a quantity of ${p.quantity}. Stock cannot be negative — will be set to 0.`,
        severity: 'error',
        fixType: 'set_quantity_zero',
        fixValue: 0,
      })
    }

    // 4. Wrong category label — "Prepared Goods" / similar → should be "Prepared Food and Beverage"
    const catNorm = (p.category ?? '').toLowerCase().trim()
    if (WRONG_PREPARED_LABELS.some(l => catNorm === l || catNorm.startsWith(l))) {
      issues.push({
        id: nextId(),
        productId: id,
        productName: name,
        issue: 'Wrong category label',
        detail: `"${name}" is categorized as "${p.category}". Food and beverage items must use the Square category "${CORRECT_PREPARED_LABEL}".`,
        severity: 'error',
        fixType: 'set_category',
        fixValue: CORRECT_PREPARED_LABEL,
      })
    }

    // 5. Missing / uncategorized / Square "Non" placeholder
    if (!p.category || p.category.trim() === '' || ['uncategorized', 'non'].includes(p.category.toLowerCase().trim())) {
      issues.push({
        id: nextId(),
        productId: id,
        productName: name,
        issue: 'No category',
        detail: `"${name}" has no category set. Items without a category won't appear in category sales reports.`,
        severity: 'warning',
      })
    }

    // 6. Zero or missing price (non-variable items shouldn't have $0)
    if (p.price !== null && p.price !== undefined && p.price === 0 && p.enabled) {
      issues.push({
        id: nextId(),
        productId: id,
        productName: name,
        issue: 'Zero price',
        detail: `"${name}" has a price of $0.00. If this is intentional (free item), you can ignore this. Otherwise, update the price.`,
        severity: 'warning',
      })
    }

    // 7. Null / missing price on active item
    if ((p.price === null || p.price === undefined) && p.enabled) {
      issues.push({
        id: nextId(),
        productId: id,
        productName: name,
        issue: 'Missing price',
        detail: `"${name}" has no price set. Square will treat this as a variable-price item.`,
        severity: 'info',
      })
    }

    // 8. Duplicate item names
    if ((nameCount.get(name) ?? 0) > 1) {
      issues.push({
        id: nextId(),
        productId: id,
        productName: name,
        issue: 'Duplicate name',
        detail: `"${name}" appears ${nameCount.get(name)} times in the catalogue. Square requires unique item names — duplicates will overwrite each other on import.`,
        severity: 'error',
      })
    }

    // 9. Duplicate SKUs
    if (p.sku && (skuCount.get(p.sku) ?? 0) > 1) {
      issues.push({
        id: nextId(),
        productId: id,
        productName: name,
        issue: 'Duplicate SKU',
        detail: `SKU "${p.sku}" is shared by ${skuCount.get(p.sku)} items. SKUs must be unique per variation.`,
        severity: 'error',
      })
    }

    // 10. Item name contains a comma (breaks CSV import)
    if (name.includes(',')) {
      issues.push({
        id: nextId(),
        productId: id,
        productName: name,
        issue: 'Comma in name',
        detail: `"${name}" contains a comma. Commas in item names break Square's CSV import — remove the comma before exporting.`,
        severity: 'warning',
      })
    }

    // 11. Archived item with stock > 0
    if (!p.enabled && (p.quantity ?? 0) > 0) {
      issues.push({
        id: nextId(),
        productId: id,
        productName: name,
        issue: 'Archived with stock',
        detail: `"${name}" is archived but still shows ${p.quantity} units in stock. Consider zeroing the quantity or re-enabling the item.`,
        severity: 'warning',
      })
    }

    // 12. Price mismatch vs sales data
    if (avgPrices && p.price !== null && p.price !== undefined) {
      const avg = avgPrices.get(name)
      if (avg !== undefined && Math.abs(p.price - avg) > 0.50) {
        issues.push({
          id: nextId(),
          productId: id,
          productName: name,
          issue: 'Price mismatch',
          detail: `Catalogue price $${p.price.toFixed(2)} vs avg sold price $${avg.toFixed(2)} (diff $${Math.abs(p.price - avg).toFixed(2)}).`,
          severity: 'info',
        })
      }
    }

    // 13. Sold in sales data but not in catalogue (only applies to enabled items check)
    // (handled outside per-product loop with salesNames set)
  }

  // -- Catalogue-vs-sales checks (require external data) -----------------------
  if (salesNames) {
    const catNames = new Set(products.map(p => p.name))
    for (const soldName of salesNames) {
      if (!catNames.has(soldName)) {
        issues.push({
          id: nextId(),
          productName: soldName,
          issue: 'Sold — not in catalogue',
          detail: `"${soldName}" appears in sales data but has no catalogue entry. Add it to Square to track it properly.`,
          severity: 'warning',
        })
      }
    }
  }

  const errorCount   = issues.filter(i => i.severity === 'error').length
  const warningCount = issues.filter(i => i.severity === 'warning').length
  const infoCount    = issues.filter(i => i.severity === 'info').length

  return { issues, errorCount, warningCount, infoCount }
}
