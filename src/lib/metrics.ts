/**
 * metrics.ts – core execution quality calculations
 *
 * All spread / slippage / cost figures are in basis points (bps) unless noted.
 * 1 bps = 0.01 %  →  bps = (delta / price) × 10 000
 *
 * ── Cost model ──────────────────────────────────────────────────────────────
 * Hydromancer buySlippageBps / sellSlippageBps measure the TOTAL one-way cost
 * from mid-price, i.e. they already include the half-spread component:
 *
 *   slippageBps = halfSpreadBps + additionalImpactBps
 *
 * Therefore:
 *   Taker total cost = slippageBps + feeBps
 *   Maker total cost = −halfSpreadBps + feeBps  (maker earns the spread)
 *
 * Adding halfSpreadBps on top of slippageBps would double-count the spread.
 */

import type {
  HLFill,
  HLCandle,
  HLL2Book,
  HLHistoricalOrder,
  HLAssetContext,
  TradeExecutionMetrics,
  AssetSummary,
  WalletSummary,
  OrderBookMetrics,
  CancelTradeRatio,
} from '../types'
import {
  buildSlippageCache,
  closestTier,
  nearestSlippagePoint,
  type SlippageCache,
  type NotionalTier,
} from './hydromancer'
import {
  getL2Book,
  buildCoinIndex,
  isPerpCoin,
  getUserFills,
  getCandlesFull,
  getHistoricalOrders,
  getMetaAndAssetCtxs,
  getSpotMetaAndAssetCtxs,
} from './hyperliquid'

// ─── Candle helpers ───────────────────────────────────────────────────────────

function candleMid(c: HLCandle): number {
  return (parseFloat(c.h) + parseFloat(c.l)) / 2
}

function buildCandleMap(candles: HLCandle[]): Map<number, HLCandle> {
  const m = new Map<number, HLCandle>()
  for (const c of candles) m.set(c.t, c)
  return m
}

function snapToMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000
}

// ─── Per-trade metric calculations ───────────────────────────────────────────

/**
 * Effective spread: 2 × |fill – mid| / mid  (bps)
 * Note: from a OHLCV candle, mid = (H+L)/2 is an approximation; treat output
 * as directionally correct but not tick-precise.
 */
function effectiveSpreadBps(fillPx: number, midPx: number): number {
  return (2 * Math.abs(fillPx - midPx)) / midPx * 10_000
}

/**
 * Realized spread: 2 × sideSign × (fill – mid+5min) / mid  (bps)
 *
 * Interpretation from the TAKER's perspective:
 *   Negative = price moved in your favour after execution (BUY: price rose; SELL: price fell)
 *   Positive = adverse selection (price moved against you after execution)
 *
 * Note: sign convention is the opposite of the traditional market-maker view.
 */
function realizedSpreadBps(
  fillPx: number,
  midAtTrade: number,
  midPlus5: number,
  side: 'buy' | 'sell',
): number {
  const sign = side === 'buy' ? 1 : -1
  return (2 * sign * (fillPx - midPlus5)) / midAtTrade * 10_000
}

/**
 * Arrival cost (implementation shortfall).
 * Uses candle open as a proxy for the "arrival" (decision) price.
 * Positive = filled worse than the arrival price.
 * Approximation caveat: candle open snaps to the start of the minute.
 */
function arrivalCostBps(fillPx: number, arrivalPx: number, side: 'buy' | 'sell'): number {
  const sign = side === 'buy' ? 1 : -1
  return (sign * (fillPx - arrivalPx)) / arrivalPx * 10_000
}

function feeBps(feeUsd: number, notionalUsd: number): number {
  if (notionalUsd === 0) return 0
  return (feeUsd / notionalUsd) * 10_000
}

// ─── Safe array min/max (avoids call-stack overflow on large arrays) ──────────

function arrayMin(arr: number[]): number {
  return arr.reduce((m, v) => Math.min(m, v), Infinity)
}

function arrayMax(arr: number[]): number {
  return arr.reduce((m, v) => Math.max(m, v), -Infinity)
}

// ─── Main wallet analysis pipeline ───────────────────────────────────────────

export interface AnalysisProgress {
  stage: string
  detail?: string
}

