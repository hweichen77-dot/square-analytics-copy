import { useState } from 'react'

export interface Column<T> {
  key: string
  label: string
  render?: (row: T) => React.ReactNode
  getValue?: (row: T) => number | string
  align?: 'left' | 'right' | 'center'
}

interface SortableTableProps<T> {
  data: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string | number
  defaultSortKey?: string
  defaultSortDir?: 'asc' | 'desc'
  maxRows?: number
}

export function SortableTable<T>({
  data,
  columns,
  rowKey,
  defaultSortKey,
  defaultSortDir = 'desc',
  maxRows,
}: SortableTableProps<T>) {
  const [sortKey, setSortKey] = useState(defaultSortKey ?? columns[0]?.key ?? '')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultSortDir)

  const sorted = [...data].sort((a, b) => {
    const col = columns.find(c => c.key === sortKey)
    const getVal = col?.getValue
    if (!getVal) return 0
    const av = getVal(a)
    const bv = getVal(b)
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv))
    return sortDir === 'asc' ? cmp : -cmp
  })

  const displayed = maxRows ? sorted.slice(0, maxRows) : sorted

  function handleSort(key: string) {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const alignClass = (align?: 'left' | 'right' | 'center') =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-900/70 text-slate-200 uppercase text-[10px] tracking-wider">
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className={`px-4 py-3 font-semibold cursor-pointer select-none hover:text-slate-300 transition-colors ${alignClass(col.align)}`}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-1 text-teal-400">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/40">
          {displayed.map((row, idx) => (
            <tr key={rowKey(row)} className={`hover:bg-slate-700/30 transition-colors ${idx % 2 === 1 ? 'bg-slate-800/40' : ''}`}>
              {columns.map(col => (
                <td key={col.key} className={`px-4 py-3 text-slate-100 ${alignClass(col.align)}`}>
                  {col.render ? col.render(row) : col.getValue ? String(col.getValue(row)) : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {displayed.length === 0 && (
        <div className="text-center py-10 text-slate-200 text-sm">No data to display.</div>
      )}
    </div>
  )
}
