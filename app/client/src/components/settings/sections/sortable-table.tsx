import { useMemo, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface SortableColumn<T> {
  key: string
  label: string
  sortType: 'string' | 'number'
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
  /** Optional value-extractor for sort comparison. Defaults to the render output. */
  sortValue?: (row: T) => string | number
  /** Extra class names applied to both header and cells. */
  className?: string
}

export interface SortableTableProps<T> {
  rows: T[]
  columns: SortableColumn<T>[]
  defaultSort: { key: string; dir: 'asc' | 'desc' }
  /**
   * Optional footer row rendered as a `<tfoot>` inside the same
   * table so columns line up with the data rows. The array is
   * keyed by column order (one ReactNode per column, in the same
   * order as `columns`). Use `null` for cells you want empty.
   */
  footer?: (ReactNode | null)[]
}

/**
 * Generic table with click-to-sort headers. Header click toggles
 * direction on the active column; clicking a different column moves
 * the sort there in its default direction (desc for number, asc for
 * string).
 */
export function SortableTable<T>({ rows, columns, defaultSort, footer }: SortableTableProps<T>) {
  const [sort, setSort] = useState(defaultSort)

  const sortedRows = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const accessor = col.sortValue ?? ((r: T) => String(col.render(r)))
    const sorted = [...rows].sort((a, b) => {
      const av = accessor(a)
      const bv = accessor(b)
      if (col.sortType === 'number') {
        return (Number(av) || 0) - (Number(bv) || 0)
      }
      return String(av).localeCompare(String(bv))
    })
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [rows, columns, sort])

  function onHeaderClick(col: SortableColumn<T>) {
    setSort((cur) => {
      if (cur.key === col.key) {
        return { key: col.key, dir: cur.dir === 'desc' ? 'asc' : 'desc' }
      }
      return { key: col.key, dir: col.sortType === 'number' ? 'desc' : 'asc' }
    })
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted-foreground border-b border-border">
          {columns.map((col) => {
            const isActive = col.key === sort.key
            const indicator = isActive ? (sort.dir === 'desc' ? '▾' : '▴') : ''
            return (
              <th
                key={col.key}
                onClick={() => onHeaderClick(col)}
                className={cn(
                  'font-normal py-1.5 px-2 cursor-pointer select-none whitespace-nowrap',
                  col.align === 'right' && 'text-right',
                  isActive && 'text-amber-500',
                  col.className,
                )}
              >
                {col.label}
                {indicator && <span className="ml-1">{indicator}</span>}
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody className="font-mono">
        {sortedRows.map((row, i) => (
          <tr key={i} className="border-b border-border/40">
            {columns.map((col) => (
              <td
                key={col.key}
                className={cn(
                  'py-1 px-2 text-foreground',
                  col.align === 'right' && 'text-right',
                  col.className,
                )}
              >
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {footer && (
        <tfoot className="font-mono">
          <tr className="border-t border-border text-muted-foreground">
            {columns.map((col, i) => (
              <td
                key={col.key}
                className={cn(
                  'py-1.5 px-2 whitespace-nowrap',
                  col.align === 'right' && 'text-right',
                  col.className,
                )}
              >
                {footer[i] ?? ''}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  )
}
