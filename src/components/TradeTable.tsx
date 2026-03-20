import { useState, useMemo } from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronUp, ChevronRight, SlidersHorizontal, X } from 'lucide-react'
import type { TradeExecutionMetrics } from '../types'
import type { BuilderFeeMap, BuilderFeeEntry } from '../App'
import { fmtBps, fmtUsd } from '../lib/metrics'
import { CoinIcon } from './CoinIcon'

type SortKey = keyof TradeExecutionMetrics
type SortDir = 'asc' | 'desc'
type MarketType = 'all' | 'spot' | 'perp' | 'hip-3'

interface TradeTableProps {
  trades: TradeExecutionMetrics[]
  builderFeeMap: BuilderFeeMap
  onSelectTrade: (trade: TradeExecutionMetrics) => void
  filterCoin?: string
}

function fmtSliderValue(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

/** Render bps on top, $ value below in muted smaller text */
function BpsCell({ bps, usd }: { bps: number | null; usd: number | null }) {
  if (bps === null) return <span className="text-text-muted">—</span>
  return (
    <div>
      <div>{fmtBps(bps)}</div>
      {usd !== null && (
        <div className="text-xs text-text-muted">{fmtUsd(usd)}</div>
      )}
    </div>
  )
}

export function TradeTable({ trades, builderFeeMap, onSelectTrade, filterCoin }: TradeTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  // ── Filter state ──────────────────────────────────────────────────────────
  const [showFilters, setShowFilters] = useState(false)
  const [marketType, setMarketType] = useState<MarketType>('all')
  const [minValue, setMinValue] = useState(0)
  const [maxValue, setMaxValue] = useState(Infinity)

  // Global bounds from all trades (ignoring coin filter)
  const { globalMax } = useMemo(() => {
    const vals = trades.map((t) => t.notionalUsd).filter((v) => v > 0)
    return {
      globalMax: vals.length ? Math.max(...vals) : 100_000,
    }
  }, [trades])

  // Initialise slider to full range when bounds are known
  const sliderMax = globalMax
  const sliderMin = minValue === 0 && maxValue === Infinity ? 0 : minValue
  const sliderMaxVal = minValue === 0 && maxValue === Infinity ? sliderMax : Math.min(maxValue, sliderMax)

  const activeFilters =
    marketType !== 'all' ||
    (minValue > 0) ||
    (maxValue < Infinity)

  function resetFilters() {
    setMarketType('all')
    setMinValue(0)
    setMaxValue(Infinity)
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
    setPage(0)
  }

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return trades.filter((t) => {
      if (filterCoin && t.coin !== filterCoin) return false
      if (marketType === 'spot' && !t.isSpot) return false
      if (marketType === 'perp' && t.isSpot) return false
      if (marketType === 'hip-3' && !t.isHip3) return false
      if (minValue > 0 && t.notionalUsd < minValue) return false
      if (maxValue < Infinity && t.notionalUsd > maxValue) return false
      return true
    })
  }, [trades, filterCoin, marketType, minValue, maxValue])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const va = a[sortKey]
      const vb = b[sortKey]
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filtered, sortKey, sortDir])

  const pageCount = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const marketTypeOptions: Array<{ key: MarketType; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'spot', label: 'Spot' },
    { key: 'perp', label: 'Perp' },
    { key: 'hip-3', label: 'HIP-3' },
  ]

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">
          Trade History {filterCoin ? `— ${filterCoin}` : ''}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted">{filtered.length} trades</span>
          <button
            onClick={() => setShowFilters((s) => !s)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
              showFilters || activeFilters
                ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/40'
                : 'btn-ghost'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filters
            {activeFilters && (
              <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
            )}
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="px-5 py-4 border-b border-border bg-surface-2 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-secondary">Filter trades</span>
            {activeFilters && (
              <button onClick={resetFilters} className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary transition-colors">
                <X className="w-3 h-3" /> Reset
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-6">
            {/* Market type */}
            <div>
              <div className="text-xs text-text-muted mb-2">Market type</div>
              <div className="flex rounded overflow-hidden border border-border">
                {marketTypeOptions.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => { setMarketType(key); setPage(0) }}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      marketType === key
                        ? 'bg-accent-blue text-white'
                        : 'bg-surface-1 text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Value range */}
            <div className="flex-1 min-w-[260px]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-text-muted">Trade value range</span>
                <span className="text-xs font-mono text-text-secondary">
                  {fmtSliderValue(sliderMin)} – {maxValue >= Infinity ? 'any' : fmtSliderValue(sliderMaxVal)}
                </span>
              </div>

              {/* Dual-thumb slider */}
              <div className="relative h-5 flex items-center">
                {/* Track */}
                <div className="absolute w-full h-1 bg-surface-3 rounded" />
                {/* Active range highlight */}
                <div
                  className="absolute h-1 bg-accent-blue/60 rounded"
                  style={{
                    left: `${(sliderMin / sliderMax) * 100}%`,
                    right: `${100 - (Math.min(sliderMaxVal, sliderMax) / sliderMax) * 100}%`,
                  }}
                />
                {/* Min thumb */}
                <input
                  type="range"
                  min={0}
                  max={sliderMax}
                  step={sliderMax / 200}
                  value={sliderMin}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setMinValue(v)
                    if (maxValue < v) setMaxValue(v)
                    setPage(0)
                  }}
                  className="range-thumb absolute w-full appearance-none bg-transparent"
                />
                {/* Max thumb */}
                <input
                  type="range"
                  min={0}
                  max={sliderMax}
                  step={sliderMax / 200}
                  value={sliderMaxVal}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setMaxValue(v >= sliderMax ? Infinity : v)
                    if (minValue > v) setMinValue(v)
                    setPage(0)
                  }}
                  className="range-thumb absolute w-full appearance-none bg-transparent"
                />
              </div>

              {/* Quick presets */}
              <div className="flex gap-1.5 mt-2">
                {[
                  { label: '< $1K', min: 0, max: 1_000 },
                  { label: '$1K–$10K', min: 1_000, max: 10_000 },
                  { label: '$10K–$100K', min: 10_000, max: 100_000 },
                  { label: '> $100K', min: 100_000, max: Infinity },
                ].map((p) => (
                  <button
                    key={p.label}
                    onClick={() => { setMinValue(p.min); setMaxValue(p.max); setPage(0) }}
                    className={`px-2 py-0.5 text-xs rounded transition-colors ${
                      minValue === p.min && maxValue === p.max
                        ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/40'
                        : 'bg-surface-3 text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto overflow-y-auto max-h-[560px]">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr>
              <SortableTh label="Date / Time" k="timestamp" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <SortableTh label="Asset" k="coin" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
              <th className="th">Side</th>
              <th className="th">Type</th>
              <SortableTh label="Size" k="notionalUsd" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Fill Px" k="fillPrice" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Spread" k="halfSpreadBps" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Slippage" k="slippageBps" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Mkt Impact" k="additionalImpactBps" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="HL Fee" k="feeBps" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <SortableTh label="Builder Fee" k="builderFee" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} align="right" />
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {paginated.map((t) => (
              <TradeRow key={t.tid} trade={t} builderFeeEntry={builderFeeMap.get(t.tid) ?? null} onClick={() => onSelectTrade(t)} />
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={12} className="td text-center text-text-muted py-8">
                  No trades match the current filters
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
  builderFeeEntry,
  onClick,
}: {
  trade: TradeExecutionMetrics
  builderFeeEntry: BuilderFeeEntry | null
  onClick: () => void
}) {
  const notional = t.notionalUsd

  const spreadUsd = t.halfSpreadBps !== null ? (t.halfSpreadBps * 2 * notional) / 10_000 : null
  const slippageUsd = t.slippageBps !== null ? (t.slippageBps * notional) / 10_000 : null
  const impactUsd = t.additionalImpactBps !== null ? (t.additionalImpactBps * notional) / 10_000 : null
  const builderBps =
    builderFeeEntry && builderFeeEntry.feeUsd > 0 && notional > 0
      ? (builderFeeEntry.feeUsd / notional) * 10_000
      : null

  return (
    <tr className="table-row-hover" onClick={onClick}>
      <td className="td font-mono text-xs whitespace-nowrap">
        <div>{format(new Date(t.timestamp), 'MMM d, yyyy')}</div>
        <div className="text-text-muted">{format(new Date(t.timestamp), 'HH:mm:ss')}</div>
      </td>
      <td className="td-primary font-semibold">
        <div className="flex items-center gap-1.5">
          <CoinIcon symbol={t.coinDisplay} size={16} />
          {t.coinDisplay}
        </div>
      </td>
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
      <td className="td text-right font-mono">
        ${t.fillPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
      </td>
      <td className="td text-right text-text-secondary">
        <BpsCell bps={t.halfSpreadBps !== null ? t.halfSpreadBps * 2 : null} usd={spreadUsd} />
      </td>
      <td className="td text-right text-text-secondary">
        <BpsCell bps={t.slippageBps} usd={slippageUsd} />
      </td>
      <td className="td text-right text-text-secondary">
        <BpsCell bps={t.additionalImpactBps} usd={impactUsd} />
      </td>
      <td className="td text-right text-text-secondary">
        <BpsCell bps={t.feeBps} usd={t.fee} />
      </td>
      <td className="td text-right text-text-secondary">
        {builderBps !== null ? (
          <BpsCell bps={builderBps} usd={builderFeeEntry!.feeUsd} />
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
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
