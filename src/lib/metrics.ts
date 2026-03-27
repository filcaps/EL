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
  HLHistoricalOrder,
  HLAssetContext,
  TradeExecutionMetrics,
  AssetSummary,
  WalletSummary,
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
  buildCoinIndex,
  getAllUserFills,
  getCandlesFull,
  getHistoricalOrders,
  getMetaAndAssetCtxs,
  getSpotMetaAndAssetCtxs,
} from './hyperliquid'

// ─── Candle helpers ───────────────────────────────────────────────────────────

/**
 * Typical price (O+H+L+C)/4 — a better mid proxy than (H+L)/2.
 * Weights the open and close alongside the extremes, reducing the influence
 * of transient high/low ticks that may be far from the fill time.
 */
function candleMid(c: HLCandle): number {
  return (parseFloat(c.o) + parseFloat(c.h) + parseFloat(c.l) + parseFloat(c.c)) / 4
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

  // 1 ── Fetch fills (paginated — no 2000-fill cap) ──────────────────────────
  progress('Fetching trade history…')
  const rawFills = await getAllUserFills(address, (n) =>
    progress(`Fetching trade history…`, `${n.toLocaleString()} fills loaded`),
  )
  if (rawFills.length === 0) return emptyWallet(address)

  // Sort newest-first; drop dust fills (notional < $10)
  const MIN_NOTIONAL_USD = 10
  const fills = [...rawFills]
    .sort((a, b) => b.time - a.time)
    .filter((f) => parseFloat(f.px) * parseFloat(f.sz) >= MIN_NOTIONAL_USD)
  const recentFills = fills

  const minFillTime = arrayMin(recentFills.map((f) => f.time))
  const maxFillTime = arrayMax(recentFills.map((f) => f.time))
  const windowDays = (maxFillTime - minFillTime) / 86_400_000

  // 2 ── Fetch historical orders + market data in parallel ──────────────────
  //       All three resolve before we classify a single coin.
  progress('Fetching order history & market data…')
  let historicalOrders: HLHistoricalOrder[] = []
  let metaMap = new Map<string, number>()
  let assetCtxs: HLAssetContext[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rawSpotMeta: any = null

  await Promise.allSettled([
    getHistoricalOrders(address).then((o) => { historicalOrders = o }).catch(() => {}),
    getMetaAndAssetCtxs().then(([meta, ctxs]) => {
      metaMap = buildCoinIndex(meta)
      assetCtxs = ctxs
    }).catch(() => {}),
    getSpotMetaAndAssetCtxs().then(([sm]) => { rawSpotMeta = sm }).catch(() => {}),
  ])

  // ── Spot / HIP-3 classification ───────────────────────────────────────────
  //
  // HL fills use two coin formats:
  //   • @N  — spot market index (e.g. "@0" = PURR/USDC, "@142" = UBTC).
  //           Always unambiguously spot.
  //   • Named — e.g. "BTC", "ETH" for perps; but ALSO "UBTC", "MON", "USDH"
  //             for some HIP-3 spot fills when HL omits the @N encoding.
  //
  // For named coins we use fill.dir as tiebreaker:
  //   dir "Buy" | "Sell"                  → spot fill
  //   dir "Open Long" | "Close Short" …   → perp fill

  // HIP-3 = RWA perp markets: stocks, ETFs, indices, commodities, forex
  // These trade like perps (dir = "Open Long" / "Close Short" etc.)
  // but on real-world assets. Spot fills for the same ticker (dir = "Buy"/"Sell")
  // are classified as regular Spot, NOT HIP-3.
  const HIP3_TOKENS = new Set([
    // Stocks (US + international)
    'AAPL', 'AMD', 'AMZN', 'BABA', 'CLX', 'COIN', 'CRWV', 'GOOGL', 'HOOD',
    'HYUNDAI', 'INTC', 'META', 'MSFT', 'MU', 'N', 'NFLX', 'NVDA', 'ORCL',
    'PLTR', 'RIVN', 'RTX', 'SNDK', 'TSLA', 'TSMS',
    // Other HL RWA tickers
    'BMNR', 'CRC', 'KHX', 'LM', 'SMS', 'STR', 'UEWY', 'USAR', 'YZ',
    // Commodities
    '100BRENT', 'COPPER', 'GOLD', 'NATGAS', 'OIL', 'PALLADIUM', 'PLATINUM',
    'SILVER', 'USOIL', 'WTI',
    // Indices
    'SMALL2000', 'US500', 'USA500', 'USENERGY', 'USTECH',
    // Forex
    'EURUSD', 'JPY',
    // ETFs / funds
    'EWJ', 'EWYM', 'GLD', 'MINE', 'SEMI', 'URNM', 'USBOND',
  ])

  // Map any coin id → human-readable display name
  const spotCoinNames = new Map<string, string>()
  // Map any coin id → candle API ticker
  const spotCandleTickers = new Map<string, string>()
  // Canonical @N keys (PURR/USDC = "@0", HYPE/USDC = "@107", …)
  const canonicalSpotKeys = new Set<string>()

  if (rawSpotMeta) {
    const tokenNames = new Map<number, string>()
    for (const token of rawSpotMeta.tokens) {
      tokenNames.set(token.index, token.name as string)
    }

    for (const market of rawSpotMeta.universe) {
      const fillKey = `@${market.index}`

      if (market.isCanonical) {
        const baseTicker = (market.name as string).split('/')[0]
        spotCoinNames.set(fillKey, baseTicker)
        spotCandleTickers.set(fillKey, baseTicker)
        spotCoinNames.set(market.name as string, baseTicker)
        spotCandleTickers.set(market.name as string, baseTicker)
        canonicalSpotKeys.add(fillKey)
      } else {
        const displayName = tokenNames.get((market.tokens as number[])[0]) ?? fillKey
        spotCoinNames.set(fillKey, displayName)
        spotCandleTickers.set(fillKey, fillKey)

        if (displayName !== fillKey) {
          spotCoinNames.set(displayName, displayName)
          spotCandleTickers.set(displayName, fillKey) // candle API needs @N
        }
      }
    }
  }

  /** True for spot-style dir values. Case-insensitive to handle HL API variance. */
  const isSpotDir = (dir?: string) => {
    if (!dir) return false
    const d = dir.toLowerCase()
    return d === 'buy' || d === 'sell' || d.startsWith('spot ')
  }

  /**
   * Returns true when a fill is from a spot market.
   * Three sources of truth (checked in order):
   *  1. @N or "/" coin format → unambiguously spot
   *  2. Coin is in spotCoinNames, NOT in HIP3_TOKENS, and NOT in metaMap (perp market) →
   *     spot-only token (UBTC, USDH…); classified as spot regardless of dir.
   *     Note: dual-market tokens (MON, HYPE — both spot and perp) are NOT caught here;
   *     they fall through to dir-based classification below.
   *  3. dir is "buy", "sell", or starts with "spot " → spot
   */
  const isSpotCoin = (coin: string, dir?: string): boolean => {
    if (coin.startsWith('@') || coin.includes('/')) return true
    if (spotCoinNames.has(coin) && !HIP3_TOKENS.has(coin) && !metaMap.has(coin)) return true
    return isSpotDir(dir)
  }

  /**
   * Returns true for HIP-3 markets (RWA perps: stocks, ETFs, commodities, forex, indices).
   * HIP-3 fills are perp-style (dir ≠ spot) on RWA tickers.
   * Spot fills on the same ticker (e.g. HOOD/USDC) are NOT HIP-3 — they are Spot.
   */
  const isHip3Coin = (coin: string, dir?: string): boolean => {
    if (isSpotDir(dir)) return false
    if (coin.startsWith('@') || coin.includes('/')) return false
    if (spotCoinNames.has(coin) && !HIP3_TOKENS.has(coin) && !metaMap.has(coin)) return false
    return HIP3_TOKENS.has(coin)
  }

  // 3 ── Group fills by coin; compute per-fill notional tiers ────────────────
  const coinGroups = groupByCoin(recentFills)

  // Per-fill tier: each fill uses its own notional for tier resolution (fix #1)
  const fillTiers = new Map<number, NotionalTier>() // keyed by tid
  const slippagePairs: Array<{ coin: string; tier: NotionalTier }> = []
  const seenPairs = new Set<string>()

  for (const fill of recentFills) {
    if (isSpotCoin(fill.coin, fill.dir)) continue
    const notional = parseFloat(fill.px) * parseFloat(fill.sz)
    const tier = closestTier(notional)
    fillTiers.set(fill.tid, tier)
    const pairKey = `${fill.coin}:${tier}`
    if (!seenPairs.has(pairKey)) {
      seenPairs.add(pairKey)
      slippagePairs.push({ coin: fill.coin, tier })
    }
  }

  // 4+5 ── Candles + Hydromancer slippage cache — all in parallel ─────────────
  progress('Loading market data (candles · slippage)…')

  const candleMaps = new Map<string, Map<number, HLCandle>>()
  let slippageCache: SlippageCache = {}

  await Promise.all([
    // 4: 1-min candles for every coin.
    //    Canonical spot (PURR/USDC = @0) needs base ticker ("PURR") for the candle API.
    //    Non-canonical spot (@N) and perps use the coin string directly.
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
            // Buffer: 10 min before earliest fill, 30 min after latest
            const candles = await getCandlesFull(candleTicker, minT - 600_000, maxT + 1_800_000)
            // Store under original fill coin key so computeTradeMetrics can look it up
            candleMaps.set(coin, buildCandleMap(candles))
          } catch {
            // non-fatal: price-based metrics will be null for this coin
          }
        }),
    ),

    // 5: Hydromancer slippage cache (one request per unique perp coin×tier pair)
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
  ])

  // 6 ── Compute per-trade metrics ────────────────────────────────────────────
  progress('Computing execution metrics…')
  const tradeMetrics: TradeExecutionMetrics[] = recentFills.map((fill) =>
    computeTradeMetrics(fill, fillTiers, candleMaps, slippageCache, spotCoinNames, isSpotCoin, isHip3Coin, fill.dir),
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

// ─── Candle-based slippage fallback ──────────────────────────────────────────

/**
 * Estimates halfSpreadBps, slippageBps, and additionalImpactBps from 1-min OHLCV
 * candle data when Hydromancer data is unavailable.
 *
 * ── Spread estimators (three independent methods, median-combined) ─────────
 *
 * 1. Corwin-Schultz (2012)  [primary — OHLCV-native]
 *    Uses overlapping single- and two-period high-low ranges to separate spread
 *    from volatility drift. For adjacent candles (t, t+1):
 *      β = (ln H_t/L_t)² + (ln H_{t+1}/L_{t+1})²
 *      γ = (ln max(H_t,H_{t+1}) / min(L_t,L_{t+1}))²
 *      α = (1+√2)(√β − √γ)          [derived simplification of CS eq. 14]
 *      S = 2(eᵅ−1)/(1+eᵅ)           [full spread as fraction of price]
 *    Discards negative α (trending regime). Median across all valid pairs.
 *
 * 2. Roll (1984)  [secondary — close-price autocovariance]
 *    halfSpread = √(−Cov(Δclose_t, Δclose_{t+1}))   [when Cov < 0]
 *    Detects bid-ask bounce as negative serial correlation of price changes.
 *    Tends to fail on liquid markets at 1-min resolution (bounce is diluted).
 *
 * 3. Range / √n_trades  [tertiary — volume-adjusted range]
 *    In a market with n trades/candle, the 1-min range's spread contribution
 *    scales as halfSpread × √n_trades (Madhavan 2000):
 *      halfSpread ≈ (H−L)/2 / mid / √n_trades
 *    Median across candles for robustness.
 *
 *    Final halfSpreadBps = median of all positive estimates across the three methods.
 *
 * ── Slippage (takers) ───────────────────────────────────────────────────────
 *    Direct implementation shortfall from the typical-price mid:
 *      slippageBps = max(halfSpreadBps, (fillPx − midPx) × sign / midPx × 10 000)
 *    Floored at halfSpreadBps because a taker always crosses at minimum the spread.
 *
 * ── Market impact (Almgren-Chriss √-law) ───────────────────────────────────
 *    additionalImpactBps = halfSpreadBps × √(notionalUsd / avgMinuteVolumeUsd)
 *    Captures the size-proportional book-walk: zero for infinitesimal orders,
 *    one half-spread worth of extra impact when the order equals a full minute
 *    of market volume.  slippageBps is then max(independent_IS, halfSpread + impact).
 */
function estimateCandleSlippage(
  cMap: Map<number, HLCandle>,
  tradeTime: number,
  fillPx: number,
  midPx: number,
  side: 'buy' | 'sell',
  isTaker: boolean,
  notionalUsd: number,
): {
  halfSpreadBps: number | null
  slippageBps: number | null
  additionalImpactBps: number | null
} {
  if (midPx <= 0) return { halfSpreadBps: null, slippageBps: null, additionalImpactBps: null }

  const snapped = snapToMinute(tradeTime)

  // Collect up to 16 candles: 15 pre-trade + the trade candle itself
  const candles: HLCandle[] = []
  for (let i = -15; i <= 0; i++) {
    const c = cMap.get(snapped + i * 60_000)
    if (c) candles.push(c)
  }
  if (candles.length === 0) return { halfSpreadBps: null, slippageBps: null, additionalImpactBps: null }

  const allSpreadEstimates: number[] = []

  // ── Estimator 1: Corwin-Schultz (2012) ─────────────────────────────────────
  // α = (1+√2)(√β − √γ);  S = 2(eᵅ−1)/(1+eᵅ)
  const SQ2P1 = 1 + Math.SQRT2  // ≈ 2.4142
  for (let i = 0; i < candles.length - 1; i++) {
    const c0 = candles[i], c1 = candles[i + 1]
    const lnH0 = Math.log(parseFloat(c0.h)), lnL0 = Math.log(parseFloat(c0.l))
    const lnH1 = Math.log(parseFloat(c1.h)), lnL1 = Math.log(parseFloat(c1.l))
    const beta = (lnH0 - lnL0) ** 2 + (lnH1 - lnL1) ** 2
    const gamma = (Math.max(lnH0, lnH1) - Math.min(lnL0, lnL1)) ** 2
    const alpha = SQ2P1 * (Math.sqrt(beta) - Math.sqrt(gamma))
    if (alpha <= 0) continue  // trending candle pair — discard
    const S = 2 * (Math.exp(alpha) - 1) / (1 + Math.exp(alpha))
    const halfBps = S / 2 * 10_000
    if (halfBps > 0 && halfBps < 500) allSpreadEstimates.push(halfBps)  // sanity cap 500 bps
  }

  // ── Estimator 2: Roll (1984) ────────────────────────────────────────────────
  if (candles.length >= 5) {
    const closes = candles.map((c) => parseFloat(c.c))
    const diffs = closes.slice(1).map((c, i) => c - closes[i])
    const n = diffs.length - 1
    if (n >= 3) {
      const cov = diffs.slice(0, n).reduce((s, d, i) => s + d * diffs[i + 1], 0) / n
      if (cov < 0) {
        const halfBps = Math.sqrt(-cov) / midPx * 10_000
        if (halfBps < 500) allSpreadEstimates.push(halfBps)
      }
    }
  }

  // ── Estimator 3: Volume-adjusted range (Range / √n_trades) ─────────────────
  for (const c of candles) {
    const hi = parseFloat(c.h), lo = parseFloat(c.l), mid = (hi + lo) / 2
    const nTrades = Math.max(1, c.n)
    if (mid > 0) {
      const halfBps = (hi - lo) / 2 / mid / Math.sqrt(nTrades) * 10_000
      if (halfBps > 0 && halfBps < 500) allSpreadEstimates.push(halfBps)
    }
  }

  // ── Combine: median of all valid estimates ─────────────────────────────────
  let halfSpreadBps: number | null = null
  if (allSpreadEstimates.length > 0) {
    allSpreadEstimates.sort((a, b) => a - b)
    halfSpreadBps = allSpreadEstimates[Math.floor(allSpreadEstimates.length / 2)]
  }

  // ── Average minute-volume for impact model ─────────────────────────────────
  let avgMinuteVolumeUsd = 0
  if (candles.length > 0) {
    const totalVol = candles.reduce((s, c) => {
      const volBase = parseFloat(c.v)
      const px = (parseFloat(c.h) + parseFloat(c.l)) / 2
      return s + volBase * px
    }, 0)
    avgMinuteVolumeUsd = totalVol / candles.length
  }

  // ── Directional slippage (takers only) ─────────────────────────────────────
  let slippageBps: number | null = null
  let additionalImpactBps: number | null = null

  if (isTaker) {
    const sign = side === 'buy' ? 1 : -1
    const IS = sign * (fillPx - midPx) / midPx * 10_000  // raw implementation shortfall

    // ── Almgren-Chriss √-impact model ────────────────────────────────────────
    // impact = halfSpread × √(notional / avgMinuteVolume)
    // Rationale: zero-size orders pay only halfSpread; as size → avgMinuteVolume,
    // expected book-walk adds another halfSpread worth of impact.
    let sqrtImpact = 0
    if (halfSpreadBps !== null && avgMinuteVolumeUsd > 0) {
      sqrtImpact = halfSpreadBps * Math.sqrt(notionalUsd / avgMinuteVolumeUsd)
    }
    const modelSlippage = halfSpreadBps !== null ? halfSpreadBps + sqrtImpact : 0

    // Use the larger of: observed IS (direct) vs model prediction.
    // The model provides a floor when the observed IS is noisy (e.g., candle-mid error).
    const floor = halfSpreadBps ?? 0
    slippageBps = Math.max(floor, IS, modelSlippage)

    additionalImpactBps = halfSpreadBps !== null
      ? Math.max(0, slippageBps - halfSpreadBps)
      : null
  }

  return { halfSpreadBps, slippageBps, additionalImpactBps }
}

// ─── Single-trade metrics ─────────────────────────────────────────────────────

function computeTradeMetrics(
  fill: HLFill,
  fillTiers: Map<number, NotionalTier>,
  candleMaps: Map<string, Map<number, HLCandle>>,
  slippageCache: SlippageCache,
  spotCoinNames: Map<string, string>,
  isSpotCoin: (coin: string, dir?: string) => boolean,
  isHip3Coin: (coin: string, dir?: string) => boolean,
  dir?: string,
): TradeExecutionMetrics {
  const fillPx = parseFloat(fill.px)
  const sz = parseFloat(fill.sz)
  const notional = fillPx * sz
  const feeUsd = parseFloat(fill.fee)
  const builderFeeUsd = fill.builderFee ? parseFloat(fill.builderFee) : 0
  const side: 'buy' | 'sell' = fill.side === 'B' ? 'buy' : 'sell'
  const isTaker = fill.crossed
  const isSpot = isSpotCoin(fill.coin, dir)
  const isHip3 = isHip3Coin(fill.coin, dir)

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
  if (tier && !isSpot) {
    const key = `${fill.coin}:${tier}`
    const pts = slippageCache[key] ?? []
    const nearest = nearestSlippagePoint(pts, fill.time)

    if (nearest) {
      slippageSource = 'hydromancer'
      // halfSpreadBps is always present; full spread = halfSpreadBps × 2
      halfSpreadBps = nearest.halfSpreadBps
      rawBuySlippageBps = nearest.buySlippageBps ?? null
      rawSellSlippageBps = nearest.sellSlippageBps ?? null

      if (isTaker) {
        // Directional slippage (already includes halfSpread component)
        slippageBps = side === 'buy' ? rawBuySlippageBps : rawSellSlippageBps

        if (slippageBps !== null) {
          // Market impact = slippage above and beyond the half-spread
          additionalImpactBps = Math.max(0, slippageBps - nearest.halfSpreadBps)
        } else {
          // buySlippageBps / sellSlippageBps were null (insufficient liquidity for the
          // requested notional size). Fall back to halfSpreadBps as a lower-bound:
          // at minimum a taker pays at least the half-spread to cross the book.
          slippageBps = nearest.halfSpreadBps
          additionalImpactBps = 0
        }
      }
      // Makers: slippageBps stays null — they earn the spread, not pay it
    }
  }

  // ── Candle-based fallback (pre-Dec 2025 or any gap in Hydromancer coverage) ─
  // Applied to all non-spot fills when Hydromancer returned no matching data point.
  if (slippageSource !== 'hydromancer' && !isSpot && midAtTrade !== null && cMap) {
    const est = estimateCandleSlippage(cMap, fill.time, fillPx, midAtTrade, side, isTaker, notional)
    if (est.halfSpreadBps !== null || est.slippageBps !== null) {
      halfSpreadBps = est.halfSpreadBps
      slippageBps = est.slippageBps
      additionalImpactBps = est.additionalImpactBps
      slippageSource = 'candle'
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
    isSpot,
    isHip3,
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
  const totalPnl = trades.reduce((s, t) => s + t.closedPnl, 0)
  const w = (t: TradeExecutionMetrics) => ({ w: t.notionalUsd })

  const avgEffSpread = weightedAvg(trades.map((t) => ({ v: t.effectiveSpreadBps, ...w(t) })))
  const avgSlippage = weightedAvg(trades.map((t) => ({ v: t.slippageBps, ...w(t) })))
  const avgTotal = weightedAvg(trades.map((t) => ({ v: t.totalCostBps, ...w(t) })))

  const estimatedTotalCostUsd =
    avgTotal !== null ? (avgTotal / 10_000) * totalVolumeUsd : null

  // Coverage: fraction of non-spot trades that have any slippage estimate
  // (Hydromancer = observed order-book data; candle = model estimate)
  const nonSpotTrades = trades.filter((t) => !t.isSpot)
  const slippageDataCoverage =
    nonSpotTrades.length > 0
      ? nonSpotTrades.filter((t) => t.slippageSource === 'hydromancer' || t.slippageSource === 'candle').length / nonSpotTrades.length
      : 0

  return {
    address,
    totalTrades: trades.length,
    totalVolumeUsd,
    totalFeesUsd,
    totalPnl,
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

// ─── Empty wallet ─────────────────────────────────────────────────────────────

function emptyWallet(address: string): WalletSummary {
  return {
    address,
    totalTrades: 0,
    totalVolumeUsd: 0,
    totalFeesUsd: 0,
    totalPnl: 0,
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
  const abs = Math.abs(v)
  const prefix = v < 0 ? '-$' : '$'
  if (abs >= 1_000_000) return `${prefix}${(abs / 1_000_000).toFixed(2)}M`
  return `${prefix}${abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
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
