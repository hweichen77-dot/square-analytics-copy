import type { SalesTransaction } from '../types/models'
import { parseProductItems, splitItemVariation } from '../types/models'

export interface BasketPair {
  itemA: string
  itemB: string
  coOccurrences: number
  support: number      // co_occurrences / total_transactions
  lift: number         // how much more likely than by chance (>1 = positive association)
  confidence: number   // P(B | A) — if someone buys A, probability they also buy B
}

export interface BasketResult {
  pairs: BasketPair[]
  totalTransactions: number
  multiItemTransactions: number
  uniqueItems: number
}

/**
 * Apriori-style association rule mining over Square transactions.
 * Groups rows by transactionID so each order is treated as one basket,
 * then counts item pair co-occurrences and computes lift + confidence.
 */
export function computeBasketAnalysis(
  transactions: SalesTransaction[],
  minCoOccurrences = 2,
): BasketResult {
  // Build baskets: one Set<itemName> per transactionID
  const baskets = new Map<string, Set<string>>()
  for (const tx of transactions) {
    const items = parseProductItems(tx.itemDescription)
    if (items.length === 0) continue
    const basket = baskets.get(tx.transactionID) ?? new Set<string>()
    for (const item of items) basket.add(splitItemVariation(item.name).itemName)
    baskets.set(tx.transactionID, basket)
  }

  const allBaskets = Array.from(baskets.values())
  const totalTransactions = allBaskets.length
  const multiItemTransactions = allBaskets.filter(b => b.size > 1).length

  // Individual item counts
  const itemCounts = new Map<string, number>()
  for (const basket of allBaskets) {
    for (const item of basket) {
      itemCounts.set(item, (itemCounts.get(item) ?? 0) + 1)
    }
  }

  const uniqueItems = itemCounts.size

  // Pair co-occurrence counts (always store with sorted keys so A < B)
  const pairCounts = new Map<string, number>()
  for (const basket of allBaskets) {
    const items = Array.from(basket).sort()
    for (let i = 0; i < items.length - 1; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const key = `${items[i]}\x00${items[j]}`
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    }
  }

  const pairs: BasketPair[] = []
  for (const [key, coCount] of pairCounts) {
    if (coCount < minCoOccurrences) continue
    const [itemA, itemB] = key.split('\x00')
    const countA = itemCounts.get(itemA) ?? 0
    const countB = itemCounts.get(itemB) ?? 0

    // Guard all denominators against division-by-zero
    if (!totalTransactions || !countA || !countB) {
      pairs.push({ itemA, itemB, coOccurrences: coCount, support: 0, lift: 0, confidence: 0 })
      continue
    }

    const support = coCount / totalTransactions
    const lift = (coCount * totalTransactions) / (countA * countB)
    const confidence = countA > 0 ? coCount / countA : 0

    pairs.push({ itemA, itemB, coOccurrences: coCount, support, lift, confidence })
  }

  return {
    pairs: pairs.sort((a, b) => b.coOccurrences - a.coOccurrences),
    totalTransactions,
    multiItemTransactions,
    uniqueItems,
  }
}