export async function analyseWallet(
  rawAddress: string,
  onProgress?: (p: AnalysisProgress) => void,
): Promise<WalletSummary> {
  // Normalize to lowercase — Hyperliquid's API rejects checksummed addresses with 422
  const address = rawAddress.toLowerCase()
  const progress = (stage: string, detail?: string) =>
    onProgress?.({ stage, detail })

  // 1 ── Fetch fills ──────────────────────────────────────────────────────────
  progress('Fetching trade history…')
  const rawFills = await getUserFills(address)
  if (rawFills.length === 0) return emptyWallet(address)

  // Sort newest-first
  const fills = [...rawFills].sort((a, b) => b.time - a.time)
  const recentFills = fills

  const minFillTime = arrayMin(recentFills.map((f) => f.time))
  const maxFillTime = arrayMax(recentFills.map((f) => f.time))
  const windowDays = (maxFillTime - minFillTime) / 86_400_000

  // 2 ── Fetch historical orders in parallel with market data ────────────────
  progress('Fetching order history & market data…')
  let historicalOrders: HLHistoricalOrder[] = []
  let metaMap = new Map<string, number>()
  let assetCtxs: HLAssetContext[] = []
  const spotCoinNames = new Map<string, string>()    // "@N" → human-readable name
  const spotCandleTickers = new Map<string, string>() // "@N" → ticker for candleSnapshot API

  await Promise.allSettled([
    getHistoricalOrders(address).then((o) => { historicalOrders = o }).catch(() => {}),
    getMetaAndAssetCtxs().then(([meta, ctxs]) => {
      metaMap = buildCoinIndex(meta)
      assetCtxs = ctxs
    }).catch(() => {}),
    getSpotMetaAndAssetCtxs().then(([spotMeta]) => {
      // Build token-index → name lookup first
      const tokenNames = new Map<number, string>()
      for (const token of spotMeta.tokens) tokenNames.set(token.index, token.name)

      // @N in fills = universe[N].index — resolve display name + candle ticker
      for (const market of spotMeta.universe) {
        const fillKey = `@${market.index}`

        if (market.isCanonical) {
          // Canonical market like "PURR/USDC":
          //   display name = base ticker ("PURR")
          //   candle API needs the base ticker too — "@N" returns null for canonical markets
          const baseTicker = market.name.split('/')[0]
          spotCoinNames.set(fillKey, baseTicker)
          spotCandleTickers.set(fillKey, baseTicker)
        } else {
          // Non-canonical market: name is "@N" — look up base token (tokens[0]) by its index
          const displayName = tokenNames.get(market.tokens[0]) ?? market.name
          spotCoinNames.set(fillKey, displayName)
          // Non-canonical coins use "@N" notation in candleSnapshot (works fine)
          spotCandleTickers.set(fillKey, fillKey)
        }
      }
    }).catch(() => {}),
  ])

  // 3 ── Group fills by coin; compute per-fill notional tiers ────────────────
  const coinGroups = groupByCoin(recentFills)

  // Per-fill tier: each fill uses its own notional for tier resolution (fix #1)
  const fillTiers = new Map<number, NotionalTier>() // keyed by tid
  const slippagePairs: Array<{ coin: string; tier: NotionalTier }> = []
  const seenPairs = new Set<string>()

  for (const fill of recentFills) {
    if (!isPerpCoin(fill.coin)) continue
    const notional = parseFloat(fill.px) * parseFloat(fill.sz)
    const tier = closestTier(notional)
    fillTiers.set(fill.tid, tier)
    const pairKey = `${fill.coin}:${tier}`
    if (!seenPairs.has(pairKey)) {
      seenPairs.add(pairKey)
      slippagePairs.push({ coin: fill.coin, tier })
    }
  }

  // 4+5+6 ── Candles, slippage cache, live books — all in parallel (fix #11) ─
  progress('Loading market data (candles · slippage · order books)…')

  const candleMaps = new Map<string, Map<number, HLCandle>>()
  const liveBooks = new Map<string, HLL2Book>()
  let slippageCache: SlippageCache = {}

  await Promise.all([
    // 4: 1-min candles for every coin.
    //    Spot coins: canonical markets (e.g. PURR/USDC = @0) need their base ticker ("PURR")
    //    because the candleSnapshot API returns null for "@N" notation on canonical markets.
    //    Non-canonical spot markets ("@1", "@2", ...) work fine with "@N" directly.
    Promise.allSettled(
      Array.from(coinGroups.entries())
        .map(async ([coin, coinFills]) => {
          const times = coinFills.map((f) => f.time)
          const minT = arrayMin(times)
          const maxT = arrayMax(times)
          // Resolve the correct ticker for the candle API
          const candleTicker = spotCandleTickers.get(coin) ?? coin
          try {
            progress('Loading candles…', coin)
            // Buffer: 10 min before earliest fill, 30 min after latest (covers +5 min realized spread + edge cases)
            const candles = await getCandlesFull(candleTicker, minT - 600_000, maxT + 1_800_000)
            // Store under original fill coin key so computeTradeMetrics can look it up
            candleMaps.set(coin, buildCandleMap(candles))
          } catch {
            // non-fatal: price-based metrics will be null for this coin
          }
        }),
    ),

    // 5: Hydromancer slippage cache (one request per unique coin×tier pair)
    (async () => {
      try {
        slippageCache = await buildSlippageCache(
          slippagePairs,
          minFillTime - 60 * 60 * 1000,
          maxFillTime + 60 * 60 * 1000,
        )
      } catch {
        // non-fatal
      }
    })(),

    // 6: Live order books (used as spread fallback)
    Promise.allSettled(
      Array.from(coinGroups.keys())
        .filter(isPerpCoin)
        .map(async (coin) => {
          try {
            liveBooks.set(coin, await getL2Book(coin))
          } catch {
            // non-fatal
          }
        }),
    ),
  ])

  // 7 ── Compute per-trade metrics ───────────────────────────────────────────
  progress('Computing execution metrics…')
  const tradeMetrics: TradeExecutionMetrics[] = recentFills.map((fill) =>
    computeTradeMetrics(fill, fillTiers, candleMaps, slippageCache, liveBooks, spotCoinNames),
  )

  // 8 ── Cancel / trade ratio (windowed to fills time range) (fix #6) ────────
  const windowedOrders = historicalOrders.filter(
    (o) => o.timestamp >= minFillTime && o.timestamp <= maxFillTime + 86_400_000,
  )
  const ctr = computeCancelTradeRatio(windowedOrders, recentFills, windowDays)

  // 9 ── Aggregate ───────────────────────────────────────────────────────────
  progress('Aggregating results…')
  const summary = aggregateWallet(address, tradeMetrics, ctr, spotCoinNames)

  // Attach 24h market volume from Hyperliquid metadata (fix #8 — no longer dead code)
  for (const asset of summary.assetBreakdown) {
    const idx = metaMap.get(asset.coin)
    if (idx !== undefined && assetCtxs[idx]) {
      asset.dayVolumeUsd = parseFloat(assetCtxs[idx].dayNtlVlm)
    }
  }

  return summary
}

