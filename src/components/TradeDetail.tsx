import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { X, ExternalLink, RefreshCw } from 'lucide-react'
import type { TradeExecutionMetrics, OrderBookMetrics } from '../types'
import { fmtBps, fmtUsd, bpsColorClass, fetchOrderBookMetrics } from '../lib/metrics'
import { getMetaAndAssetCtxs, buildCoinIndex } from '../lib/hyperliquid'
import { OrderBookPanel } from './OrderBookPanel'

interface TradeDetailProps {
  trade: TradeExecutionMetrics
  onClose: () => void
}

export function TradeDetail({ trade: t, onClose }: TradeDetailProps) {
  const [obMetrics, setObMetrics] = useState<OrderBookMetrics | null>(null)
  const [obLoading, setObLoading] = useState(true)

  useEffect(() => {
    setObLoading(true)
    setObMetrics(null)

    async function load() {
      try {
        const [meta, ctxs] = await getMetaAndAssetCtxs()
        const idx = buildCoinIndex(meta).get(t.coin)
        const dayVol = idx !== undefined ? parseFloat(ctxs[idx]?.dayNtlVlm ?? '0') : 0
        const metrics = await fetchOrderBookMetrics(t.coin, dayVol)
        setObMetrics(metrics)
      } catch {
        // no-op
      } finally {
        setObLoading(false)
      }
    }

    load()
  }, [t.coin, t.tid])

  const sourceLabel =
    t.slippageSource === 'hydromancer'
      ? 'Hydromancer slippageHistory'
      : t.slippageSource === 'live_book'
      ? 'Live order book (spread only, no market impact)'
      : 'Unavailable'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl h-full bg-surface-1 border-l border-border overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface-1 border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-text-primary">Trade Detail</span>
            <span className="font-mono text-xs text-text-muted">{t.hash.slice(0, 10)}…</span>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Trade identity */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-text-primary">{t.coin}</span>
              {t.side === 'buy' ? (
                <span className="tag-buy">BUY</span>
              ) : (
                <span className="tag-sell">SELL</span>
              )}
              {t.isTaker ? (
                <span className="tag-taker">TAKER</span>
              ) : (
                <span className="tag-maker">MAKER</span>
              )}
              <span className="text-xs text-text-muted ml-auto font-mono">{t.direction}</span>
            </div>

            <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
              <KV label="Timestamp" value={format(new Date(t.timestamp), 'MMM d yyyy, HH:mm:ss')} mono />
              <KV label="Fill Price" value={`$${t.fillPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`} mono />
              <KV label="Size" value={`${t.size.toFixed(6)} ${t.coin}`} mono />
              <KV label="Notional" value={fmtUsd(t.notionalUsd)} mono />
              <KV label="Fee" value={`${fmtUsd(t.fee)} ${t.feeToken}`} mono warn />
              <KV
                label="Closed PnL"
                value={`${t.closedPnl >= 0 ? '+' : ''}${fmtUsd(t.closedPnl)}`}
                mono
                pos={t.closedPnl >= 0}
                neg={t.closedPnl < 0}
              />
            </div>
          </div>

          {/* Execution cost breakdown */}
          <section>
            <h3 className="card-title mb-3">Execution Cost Breakdown</h3>
            <div className="card divide-y divide-border">
              {t.isTaker ? (
                <>
                  {/* Taker: halfSpread + additionalImpact = total slippage + fees */}
                  <CostRow
                    label="Half-Spread (crossing cost)"
                    desc="Minimum cost to cross from mid to best bid/ask. Embedded in total slippage below."
                    bps={t.halfSpreadBps}
                    source={sourceLabel}
                    dimmed
                  />
                  <CostRow
                    label="Additional Market Impact"
                    desc="Price walking beyond best bid/ask due to order size."
                    bps={t.additionalImpactBps}
                  />
                  <CostRow
                    label="Total Slippage (spread + impact)"
                    desc={`One-way cost from mid. = half-spread + market impact. Source: ${sourceLabel}.`}
                    bps={t.slippageBps}
                    subtotal
                  />
                  <CostRow
                    label="Exchange Fees"
                    desc="Taker fee charged by Hyperliquid"
                    bps={t.feeBps}
                    alwaysShow
                  />
                  <CostRow
                    label="Total Execution Cost"
                    desc="Total slippage + fees"
                    bps={t.totalCostBps}
                    total
                  />
                </>
              ) : (
                <>
                  {/* Maker: earns the spread, pays lower fees */}
                  <CostRow
                    label="Spread Rebate (earned)"
                    desc="Maker posts a resting order and earns the half-spread when filled."
                    bps={t.halfSpreadBps !== null ? -t.halfSpreadBps : null}
                    source={sourceLabel}
                    positiveIsBad={false}
                  />
                  <CostRow
                    label="Exchange Fees"
                    desc="Maker fee charged by Hyperliquid (usually lower than taker)"
                    bps={t.feeBps}
                    alwaysShow
                  />
                  <CostRow
                    label="Total Execution Cost"
                    desc="Fees minus spread rebate (negative = net saving vs taker)"
                    bps={t.totalCostBps}
                    total
                    positiveIsBad={false}
                  />
                </>
              )}
            </div>
          </section>

          {/* Price-based metrics */}
          <section>
            <h3 className="card-title mb-3">Price-Based Metrics (from candle data)</h3>
            <div className="card divide-y divide-border">
              <CostRow
                label="Effective Spread"
                desc="2 × |fill − mid| / mid. Mid estimated from 1-min candle (H+L)/2. Approximation: candle mid ≠ tick mid."
                bps={t.effectiveSpreadBps}
                source={
                  t.midPriceAtExecution !== null
                    ? `Candle mid: $${t.midPriceAtExecution.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
                    : 'No candle data available'
                }
              />
              <CostRow
                label="Realized Spread (price impact persistence)"
                desc={
                  t.isTaker
                    ? `Taker view: negative = price moved in your favour after execution (${t.side === 'buy' ? 'rose' : 'fell'}). Positive = adverse selection.`
                    : `2 × side × (fill − mid+5min) / mid. Negative = favourable post-trade drift.`
                }
                bps={t.realizedSpreadBps}
                source={
                  t.midPricePlus5Min !== null
                    ? `Mid +5 min: $${t.midPricePlus5Min.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
                    : 'Mid+5 unavailable'
                }
                positiveIsBad
              />
              <CostRow
                label="Arrival Cost (Implementation Shortfall)"
                desc="side × (fill − candle open) / candle open. Proxy for execution vs decision price. Note: arrival snaps to candle boundary."
                bps={t.arrivalCostBps}
                source={
                  t.candleOpen !== null
                    ? `Arrival proxy (candle open): $${t.candleOpen.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
                    : 'Arrival price unavailable'
                }
              />
            </div>
          </section>

          {/* Live order book */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="card-title">{t.coin} Live Spread</h3>
              {obLoading && <RefreshCw className="w-3.5 h-3.5 text-text-muted animate-spin" />}
            </div>
            <OrderBookPanel metrics={obMetrics} loading={obLoading} />
          </section>

          {/* Explorer link */}
          <a
            href={`https://app.hyperliquid.xyz/explorer/tx/${t.hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-accent-blue hover:text-accent-blue/80 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View on Hyperliquid Explorer
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KV({
  label,
  value,
  mono,
  warn,
  pos,
  neg,
}: {
  label: string
  value: string
  mono?: boolean
  warn?: boolean
  pos?: boolean
  neg?: boolean
}) {
  const cls = warn ? 'text-warn' : pos ? 'text-pos' : neg ? 'text-neg' : 'text-text-primary'
  return (
    <div>
      <div className="text-text-muted mb-0.5">{label}</div>
      <div className={`${mono ? 'font-mono' : ''} ${cls} font-medium`}>{value}</div>
    </div>
  )
}

function CostRow({
  label,
  desc,
  bps,
  source,
  total,
  subtotal,
  alwaysShow,
  dimmed,
  positiveIsBad = true,
}: {
  label: string
  desc: string
  bps: number | null
  source?: string
  total?: boolean
  subtotal?: boolean
  alwaysShow?: boolean
  dimmed?: boolean   // shown greyed-out (informational only, already counted elsewhere)
  positiveIsBad?: boolean
}) {
  if (bps === null && !alwaysShow) {
    return (
      <div className="px-4 py-3 flex items-start justify-between gap-4 opacity-40">
        <div>
          <div className="text-xs font-medium text-text-secondary">{label}</div>
          <div className="text-xs text-text-muted mt-0.5">{desc}</div>
        </div>
        <div className="shrink-0 font-mono text-sm text-text-muted">—</div>
      </div>
    )
  }

  const bg = total ? 'bg-surface-3' : subtotal ? 'bg-surface-2' : ''
  const labelCls = total
    ? 'text-text-primary font-semibold'
    : subtotal
    ? 'text-text-primary font-medium'
    : dimmed
    ? 'text-text-muted'
    : 'text-text-secondary'

  return (
    <div className={`px-4 py-3 flex items-start justify-between gap-4 ${bg} ${dimmed ? 'opacity-60' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className={`text-xs font-medium ${labelCls} flex items-center gap-1.5`}>
          {label}
          {dimmed && (
            <span className="text-xs text-text-dim font-normal">(included in slippage below)</span>
          )}
        </div>
        <div className="text-xs text-text-muted mt-0.5 leading-snug">{desc}</div>
        {source && <div className="text-xs text-text-dim mt-1 font-mono">{source}</div>}
      </div>
      <div
        className={`shrink-0 font-mono font-semibold ${bpsColorClass(bps, positiveIsBad)} ${total || subtotal ? 'text-base' : 'text-sm'}`}
      >
        {fmtBps(bps)}
      </div>
    </div>
  )
}
