import { TrendingDown, TrendingUp, DollarSign, Activity, RefreshCw, Info, Zap } from 'lucide-react'
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

interface TotalCostCardProps {
  summary: WalletSummary
}

export function TotalCostCard({ summary }: TotalCostCardProps) {
  const feesUsd = summary.totalFeesUsd
  const vol = Math.max(summary.totalVolumeUsd, 1)
  const feeBpsAvg = (feesUsd / vol) * 10_000

  // Est. slippage cost derived from avg slippage bps × volume — always a positive cost.
  // If avgSlippageBps is null or negative (rare: genuine price improvement vs benchmark),
  // treat as zero to keep the sign consistent with fees.
  const rawSlippageCostUsd =
    summary.avgSlippageBps !== null
      ? (summary.avgSlippageBps / 10_000) * summary.totalVolumeUsd
      : null
  const slippageCostUsd =
    rawSlippageCostUsd !== null ? Math.max(0, rawSlippageCostUsd) : null
  const isImprovement = rawSlippageCostUsd !== null && rawSlippageCostUsd < 0

  // Total = fees + slippage (both positive costs)
  const totalCostUsd =
    slippageCostUsd !== null ? feesUsd + slippageCostUsd : null

  // avg total bps for color
  const avgTotalBps =
    summary.avgSlippageBps !== null
      ? feeBpsAvg + Math.max(0, summary.avgSlippageBps)
      : null

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-accent-blue" />
        <span className="card-title">Total Execution Cost</span>
        <span className="text-xs text-text-muted ml-auto">fees + slippage · estimated</span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="text-xs text-text-muted mb-1">Fees Paid</div>
          <div className="font-mono text-xl font-semibold text-warn">{fmtUsd(feesUsd)}</div>
          <div className="text-xs text-text-muted mt-0.5">
            {fmtBps(feeBpsAvg)} avg
          </div>
        </div>

        <div>
          <div className="text-xs text-text-muted mb-1">Est. Slippage Cost</div>
          <div className={`font-mono text-xl font-semibold ${slippageCostUsd !== null ? 'text-warn' : 'text-text-muted'}`}>
            {slippageCostUsd !== null ? fmtUsd(slippageCostUsd) : '—'}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {isImprovement
              ? 'price improvement vs benchmark'
              : fmtBps(summary.avgSlippageBps !== null ? Math.max(0, summary.avgSlippageBps) : null) + ' avg'}
          </div>
        </div>

        <div className="border-l border-border pl-4">
          <div className="text-xs text-text-muted mb-1">Total</div>
          <div className={`font-mono text-2xl font-bold ${totalCostUsd !== null ? bpsColorClass(avgTotalBps) : 'text-text-muted'}`}>
            {totalCostUsd !== null ? fmtUsd(totalCostUsd) : '—'}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {fmtBps(avgTotalBps)} avg · across {summary.totalTrades.toLocaleString()} trades
          </div>
        </div>
      </div>
    </div>
  )
}
