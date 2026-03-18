import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { format } from 'date-fns'
import type { TradeExecutionMetrics } from '../types'

interface ExecutionCostOverTimeProps {
  trades: TradeExecutionMetrics[]
  filterCoin?: string
}

export function ExecutionCostOverTime({ trades, filterCoin }: ExecutionCostOverTimeProps) {
  const relevant = filterCoin ? trades.filter((t) => t.coin === filterCoin) : trades
  const points = relevant
    .filter((t) => t.totalCostBps !== null)
    .map((t) => ({
      time: t.timestamp,
      bps: t.totalCostBps as number,
      coin: t.coin,
      side: t.side,
      notional: t.notionalUsd,
    }))
    .sort((a, b) => a.time - b.time)

  if (points.length < 2) return null

  const mean = points.reduce((s, p) => s + p.bps, 0) / points.length

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <span className="card-title">Execution Cost Over Time</span>
          <p className="text-xs text-text-muted mt-0.5">
            Total cost per trade in basis points
          </p>
        </div>
        <span className="text-xs text-text-muted font-mono">avg {mean.toFixed(2)} bps</span>
      </div>

      <div className="p-5">
        <ResponsiveContainer width="100%" height={200}>
          <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E2A3A" />
            <XAxis
              dataKey="time"
              type="number"
              domain={['auto', 'auto']}
              tickFormatter={(v) => format(new Date(v), 'MMM d')}
              tick={{ fontSize: 10, fill: '#4A5A72' }}
              axisLine={{ stroke: '#1E2A3A' }}
              tickLine={false}
            />
            <YAxis
              dataKey="bps"
              tick={{ fontSize: 10, fill: '#4A5A72' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}`}
              width={36}
              label={{ value: 'bps', angle: -90, position: 'insideLeft', offset: 10, fontSize: 10, fill: '#4A5A72' }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.[0]) return null
                const p = payload[0].payload as (typeof points)[0]
                return (
                  <div className="bg-surface-2 border border-border rounded p-2.5 text-xs space-y-1">
                    <div className="text-text-muted font-mono">{format(new Date(p.time), 'MMM d HH:mm')}</div>
                    <div className="text-text-primary font-semibold">{p.coin}</div>
                    <div className={p.side === 'buy' ? 'text-pos' : 'text-neg'}>{p.side.toUpperCase()}</div>
                    <div className="font-mono text-text-primary">{p.bps.toFixed(2)} bps</div>
                  </div>
                )
              }}
            />
            <ReferenceLine y={mean} stroke="#8B5CF6" strokeDasharray="4 4" label={{ value: 'avg', fill: '#8B5CF6', fontSize: 10 }} />
            <Scatter
              data={points}
              fill="#3B82F6"
              opacity={0.7}
              shape={(props: { cx?: number; cy?: number; payload?: (typeof points)[0] }) => {
                const { cx = 0, cy = 0, payload } = props
                const bps = payload?.bps ?? 0
                const color = bps > 10 ? '#EF4444' : bps > 3 ? '#F59E0B' : '#10B981'
                return <circle cx={cx} cy={cy} r={3} fill={color} fillOpacity={0.7} />
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
