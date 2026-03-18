import type { OrderBookMetrics } from '../types'
import { fmtBps, fmtUsd } from '../lib/metrics'

interface OrderBookPanelProps {
  metrics: OrderBookMetrics | null
  loading: boolean
}

export function OrderBookPanel({ metrics, loading }: OrderBookPanelProps) {
  if (loading) {
    return (
      <div className="card p-5 text-center text-sm text-text-muted">
        <div className="inline-block w-4 h-4 border-2 border-text-muted/30 border-t-text-muted rounded-full animate-spin mb-2" />
        <p>Fetching live spread…</p>
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="card p-5 text-center text-sm text-text-muted">
        Spread data unavailable
      </div>
    )
  }

  const spreadQuality =
    metrics.bidAskSpreadBps < 2 ? 'tight' : metrics.bidAskSpreadBps < 8 ? 'moderate' : 'wide'

  const spreadColor =
    spreadQuality === 'tight' ? 'text-pos' : spreadQuality === 'moderate' ? 'text-warn' : 'text-neg'

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <span className="card-title">Live Spread — {metrics.coin}</span>
          <p className="text-xs text-text-muted mt-0.5">
            Used as fallback when Hydromancer spread is unavailable for a fill
          </p>
        </div>
        <span className="text-xs text-text-muted font-mono">
          {new Date(metrics.timestamp).toLocaleTimeString()}
        </span>
      </div>

      <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-5">
        {/* Best bid */}
        <div>
          <div className="metric-label mb-1">Best Bid</div>
          <div className="font-mono text-pos font-semibold">
            ${metrics.bestBid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {metrics.topBidSize.toFixed(4)} {metrics.coin}
          </div>
        </div>

        {/* Best ask */}
        <div>
          <div className="metric-label mb-1">Best Ask</div>
          <div className="font-mono text-neg font-semibold">
            ${metrics.bestAsk.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {metrics.topAskSize.toFixed(4)} {metrics.coin}
          </div>
        </div>

        {/* Bid-ask spread */}
        <div>
          <div className="metric-label mb-1">Bid-Ask Spread</div>
          <div className={`font-mono font-semibold ${spreadColor}`}>
            {fmtBps(metrics.bidAskSpreadBps)}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            Half: {fmtBps(metrics.halfSpreadBps)} · {spreadQuality}
          </div>
        </div>

        {/* 24h volume */}
        <div>
          <div className="metric-label mb-1">24h Volume</div>
          <div className="font-mono text-text-primary font-semibold">
            {fmtUsd(metrics.dayVolumeUsd)}
          </div>
          <div className="text-xs text-text-muted mt-0.5">Notional USD</div>
        </div>
      </div>
    </div>
  )
}
