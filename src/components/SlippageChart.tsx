import { useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'
import type { SlippageChartPoint } from '../types'
import { getSlippageHistory } from '../lib/hydromancer'
import { closestTier } from '../lib/hydromancer'

interface SlippageChartProps {
  coin: string
  notionalUsd?: number
  startTime?: number
  endTime?: number
}

export function SlippageChart({
  coin,
  notionalUsd = 10_000,
  startTime,
  endTime,
}: SlippageChartProps) {
  const [data, setData] = useState<SlippageChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tier, setTier] = useState<number>(closestTier(notionalUsd))

  const tiers = [1_000, 5_000, 10_000, 30_000, 50_000, 100_000, 250_000, 500_000, 1_000_000]

  useEffect(() => {
    setLoading(true)
    setError(null)

    const now = Date.now()
    const start = startTime ?? now - 7 * 24 * 60 * 60 * 1000
    const end = endTime ?? now

    getSlippageHistory({ coin, amount: tier as ReturnType<typeof closestTier>, startTime: start, endTime: end, limit: 2000 })
      .then((pts) => {
        setData(
          pts.map((p) => ({
            time: p.timestamp,
            buyBps: p.buySlippageBps,
            sellBps: p.sellSlippageBps,
            halfSpreadBps: p.halfSpreadBps,
          })),
        )
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [coin, tier, startTime, endTime])

  function fmtTier(t: number) {
    if (t >= 1_000_000) return '$1M'
    if (t >= 1_000) return `$${(t / 1_000).toFixed(0)}K`
    return `$${t}`
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <span className="card-title">{coin} Historical Slippage</span>
          <p className="text-xs text-text-muted mt-0.5">
            15-minute sampled buy/sell slippage · Hydromancer
          </p>
        </div>

        {/* Tier selector */}
        <div className="flex items-center gap-1.5">
          {tiers.map((t) => (
            <button
              key={t}
              onClick={() => setTier(t)}
              className={`px-2 py-1 text-xs rounded font-mono transition-colors ${
                tier === t
                  ? 'bg-accent-blue text-white'
                  : 'bg-surface-3 text-text-muted hover:text-text-secondary'
              }`}
            >
              {fmtTier(t)}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {loading ? (
          <div className="h-56 flex items-center justify-center text-sm text-text-muted">
            <span className="w-4 h-4 border-2 border-text-muted/30 border-t-text-muted rounded-full animate-spin mr-2" />
            Loading slippage data…
          </div>
        ) : error ? (
          <div className="h-56 flex items-center justify-center text-sm text-neg text-center px-4">
            {error}
          </div>
        ) : data.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-sm text-text-muted">
            No slippage data available for {coin} at {fmtTier(tier)}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2A3A" />
              <XAxis
                dataKey="time"
                tickFormatter={(v) => format(new Date(v), 'MMM d')}
                tick={{ fontSize: 10, fill: '#4A5A72' }}
                axisLine={{ stroke: '#1E2A3A' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#4A5A72' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v} bps`}
                width={60}
              />
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ stroke: '#2A3A50', strokeWidth: 1 }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, color: '#8CA0BE', paddingTop: 8 }}
              />
              <ReferenceLine y={0} stroke="#2A3A50" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="buyBps"
                name="Buy Slippage"
                stroke="#10B981"
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="sellBps"
                name="Sell Slippage"
                stroke="#EF4444"
                strokeWidth={1.5}
                dot={false}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="halfSpreadBps"
                name="Half Spread"
                stroke="#8B5CF6"
                strokeWidth={1}
                strokeDasharray="4 4"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ name: string; value: number | null; color: string }>
  label?: number
}) {
  if (!active || !payload || !label) return null

  return (
    <div className="bg-surface-2 border border-border rounded-lg p-3 text-xs shadow-xl">
      <div className="font-mono text-text-muted mb-2">
        {format(new Date(label), 'MMM d HH:mm')}
      </div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-text-secondary">{p.name}:</span>
          <span className="font-mono font-medium text-text-primary ml-auto pl-4">
            {p.value !== null ? `${p.value.toFixed(2)} bps` : 'N/A'}
          </span>
        </div>
      ))}
    </div>
  )
}
