import { useState, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { importCSVTransactions, importXLSXCatalogue, importShopifyCSV, importEtsyCSV, importOpexXLSX } from '../engine/importEngine'
import { clearAllData, exportAllData, restoreAllData } from '../db/dbUtils'
import { isShopifyCSV, isEtsyCSV } from '../engine/shopifyParser'
import { useToastStore } from '../store/toastStore'
import { formatNumber } from '../utils/format'
import Papa from 'papaparse'

export default function ImportView() {
  const { show } = useToastStore()
  const txCount = useLiveQuery(() => db.salesTransactions.count(), []) ?? 0
  const catCount = useLiveQuery(() => db.catalogueProducts.count(), []) ?? 0
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const csvRef = useRef<HTMLInputElement>(null)
  const xlsxRef = useRef<HTMLInputElement>(null)
  const shopifyRef = useRef<HTMLInputElement>(null)
  const etsyRef = useRef<HTMLInputElement>(null)
  const opexRef = useRef<HTMLInputElement>(null)
  const backupRef = useRef<HTMLInputElement>(null)

  async function handleCSV(file: File) {
    setImporting(true)
    try {
      const result = await importCSVTransactions(file)
      if (result.errors.length > 0) {
        show(result.errors[0], 'error')
      } else if (result.added === 0) {
        show('No new transactions found (all already imported).', 'info')
      } else {
        const skippedNote = result.skipped > 0 ? ` · ${result.skipped} rows skipped (missing date)` : ''
        show(`Added ${result.added} of ${result.total} transactions${skippedNote}`, 'success')
      }
    } catch (e) {
      show(`CSV import failed: ${(e as Error).message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  async function handleShopify(file: File) {
    setImporting(true)
    try {
      const result = await importShopifyCSV(file)
      if (result.errors.length > 0) {
        show(result.errors[0], 'error')
      } else if (result.added === 0) {
        show('No new Shopify orders found (all already imported).', 'info')
      } else {
        const skippedNote = result.skipped > 0 ? ` · ${result.skipped} orders skipped` : ''
        show(`Added ${result.added} of ${result.total} Shopify orders${skippedNote}`, 'success')
      }
    } catch (e) {
      show(`Shopify import failed: ${(e as Error).message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  async function handleEtsy(file: File) {
    setImporting(true)
    try {
      const result = await importEtsyCSV(file)
      if (result.errors.length > 0) {
        show(result.errors[0], 'error')
      } else if (result.added === 0) {
        show('No new Etsy orders found (all already imported).', 'info')
      } else {
        const skippedNote = result.skipped > 0 ? ` · ${result.skipped} orders skipped` : ''
        show(`Added ${result.added} of ${result.total} Etsy orders${skippedNote}`, 'success')
      }
    } catch (e) {
      show(`Etsy import failed: ${(e as Error).message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  async function handleOpex(file: File) {
    setImporting(true)
    try {
      const result = await importOpexXLSX(file)
      if (result.errors.length > 0) {
        show(result.errors[0], 'error')
      } else if (result.added === 0) {
        show('No operating expenses found in the file.', 'info')
      } else {
        show(`Imported ${result.added} operating expense entries`, 'success')
      }
    } catch (e) {
      show(`OPEX import failed: ${(e as Error).message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  async function handleXLSX(file: File) {
    setImporting(true)
    try {
      const result = await importXLSXCatalogue(file)
      if (result.errors.length > 0) {
        show(result.errors[0], 'error')
      } else {
        show(`Imported ${result.added} catalogue products`, 'success')
      }
    } catch (e) {
      show(`XLSX import failed: ${(e as Error).message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    if (file.name.endsWith('.xlsx')) {
      handleXLSX(file)
    } else if (file.name.endsWith('.csv')) {
      const text = await file.text()
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, preview: 1 })
      const headers = parsed.meta.fields ?? []
      if (isShopifyCSV(headers)) {
        handleShopify(file)
      } else if (isEtsyCSV(headers)) {
        handleEtsy(file)
      } else {
        handleCSV(file)
      }
    } else {
      show('Unsupported file type. Drop a .csv or .xlsx file.', 'error')
    }
  }

  async function handleExportBackup() {
    try {
      const json = await exportAllData()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `walleys-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      show('Backup downloaded', 'success')
    } catch (e) {
      show(`Backup failed: ${(e as Error).message}`, 'error')
    }
  }

  async function handleRestoreBackup(file: File) {
    setImporting(true)
    try {
      const text = await file.text()
      const result = await restoreAllData(text)
      show(`Restored ${result.transactions} transactions · ${result.catalogue} catalogue products`, 'success')
    } catch (e) {
      show(`Restore failed: ${(e as Error).message}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  async function handleClearAll() {
    try {
      await clearAllData()
      show('All data cleared', 'info')
    } catch (e) {
      show(`Clear failed: ${(e as Error).message}`, 'error')
    } finally {
      setConfirmClear(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Import Data</h1>
        <p className="text-sm text-slate-200 mt-1">
          {formatNumber(txCount)} transactions · {formatNumber(catCount)} catalogue products stored
        </p>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          dragging ? 'border-teal-400 bg-teal-500/10' : 'border-slate-600 hover:border-teal-300 bg-slate-900'
        }`}
        onClick={() => csvRef.current?.click()}
      >
        <div className="w-12 h-12 rounded-xl bg-slate-700 border border-slate-600 flex items-center justify-center mx-auto mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        </div>
        <p className="font-medium text-slate-200">Drop Square CSV here or click to browse</p>
        <p className="text-sm text-slate-200 mt-1">Accepts Square transaction export (.csv)</p>
        <input ref={csvRef} type="file" accept=".csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleCSV(f); e.target.value = '' }} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-slate-800/30 border border-slate-700/40 p-5">
          <div className="flex items-center gap-2 mb-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
            <h2 className="font-semibold text-slate-200">Shopify Orders</h2>
          </div>
          <p className="text-sm text-slate-200 mb-3">Import from Shopify Admin → Orders → Export as CSV.</p>
          <button
            onClick={() => shopifyRef.current?.click()}
            className="px-4 py-2 bg-teal-500 text-slate-950 rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-50"
            disabled={importing}
          >
            {importing ? 'Importing…' : 'Select Shopify CSV'}
          </button>
          <input ref={shopifyRef} type="file" accept=".csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleShopify(f); e.target.value = '' }} />
        </div>

        <div className="bg-slate-800/30 border border-slate-700/40 p-5">
          <div className="flex items-center gap-2 mb-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
            <h2 className="font-semibold text-slate-200">Etsy Orders</h2>
          </div>
          <p className="text-sm text-slate-200 mb-3">Import from Etsy Shop Manager → Orders → Download CSV.</p>
          <button
            onClick={() => etsyRef.current?.click()}
            className="px-4 py-2 bg-teal-500 text-slate-950 rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-50"
            disabled={importing}
          >
            {importing ? 'Importing…' : 'Select Etsy CSV'}
          </button>
          <input ref={etsyRef} type="file" accept=".csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleEtsy(f); e.target.value = '' }} />
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 p-5">
        <div className="flex items-center gap-2 mb-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          <h2 className="font-semibold text-slate-200">Operating Expenses (XLSX)</h2>
        </div>
        <p className="text-sm text-slate-200 mb-3">Import the Walley's Ops spreadsheet to bulk-load operating expenses.</p>
        <button
          onClick={() => opexRef.current?.click()}
          className="px-4 py-2 bg-teal-500 text-slate-950 rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-50"
          disabled={importing}
        >
          {importing ? 'Importing…' : 'Select Ops XLSX'}
        </button>
        <input ref={opexRef} type="file" accept=".xlsx" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleOpex(f); e.target.value = '' }} />
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 p-5">
        <h2 className="font-semibold text-slate-200 mb-3">Catalogue Import (XLSX)</h2>
        <p className="text-sm text-slate-200 mb-3">Import Square Item Library export to enable price tracking and catalogue checking.</p>
        <button
          onClick={() => xlsxRef.current?.click()}
          className="px-4 py-2 bg-teal-500 text-slate-950 rounded-lg text-sm font-medium hover:bg-teal-600 disabled:opacity-50"
          disabled={importing}
        >
          {importing ? 'Importing…' : 'Select XLSX file'}
        </button>
        <input ref={xlsxRef} type="file" accept=".xlsx" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleXLSX(f); e.target.value = '' }} />
      </div>

      <div className="bg-slate-800/30 border border-slate-700/40 p-5">
        <h2 className="font-semibold text-slate-200 mb-1">Data Backup</h2>
        <p className="text-sm text-slate-200 mb-4">Export all your data to a backup file. Restore it after reinstalling or on a new machine.</p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleExportBackup}
            className="px-4 py-2 bg-teal-500 text-slate-950 rounded-lg text-sm font-medium hover:bg-teal-600"
          >
            Export Backup (.json)
          </button>
          <button
            onClick={() => backupRef.current?.click()}
            disabled={importing}
            className="px-4 py-2 bg-slate-700 text-slate-200 border border-slate-600 rounded-lg text-sm font-medium hover:bg-slate-600 disabled:opacity-50"
          >
            {importing ? 'Restoring…' : 'Restore from Backup'}
          </button>
          <input ref={backupRef} type="file" accept=".json" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleRestoreBackup(f); e.target.value = '' }} />
        </div>
        <p className="text-xs text-amber-400 mt-3">Restoring overwrites all current data. Export a backup first if you want to keep it.</p>
      </div>

      {(txCount > 0 || catCount > 0) && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <h2 className="font-semibold text-red-300 mb-1">Clear All Data</h2>
          <p className="text-sm text-red-400 mb-3">Permanently deletes all transactions, catalogue products, and settings stored locally.</p>
          {confirmClear ? (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-red-400">Are you sure? This cannot be undone.</span>
              <button
                onClick={handleClearAll}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-700"
              >
                Yes, delete everything
              </button>
              <button
                onClick={() => setConfirmClear(false)}
                className="px-4 py-2 bg-slate-800 border border-slate-600 text-slate-100 rounded-lg text-sm font-medium hover:bg-slate-700/50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmClear(true)}
              className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-700"
            >
              Clear everything
            </button>
          )}
        </div>
      )}
    </div>
  )
}
