import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import type { TradeExecutionMetrics } from '../types'

interface ExecutionDistributionChartProps {
  trades: TradeExecutionMetrics[]
  filterCoin?: string
}

function buildHistogram(values: number[], buckets = 20): Array<{ label: string; count: number; midpoint: number }> {
  if (values.length === 0) return []

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min
  if (range === 0) return [{ label: `${min.toFixed(1)}`, count: values.length, midpoint: min }]

  const step = range / buckets
  const hist = Array.from({ length: buckets }, (_, i) => {
    const lo = min + i * step
    const hi = lo + step
    const mid = (lo + hi) / 2
    return {
      label: mid.toFixed(1),
      midpoint: mid,
      count: values.filter((v) => (i === buckets - 1 ? v >= lo && v <= hi : v >= lo && v < hi)).length,
    }
  })

  return hist.filter((b) => b.count > 0)
}

export function ExecutionDistributionChart({ trades, filterCoin }: ExecutionDistributionChartProps) {
  const relevant = filterCoin ? trades.filter((t) => t.coin === filterCoin) : trades
  const costs = relevant.map((t) => t.totalCostBps).filter((v): v is number => v !== null)

  if (costs.length < 3) return null

  const hist = buildHistogram(costs, Math.min(30, Math.ceil(costs.length / 2)))
  const mean = costs.reduce((s, v) => s + v, 0) / costs.length

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <span className="card-title">Execution Cost Distribution</span>
          <p className="text-xs text-text-muted mt-0.5">
            Total cost per trade (bps) · mean: {mean.toFixed(2)} bps
          </p>
        </div>
        <span className="text-xs text-text-muted">{costs.length} trades</span>
      </div>

      <div className="p-5">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={hist} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E2A3A" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: '#4A5A72' }}
              axisLine={{ stroke: '#1E2A3A' }}
              tickLine={false}
              label={{ value: 'bps', position: 'insideBottomRight', offset: 4, fontSize: 10, fill: '#4A5A72' }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#4A5A72' }}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null
                return (
                  <div className="bg-surface-2 border border-border rounded p-2 text-xs">
                    <div className="text-text-muted">{payload[0].payload.label} bps</div>
                    <div className="font-mono text-text-primary">{payload[0].value} trades</div>
                  </div>
                )
              }}
            />
            <Bar dataKey="count" radius={[2, 2, 0, 0]}>
              {hist.map((entry) => (
                <Cell
                  key={entry.midpoint}
                  fill={
                    entry.midpoint > 10
                      ? '#EF4444'
                      : entry.midpoint > 3
                      ? '#F59E0B'
                      : '#10B981'
                  }
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
