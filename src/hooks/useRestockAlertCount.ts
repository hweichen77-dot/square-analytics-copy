import { useMemo } from 'react'
import { startOfDay } from 'date-fns'
import { useAllTransactions, useRestockLogs, useCatalogueProducts } from '../db/useTransactions'
import { computeProductStats, productVelocity } from '../engine/analyticsEngine'

/**
 * Returns the count of products that are outOfStock or critical (≤5 days until stockout).
 * Mirrors the urgency logic in RestockView's computeAlerts.
 */
export function useRestockAlertCount(): number {
  const transactions = useAllTransactions()
  const restockLogs = useRestockLogs()
  const catalogueProducts = useCatalogueProducts()

  return useMemo(() => {
    if (!transactions.length) return 0

    const stats = computeProductStats(transactions)

    const latestLog: Record<string, { date: Date; quantity: number }> = {}
    for (const log of restockLogs) {
      const existing = latestLog[log.productName]
      if (!existing || log.date > existing.date) latestLog[log.productName] = log
    }

    const catalogueQtyLower: Record<string, number> = {}
    for (const p of catalogueProducts) {
      if (p.quantity !== null) catalogueQtyLower[p.name.toLowerCase().trim()] = p.quantity
    }

    function lookupQty(name: string): number | undefined {
      const lower = name.toLowerCase().trim()
      if (catalogueQtyLower[lower] !== undefined) return catalogueQtyLower[lower]
      const base = lower.replace(/\s*\([^)]*\)\s*$/, '').trim()
      return catalogueQtyLower[base]
    }

    let count = 0

    for (const product of stats) {
      const dailyVel = productVelocity(product)

      let stockRemaining: number | null = null
      let daysUntilStockout: number | null = null

      const log = latestLog[product.name]
      if (log) {
        const restockDay = startOfDay(log.date).getTime()
        const soldAfter = Object.entries(product.dailySales)
          .filter(([key]) => startOfDay(new Date(key + 'T00:00:00')).getTime() > restockDay)
          .reduce((s, [, v]) => s + v, 0)
        stockRemaining = log.quantity - soldAfter
        if (stockRemaining > 0 && dailyVel > 0) daysUntilStockout = stockRemaining / dailyVel
      } else {
        const qty = lookupQty(product.name)
        if (qty !== undefined) {
          stockRemaining = qty
          if (qty > 0 && dailyVel > 0) daysUntilStockout = qty / dailyVel
        }
      }

      if (stockRemaining !== null) {
        if (stockRemaining <= 0) count++
        else if (daysUntilStockout !== null && daysUntilStockout <= 5) count++
      }
    }

    return count
  }, [transactions, restockLogs, catalogueProducts])
}
