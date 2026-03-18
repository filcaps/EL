import { TrendingDown, TrendingUp, DollarSign, Activity, RefreshCw, Info } from 'lucide-react'
import type { WalletSummary } from '../types'
import { fmtBps, fmtUsd, bpsColorClass } from '../lib/metrics'

interface SummaryCardsProps {
  summary: WalletSummary
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  const coveragePct = Math.round(summary.slippageDataCoverage * 100)

  const cards = [
    {
      label: 'Total Trades',
      value: summary.totalTrades.toLocaleString(),
      sub: `${summary.assetBreakdown.length} asset${summary.assetBreakdown.length !== 1 ? 's' : ''}`,
      icon: <Activity className="w-4 h-4 text-accent-blue" />,
      valueClass: 'text-text-primary',
    },
    {
      label: 'Total Volume',
      value: fmtUsd(summary.totalVolumeUsd, 0),
      sub: `Avg ${fmtUsd(summary.totalVolumeUsd / Math.max(summary.totalTrades, 1))} per trade`,
      icon: <DollarSign className="w-4 h-4 text-accent-cyan" />,
      valueClass: 'text-text-primary',
    },
    {
      label: 'Total Fees Paid',
      value: fmtUsd(summary.totalFeesUsd),
      sub: `${fmtBps((summary.totalFeesUsd / Math.max(summary.totalVolumeUsd, 1)) * 10_000)} avg`,
      icon: <TrendingDown className="w-4 h-4 text-warn" />,
      valueClass: 'text-warn',
    },
    {
      label: 'Avg Effective Spread',
      value: fmtBps(summary.avgEffectiveSpreadBps),
      sub: 'Volume-weighted · from candle data',
      icon: <TrendingUp className="w-4 h-4 text-text-muted" />,
      valueClass: bpsColorClass(summary.avgEffectiveSpreadBps),
    },
    {
      label: 'Avg Slippage (takers)',
      value: fmtBps(summary.avgSlippageBps),
      sub: `${coveragePct}% trades have HM data`,
      icon: <TrendingDown className="w-4 h-4 text-text-muted" />,
      valueClass: bpsColorClass(summary.avgSlippageBps),
      coverageWarning: coveragePct < 50,
    },
    {
      label: 'Avg Total Cost',
      value: fmtBps(summary.avgTotalCostBps),
      sub:
        summary.estimatedTotalCostUsd !== null
          ? `≈ ${fmtUsd(summary.estimatedTotalCostUsd)} total`
          : 'Slippage + fees',
      icon: <Activity className="w-4 h-4 text-text-muted" />,
      valueClass: bpsColorClass(summary.avgTotalCostBps),
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="metric-label">{c.label}</span>
            <div className="flex items-center gap-1">
              {'coverageWarning' in c && c.coverageWarning && (
                <span title="Less than 50% of trades have Hydromancer slippage data — averages may be incomplete">
                  <Info className="w-3.5 h-3.5 text-warn" />
                </span>
              )}
              {c.icon}
            </div>
          </div>
          <div className={`metric-value ${c.valueClass} text-xl`}>{c.value}</div>
          <div className="mt-1 text-xs text-text-muted">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

interface CancelTradeRatioCardProps {
  ctr: WalletSummary['cancelTradeRatio']
}

export function CancelTradeRatioCard({ ctr }: CancelTradeRatioCardProps) {
  if (!ctr) return null
  const pct = ctr.ratio.toFixed(1)
  const isHigh = ctr.ratio > 5

  return (
    <div className="card p-4 flex items-start gap-4">
      <div className="shrink-0 w-9 h-9 rounded bg-surface-4 flex items-center justify-center">
        <RefreshCw className="w-4 h-4 text-text-secondary" />
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="metric-label">Cancel / Trade Ratio</span>
          <span className={`font-mono text-sm font-semibold ${isHigh ? 'text-warn' : 'text-pos'}`}>
            {pct}×
          </span>
          <span className="text-xs text-text-muted">
            over {ctr.windowDays > 0 ? `~${ctr.windowDays}d window` : 'available history'}
          </span>
        </div>
        <div className="flex gap-4 text-xs text-text-muted font-mono">
          <span>{ctr.cancelledOrders.toLocaleString()} cancelled</span>
          <span>{ctr.filledOrders.toLocaleString()} filled</span>
          <span>{ctr.totalOrders.toLocaleString()} total orders in window</span>
        </div>
        {isHigh && (
          <p className="mt-1.5 text-xs text-warn/80">
            High CTR may indicate algo strategies or quote-stuffing during volatile periods.
          </p>
        )}
      </div>
    </div>
  )
}
