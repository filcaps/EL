import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { format } from 'date-fns'
import type { TradeExecutionMetrics } from '../types'
import { fmtUsd } from '../lib/metrics'

interface CostChartProps {
  trades: TradeExecutionMetrics[]
}

interface ChartPoint {
  date: number
  cumCost: number
  cumFees: number
}

export function CostChart({ trades }: CostChartProps) {
  const data = useMemo<ChartPoint[]>(() => {
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp)
    let cumCost = 0
    let cumFees = 0
    return sorted.map((t) => {
      const slippageCost = t.slippageBps !== null
        ? Math.max(0, (t.slippageBps / 10_000) * t.notionalUsd)
        : 0
      cumFees += t.fee
      cumCost += t.fee + slippageCost
      return { date: t.timestamp, cumCost, cumFees }
    })
  }, [trades])

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        No data
      </div>
    )
  }

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-xs">
        <div className="text-text-muted mb-1">{format(new Date(label), 'MMM d, yyyy HH:mm')}</div>
        <div className="text-text-secondary">Total cost: <span className="text-text-primary font-mono">{fmtUsd(payload[0]?.value ?? 0)}</span></div>
        <div className="text-text-secondary">Fees only: <span className="text-text-primary font-mono">{fmtUsd(payload[1]?.value ?? 0)}</span></div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="feesGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#555555" stopOpacity={0.12} />
            <stop offset="95%" stopColor="#555555" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => format(new Date(v), 'MMM d')}
          tick={{ fill: '#555', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={60}
        />
        <YAxis
          tickFormatter={(v) => fmtUsd(v, 0)}
          tick={{ fill: '#555', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="cumCost"
          name="Total Cost"
          stroke="#3B82F6"
          strokeWidth={1.5}
          fill="url(#costGrad)"
          dot={false}
          activeDot={{ r: 3, fill: '#3B82F6' }}
        />
        <Area
          type="monotone"
          dataKey="cumFees"
          name="Fees"
          stroke="#444"
          strokeWidth={1}
          fill="url(#feesGrad)"
          dot={false}
          activeDot={{ r: 3, fill: '#666' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
