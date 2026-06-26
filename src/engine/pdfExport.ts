import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format, parseISO } from 'date-fns'
import { formatCurrency, formatNumber, formatPercent } from '../utils/format'
import type {
  RevenueReport,
  TopProductsReport,
  CustomerBehaviorReport,
  TransactionLogReport,
  SeasonalReport,
  MonthlyDetailReport,
  CashReport,
  AnyReport,
} from './reportEngine'
import { REPORT_META } from './reportEngine'


const MARGIN = 14
const PAGE_W = 210
const PAGE_H = 297
const CW = PAGE_W - MARGIN * 2


const C = {
  indigo600: [79, 70, 229] as [number, number, number],
  indigo500: [99, 102, 241] as [number, number, number],
  indigo50:  [238, 242, 255] as [number, number, number],
  indigo200: [199, 210, 254] as [number, number, number],
  gray900:   [17, 24, 39] as [number, number, number],
  gray700:   [55, 65, 81] as [number, number, number],
  gray500:   [107, 114, 128] as [number, number, number],
  gray200:   [229, 231, 235] as [number, number, number],
  gray50:    [249, 250, 251] as [number, number, number],
  white:     [255, 255, 255] as [number, number, number],
}

function fill(doc: jsPDF, c: [number, number, number]) { doc.setFillColor(c[0], c[1], c[2]) }
function draw(doc: jsPDF, c: [number, number, number]) { doc.setDrawColor(c[0], c[1], c[2]) }
function text(doc: jsPDF, c: [number, number, number]) { doc.setTextColor(c[0], c[1], c[2]) }