// ─── Candle lookup helpers ────────────────────────────────────────────────────

/**
 * Find the nearest 1-min candle to `snappedMs` within ±`maxMinutes` minutes.
 * Scans outward from the target in 1-min steps, checking both directions.
 */
function findNearestCandle(
  cMap: Map<number, HLCandle>,
  snappedMs: number,
  maxMinutes: number,
): HLCandle | null {
  for (let step = 0; step <= maxMinutes; step++) {
    const earlier = cMap.get(snappedMs - step * 60_000)
    if (earlier) return earlier
    if (step > 0) {
      const later = cMap.get(snappedMs + step * 60_000)
      if (later) return later
    }
  }
  return null
}

// ─── Single-trade metrics ─────────────────────────────────────────────────────

function computeTradeMetrics(
  fill: HLFill,
  fillTiers: Map<number, NotionalTier>,
  candleMaps: Map<string, Map<number, HLCandle>>,
  slippageCache: SlippageCache,
  liveBooks: Map<string, HLL2Book>,
  spotCoinNames: Map<string, string>,
): TradeExecutionMetrics {
  const fillPx = parseFloat(fill.px)
  const sz = parseFloat(fill.sz)
  const notional = fillPx * sz
  const feeUsd = parseFloat(fill.fee)
  const builderFeeUsd = fill.builderFee ? parseFloat(fill.builderFee) : 0
  const side: 'buy' | 'sell' = fill.side === 'B' ? 'buy' : 'sell'
  const isTaker = fill.crossed

  // ── Candle-based mid prices ──────────────────────────────────────────────
  let midAtTrade: number | null = null
  let midPlus5: number | null = null
  let candleOpen: number | null = null

  const cMap = candleMaps.get(fill.coin)
  if (cMap) {
    const snapped = snapToMinute(fill.time)
    const candleAtTrade = findNearestCandle(cMap, snapped, 10)
    if (candleAtTrade) {
      midAtTrade = candleMid(candleAtTrade)
      candleOpen = parseFloat(candleAtTrade.o)
    }
    const snapped5 = snapToMinute(fill.time + 5 * 60_000)
    const candle5 = findNearestCandle(cMap, snapped5, 10)
    if (candle5) midPlus5 = candleMid(candle5)
  }

  // ── Slippage & spread from Hydromancer (fix #2, #3) ─────────────────────
  let halfSpreadBps: number | null = null
  let rawBuySlippageBps: number | null = null
  let rawSellSlippageBps: number | null = null
  let slippageBps: number | null = null
  let additionalImpactBps: number | null = null
  let slippageSource: TradeExecutionMetrics['slippageSource'] = 'unavailable'

  const tier = fillTiers.get(fill.tid)
  if (tier && isPerpCoin(fill.coin)) {
    const key = `${fill.coin}:${tier}`
    const pts = slippageCache[key] ?? []
    const nearest = nearestSlippagePoint(pts, fill.time)

    if (nearest) {
      slippageSource = 'hydromancer'
      halfSpreadBps = nearest.halfSpreadBps
      rawBuySlippageBps = nearest.buySlippageBps ?? null
      rawSellSlippageBps = nearest.sellSlippageBps ?? null

      if (isTaker) {
        // Directional slippage for this trade side
        slippageBps = side === 'buy' ? rawBuySlippageBps : rawSellSlippageBps
        additionalImpactBps =
          slippageBps !== null
            ? Math.max(0, slippageBps - nearest.halfSpreadBps)
            : null
      }
      // Makers: slippageBps stays null — they don't cause market impact
    }
  }

  // Fallback to live order book for spread only (fix #3: only spread, no taker slippage)
  if (halfSpreadBps === null) {
    const book = liveBooks.get(fill.coin)
    if (book && book.levels[0].length > 0 && book.levels[1].length > 0) {
      const bid = parseFloat(book.levels[0][0].px)
      const ask = parseFloat(book.levels[1][0].px)
      const mid = (bid + ask) / 2
      halfSpreadBps = ((ask - bid) / 2 / mid) * 10_000
      slippageSource = 'live_book'
      if (isTaker) {
        // Approximate: assume no book walking (lower bound on actual cost)
        slippageBps = halfSpreadBps
        additionalImpactBps = 0
      }
    }
  }

  // ── Derived metrics ──────────────────────────────────────────────────────
  const effSpread =
    midAtTrade !== null ? effectiveSpreadBps(fillPx, midAtTrade) : null

  const realSpread =
    midAtTrade !== null && midPlus5 !== null
      ? realizedSpreadBps(fillPx, midAtTrade, midPlus5, side)
      : null

  const arrCost =
    candleOpen !== null ? arrivalCostBps(fillPx, candleOpen, side) : null

  const fBps = feeBps(feeUsd, notional)

  // Total cost (fix #2: no double-counting; fix #3: maker uses rebate not slippage)
  let totalCostBps: number | null = null
  if (isTaker) {
    if (slippageBps !== null) {
      totalCostBps = slippageBps + fBps
    } else if (halfSpreadBps !== null) {
      // Partial: have spread but no slippage data — note this in the data
      totalCostBps = halfSpreadBps + fBps
    }
  } else {
    // Maker: earns the spread, pays (usually lower) fees
    if (halfSpreadBps !== null) {
      totalCostBps = -halfSpreadBps + fBps
    } else {
      // Only fees known
      totalCostBps = fBps
    }
  }

  return {
    tid: fill.tid,
    oid: fill.oid,
    hash: fill.hash,
    coin: fill.coin,
    coinDisplay: spotCoinNames.get(fill.coin) ?? fill.coin,
    side,
    direction: fill.dir,
    isTaker,
    fillPrice: fillPx,
    size: sz,
    notionalUsd: notional,
    timestamp: fill.time,
    fee: feeUsd,
    builderFee: builderFeeUsd,
    feeToken: fill.feeToken,
    closedPnl: parseFloat(fill.closedPnl),
    midPriceAtExecution: midAtTrade,
    midPricePlus5Min: midPlus5,
    candleOpen,
    feeBps: fBps,
    halfSpreadBps,
    rawBuySlippageBps,
    rawSellSlippageBps,
    slippageBps,
    additionalImpactBps,
    effectiveSpreadBps: effSpread,
    realizedSpreadBps: realSpread,
    arrivalCostBps: arrCost,
    totalCostBps,
    slippageSource,
  }
}

