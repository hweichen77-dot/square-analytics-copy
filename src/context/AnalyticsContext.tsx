import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useDateRangeStore } from '../store/dateRangeStore'
import { useFilteredTransactions, useOverridesMap } from '../db/useTransactions'
import {
  computeProductStats,
  computeDailyRevenue,
  computeWeeklyRevenue,
  computeMonthlyRevenue,
  computeCategoryRevenue,
  computeStaffStats,
  type ProductStats,
  type DailyRevenue,
  type CategoryRevenue,
  type StaffStats,
} from '../engine/analyticsEngine'
import type { SalesTransaction } from '../types/models'

interface AnalyticsCache {
  transactions: SalesTransaction[]
  overrides: Record<string, string>
  productStats: ProductStats[]
  daily: DailyRevenue[]
  weekly: DailyRevenue[]
  monthly: DailyRevenue[]
  categories: CategoryRevenue[]
  staffStats: StaffStats[]
  totalRevenue: number
  totalTransactions: number
}

const AnalyticsContext = createContext<AnalyticsCache | null>(null)

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const { range } = useDateRangeStore()
  const transactions = useFilteredTransactions(range)
  const overrides = useOverridesMap()

  const productStats = useMemo(() => computeProductStats(transactions, overrides), [transactions, overrides])
  const daily        = useMemo(() => computeDailyRevenue(transactions), [transactions])
  const weekly       = useMemo(() => computeWeeklyRevenue(transactions), [transactions])
  const monthly      = useMemo(() => computeMonthlyRevenue(transactions), [transactions])
  const categories   = useMemo(() => computeCategoryRevenue(transactions, overrides), [transactions, overrides])
  const staffStats   = useMemo(() => computeStaffStats(transactions), [transactions])

  const totalRevenue       = useMemo(() => transactions.reduce((s, t) => s + t.netSales, 0), [transactions])
  const totalTransactions  = transactions.length

  const value = useMemo<AnalyticsCache>(() => ({
    transactions,
    overrides,
    productStats,
    daily,
    weekly,
    monthly,
    categories,
    staffStats,
    totalRevenue,
    totalTransactions,
  }), [transactions, overrides, productStats, daily, weekly, monthly, categories, staffStats, totalRevenue, totalTransactions])

  return (
    <AnalyticsContext.Provider value={value}>
      {children}
    </AnalyticsContext.Provider>
  )
}

export function useAnalytics(): AnalyticsCache {
  const ctx = useContext(AnalyticsContext)
  if (!ctx) throw new Error('useAnalytics must be used within AnalyticsProvider')
  return ctx
}
