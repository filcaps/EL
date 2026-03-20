import { useState, useRef } from 'react'
import type { AssetSummary } from '../types'
import { fmtBps, fmtUsd, bpsColorClass } from '../lib/metrics'
import { ChevronRight, Search, X } from 'lucide-react'
import { CoinIcon } from './CoinIcon'

interface AssetBreakdownProps {
  assets: AssetSummary[]
  onSelectAsset?: (coin: string) => void
}

function hlTradeUrl(displayName: string, coin: string): string {
  // Spot coins have "@N" raw coin; perps use the displayName directly
  const isSpot = coin.startsWith('@')
  if (isSpot) return `https://app.hyperliquid.xyz/spot/${displayName}`
  return `https://app.hyperliquid.xyz/trade/${displayName}`
}

type VolumeFilter = 'all' | 100 | 1_000 | 10_000 | 100_000

const VOLUME_FILTERS: Array<{ key: VolumeFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 100, label: '>$100' },
  { key: 1_000, label: '>$1K' },
  { key: 10_000, label: '>$10K' },
  { key: 100_000, label: '>$100K' },
]

export function AssetBreakdown({ assets, onSelectAsset }: AssetBreakdownProps) {
  const [volumeFilter, setVolumeFilter] = useState<VolumeFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  if (assets.length === 0) return null

  function handleSearchToggle() {
    if (showSearch) {
      setShowSearch(false)
      setSearchQuery('')
    } else {
      setShowSearch(true)
      setTimeout(() => searchInputRef.current?.focus(), 0)
    }
  }

  const minVolume = volumeFilter === 'all' ? 0 : volumeFilter

  const visible = assets.filter((a) => {
    if (minVolume > 0 && a.totalVolumeUsd < minVolume) return false
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      if (!a.displayName.toLowerCase().includes(q) && !a.coin.toLowerCase().includes(q)) return false
    }
    return true
  })

  const hidden = assets.length - visible.length

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Asset Breakdown</span>
        <div className="flex items-center gap-2">
          {/* Search input */}
          {showSearch && (
            <div className="flex items-center gap-1 bg-surface-3 border border-border rounded px-2 py-0.5">
              <Search className="w-3 h-3 text-text-muted shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="bg-transparent text-xs text-text-primary placeholder-text-muted outline-none w-24"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-text-muted hover:text-text-secondary">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Search toggle */}
          <button
            onClick={handleSearchToggle}
            className={`p-1 rounded transition-colors ${
              showSearch
                ? 'text-accent-blue'
                : 'text-text-muted hover:text-text-secondary'
            }`}
            title="Search assets"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          {/* Volume filter buttons */}
          <div className="flex items-center gap-1">
            {VOLUME_FILTERS.map(({ key, label }) => (
              <button
                key={String(key)}
                onClick={() => setVolumeFilter(key)}
                className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                  volumeFilter === key
                    ? 'bg-surface-3 border-border-bright text-text-secondary'
                    : 'border-border text-text-muted hover:text-text-secondary hover:border-border-bright'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="text-xs text-text-muted ml-1">
            {hidden > 0 ? `· ${hidden} hidden` : `· ${visible.length} markets`}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto overflow-y-auto max-h-[420px]">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-surface-1">
            <tr>
              <th className="th">Asset</th>
              <th className="th text-right">Trades</th>
              <th className="th text-right">Volume</th>
              <th className="th text-right">Fees</th>
              <th className="th text-right">Eff. Spread</th>
              <th className="th text-right">Half-Spread</th>
              <th className="th text-right">Mkt Impact</th>
              <th className="th text-right">Arrival Cost</th>
              <th className="th text-right">Total Cost</th>
              <th className="th text-right">Taker %</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {visible.map((a) => {
              const takerPct =
                a.totalTrades > 0 ? ((a.takerTrades / a.totalTrades) * 100).toFixed(0) : '—'
              const url = hlTradeUrl(a.displayName, a.coin)

              return (
                <tr
                  key={a.coin}
                  className="table-row-hover"
                  onClick={() => onSelectAsset?.(a.coin)}
                >
                  <td className="td-primary font-semibold">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 hover:text-text-primary transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <CoinIcon symbol={a.displayName} size={16} />
                      {a.displayName}
                    </a>
                  </td>
                  <td className="td text-right">{a.totalTrades}</td>
                  <td className="td text-right">{fmtUsd(a.totalVolumeUsd)}</td>
                  <td className="td text-right text-text-secondary">{fmtUsd(a.totalFeesUsd)}</td>
                  <td className={`td text-right ${bpsColorClass(a.avgEffectiveSpreadBps)}`}>
                    {fmtBps(a.avgEffectiveSpreadBps)}
                  </td>
                  <td className={`td text-right ${bpsColorClass(a.avgHalfSpreadBps)}`}>
                    {fmtBps(a.avgHalfSpreadBps)}
                  </td>
                  <td className={`td text-right ${bpsColorClass(a.avgAdditionalImpactBps)}`}>
                    {fmtBps(a.avgAdditionalImpactBps)}
                  </td>
                  <td className={`td text-right ${bpsColorClass(a.avgArrivalCostBps)}`}>
                    {fmtBps(a.avgArrivalCostBps)}
                  </td>
                  <td className={`td text-right font-semibold ${bpsColorClass(a.avgTotalCostBps)}`}>
                    {fmtBps(a.avgTotalCostBps)}
                  </td>
                  <td className="td text-right text-text-secondary">{takerPct}%</td>
                  <td className="td text-right">
                    <ChevronRight className="w-3.5 h-3.5 text-text-muted ml-auto" />
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={11} className="td text-center text-text-muted py-8">
                  No assets match the current filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
