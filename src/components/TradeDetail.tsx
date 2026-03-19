import { useState, useEffect } from 'react'
import { format } from 'date-fns'
import { X, ExternalLink, RefreshCw, Copy, Check } from 'lucide-react'
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
  const [copied, setCopied] = useState(false)

  const isZeroHash = /^0x0+$/.test(t.hash)
  const displayHash = isZeroHash ? null : t.hash

  function copyHash() {
    const text = displayHash ?? String(t.tid)
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

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
      ? 'Market data (spread + impact)'
      : t.slippageSource === 'live_book'
      ? 'Live order book (spread only, no market impact)'
      : 'Unavailable'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl h-full bg-surface-1 border-l border-border overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-surface-1 border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-text-primary shrink-0">Trade Detail</span>
            <button
              onClick={copyHash}
              className="flex items-center gap-1.5 group min-w-0"
              title="Copy transaction hash"
            >
              <span className="font-mono text-xs text-text-muted truncate max-w-[220px]">
                {displayHash ?? `TID: ${t.tid}`}
              </span>
              {copied
                ? <Check className="w-3 h-3 text-pos shrink-0" />
                : <Copy className="w-3 h-3 text-text-dim opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              }
            </button>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Trade identity */}
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-lg font-bold text-text-primary">{t.coinDisplay}</span>
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
              <KV label="Size" value={`${t.size.toFixed(6)} ${t.coinDisplay}`} mono />
              <KV label="Notional" value={fmtUsd(t.notionalUsd)} mono />
              <KV label="Fee" value={`${fmtUsd(t.fee)} ${t.feeToken}`} mono />
              <KV
                label="Closed PnL"
                value={`${t.closedPnl >= 0 ? '+' : ''}${fmtUsd(t.closedPnl)}`}
                mono
                pos={t.closedPnl >= 0}
                neg={t.closedPnl < 0}
              />
            </div>
          </div>

          {/* Hydromancer liquidity data */}
          <section>
            <h3 className="card-title mb-3">Liquidity at Execution · Hydromancer</h3>
            <div className="card divide-y divide-border">
              <CostRow
                label="Bid-Ask Spread"
                desc="Full quoted spread (2 × halfSpread) at the time of this trade. The baseline cost for any taker to cross the book."
                bps={t.halfSpreadBps !== null ? t.halfSpreadBps * 2 : null}
                source={sourceLabel}
              />
              <CostRow
                label={t.side === 'buy' ? 'Slippage (buy side)' : 'Slippage (sell side)'}
                desc={
                  t.side === 'buy'
                    ? 'Total one-way cost from mid for a buy at this notional — includes half-spread plus any book-walk impact.'
                    : 'Total one-way cost from mid for a sell at this notional — includes half-spread plus any book-walk impact.'
                }
                bps={t.slippageBps}
                source={sourceLabel}
              />
              <CostRow
                label="Market Impact"
                desc="Extra cost above the half-spread (pure size effect). Zero for small orders; rises when the order walks the book."
                bps={t.additionalImpactBps}
                source={sourceLabel}
              />
              <CostRow
                label="Exchange Fee"
                desc={t.isTaker ? 'Taker fee charged by Hyperliquid' : 'Maker fee charged by Hyperliquid'}
                bps={t.feeBps}
                alwaysShow
              />
              {/* Total: slippage + fee, both shown as positive costs */}
              {(t.slippageBps !== null) && (
                <CostRow
                  label="Total Cost"
                  desc="Slippage + exchange fee. Represents the full round-trip cost of this execution vs. mid-price."
                  bps={Math.max(0, t.slippageBps) + t.feeBps}
                  total
                />
              )}
            </div>
          </section>

          {/* Live order book */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="card-title">{t.coinDisplay} Live Spread</h3>
              {obLoading && <RefreshCw className="w-3.5 h-3.5 text-text-muted animate-spin" />}
            </div>
            <OrderBookPanel metrics={obMetrics} loading={obLoading} />
          </section>

          {/* Explorer link */}
          {displayHash && (
            <a
              href={`https://app.hyperliquid.xyz/explorer/tx/${displayHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-xs text-accent-blue hover:text-accent-blue/80 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              View on Hyperliquid Explorer
            </a>
          )}
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