// ─── Cancel / trade ratio ─────────────────────────────────────────────────────

function computeCancelTradeRatio(
  orders: HLHistoricalOrder[],
  fills: HLFill[],
  windowDays: number,
): CancelTradeRatio | null {
  if (orders.length === 0) return null
  const cancelled = orders.filter(
    (o) => o.status === 'canceled' || o.status === 'marginCanceled',
  ).length
  const filled = fills.length
  return {
    totalOrders: orders.length,
    filledOrders: filled,
    cancelledOrders: cancelled,
    ratio: filled > 0 ? cancelled / filled : 0,
    windowDays: Math.round(windowDays),
  }
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

function groupByCoin(fills: HLFill[]): Map<string, HLFill[]> {
  const m = new Map<string, HLFill[]>()
  for (const f of fills) {
    const arr = m.get(f.coin) ?? []
    arr.push(f)
    m.set(f.coin, arr)
  }
  return m
}

function weightedAvg(values: Array<{ v: number | null; w: number }>): number | null {
  const valid = values.filter((x): x is { v: number; w: number } => x.v !== null)
  if (valid.length === 0) return null
  const totalW = valid.reduce((s, x) => s + x.w, 0)
  if (totalW === 0) return null
  return valid.reduce((s, x) => s + x.v * x.w, 0) / totalW
}

function aggregateWallet(
  address: string,
  trades: TradeExecutionMetrics[],
  ctr: CancelTradeRatio | null,
  spotCoinNames: Map<string, string>,
): WalletSummary {
  const byAsset = new Map<string, TradeExecutionMetrics[]>()
  for (const t of trades) {
    const arr = byAsset.get(t.coin) ?? []
    arr.push(t)
    byAsset.set(t.coin, arr)
  }

  const assetBreakdown: AssetSummary[] = Array.from(byAsset.entries()).map(
    ([coin, coinTrades]) => {
      const totalVol = coinTrades.reduce((s, t) => s + t.notionalUsd, 0)
      const totalFees = coinTrades.reduce((s, t) => s + t.fee, 0)
      const w = (t: TradeExecutionMetrics) => ({ w: t.notionalUsd })

      const avgEffSpread = weightedAvg(coinTrades.map((t) => ({ v: t.effectiveSpreadBps, ...w(t) })))
      const avgHalfSpread = weightedAvg(coinTrades.map((t) => ({ v: t.halfSpreadBps, ...w(t) })))
      const avgSlip = weightedAvg(coinTrades.map((t) => ({ v: t.slippageBps, ...w(t) })))
      const avgImpact = weightedAvg(coinTrades.map((t) => ({ v: t.additionalImpactBps, ...w(t) })))
      const avgTotal = weightedAvg(coinTrades.map((t) => ({ v: t.totalCostBps, ...w(t) })))
      const avgArr = weightedAvg(coinTrades.map((t) => ({ v: t.arrivalCostBps, ...w(t) })))
      const costBps = coinTrades.map((t) => t.totalCostBps).filter((v): v is number => v !== null)

      return {
        coin,
        displayName: spotCoinNames.get(coin) ?? coin,
        totalTrades: coinTrades.length,
        takerTrades: coinTrades.filter((t) => t.isTaker).length,
        makerTrades: coinTrades.filter((t) => !t.isTaker).length,
        totalVolumeUsd: totalVol,
        dayVolumeUsd: 0, // populated from metaAndAssetCtxs after aggregation
        totalFeesUsd: totalFees,
        avgEffectiveSpreadBps: avgEffSpread,
        avgHalfSpreadBps: avgHalfSpread,
        avgSlippageBps: avgSlip,
        avgAdditionalImpactBps: avgImpact,
        avgTotalCostBps: avgTotal,
        avgArrivalCostBps: avgArr,
        worstTradeBps: costBps.length > 0 ? arrayMax(costBps) : null,
        bestTradeBps: costBps.length > 0 ? arrayMin(costBps) : null,
      }
    },
  )

  const totalVolumeUsd = trades.reduce((s, t) => s + t.notionalUsd, 0)
  const totalFeesUsd = trades.reduce((s, t) => s + t.fee, 0)
  const w = (t: TradeExecutionMetrics) => ({ w: t.notionalUsd })

  const avgEffSpread = weightedAvg(trades.map((t) => ({ v: t.effectiveSpreadBps, ...w(t) })))
  const avgSlippage = weightedAvg(trades.map((t) => ({ v: t.slippageBps, ...w(t) })))
  const avgTotal = weightedAvg(trades.map((t) => ({ v: t.totalCostBps, ...w(t) })))

  const estimatedTotalCostUsd =
    avgTotal !== null ? (avgTotal / 10_000) * totalVolumeUsd : null

  // Coverage: fraction of trades with Hydromancer slippage data (fix #12)
  const slippageDataCoverage =
    trades.length > 0
      ? trades.filter((t) => t.slippageSource === 'hydromancer').length / trades.length
      : 0

  return {
    address,
    totalTrades: trades.length,
    totalVolumeUsd,
    totalFeesUsd,
    avgEffectiveSpreadBps: avgEffSpread,
    avgSlippageBps: avgSlippage,
    avgTotalCostBps: avgTotal,
    estimatedTotalCostUsd,
    slippageDataCoverage,
    cancelTradeRatio: ctr,
    assetBreakdown: assetBreakdown.sort((a, b) => b.totalVolumeUsd - a.totalVolumeUsd),
    trades,
  }
}

// ─── Live order book metrics ──────────────────────────────────────────────────

export function computeOrderBookMetrics(
  book: HLL2Book,
  dayVolumeUsd: number,
): OrderBookMetrics {
  const bids = book.levels[0]
  const asks = book.levels[1]

  const bestBid = bids.length > 0 ? parseFloat(bids[0].px) : 0
  const bestAsk = asks.length > 0 ? parseFloat(asks[0].px) : 0
  const mid = (bestBid + bestAsk) / 2
  const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : 0
  const halfSpreadBps = spreadBps / 2

  const topBidSz = bids.length > 0 ? parseFloat(bids[0].sz) : 0
  const topAskSz = asks.length > 0 ? parseFloat(asks[0].sz) : 0
  const topBidUsd = topBidSz * bestBid
  const topAskUsd = topAskSz * bestAsk
  const topDepth = topBidUsd + topAskUsd
  const obi = topDepth > 0 ? (topBidUsd - topAskUsd) / topDepth : 0

  function depthWithinBps(thresholdBps: number): number {
    const maxDeviation = (thresholdBps / 10_000) * mid
    let total = 0
    for (const level of bids) {
      const px = parseFloat(level.px)
      if (mid - px > maxDeviation) break
      total += parseFloat(level.sz) * px
    }
    for (const level of asks) {
      const px = parseFloat(level.px)
      if (px - mid > maxDeviation) break
      total += parseFloat(level.sz) * px
    }
    return total
  }

  return {
    coin: book.coin,
    timestamp: book.time,
    markPrice: mid,
    bestBid,
    bestAsk,
    bidAskSpreadBps: spreadBps,
    halfSpreadBps,
    topBidSize: topBidSz,
    topAskSize: topAskSz,
    topOfBookDepthUsd: topDepth,
    depth10Bps: depthWithinBps(10),
    depth50Bps: depthWithinBps(50),
    depth100Bps: depthWithinBps(100),
    depth200Bps: depthWithinBps(200),
    orderBookImbalance: obi,
    dayVolumeUsd,
  }
}

export async function fetchOrderBookMetrics(
  coin: string,
  dayVolumeUsd = 0,
): Promise<OrderBookMetrics | null> {
  try {
    const book = await getL2Book(coin)
    return computeOrderBookMetrics(book, dayVolumeUsd)
  } catch {
    return null
  }
}

// ─── Empty wallet ─────────────────────────────────────────────────────────────

function emptyWallet(address: string): WalletSummary {
  return {
    address,
    totalTrades: 0,
    totalVolumeUsd: 0,
    totalFeesUsd: 0,
    avgEffectiveSpreadBps: null,
    avgSlippageBps: null,
    avgTotalCostBps: null,
    estimatedTotalCostUsd: null,
    slippageDataCoverage: 0,
    cancelTradeRatio: null,
    assetBreakdown: [],
    trades: [],
  }
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function fmtBps(v: number | null, decimals = 2): string {
  if (v === null) return '—'
  return `${v.toFixed(decimals)} bps`
}

export function fmtUsd(v: number, decimals = 2): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${v.toFixed(decimals)}`
}

export function fmtPct(v: number | null, decimals = 3): string {
  if (v === null) return '—'
  return `${(v / 100).toFixed(decimals)}%`
}

export function bpsColorClass(
  v: number | null,
  positiveIsBad = true,
): string {
  if (v === null) return 'text-text-muted'
  if (positiveIsBad) {
    if (v > 10) return 'text-neg'
    if (v > 3) return 'text-warn'
    return 'text-pos'
  } else {
    if (v < 0) return 'text-neg'
    if (v < 3) return 'text-pos'
    return 'text-warn'
  }
}
