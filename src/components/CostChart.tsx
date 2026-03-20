import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { format } from 'date-fns'
import type { TradeExecutionMetrics } from '../types'
import type { BuilderFeeMap } from '../App'
import { fmtUsd } from '../lib/metrics'

interface CostChartProps {
  trades: TradeExecutionMetrics[]
  builderFeeMap: BuilderFeeMap
}

interface ChartPoint {
  date: number
  cumCost: number
  cumFees: number
  cumBuilder: number
}

export function CostChart({ trades, builderFeeMap }: CostChartProps) {
  const data = useMemo<ChartPoint[]>(() => {
    const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp)
    if (sorted.length === 0) return []

    let cumCost = 0
    let cumFees = 0
    let cumBuilder = 0

    // Anchor at zero just before the first trade so the chart starts flat
    const points: ChartPoint[] = [
      { date: sorted[0].timestamp - 1, cumCost: 0, cumFees: 0, cumBuilder: 0 },
    ]

    for (const t of sorted) {
      const slippageCost =
        t.slippageBps !== null ? Math.max(0, (t.slippageBps / 10_000) * t.notionalUsd) : 0
      // Prefer enriched builder fee entry; fall back to what was parsed from the fill
      const builderCost = builderFeeMap.get(t.tid)?.feeUsd ?? t.builderFee ?? 0
      cumFees += t.fee
      cumBuilder += builderCost
      cumCost += t.fee + slippageCost + builderCost
      points.push({ date: t.timestamp, cumCost, cumFees, cumBuilder })
    }

    return points
  }, [trades, builderFeeMap])

  const hasBuilderFees = (data[data.length - 1]?.cumBuilder ?? 0) > 0

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        No data
      </div>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const total = payload.find((p: any) => p.dataKey === 'cumCost')?.value ?? 0
    const fees = payload.find((p: any) => p.dataKey === 'cumFees')?.value ?? 0
    const builder = payload.find((p: any) => p.dataKey === 'cumBuilder')?.value ?? 0
    return (
      <div className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-xs">
        <div className="text-text-muted mb-1.5">{format(new Date(label), 'MMM d, yyyy HH:mm')}</div>
        <div className="space-y-0.5">
          <div className="text-text-secondary">
            Total: <span className="text-text-primary font-mono">{fmtUsd(total)}</span>
          </div>
          <div className="text-text-secondary">
            HL Fees: <span className="text-text-primary font-mono">{fmtUsd(fees)}</span>
          </div>
          {hasBuilderFees && (
            <div className="text-text-secondary">
              Builder Fees: <span className="text-text-primary font-mono">{fmtUsd(builder)}</span>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#235051" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#235051" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="feesGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#555555" stopOpacity={0.12} />
            <stop offset="95%" stopColor="#555555" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="builderGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
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
          type="stepAfter"
          dataKey="cumCost"
          name="Total Cost"
          stroke="#235051"
          strokeWidth={1.5}
          fill="url(#costGrad)"
          dot={false}
          activeDot={{ r: 3, fill: '#235051' }}
        />
        <Area
          type="stepAfter"
          dataKey="cumFees"
          name="HL Fees"
          stroke="#444"
          strokeWidth={1}
          fill="url(#feesGrad)"
          dot={false}
          activeDot={{ r: 3, fill: '#666' }}
        />
        {hasBuilderFees && (
          <Area
            type="stepAfter"
            dataKey="cumBuilder"
            name="Builder Fees"
            stroke="#8B5CF6"
            strokeWidth={1}
            fill="url(#builderGrad)"
            dot={false}
            activeDot={{ r: 3, fill: '#8B5CF6' }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}
