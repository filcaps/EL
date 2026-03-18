import { useState } from 'react'
import type { WalletSummary, TradeExecutionMetrics } from '../types'
import { SummaryCards, CancelTradeRatioCard } from './SummaryCards'
import { AssetBreakdown } from './AssetBreakdown'
import { TradeTable } from './TradeTable'
import { TradeDetail } from './TradeDetail'
import { SlippageChart } from './SlippageChart'
import { ExecutionDistributionChart } from './ExecutionDistributionChart'
import { ExecutionCostOverTime } from './ExecutionCostOverTime'
import { RefreshCw } from 'lucide-react'

interface WalletDashboardProps {
  summary: WalletSummary
  onRefresh?: () => void
}

export function WalletDashboard({ summary, onRefresh }: WalletDashboardProps) {
  const [selectedTrade, setSelectedTrade] = useState<TradeExecutionMetrics | null>(null)
  const [filterCoin, setFilterCoin] = useState<string | undefined>()

  const topCoin = summary.assetBreakdown[0]?.coin

  return (
    <div className="max-w-screen-2xl mx-auto px-4 md:px-6 py-6 space-y-5">
      {/* Summary row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary">
            {summary.address.slice(0, 6)}…{summary.address.slice(-4)}
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            Showing most recent {summary.totalTrades.toLocaleString()} fills
          </p>
        </div>
        {onRefresh && (
          <button onClick={onRefresh} className="btn-ghost flex items-center gap-1.5 text-xs">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        )}
      </div>

      {/* Metric cards */}
      <SummaryCards summary={summary} />

      {/* Cancel/Trade ratio */}
      <CancelTradeRatioCard ctr={summary.cancelTradeRatio} />

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ExecutionCostOverTime trades={summary.trades} filterCoin={filterCoin} />
        <ExecutionDistributionChart trades={summary.trades} filterCoin={filterCoin} />
      </div>

      {/* Slippage chart for top asset */}
      {topCoin && (
        <SlippageChart
          coin={filterCoin ?? topCoin}
          notionalUsd={(() => {
            const asset = summary.assetBreakdown.find((a) => a.coin === (filterCoin ?? topCoin))
            if (!asset || asset.totalTrades === 0) return 10_000
            return asset.totalVolumeUsd / asset.totalTrades
          })()}
          startTime={
            summary.trades.length > 0
              ? Math.min(...summary.trades.map((t) => t.timestamp)) - 24 * 60 * 60 * 1000
              : undefined
          }
          endTime={
            summary.trades.length > 0
              ? Math.max(...summary.trades.map((t) => t.timestamp)) + 24 * 60 * 60 * 1000
              : undefined
          }
        />
      )}

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
            {filterCoin}
            <span className="text-accent-blue/60">×</span>
          </button>
        </div>
      )}

      {/* Trade table */}
      <TradeTable
        trades={summary.trades}
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
