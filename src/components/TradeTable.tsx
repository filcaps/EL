import { useState } from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronUp, ChevronRight } from 'lucide-react'
import type { TradeExecutionMetrics } from '../types'
import { fmtBps, fmtUsd, bpsColorClass } from '../lib/metrics'

type SortKey = keyof TradeExecutionMetrics
type SortDir = 'asc' | 'desc'

interface TradeTableProps {
  trades: TradeExecutionMetrics[]
  onSelectTrade: (trade: TradeExecutionMetrics) => void
  filterCoin?: string
}

export function TradeTable({ trades, onSelectTrade, filterCoin }: TradeTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
    setPage(0)
  }

  const filtered = filterCoin ? trades.filter((t) => t.coin === filterCoin) : trades

  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortKey]
    const vb = b[sortKey]
    if (va === null || va === undefined) return 1
    if (vb === null || vb === undefined) return -1
    const cmp = va < vb ? -1 : va > vb ? 1 : 0
    return sortDir === 'asc' ? cmp : -cmp
  })

  const pageCount = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          Trade History {filterCoin ? `— ${filterCoin}` : ''}
        </span>
        <span className="text-xs text-text-muted">{filtered.length} trades</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <SortableTh label="Date / Time" k="timestamp" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableTh label="Asset" k="coin" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <th className="th">Side</th>
              <th className="th">Type</th>
              <SortableTh label="Size" k="notionalUsd" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Fill Px" k="fillPrice" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Mid Px" k="midPriceAtExecution" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Eff. Spread" k="effectiveSpreadBps" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Slippage" k="slippageBps" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Arrival Cost" k="arrivalCostBps" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Total Cost" k="totalCostBps" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Fee" k="fee" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {paginated.map((t) => (
              <TradeRow key={t.tid} trade={t} onClick={() => onSelectTrade(t)} />
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={13} className="td text-center text-text-muted py-8">
                  No trades found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <span className="text-xs text-text-muted">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of{' '}
            {filtered.length}
          </span>
          <div className="flex gap-1">
            <button
              className="btn-ghost px-2 py-1 text-xs disabled:opacity-30"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Prev
            </button>
            <button
              className="btn-ghost px-2 py-1 text-xs disabled:opacity-30"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TradeRow({
  trade: t,
  onClick,
}: {
  trade: TradeExecutionMetrics
  onClick: () => void
}) {
  return (
    <tr className="table-row-hover" onClick={onClick}>
      <td className="td font-mono text-xs whitespace-nowrap">
        {format(new Date(t.timestamp), 'MMM d, HH:mm:ss')}
      </td>
      <td className="td-primary font-semibold">{t.coinDisplay}</td>
      <td className="td">
        {t.side === 'buy' ? (
          <span className="tag-buy">BUY</span>
        ) : (
          <span className="tag-sell">SELL</span>
        )}
      </td>
      <td className="td font-mono text-xs">
        {t.isTaker ? (
          <span className="text-text-secondary">Taker</span>
        ) : (
          <span className="text-text-muted">Maker</span>
        )}
      </td>
      <td className="td text-right">
        <div className="text-text-primary">{fmtUsd(t.notionalUsd)}</div>
        <div className="text-xs text-text-muted">
          {t.size.toFixed(4)} {t.coinDisplay}
        </div>
      </td>
      <td className="td text-right font-mono">${t.fillPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
      <td className="td text-right font-mono">
        {t.midPriceAtExecution !== null
          ? `$${t.midPriceAtExecution.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
          : '—'}
      </td>
      <td className={`td text-right ${bpsColorClass(t.effectiveSpreadBps)}`}>
        {fmtBps(t.effectiveSpreadBps)}
      </td>
      <td className={`td text-right ${bpsColorClass(t.slippageBps)}`}>
        {fmtBps(t.slippageBps)}
        {t.slippageBps !== null && (
          <div className="text-xs text-text-dim">
            {t.slippageSource === 'hydromancer' ? 'HM' : t.slippageSource === 'live_book' ? 'live' : ''}
          </div>
        )}
      </td>
      <td className={`td text-right ${bpsColorClass(t.arrivalCostBps)}`}>
        {fmtBps(t.arrivalCostBps)}
      </td>
      <td className={`td text-right font-semibold ${bpsColorClass(t.totalCostBps)}`}>
        {fmtBps(t.totalCostBps)}
      </td>
      <td className="td text-right text-warn">{fmtUsd(t.fee)}</td>
      <td className="td text-right">
        <ChevronRight className="w-3.5 h-3.5 text-text-muted ml-auto" />
      </td>
    </tr>
  )
}

function SortableTh({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  align = 'left',
}: {
  label: string
  k: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
}) {
  const active = sortKey === k
  return (
    <th
      className={`th cursor-pointer hover:text-text-secondary select-none ${align === 'right' ? 'text-right' : ''}`}
      onClick={() => onSort(k)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          sortDir === 'asc' ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )
        ) : null}
      </span>
    </th>
  )
}
