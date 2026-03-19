import { useState } from 'react'
import type { AssetSummary } from '../types'
import { fmtBps, fmtUsd, bpsColorClass } from '../lib/metrics'
import { ChevronRight } from 'lucide-react'

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

const SMALL_VOL_THRESHOLDS = [100, 1000] as const

export function AssetBreakdown({ assets, onSelectAsset }: AssetBreakdownProps) {
  const [hideThreshold, setHideThreshold] = useState<number | null>(null)

  if (assets.length === 0) return null

  const visible = hideThreshold !== null
    ? assets.filter((a) => a.totalVolumeUsd >= hideThreshold)
    : assets

  const hidden = assets.length - visible.length

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Asset Breakdown</span>
        <div className="flex items-center gap-2">
          {/* Small-volume filter toggle */}
          <span className="text-xs text-text-muted">Hide &lt;</span>
          {SMALL_VOL_THRESHOLDS.map((t) => (
            <button
              key={t}
              onClick={() => setHideThreshold((prev) => (prev === t ? null : t))}
              className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                hideThreshold === t
                  ? 'bg-surface-3 border-border-bright text-text-secondary'
                  : 'border-border text-text-muted hover:text-text-secondary hover:border-border-bright'
              }`}
            >
              {t >= 1000 ? `$${t / 1000}K` : `$${t}`}
            </button>
          ))}
          <span className="text-xs text-text-muted ml-1">
            {hidden > 0 ? `· ${hidden} hidden` : `· ${visible.length} markets`}
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
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
                      className="hover:text-text-primary transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
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
          </tbody>
        </table>
      </div>
    </div>
  )
}
