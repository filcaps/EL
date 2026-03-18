import type { AssetSummary } from '../types'
import { fmtBps, fmtUsd, bpsColorClass } from '../lib/metrics'
import { ChevronRight } from 'lucide-react'

interface AssetBreakdownProps {
  assets: AssetSummary[]
  onSelectAsset?: (coin: string) => void
}

export function AssetBreakdown({ assets, onSelectAsset }: AssetBreakdownProps) {
  if (assets.length === 0) return null

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Asset Breakdown</span>
        <span className="text-xs text-text-muted">{assets.length} markets</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Asset</th>
              <th className="th text-right">Trades</th>
              <th className="th text-right">Volume (wallet)</th>
              <th className="th text-right">24h Mkt Vol</th>
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
            {assets.map((a) => {
              const takerPct =
                a.totalTrades > 0 ? ((a.takerTrades / a.totalTrades) * 100).toFixed(0) : '—'

              return (
                <tr
                  key={a.coin}
                  className="table-row-hover"
                  onClick={() => onSelectAsset?.(a.coin)}
                >
                  <td className="td-primary font-semibold">{a.coin}</td>
                  <td className="td text-right">{a.totalTrades}</td>
                  <td className="td text-right">{fmtUsd(a.totalVolumeUsd)}</td>
                  <td className="td text-right text-text-muted">
                    {a.dayVolumeUsd > 0 ? fmtUsd(a.dayVolumeUsd) : '—'}
                  </td>
                  <td className="td text-right text-warn">{fmtUsd(a.totalFeesUsd)}</td>
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
