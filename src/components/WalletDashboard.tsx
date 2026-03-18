import { useState } from 'react'
import type { WalletSummary, TradeExecutionMetrics } from '../types'
import { SummaryCards, CancelTradeRatioCard, TotalCostCard } from './SummaryCards'
import { AssetBreakdown } from './AssetBreakdown'
import { TradeTable } from './TradeTable'
import { TradeDetail } from './TradeDetail'
import { SlippageChart } from './SlippageChart'
import { RefreshCw } from 'lucide-react'
import { isPerpCoin } from '../lib/hyperliquid'

interface WalletDashboardProps {
  summary: WalletSummary
  onRefresh?: () => void
}

export function WalletDashboard({ summary, onRefresh }: WalletDashboardProps) {
  const [selectedTrade, setSelectedTrade] = useState<TradeExecutionMetrics | null>(null)
  const [filterCoin, setFilterCoin] = useState<string | undefined>()

  // Only use a perp coin for the slippage chart — Hydromancer has no data for spot (@N) coins
  const topPerpCoin = summary.assetBreakdown.find((a) => isPerpCoin(a.coin))?.coin
  const chartCoin = filterCoin && isPerpCoin(filterCoin) ? filterCoin : topPerpCoin

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-text-primary font-mono">
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

      {/* Total cost in $ */}
      <TotalCostCard summary={summary} />

      {/* Cancel/Trade ratio */}
      <CancelTradeRatioCard ctr={summary.cancelTradeRatio} />

      {/* Slippage chart — perp coins only */}
      {chartCoin && (
        <SlippageChart
          coin={chartCoin}
          notionalUsd={(() => {
            const asset = summary.assetBreakdown.find((a) => a.coin === chartCoin)
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
            {summary.assetBreakdown.find((a) => a.coin === filterCoin)?.displayName ?? filterCoin}
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