function shortVal(v: number, isCurrency = true): string {
  const abs = Math.abs(v)
  const prefix = isCurrency ? '$' : ''
  if (abs >= 1_000_000) return `${prefix}${(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `${prefix}${(v / 1_000).toFixed(1)}k`
  return isCurrency ? formatCurrency(v) : String(Math.round(v))
}

function makeDoc() {
  return new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
}


function drawHeader(doc: jsPDF, reportLabel: string, dateRange: string): number {
  const y = MARGIN

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  text(doc, C.gray900)
  doc.text("Walley's Analytics", MARGIN, y + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  text(doc, C.indigo600)
  doc.text(reportLabel, PAGE_W - MARGIN, y + 6, { align: 'right' })

  doc.setFontSize(7.5)
  text(doc, C.gray500)
  doc.text(dateRange, MARGIN, y + 11)

  draw(doc, C.indigo200)
  doc.setLineWidth(0.4)
  doc.line(MARGIN, y + 14, PAGE_W - MARGIN, y + 14)

  return y + 19
}

function addFooters(doc: jsPDF, generatedAt: string): void {
  const total = doc.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    const fy = PAGE_H - 8
    draw(doc, C.gray200)
    doc.setLineWidth(0.25)
    doc.line(MARGIN, fy - 3, PAGE_W - MARGIN, fy - 3)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    text(doc, C.gray500)
    doc.text(`Generated ${generatedAt}`, MARGIN, fy)
    doc.text(`Page ${i} of ${total}`, PAGE_W - MARGIN, fy, { align: 'right' })
  }
}


function drawKPICards(
  doc: jsPDF,
  cards: { label: string; value: string; sub?: string }[],
  y: number,
): number {
  const gap = 3
  const cardW = (CW - gap * (cards.length - 1)) / cards.length
  const cardH = 18

  cards.forEach((card, i) => {
    const cx = MARGIN + i * (cardW + gap)
    fill(doc, C.indigo50)
    draw(doc, C.indigo200)
    doc.setLineWidth(0.25)
    doc.rect(cx, y, cardW, cardH, 'FD')

    doc.setFontSize(6)
    doc.setFont('helvetica', 'normal')
    text(doc, C.indigo600)
    doc.text(card.label.toUpperCase(), cx + 3.5, y + 5.5)

    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    text(doc, C.gray900)
    doc.text(card.value, cx + 3.5, y + 13)

    if (card.sub) {
      doc.setFontSize(6)
      doc.setFont('helvetica', 'normal')
      text(doc, C.gray500)
      doc.text(card.sub, cx + 3.5, y + 17)
    }
  })

  doc.setFont('helvetica', 'normal')
  return y + cardH + 5
}

function drawSectionHeader(doc: jsPDF, label: string, y: number): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  text(doc, C.gray700)
  doc.text(label.toUpperCase(), MARGIN, y)
  draw(doc, C.gray200)
  doc.setLineWidth(0.2)
  doc.line(MARGIN, y + 1.5, PAGE_W - MARGIN, y + 1.5)
  doc.setFont('helvetica', 'normal')
  return y + 6
}

function drawBarChart(
  doc: jsPDF,
  data: { label: string; value: number }[],
  y: number,
  chartH = 52,
): number {
  if (data.length === 0) return y
  const capped = data.length > 30 ? data.slice(-30) : data
  const max = Math.max(...capped.map(d => d.value), 1)
  const barAreaH = chartH - 10
  const gap = capped.length > 20 ? 0.4 : 1.5
  const barW = (CW - gap * (capped.length - 1)) / capped.length

  fill(doc, C.gray50)
  doc.rect(MARGIN, y, CW, chartH, 'F')

  for (let lvl = 1; lvl <= 4; lvl++) {
    const lineY = y + barAreaH - (barAreaH * lvl) / 4
    draw(doc, C.gray200)
    doc.setLineWidth(0.15)
    doc.line(MARGIN, lineY, MARGIN + CW, lineY)
    doc.setFontSize(5.5)
    text(doc, C.gray500)
    doc.text(shortVal(max * lvl / 4), MARGIN + 1, lineY - 0.5)
  }

  capped.forEach((d, i) => {
    const bh = (d.value / max) * barAreaH
    const bx = MARGIN + i * (barW + gap)
    const by = y + barAreaH - bh
    fill(doc, C.indigo500)
    if (bh > 0.3) doc.rect(bx, by, barW, bh, 'F')

    if (capped.length <= 24) {
      const maxCh = Math.max(3, Math.floor(barW / 1.15))
      const lbl = d.label.length > maxCh ? d.label.slice(0, maxCh - 1) + '…' : d.label
      doc.setFontSize(5.5)
      text(doc, C.gray500)
      doc.text(lbl, bx + barW / 2, y + chartH - 0.5, { align: 'center' })
    }
  })

  draw(doc, C.gray500)
  doc.setLineWidth(0.3)
  doc.line(MARGIN, y + barAreaH, MARGIN + CW, y + barAreaH)

  return y + chartH + 5
}

function drawHBarChart(
  doc: jsPDF,
  data: { label: string; value: number; sub?: string }[],
  y: number,
  maxRows = 10,
): number {
  const rows = data.slice(0, maxRows)
  if (rows.length === 0) return y
  const max = Math.max(...rows.map(d => d.value), 1)
  const labelW = 36
  const valueW = 30
  const barMaxW = CW - labelW - valueW
  const rowH = 7.5

  rows.forEach((d, i) => {
    const ry = y + i * (rowH + 1)
    if (i % 2 === 0) {
      fill(doc, C.gray50)
      doc.rect(MARGIN, ry, CW, rowH, 'F')
    }
    const lbl = d.label.length > 22 ? d.label.slice(0, 21) + '…' : d.label
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    text(doc, C.gray700)
    doc.text(lbl, MARGIN + 2, ry + 5)

    const bw = (d.value / max) * barMaxW
    fill(doc, C.indigo500)
    if (bw > 0) doc.rect(MARGIN + labelW, ry + 2, bw, 3.5, 'F')

    doc.setFontSize(6.5)
    text(doc, C.gray500)
    doc.text(d.sub ?? formatNumber(d.value), MARGIN + labelW + barMaxW + 2, ry + 5)
  })

  return y + rows.length * (rowH + 1) + 4
}

const TABLE_STYLES = {
  headStyles: { fillColor: [79, 70, 229] as [number, number, number], textColor: [255, 255, 255] as [number, number, number], fontSize: 8, fontStyle: 'bold' as const },
  bodyStyles: { fontSize: 7.5, textColor: [55, 65, 81] as [number, number, number] },
  alternateRowStyles: { fillColor: [249, 250, 251] as [number, number, number] },
  margin: { left: MARGIN, right: MARGIN },
}


function buildRevenuePDF(report: RevenueReport, dateRange: string): jsPDF {
  const doc = makeDoc()
  const now = format(new Date(), 'MMM d, yyyy h:mm a')
  let y = drawHeader(doc, REPORT_META.revenue.label, dateRange)

  y = drawKPICards(doc, [
    { label: 'Total Revenue',    value: formatCurrency(report.totalRevenue) },
    { label: 'Transactions',     value: formatNumber(report.transactions) },
    { label: 'Avg Transaction',  value: formatCurrency(report.avgTransaction) },
    {
      label: 'Best Period',
      value: report.topPeriod ? shortVal(report.topPeriod.revenue) : '—',
      sub: report.topPeriod?.label,
    },
  ], y)

  y = drawSectionHeader(doc, `Revenue by ${report.granularity} Period`, y)
  const dateFmt = report.granularity === 'Monthly' ? 'MMM yy' : 'M/d'
  y = drawBarChart(doc, report.timeSeries.map(d => ({
    label: format(d.date, dateFmt),
    value: d.revenue,
  })), y, 55)

  y = drawSectionHeader(doc, 'Period Detail', y)
  const fullFmt = report.granularity === 'Monthly' ? 'MMMM yyyy' : 'MMM d, yyyy'
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: [['Period', 'Revenue', 'Transactions', 'Avg Transaction']],
    body: report.timeSeries.map(d => [
      format(d.date, fullFmt),
      formatCurrency(d.revenue),
      formatNumber(d.transactionCount),
      formatCurrency(d.transactionCount > 0 ? d.revenue / d.transactionCount : 0),
    ]),
    columnStyles: {
      0: { cellWidth: 55 },
      1: { halign: 'right', cellWidth: 42 },
      2: { halign: 'right', cellWidth: 40 },
      3: { halign: 'right', cellWidth: 45 },
    },
  })

  addFooters(doc, now)
  return doc
}

function buildTopProductsPDF(report: TopProductsReport, dateRange: string): jsPDF {
  const doc = makeDoc()
  const now = format(new Date(), 'MMM d, yyyy h:mm a')
  let y = drawHeader(doc, REPORT_META['top-products'].label, dateRange)

  y = drawKPICards(doc, [
    { label: 'Total Revenue',    value: formatCurrency(report.totalRevenue) },
    { label: 'Total Units Sold', value: formatNumber(report.totalUnits) },
    { label: 'Unique Products',  value: formatNumber(report.byRevenue.length) },
  ], y)

  y = drawSectionHeader(doc, 'Top Products by Revenue', y)
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: [['#', 'Product', 'Category', 'Revenue', 'Units', 'Avg Price']],
    body: report.byRevenue.map((p, i) => [
      i + 1, p.name, p.category || '—',
      formatCurrency(p.totalRevenue), formatNumber(p.totalUnitsSold), formatCurrency(p.avgPrice),
    ]),
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 62 },
      2: { cellWidth: 28 },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'right', cellWidth: 22 },
      5: { halign: 'right', cellWidth: 32 },
    },
  })

  doc.addPage()
  y = drawHeader(doc, REPORT_META['top-products'].label, dateRange)
  y = drawSectionHeader(doc, 'Top Products by Units Sold', y)
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: [['#', 'Product', 'Category', 'Units', 'Revenue', 'Avg Price']],
    body: report.byUnits.map((p, i) => [
      i + 1, p.name, p.category || '—',
      formatNumber(p.totalUnitsSold), formatCurrency(p.totalRevenue), formatCurrency(p.avgPrice),
    ]),
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 62 },
      2: { cellWidth: 28 },
      3: { halign: 'right', cellWidth: 22 },
      4: { halign: 'right', cellWidth: 30 },
      5: { halign: 'right', cellWidth: 32 },
    },
  })

  addFooters(doc, now)
  return doc
}

function buildCustomerBehaviorPDF(report: CustomerBehaviorReport, dateRange: string): jsPDF {
  const doc = makeDoc()
  const now = format(new Date(), 'MMM d, yyyy h:mm a')
  let y = drawHeader(doc, REPORT_META['customer-behavior'].label, dateRange)

  y = drawKPICards(doc, [
    { label: 'Total Transactions', value: formatNumber(report.totalTransactions) },
    { label: 'Total Revenue',      value: formatCurrency(report.totalRevenue) },
    { label: 'Avg Transaction',    value: formatCurrency(report.avgTransactionValue) },
    { label: 'Payment Methods',    value: formatNumber(report.paymentMethods.length) },
  ], y)

  y = drawSectionHeader(doc, 'Payment Methods', y)
  y = drawHBarChart(doc, report.paymentMethods.map(p => ({
    label: p.method,
    value: p.count,
    sub: `${formatNumber(p.count)} txns · ${formatPercent(p.pct)}`,
  })), y)

  y += 2
  y = drawSectionHeader(doc, 'Peak Hours', y)
  const busyHours = [...report.peakHours]
    .filter(h => h.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 14)
    .sort((a, b) => a.hour - b.hour)
  y = drawBarChart(doc, busyHours.map(h => ({ label: h.label, value: h.count })), y, 44)

  y = drawSectionHeader(doc, 'Sales by Day of Week', y)
  y = drawHBarChart(doc, report.peakDays.map(d => ({
    label: d.label, value: d.count, sub: `${formatNumber(d.count)} txns`,
  })), y, 7)

  if (y > 215) { doc.addPage(); y = drawHeader(doc, REPORT_META['customer-behavior'].label, dateRange) }
  y += 3
  y = drawSectionHeader(doc, 'Payment Method Detail', y)
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: [['Payment Method', 'Transactions', 'Share', 'Revenue', 'Avg Transaction']],
    body: report.paymentMethods.map(p => [
      p.method,
      formatNumber(p.count),
      formatPercent(p.pct),
      formatCurrency(p.revenue),
      formatCurrency(p.count > 0 ? p.revenue / p.count : 0),
    ]),
  })

  addFooters(doc, now)
  return doc
}

function buildTransactionLogPDF(report: TransactionLogReport, dateRange: string): jsPDF {
  const doc = makeDoc()
  const now = format(new Date(), 'MMM d, yyyy h:mm a')
  let y = drawHeader(doc, REPORT_META['transaction-log'].label, dateRange)

  y = drawKPICards(doc, [
    { label: 'Transactions',    value: formatNumber(report.count) },
    { label: 'Total Revenue',   value: formatCurrency(report.totalRevenue) },
    { label: 'Avg Transaction', value: formatCurrency(report.count > 0 ? report.totalRevenue / report.count : 0) },
  ], y)

  y = drawSectionHeader(doc, 'Transaction Log', y)
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: [['Date & Time', 'Items', 'Amount', 'Payment', 'Staff']],
    body: report.transactions.map(tx => [
      format(tx.date, 'MMM d, yyyy h:mm a'),
      tx.itemDescription.length > 55 ? tx.itemDescription.slice(0, 54) + '…' : tx.itemDescription,
      formatCurrency(tx.netSales),
      tx.paymentMethod || '—',
      tx.staffName || '—',
    ]),
    bodyStyles: { fontSize: 6.5, textColor: [55, 65, 81] as [number, number, number] },
    columnStyles: {
      0: { cellWidth: 36 },
      1: { cellWidth: 72 },
      2: { halign: 'right', cellWidth: 26 },
      3: { cellWidth: 26 },
      4: { cellWidth: 22 },
    },
  })

  addFooters(doc, now)
  return doc
}

function buildSeasonalPDF(report: SeasonalReport, dateRange: string): jsPDF {
  const doc = makeDoc()
  const now = format(new Date(), 'MMM d, yyyy h:mm a')
  let y = drawHeader(doc, REPORT_META.seasonal.label, dateRange)

  const avgMonthly = report.monthly.length > 0 ? report.totalRevenue / report.monthly.length : 0
  y = drawKPICards(doc, [
    { label: 'Total Revenue', value: formatCurrency(report.totalRevenue) },
    { label: 'Best Season',   value: report.bestSeason ?? '—', sub: report.seasons.find(s => s.name === report.bestSeason) ? formatCurrency(report.seasons.find(s => s.name === report.bestSeason)!.revenue) : undefined },
    { label: 'Best Month',    value: report.bestMonth ? shortVal(report.bestMonth.revenue) : '—', sub: report.bestMonth?.month },
    { label: 'Monthly Avg',   value: formatCurrency(avgMonthly) },
  ], y)

  y = drawSectionHeader(doc, 'Season Overview', y)
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: [['Season', 'Revenue', 'Share', 'Transactions', 'Avg Transaction', 'Top Product']],
    body: report.seasons.map(s => [
      `${s.icon} ${s.name}`,
      formatCurrency(s.revenue),
      `${s.revenueShare.toFixed(1)}%`,
      formatNumber(s.transactions),
      formatCurrency(s.avgTransaction),
      s.topProducts[0]?.name ?? '—',
    ]),
    columnStyles: {
      0: { cellWidth: 24 },
      1: { halign: 'right', cellWidth: 32 },
      2: { halign: 'right', cellWidth: 18 },
      3: { halign: 'right', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 32 },
      5: { cellWidth: 48 },
    },
  })
  y = (doc as any).lastAutoTable.finalY + 6

  for (const season of report.seasons) {
    if (season.topProducts.length === 0) continue
    if (y > 230) { doc.addPage(); y = drawHeader(doc, REPORT_META.seasonal.label, dateRange) }
    y = drawSectionHeader(doc, `${season.icon} ${season.name} — Top Products`, y)
    autoTable(doc, {
      ...TABLE_STYLES,
      startY: y,
      head: [['Product', 'Revenue', 'Units', 'Avg Price']],
      body: season.topProducts.map(p => [
        p.name, formatCurrency(p.totalRevenue), formatNumber(p.totalUnitsSold), formatCurrency(p.avgPrice),
      ]),
      columnStyles: {
        0: { cellWidth: 90 },
        1: { halign: 'right', cellWidth: 36 },
        2: { halign: 'right', cellWidth: 28 },
        3: { halign: 'right', cellWidth: 28 },
      },
    })
    y = (doc as any).lastAutoTable.finalY + 5
  }

  doc.addPage()
  y = drawHeader(doc, REPORT_META.seasonal.label, dateRange)
  y = drawSectionHeader(doc, 'Monthly Revenue', y)
  y = drawBarChart(doc, report.monthly.map(m => ({
    label: format(parseISO(m.month + '-01'), 'MMM yy'),
    value: m.revenue,
  })), y, 58)

  y = drawSectionHeader(doc, 'Monthly Breakdown', y)
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: [['Month', 'Revenue', 'Transactions', 'Avg Transaction']],
    body: report.monthly.map(m => [
      format(parseISO(m.month + '-01'), 'MMMM yyyy'),
      formatCurrency(m.revenue),
      formatNumber(m.transactions),
      formatCurrency(m.avgTransaction),
    ]),
    columnStyles: {
      0: { cellWidth: 55 },
      1: { halign: 'right', cellWidth: 43 },
      2: { halign: 'right', cellWidth: 43 },
      3: { halign: 'right', cellWidth: 41 },
    },
  })

  addFooters(doc, now)
  return doc
}

function buildMonthlyDetailPDF(report: MonthlyDetailReport, dateRange: string): jsPDF {
  const doc = makeDoc()
  const now = format(new Date(), 'MMM d, yyyy h:mm a')
  let y = drawHeader(doc, REPORT_META['monthly-detail'].label, dateRange)

  y = drawKPICards(doc, [
    { label: 'Total Revenue',      value: formatCurrency(report.totalRevenue) },
    { label: 'Total Transactions', value: formatNumber(report.totalTransactions) },
    { label: 'Monthly Avg',        value: formatCurrency(report.avgMonthlyRevenue) },
    {
      label: 'Best Month',
      value: report.bestMonth ? formatCurrency(report.bestMonth.revenue) : '—',
      sub: report.bestMonth?.label,
    },
  ], y)

  y = drawSectionHeader(doc, 'Monthly Revenue', y)
  y = drawBarChart(doc, report.rows.map(r => ({ label: format(parseISO(r.month + '-01'), 'MMM yy'), value: r.revenue })), y, 55)

  y = drawSectionHeader(doc, 'Monthly Breakdown', y)
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: [['Month', 'Revenue', 'Transactions', 'Avg Transaction', 'MoM Growth', 'Top Product']],
    body: report.rows.map(r => [
      r.label,
      formatCurrency(r.revenue),
      formatNumber(r.transactions),
      formatCurrency(r.avgTransaction),
      r.momGrowth != null ? `${r.momGrowth >= 0 ? '+' : ''}${r.momGrowth.toFixed(1)}%` : '—',
      r.topProduct ?? '—',
    ]),
    columnStyles: {
      0: { cellWidth: 36 },
      1: { halign: 'right', cellWidth: 30 },
      2: { halign: 'right', cellWidth: 26 },
      3: { halign: 'right', cellWidth: 30 },
      4: { halign: 'right', cellWidth: 22 },
      5: { cellWidth: 38 },
    },
  })

  addFooters(doc, now)
  return doc
}

function buildCashPDF(report: CashReport, dateRange: string): jsPDF {
  const doc = makeDoc()
  const now = format(new Date(), 'MMM d, yyyy h:mm a')
  let y = drawHeader(doc, REPORT_META.cash.label, dateRange)

  y = drawKPICards(doc, [
    { label: 'Cash Revenue',      value: formatCurrency(report.cashRevenue), sub: `${report.cashRevenuePct.toFixed(1)}% of total` },
    { label: 'Cash Transactions', value: formatNumber(report.cashTransactions), sub: `${report.cashPct.toFixed(1)}% of total` },
    { label: 'Avg Cash Sale',     value: formatCurrency(report.avgCashTransaction) },
    { label: 'Total Revenue',     value: formatCurrency(report.totalRevenue), sub: `${formatNumber(report.totalTransactions)} transactions` },
  ], y)

  y = drawSectionHeader(doc, 'Cash Sales by Day of Week', y)
  y = drawHBarChart(doc, report.byDayOfWeek.map(d => ({
    label: d.label, value: d.cashCount, sub: `${formatNumber(d.cashCount)} · ${formatCurrency(d.cashRevenue)}`,
  })), y, 7)

  y += 2
  y = drawSectionHeader(doc, 'Cash Sales by Hour', y)
  const busyHours = report.byHour.filter(h => h.cashCount > 0)
  y = drawBarChart(doc, busyHours.map(h => ({ label: h.label, value: h.cashCount })), y, 44)

  y = drawSectionHeader(doc, 'Payment Method Breakdown', y)
  y = drawHBarChart(doc, report.paymentBreakdown.map(p => ({
    label: p.method, value: p.revenue, sub: `${formatCurrency(p.revenue)} · ${formatNumber(p.count)} txns`,
  })), y)

  if (y > 180) { doc.addPage(); y = drawHeader(doc, REPORT_META.cash.label, dateRange) }
  y += 3
  y = drawSectionHeader(doc, 'Weekly Cash Totals', y)
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: [['Week', 'Cash Revenue', 'Cash Txns', 'Total Revenue', 'Cash %']],
    body: report.byWeek.map((w) => [
      w.weekLabel,
      formatCurrency(w.cashRevenue),
      formatNumber(w.cashCount),
      formatCurrency(w.totalRevenue),
      w.totalRevenue > 0 ? `${((w.cashRevenue / w.totalRevenue) * 100).toFixed(1)}%` : '—',
    ]),
    columnStyles: {
      0: { cellWidth: 60 },
      1: { halign: 'right', cellWidth: 36 },
      2: { halign: 'right', cellWidth: 24 },
      3: { halign: 'right', cellWidth: 36 },
      4: { halign: 'right', cellWidth: 26 },
    },
  })
  y = (doc as any).lastAutoTable.finalY + 5

  if (y > 200) { doc.addPage(); y = drawHeader(doc, REPORT_META.cash.label, dateRange) }
  y += 3
  y = drawSectionHeader(doc, 'Cash Transaction Log', y)
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: [['Date & Time', 'Items', 'Amount', 'Staff']],
    body: report.transactions.map(tx => [
      format(tx.date, 'MMM d, yyyy h:mm a'),
      tx.itemDescription.length > 60 ? tx.itemDescription.slice(0, 59) + '…' : tx.itemDescription,
      formatCurrency(tx.netSales),
      tx.staffName || '—',
    ]),
    bodyStyles: { fontSize: 6.5, textColor: [55, 65, 81] as [number, number, number] },
    columnStyles: {
      0: { cellWidth: 36 },
      1: { cellWidth: 82 },
      2: { halign: 'right', cellWidth: 26 },
      3: { cellWidth: 38 },
    },
  })

  addFooters(doc, now)
  return doc
}


export function exportToPDF(report: AnyReport, dateRange: string): void {
  let doc: jsPDF
  if      (report.type === 'revenue')           doc = buildRevenuePDF(report, dateRange)
  else if (report.type === 'top-products')      doc = buildTopProductsPDF(report, dateRange)
  else if (report.type === 'customer-behavior') doc = buildCustomerBehaviorPDF(report, dateRange)
  else if (report.type === 'transaction-log')   doc = buildTransactionLogPDF(report, dateRange)
  else if (report.type === 'seasonal')          doc = buildSeasonalPDF(report, dateRange)
  else if (report.type === 'monthly-detail')    doc = buildMonthlyDetailPDF(report, dateRange)
  else                                          doc = buildCashPDF(report, dateRange)

  doc.save(`walleys-${report.type}-${format(new Date(), 'yyyy-MM-dd')}.pdf`)
}


export interface AccountantPaymentRow {
  method: string
  revenue: number
  count: number
  pct: number
}

export interface AccountantProductRow {
  name: string
  revenue: number
  units: number
  costPerUnit: number | null
  totalCost: number | null
  grossProfit: number | null
  marginPct: number | null
}

export interface AccountantReportData {
  dateRange: string
  totalRevenue: number
  totalTransactions: number
  avgTransaction: number
  refundRevenue: number
  refundCount: number
  netRevenue: number
  totalCOGS: number | null
  grossProfit: number | null
  grossMarginPct: number | null
  paymentBreakdown: AccountantPaymentRow[]
  topProducts: AccountantProductRow[]
}

export function exportAccountantPDF(data: AccountantReportData): void {
  const doc = makeDoc()
  const now = format(new Date(), 'MMM d, yyyy h:mm a')
  let y = drawHeader(doc, 'Accountant Summary', data.dateRange)

  y = drawSectionHeader(doc, '1. Revenue', y)

  const hasCOGS = data.totalCOGS !== null
  const kpiCards: { label: string; value: string; sub?: string }[] = hasCOGS
    ? [
        { label: 'Gross Revenue',  value: formatCurrency(data.totalRevenue) },
        { label: 'Refunds',        value: formatCurrency(data.refundRevenue), sub: `${data.refundCount} refund(s)` },
        { label: 'Net Revenue',    value: formatCurrency(data.netRevenue) },
        { label: 'Gross Profit',   value: formatCurrency(data.grossProfit!), sub: `${data.grossMarginPct!.toFixed(1)}% margin` },
      ]
    : [
        { label: 'Gross Revenue',    value: formatCurrency(data.totalRevenue) },
        { label: 'Refunds',          value: formatCurrency(data.refundRevenue), sub: `${data.refundCount} refund(s)` },
        { label: 'Net Revenue',      value: formatCurrency(data.netRevenue) },
        { label: 'Transactions',     value: formatNumber(data.totalTransactions), sub: `avg ${formatCurrency(data.avgTransaction)}` },
      ]

  y = drawKPICards(doc, kpiCards, y)

  const revRows: [string, string][] = [
    ['Gross Revenue',         formatCurrency(data.totalRevenue)],
    ['Refunds / Adjustments', `(${formatCurrency(Math.abs(data.refundRevenue))})`],
    ['Net Revenue',           formatCurrency(data.netRevenue)],
    ['Total Transactions',    formatNumber(data.totalTransactions)],
    ['Avg Transaction Value', formatCurrency(data.avgTransaction)],
  ]
  if (hasCOGS) {
    revRows.push(
      ['Cost of Goods Sold',  formatCurrency(data.totalCOGS!)],
      ['Gross Profit',        formatCurrency(data.grossProfit!)],
      ['Gross Margin',        `${data.grossMarginPct!.toFixed(1)}%`],
    )
  }

  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    body: revRows,
    columnStyles: {
      0: { cellWidth: 100, fontStyle: 'bold' },
      1: { halign: 'right', cellWidth: 82 },
    },
  })
  y = (doc as any).lastAutoTable.finalY + 6

  y = drawSectionHeader(doc, '2. Payment Method Breakdown', y)
  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: [['Payment Method', 'Transactions', 'Share', 'Revenue', 'Avg Transaction']],
    body: data.paymentBreakdown.map(p => [
      p.method,
      formatNumber(p.count),
      `${p.pct.toFixed(1)}%`,
      formatCurrency(p.revenue),
      formatCurrency(p.count > 0 ? p.revenue / p.count : 0),
    ]),
    columnStyles: {
      0: { cellWidth: 52 },
      1: { halign: 'right', cellWidth: 32 },
      2: { halign: 'right', cellWidth: 22 },
      3: { halign: 'right', cellWidth: 38 },
      4: { halign: 'right', cellWidth: 38 },
    },
  })
  y = (doc as any).lastAutoTable.finalY + 6

  if (y > 200) { doc.addPage(); y = drawHeader(doc, 'Accountant Summary', data.dateRange) }
  y = drawSectionHeader(doc, '3. Top Products by Revenue', y)

  const productHead = hasCOGS
    ? [['#', 'Product', 'Revenue', 'Units', 'COGS', 'Gross Profit', 'Margin']]
    : [['#', 'Product', 'Revenue', 'Units', 'Avg Price']]

  const productBody = data.topProducts.map((p, i) =>
    hasCOGS
      ? [
          i + 1, p.name,
          formatCurrency(p.revenue),
          formatNumber(p.units),
          p.totalCost != null ? formatCurrency(p.totalCost) : '—',
          p.grossProfit != null ? formatCurrency(p.grossProfit) : '—',
          p.marginPct != null ? `${p.marginPct.toFixed(1)}%` : '—',
        ]
      : [
          i + 1, p.name,
          formatCurrency(p.revenue),
          formatNumber(p.units),
          formatCurrency(p.units > 0 ? p.revenue / p.units : 0),
        ],
  )

  autoTable(doc, {
    ...TABLE_STYLES,
    startY: y,
    head: productHead,
    body: productBody,
    columnStyles: hasCOGS
      ? {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 62 },
          2: { halign: 'right', cellWidth: 26 },
          3: { halign: 'right', cellWidth: 14 },
          4: { halign: 'right', cellWidth: 24 },
          5: { halign: 'right', cellWidth: 24 },
          6: { halign: 'right', cellWidth: 24 },
        }
      : {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 90 },
          2: { halign: 'right', cellWidth: 34 },
          3: { halign: 'right', cellWidth: 24 },
          4: { halign: 'right', cellWidth: 26 },
        },
  })

  addFooters(doc, now)
  doc.save(`walleys-accountant-report-${format(new Date(), 'yyyy-MM-dd')}.pdf`)
}

export function exportToCSV(report: AnyReport): void {
  let rows: (string | number)[][]
  let filename: string

  if (report.type === 'revenue') {
    rows = [
      ['Period', 'Revenue', 'Transactions', 'Avg Transaction'],
      ...report.timeSeries.map(d => [
        format(d.date, 'yyyy-MM-dd'),
        d.revenue.toFixed(2),
        d.transactionCount,
        (d.transactionCount > 0 ? d.revenue / d.transactionCount : 0).toFixed(2),
      ]),
    ]
    filename = `walleys-revenue-${format(new Date(), 'yyyy-MM-dd')}.csv`

  } else if (report.type === 'top-products') {
    rows = [
      ['Rank (Revenue)', 'Product', 'Category', 'Revenue', 'Units Sold', 'Avg Price'],
      ...report.byRevenue.map((p, i) => [i + 1, p.name, p.category || '', p.totalRevenue.toFixed(2), p.totalUnitsSold, p.avgPrice.toFixed(2)]),
    ]
    filename = `walleys-top-products-${format(new Date(), 'yyyy-MM-dd')}.csv`

  } else if (report.type === 'customer-behavior') {
    rows = [
      ['Payment Method', 'Transactions', 'Share %', 'Revenue', 'Avg Transaction'],
      ...report.paymentMethods.map(p => [
        p.method, p.count, p.pct.toFixed(1), p.revenue.toFixed(2),
        (p.count > 0 ? p.revenue / p.count : 0).toFixed(2),
      ]),
      [], ['Hour', 'Transactions'],
      ...report.peakHours.map(h => [h.label, h.count]),
      [], ['Day of Week', 'Transactions'],
      ...report.peakDays.map(d => [d.label, d.count]),
    ]
    filename = `walleys-customer-behavior-${format(new Date(), 'yyyy-MM-dd')}.csv`

  } else if (report.type === 'transaction-log') {
    rows = [
      ['Date', 'Items', 'Amount', 'Payment Method', 'Staff'],
      ...report.transactions.map(tx => [
        format(tx.date, 'yyyy-MM-dd HH:mm'),
        tx.itemDescription,
        tx.netSales.toFixed(2),
        tx.paymentMethod || '',
        tx.staffName || '',
      ]),
    ]
    filename = `walleys-transactions-${format(new Date(), 'yyyy-MM-dd')}.csv`

  } else if (report.type === 'seasonal') {
    rows = [
      ['Month', 'Revenue', 'Transactions', 'Avg Transaction'],
      ...report.monthly.map(m => [m.month, m.revenue.toFixed(2), m.transactions, m.avgTransaction.toFixed(2)]),
    ]
    filename = `walleys-seasonal-${format(new Date(), 'yyyy-MM-dd')}.csv`

  } else if (report.type === 'monthly-detail') {
    rows = [
      ['Month', 'Label', 'Revenue', 'Transactions', 'Avg Transaction', 'MoM Growth %', 'Top Product', 'Top Product Revenue'],
      ...report.rows.map(r => [
        r.month, r.label, r.revenue.toFixed(2), r.transactions, r.avgTransaction.toFixed(2),
        r.momGrowth != null ? r.momGrowth.toFixed(2) : '',
        r.topProduct ?? '', r.topProductRevenue.toFixed(2),
      ]),
    ]
    filename = `walleys-monthly-detail-${format(new Date(), 'yyyy-MM-dd')}.csv`

  } else {
    rows = [
      ['Week', 'Cash Revenue', 'Cash Transactions', 'Total Revenue', 'Cash %'],
      ...report.byWeek.map(w => [
        w.weekLabel, w.cashRevenue.toFixed(2), w.cashCount, w.totalRevenue.toFixed(2),
        w.totalRevenue > 0 ? ((w.cashRevenue / w.totalRevenue) * 100).toFixed(1) + '%' : '0%',
      ]),
      [], ['Date', 'Cash Revenue', 'Cash Count', 'Total Revenue'],
      ...report.byDay.map(d => [d.date, d.cashRevenue.toFixed(2), d.cashCount, d.totalRevenue.toFixed(2)]),
      [], ['Day of Week', 'Cash Count', 'Cash Revenue'],
      ...report.byDayOfWeek.map(d => [d.label, d.cashCount, d.cashRevenue.toFixed(2)]),
      [], ['Hour', 'Cash Count', 'Cash Revenue'],
      ...report.byHour.map(h => [h.label, h.cashCount, h.cashRevenue.toFixed(2)]),
      [], ['Date', 'Items', 'Amount', 'Staff'],
      ...report.transactions.map(tx => [
        format(tx.date, 'yyyy-MM-dd HH:mm'),
        tx.itemDescription,
        tx.netSales.toFixed(2),
        tx.staffName || '',
      ]),
    ]
    filename = `walleys-cash-${format(new Date(), 'yyyy-MM-dd')}.csv`
  }

  const csv = rows
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
