import { differenceInDays } from 'date-fns'
import type { SalesTransaction, StoreEvent, RestockLog } from '../types/models'
import { computeProductStats } from './analyticsEngine'

export interface PurchaseOrderItem {
  productName: string
  category: string
  avgDailyVelocity: number
  recommendedQty: number
  estimatedRevenue: number
  avgPrice: number
  lastSoldDate: Date
  reasoning: string
}

export function generatePurchaseOrder(
  transactions: SalesTransaction[],
  events: StoreEvent[],
  _restockLogs: RestockLog[],
  overrides: Record<string, string> = {},
  weeksAhead = 2,
): PurchaseOrderItem[] {
  const reorderDays = weeksAhead * 7
  const stats = computeProductStats(transactions, overrides)
  const today = new Date()

  const upcomingEvents = events.filter(e => {
    const daysUntil = differenceInDays(e.startDate, today)
    return daysUntil >= 0 && daysUntil <= 30
  })

  const items: PurchaseOrderItem[] = []

  for (const product of stats) {
    // Weekly velocity: units sold ÷ weeks since first sale to today (minimum 1 week).
    // Using today (not lastSoldDate) so quiet weeks are counted and bursts don't inflate velocity.
    const spanDays = (Date.now() - product.firstSoldDate.getTime()) / 86_400_000
    const weeksIntroduced = Math.max(1, spanDays / 7)
    const weeklyVelocity = product.totalUnitsSold / weeksIntroduced
    const dailyVelocity = weeklyVelocity / 7
    if (dailyVelocity <= 0) continue

    let multiplier = 1.0

    if (upcomingEvents.length > 0) {
      const isHighDemandEvent = upcomingEvents.some(e =>
        ['Spirit Week', 'Homecoming', 'Back to School', 'Sports Game'].includes(e.eventType)
      )
      multiplier = isHighDemandEvent ? 1.5 : 1.2
    }

    const recommendedQty = Math.ceil(dailyVelocity * reorderDays * multiplier)
    const estimatedRevenue = recommendedQty * product.avgPrice

    let reasoning = `${weeklyVelocity.toFixed(1)} units/wk over ${Math.round(weeksIntroduced)}w since intro`
    if (multiplier > 1) {
      reasoning += ` · ${Math.round((multiplier - 1) * 100)}% boost for upcoming event`
    }

    items.push({
      productName: product.name,
      category: product.category,
      avgDailyVelocity: dailyVelocity,
      recommendedQty,
      estimatedRevenue,
      avgPrice: product.avgPrice,
      lastSoldDate: product.lastSoldDate,
      reasoning,
    })
  }

  return items.sort((a, b) => b.estimatedRevenue - a.estimatedRevenue)
}
