import { useState } from 'react'
import type { WalletSummary, TradeExecutionMetrics } from '../types'
import type { BuilderFeeMap } from '../App'
import { AssetBreakdown } from './AssetBreakdown'
import { TradeTable } from './TradeTable'
import { TradeDetail } from './TradeDetail'
import { CostChart } from './CostChart'
import { RefreshCw } from 'lucide-react'
import { fmtUsd, fmtBps } from '../lib/metrics'

interface WalletDashboardProps {
  summary: WalletSummary
  builderFeeMap: BuilderFeeMap
  enrichmentDone: boolean
  onRefresh?: () => void
}

export function WalletDashboard({ summary, builderFeeMap, enrichmentDone, onRefresh }: WalletDashboardProps) {
  const [selectedTrade, setSelectedTrade] = useState<TradeExecutionMetrics | null>(null)
  const [filterCoin, setFilterCoin] = useState<string | undefined>()

  const builderFeesTotal =
    builderFeeMap.size > 0
      ? Array.from(builderFeeMap.values()).reduce((s, v) => s + v, 0)
      : summary.trades.reduce((s, t) => s + t.builderFee, 0)

  const totalSlippageUsd = summary.avgSlippageBps !== null
    ? Math.max(0, (summary.avgSlippageBps / 10_000) * summary.totalVolumeUsd)
    : null

  const stats = [
    { label: 'Total Trades', value: summary.totalTrades.toLocaleString() },
    { label: 'Volume', value: fmtUsd(summary.totalVolumeUsd, 0) },
    { label: 'Closed PnL', value: fmtUsd(summary.totalPnl) },
    { label: 'HL Fees Paid', value: fmtUsd(summary.totalFeesUsd) },
    {
      label: 'Builder Fees Paid',
      value: enrichmentDone
        ? (builderFeesTotal > 0 ? fmtUsd(builderFeesTotal) : '—')
        : 'loading…',
      enriching: !enrichmentDone,
    },
    { label: 'Total Slippage', value: totalSlippageUsd !== null ? fmtUsd(totalSlippageUsd) : '—' },
    { label: 'Avg Execution Cost', value: fmtBps(summary.avgTotalCostBps) },
  ]

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-8 space-y-6">
      {/* Address + refresh row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary font-mono">
            {summary.address.slice(0, 6)}…{summary.address.slice(-4)}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            {summary.totalTrades.toLocaleString()} fills · {summary.assetBreakdown.length} asset{summary.assetBreakdown.length !== 1 ? 's' : ''}
          </p>
        </div>
        {onRefresh && (
          <button onClick={onRefresh} className="btn-ghost flex items-center gap-1.5 text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        )}
      </div>

      {/* Main: stats left + chart right */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Left: stats panel */}
        <div className="card p-5 flex flex-col gap-0 divide-y divide-border">
          {stats.map((s) => (
            <div key={s.label} className="py-3.5 flex items-center justify-between">
              <span className="text-xs text-text-muted">{s.label}</span>
              <span className={`font-mono text-sm font-medium ${
                'enriching' in s && s.enriching ? 'text-text-dim italic' : 'text-text-secondary'
              }`}>
                {s.value}
              </span>
            </div>
          ))}
        </div>

        {/* Right: chart */}
        <div className="card p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <span className="card-title">Total Execution Cost</span>
            <div className="flex items-center gap-4 text-xs text-text-muted">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-px bg-accent-blue" />
                Total (fees + slippage)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-px bg-border-bright" />
                Fees only
              </span>
            </div>
          </div>
          <div className="flex-1 min-h-[220px]">
            <CostChart trades={summary.trades} />
          </div>
        </div>
      </div>

      {/* Asset breakdown */}
      <AssetBreakdown
        assets={summary.assetBreakdown}
        onSelectAsset={(coin) => setFilterCoin((c) => (c === coin ? undefined : coin))}
      />

      {/* Active filter pill */}
      {filterCoin && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">Filtering by:</span>
          <button
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-accent-blue/20 border border-accent-blue/40 rounded-full text-xs text-accent-blue"
            onClick={() => setFilterCoin(undefined)}
          >
            {summary.assetBreakdown.find((a) => a.coin === filterCoin)?.displayName ?? filterCoin}
            <span className="text-accent-blue/60">×</span>
          </button>
        </div>
      )}

      {/* Trade table */}
      <TradeTable
        trades={summary.trades}
        builderFeeMap={builderFeeMap}
        onSelectTrade={setSelectedTrade}
        filterCoin={filterCoin}
      />

      {/* Trade detail panel */}
      {selectedTrade && (
        <TradeDetail trade={selectedTrade} onClose={() => setSelectedTrade(null)} />
      )}
    </div>
  )
}
