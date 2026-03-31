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
  HIP3_HYDROMANCER_KEYS,
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
 * HL candleSnapshot stores the most recent ~5000 candles per interval,
 * measured backwards from NOW (regardless of startTime requested).
 * Applies to BOTH named perp tickers ("BTC", "HYPE") and @N spot tickers.
 * Coverage as of 2026-03 (empirically verified):
 *   1m  →   ~4 days
 *   1h  → ~208 days  (7 months)   ← covers Nov 2025 perp fills
 *                                    and spot tokens as old as Sep 2025
 *   4h  → ~840 days  (28 months)  ← covers pre-2025 fills for major tokens
 *                                    (newer spot tokens limited by launch date)
 *
 * Returns the finest interval whose coverage window still contains
 * the oldest fill (`ageMs` = now − oldest fill time).
 */
const CANDLE_TIERS: Array<{ interval: string; intervalMs: number; coverageDays: number }> = [
  { interval: '1m', intervalMs:    60_000, coverageDays:   4   },
  { interval: '1h', intervalMs: 3_600_000, coverageDays: 210   },
  { interval: '4h', intervalMs:14_400_000, coverageDays: 840   },
]

function chooseCandleTier(ageMs: number) {
  const ageDays = ageMs / 86_400_000
  for (const tier of CANDLE_TIERS) {
    if (ageDays <= tier.coverageDays) return tier
  }
  return CANDLE_TIERS[CANDLE_TIERS.length - 1]
}

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

/** Snap a timestamp to the start of the candle interval it falls in. */
function snapToInterval(ms: number, intervalMs: number): number {
  return Math.floor(ms / intervalMs) * intervalMs
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
        // Use @N directly as the candle ticker.
        // HL candleSnapshot supports @N format and provides the real spot-market
        // OHLCV (distinct order book, own liquidity profile — not the perp).
        // Depth: same ~5000-candle rolling window as named perp tickers.
        spotCandleTickers.set(fillKey, fillKey)
        spotCoinNames.set(market.name as string, baseTicker)
        spotCandleTickers.set(market.name as string, fillKey)
        canonicalSpotKeys.add(fillKey)
      } else {
        const displayName = tokenNames.get((market.tokens as number[])[0]) ?? fillKey
        spotCoinNames.set(fillKey, displayName)
        // Same principle: use @N for actual spot candles.
        // For bridged tokens (UBTC, AAVE0…), the spot book is typically
        // thinner than the perp — using a perp proxy would understate
        // spread/impact. @N data correctly captures the spot liquidity.
        spotCandleTickers.set(fillKey, fillKey)
        if (displayName !== fillKey) {
          spotCoinNames.set(displayName, displayName)
          spotCandleTickers.set(displayName, fillKey)
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

  // Per-fill tier: used for Almgren-Chriss model and Hydromancer lookup
  const fillTiers = new Map<number, NotionalTier>()   // tid → tier
  // Per-fill Hydromancer cache key: `${hmCoin}:${tier}`, or absent when
  // the coin has no Hydromancer coverage (HIP-3 with no xyz/cash entry).
  const fillHmKeys = new Map<number, string>()        // tid → hmCacheKey
  const slippagePairs: Array<{ coin: string; tier: NotionalTier }> = []
  const seenPairs = new Set<string>()

  for (const fill of recentFills) {
    if (isSpotCoin(fill.coin, fill.dir)) continue
    const notional = parseFloat(fill.px) * parseFloat(fill.sz)
    const tier = closestTier(notional)
    fillTiers.set(fill.tid, tier)

    // Map HL coin → Hydromancer coin name:
    //   standard perp (BTC, ETH, HYPE…) → same name ("BTC")
    //   HIP-3 with Hydromancer coverage  → "xyz:TSLA", "cash:WTI", etc.
    //   HIP-3 without Hydromancer data   → null (candle fallback only)
    const hip3 = isHip3Coin(fill.coin, fill.dir)
    const hmCoin = hip3
      ? (HIP3_HYDROMANCER_KEYS[fill.coin] ?? null)
      : fill.coin

    if (hmCoin) {
      const hmKey = `${hmCoin}:${tier}`
      fillHmKeys.set(fill.tid, hmKey)
      if (!seenPairs.has(hmKey)) {
        seenPairs.add(hmKey)
        slippagePairs.push({ coin: hmCoin, tier })
      }
    }
  }

  // 4+5 ── Candles + Hydromancer slippage cache — all in parallel ─────────────
  progress('Loading market data (candles · slippage)…')

  const candleMaps = new Map<string, Map<number, HLCandle>>()
  // intervalMs stored alongside each coin's candle map so the lookup and
  // estimator can use the correct step size (60_000 for 1m, 3_600_000 for 1h…)
  const candleIntervalMs = new Map<string, number>()
  // 1d fallback maps: used when the primary candle window doesn't reach the
  // oldest fill (e.g. ETH/SOL fills from Oct-Dec 2023, before HL's 4h window
  // starts on Dec 19 2023; or HYPE fills from the first weeks after TGE).
  const candleFallbackMaps = new Map<string, Map<number, HLCandle>>()
  let slippageCache: SlippageCache = {}
  const nowMs = Date.now()

  await Promise.all([
    // 4: Candles for every coin — interval chosen so HL's ~5000-candle window
    //    covers the oldest fill for that coin.
    //
    //    HL candleSnapshot returns the most recent ~5000 candles from NOW,
    //    regardless of the startTime requested:
    //      1m  → ~3.5 days   (fills < 3.5 days old)
    //      1h  → ~208 days   (fills up to 7 months old, e.g. Nov 2025)
    //      4h  → ~833 days   (fills up to 2+ years old)
    //
    //    We always request endTime=now so HL populates the rolling window.
    //
    //    Concurrency limit: fire at most 2 candleSnapshot requests at once.
    //    HL rate-limits (429) aggressively; 2 in parallel is safe and keeps
    //    total load time reasonable for wallets with 200+ distinct coins.
    //
    //    Fallback: if the primary candle window doesn't reach the oldest fill
    //    (e.g. ETH fills from HL's Oct 2023 launch pre-date the 4h window
    //    that starts Dec 19 2023), we also fetch daily (1d) candles which
    //    go back to 2020 for major coins.
    (async () => {
      const CONCURRENCY = 2
      const entries = Array.from(coinGroups.entries())
      // Process in batches of CONCURRENCY
      for (let i = 0; i < entries.length; i += CONCURRENCY) {
        const batch = entries.slice(i, i + CONCURRENCY)
        await Promise.allSettled(
          batch.map(async ([coin, coinFills]) => {
            const times = coinFills.map((f) => f.time)
            const minT = arrayMin(times)
            const ageMs = nowMs - minT
            const { interval, intervalMs } = chooseCandleTier(ageMs)
            const candleTicker = spotCandleTickers.get(coin) ?? coin
            try {
              progress('Loading candles…', coin)
              const candles = await getCandlesFull(candleTicker, minT - intervalMs * 2, nowMs, interval)
              if (candles.length > 0) {
                candleMaps.set(coin, buildCandleMap(candles))
                candleIntervalMs.set(coin, intervalMs)

                // Check if the oldest fill pre-dates the first candle returned.
                // HL's rolling window means very early fills may fall before the
                // candle history (e.g. Oct 2023 fills before 4h window Dec 2023).
                // In that case, fetch daily candles as a fallback — they go back
                // to 2020 for major coins and cover all of HL's history.
                const firstCandleTime = candles.reduce((m, c) => Math.min(m, c.t), Infinity)
                if (minT < firstCandleTime - intervalMs) {
                  try {
                    const dailyCandles = await getCandlesFull(
                      candleTicker, minT - 86_400_000 * 2, nowMs, '1d',
                    )
                    if (dailyCandles.length > 0) {
                      candleFallbackMaps.set(coin, buildCandleMap(dailyCandles))
                    }
                  } catch { /* non-fatal */ }
                }
              } else if (process.env.NODE_ENV !== 'production') {
                console.warn(`[candle] empty result for ${coin} (ticker=${candleTicker}, interval=${interval}, ageMs=${ageMs})`)
              }
            } catch (err) {
              // non-fatal: price-based metrics will be null for this coin
              if (process.env.NODE_ENV !== 'production') {
                console.warn(`[candle] fetch failed for ${coin}:`, err instanceof Error ? err.message : err)
              }
            }
          }),
        )
      }
    })(),

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
    computeTradeMetrics(fill, fillTiers, fillHmKeys, candleMaps, candleIntervalMs, candleFallbackMaps, slippageCache, spotCoinNames, isSpotCoin, isHip3Coin, fill.dir),
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
 * Find the nearest candle to `ms` within ±`maxSteps` candle-intervals.
 * Works for any interval (1m, 1h, 4h…).
 */
function findNearestCandle(
  cMap: Map<number, HLCandle>,
  ms: number,
  intervalMs: number,
  maxSteps = 10,
): HLCandle | null {
  const snapped = snapToInterval(ms, intervalMs)
  for (let step = 0; step <= maxSteps; step++) {
    const earlier = cMap.get(snapped - step * intervalMs)
    if (earlier) return earlier
    if (step > 0) {
      const later = cMap.get(snapped + step * intervalMs)
      if (later) return later
    }
  }
  return null
}

// ─── Candle-based market microstructure estimator ────────────────────────────
//
// Applies to:
//   • All spot fills (Hydromancer does not cover spot markets)
//   • Perp/HIP-3 fills where Hydromancer has no data point (pre-Dec 2025 or gaps)
//
// Data source: Hyperliquid candleSnapshot API using the @N fill key for spot
// and the named coin for perps. Same ~5000-candle rolling window as all HL
// candle data; interval auto-selected by fill age (1m / 1h / 4h).
//
// ── Mid-price ──────────────────────────────────────────────────────────────
//   For 1m candles: (O+H+L+C)/4 (typical price, pre-computed as midPx).
//   For 1h/4h candles: linearly interpolate O→C by the fill's position
//   within the candle, then blend 60 % interpolated + 40 % (H+L)/2.
//   Rationale: fills at the start of an hour are near the open, not the
//   average — interpolation reduces the mid error from ~10-30 bps to ~2-5 bps.
//
// ── Spread estimators (four, weighted-combined) ────────────────────────────
//
//   1. Abdi-Ranaldo (2017)  [weight 0.50 — primary]
//      s_t = 2√(max(0, (log C_t − m_t)(log C_{t−1} − m_t)))
//      where m_t = (log H_t + log L_t)/2 (log midrange).
//      Uses both close prices and the H-L range. Empirically dominates
//      CS(2012) across asset classes and sampling frequencies.
//
//   2. Corwin-Schultz (2012)  [weight 0.30]
//      β = (ln H_t/L_t)² + (ln H_{t+1}/L_{t+1})²
//      γ = (ln max(H_t,H_{t+1}) / min(L_t,L_{t+1}))²
//      α = (1+√2)(√β − √γ);  S = 2(eᵅ−1)/(1+eᵅ)
//      OHLCV-native; discards trending (α≤0) candle pairs.
//
//   3. Roll (1984)  [weight 0.15]
//      halfSpread = √(−Cov(Δclose_t, Δclose_{t+1}))  when Cov < 0.
//      Detects bid-ask bounce as negative serial correlation of price changes.
//
//   4. Range / √n_trades  [weight 0.05]
//      halfSpread ≈ (H−L)/2 / mid / √n_trades (Madhavan 2000).
//      Highest noise — used only as a stabiliser.
//
//   For each estimator, compute the median across the 16-candle window, then
//   form a weighted average of the estimators that fired. Floor: 0.01 bps.
//
// ── Market impact — Almgren-Chriss (2001) √-law ────────────────────────────
//   σ_day  = Parkinson(1980) vol per candle × √(candles per day)
//   ADV    = avg(v × mid) per candle × candles per day   [from HL volume field]
//   impact = η × σ_day × √(notional / ADV) × 10 000 bps
//   η = 0.1  (Almgren-Chriss calibrated constant; mid-range for crypto)
//   Capped at 5 × halfSpreadBps to prevent explosion on illiquid markets.
//
// ── Slippage (takers) ──────────────────────────────────────────────────────
//   IS  = (fillPx − bestMid) × sign / bestMid × 10 000  [implementation shortfall]
//   slippage = max(halfSpread, IS, halfSpread + impact)
//   The IS floor ensures we never report less cost than actually observed.
//
// ── Makers ─────────────────────────────────────────────────────────────────
//   halfSpreadBps returned (the spread they earn); slippageBps = null.

function estimateCandleSlippage(
  cMap: Map<number, HLCandle>,
  tradeTime: number,
  fillPx: number,
  midPx: number,       // (O+H+L+C)/4 of nearest candle — used as fallback mid
  side: 'buy' | 'sell',
  isTaker: boolean,
  notionalUsd: number,
  intervalMs = 60_000,
): {
  halfSpreadBps: number | null
  slippageBps: number | null
  additionalImpactBps: number | null
} {
  const NULL_RESULT = { halfSpreadBps: null, slippageBps: null, additionalImpactBps: null }
  if (midPx <= 0) return NULL_RESULT

  const snapped = snapToInterval(tradeTime, intervalMs)

  // Collect 16 candles: 15 pre-trade + the trade candle itself
  const candles: HLCandle[] = []
  for (let i = -15; i <= 0; i++) {
    const c = cMap.get(snapped + i * intervalMs)
    if (c) candles.push(c)
  }
  // Need at least 1 candle to estimate range; statistical estimators need ≥3
  // but we have fallbacks (range, effective spread) that work with 1.
  if (candles.length < 1) return NULL_RESULT

  // ── Best mid: interpolated for coarse candles (1h / 4h) ──────────────────
  // For 1-minute candles the typical price (O+H+L+C)/4 is fine.
  // For hourly / 4-hourly candles, a fill at minute 5 of the hour should not
  // be compared against the average of the full hour — interpolate O→C by
  // the fill's fractional position in the candle and blend with (H+L)/2.
  //
  // Use findNearestCandle to get the actual trade candle (not whatever was
  // last pushed in the window loop, which may be a candle before the trade).
  let bestMid = midPx
  const tradeCandle = findNearestCandle(cMap, tradeTime, intervalMs, 3) ?? candles[candles.length - 1]
  if (tradeCandle && intervalMs >= 3_600_000) {
    const duration = tradeCandle.T - tradeCandle.t + 1
    const frac = Math.max(0, Math.min(1, (tradeTime - tradeCandle.t) / duration))
    const o = parseFloat(tradeCandle.o)
    const cl = parseFloat(tradeCandle.c)
    const hl = (parseFloat(tradeCandle.h) + parseFloat(tradeCandle.l)) / 2
    bestMid = 0.6 * (o + frac * (cl - o)) + 0.4 * hl
    if (bestMid <= 0) bestMid = midPx
  }

  // ── Estimator 1: Abdi-Ranaldo (2017) ────────────────────────────────────
  //   s_t = 2√(max(0, (log C_t − m_t)(log C_{t−1} − m_t)))
  const arEstimates: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const c0 = candles[i - 1], c1 = candles[i]
    const m1 = (Math.log(parseFloat(c1.h)) + Math.log(parseFloat(c1.l))) / 2
    const lc1 = Math.log(parseFloat(c1.c))
    const lc0 = Math.log(parseFloat(c0.c))
    const product = (lc1 - m1) * (lc0 - m1)
    if (product > 0) {
      // s_t is in log-price units ≈ fractional; halfBps = (s_t/2) * 10 000
      const halfBps = Math.sqrt(product) * 10_000
      if (halfBps >= 0.01 && halfBps < 300) arEstimates.push(halfBps)
    }
  }

  // ── Estimator 2: Corwin-Schultz (2012) ──────────────────────────────────
  //   α = (1+√2)(√β − √γ);  S = 2(eᵅ−1)/(1+eᵅ)
  const SQ2P1 = 1 + Math.SQRT2
  const csEstimates: number[] = []
  for (let i = 0; i < candles.length - 1; i++) {
    const c0 = candles[i], c1 = candles[i + 1]
    const lnH0 = Math.log(parseFloat(c0.h)), lnL0 = Math.log(parseFloat(c0.l))
    const lnH1 = Math.log(parseFloat(c1.h)), lnL1 = Math.log(parseFloat(c1.l))
    const beta = (lnH0 - lnL0) ** 2 + (lnH1 - lnL1) ** 2
    const gamma = (Math.max(lnH0, lnH1) - Math.min(lnL0, lnL1)) ** 2
    const alpha = SQ2P1 * (Math.sqrt(beta) - Math.sqrt(gamma))
    if (alpha <= 0) continue
    const S = 2 * (Math.exp(alpha) - 1) / (1 + Math.exp(alpha))
    const halfBps = S / 2 * 10_000
    if (halfBps >= 0.01 && halfBps < 300) csEstimates.push(halfBps)
  }

  // ── Estimator 3: Roll (1984) ─────────────────────────────────────────────
  let rollEst: number | null = null
  if (candles.length >= 5) {
    const closes = candles.map((c) => Math.log(parseFloat(c.c)))
    const diffs = closes.slice(1).map((c, i) => c - closes[i])
    const n = diffs.length - 1
    if (n >= 3) {
      const cov = diffs.slice(0, n).reduce((s, d, i) => s + d * diffs[i + 1], 0) / n
      if (cov < 0) {
        const halfBps = Math.sqrt(-cov) * 10_000
        if (halfBps >= 0.01 && halfBps < 300) rollEst = halfBps
      }
    }
  }

  // ── Estimator 4: Range / √n_trades ──────────────────────────────────────
  const rangeEstimates: number[] = []
  for (const c of candles) {
    if (c.n <= 0) continue
    const hi = parseFloat(c.h), lo = parseFloat(c.l), hlMid = (hi + lo) / 2
    if (hlMid <= 0) continue
    const halfBps = (hi - lo) / 2 / hlMid / Math.sqrt(c.n) * 10_000
    if (halfBps >= 0.01 && halfBps < 300) rangeEstimates.push(halfBps)
  }

  // ── Weighted combination ─────────────────────────────────────────────────
  // Each estimator produces the median across its per-candle values.
  // Weights: AR(2017)=0.50, CS(2012)=0.30, Roll(1984)=0.15, Range/√n=0.05
  const median = (arr: number[]): number | null => {
    if (arr.length === 0) return null
    const s = [...arr].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
  }

  const arMed = median(arEstimates)
  const csMed = median(csEstimates)
  const rangeMed = median(rangeEstimates)

  let wSum = 0, wTotal = 0
  if (arMed    !== null) { wSum += 0.50 * arMed;    wTotal += 0.50 }
  if (csMed    !== null) { wSum += 0.30 * csMed;    wTotal += 0.30 }
  if (rollEst  !== null) { wSum += 0.15 * rollEst;  wTotal += 0.15 }
  if (rangeMed !== null) { wSum += 0.05 * rangeMed; wTotal += 0.05 }

  let halfSpreadBps: number | null = null
  if (wTotal > 0) {
    halfSpreadBps = Math.max(0.01, wSum / wTotal)   // 0.01 bps minimum
  }

  // ── Fallback A: range-based estimate when all weighted estimators fail ────
  // Happens in strongly trending markets (AR products all ≤0, CS α all ≤0,
  // Roll covariance ≥0). Use the median H-L range across all available candles
  // as a conservative minimum estimate. No √n denominator — this overstates
  // spread slightly but guarantees we always return a value when data exists.
  if (halfSpreadBps === null && candles.length >= 1) {
    const rangeHalf = candles
      .map((c) => {
        const hi = parseFloat(c.h), lo = parseFloat(c.l), mid = (hi + lo) / 2
        return mid > 0 && hi > lo ? (hi - lo) / 2 / mid * 10_000 : null
      })
      .filter((v): v is number => v !== null && v >= 0.01)
    if (rangeHalf.length > 0) {
      const sorted = [...rangeHalf].sort((a, b) => a - b)
      halfSpreadBps = Math.max(0.01, sorted[Math.floor(sorted.length / 2)])
    }
  }

  // ── Fallback B: effective spread from actual fill vs bestMid ─────────────
  // When even the range fallback has nothing (e.g. all candles have H=L, i.e.
  // a single-price candle), use |fillPx − bestMid| as a lower-bound spread.
  // This is always computable and ensures takers get a slippage estimate.
  if (halfSpreadBps === null && fillPx > 0 && bestMid > 0) {
    const effHalf = Math.abs(fillPx - bestMid) / bestMid * 10_000
    if (effHalf >= 0.01) halfSpreadBps = effHalf
  }

  // ── Almgren-Chriss (2001) market impact ──────────────────────────────────
  // σ_day  = Parkinson(1980) per-candle vol scaled to one trading day
  // ADV_usd = avg candle volume (base × mid price) scaled to one day
  // impact = η × σ_day × √(notional / ADV_usd) × 10 000 bps
  let impactBps = 0
  if (halfSpreadBps !== null) {
    const vCandles = candles.filter((c) => parseFloat(c.v) > 0 && c.n > 0)
    if (vCandles.length >= 3) {
      const LN2_4 = 4 * Math.LN2   // ≈ 2.773
      const candlesPerDay = 86_400_000 / intervalMs

      // Parkinson volatility (fractional, per candle)
      const parkVar = vCandles.reduce((s, c) => {
        const r = Math.log(parseFloat(c.h) / parseFloat(c.l))
        return s + r * r
      }, 0) / (LN2_4 * vCandles.length)
      const σDay = Math.sqrt(Math.max(0, parkVar)) * Math.sqrt(candlesPerDay)

      // Average daily volume in USD
      const avgVolUsd = vCandles.reduce((s, c) => {
        const hlMid = (parseFloat(c.h) + parseFloat(c.l)) / 2
        return s + parseFloat(c.v) * hlMid
      }, 0) / vCandles.length
      const ADV_usd = avgVolUsd * candlesPerDay

      if (σDay > 0 && ADV_usd > 0) {
        const η = 0.1   // Almgren-Chriss calibrated constant
        impactBps = η * σDay * Math.sqrt(notionalUsd / ADV_usd) * 10_000
        impactBps = Math.min(impactBps, 5 * halfSpreadBps)  // cap: 5× half-spread
      }
    }
  }

  // ── Directional slippage (takers only) ──────────────────────────────────
  let slippageBps: number | null = null
  let additionalImpactBps: number | null = null

  if (isTaker) {
    const sign = side === 'buy' ? 1 : -1
    // Implementation shortfall: how much worse than mid the fill was
    const IS = sign * (fillPx - bestMid) / bestMid * 10_000
    const modelSlippage = halfSpreadBps !== null ? halfSpreadBps + impactBps : 0
    const floor = halfSpreadBps ?? 0
    // Take the largest of: spread floor, observed IS, model prediction
    slippageBps = Math.max(floor, IS, modelSlippage)
    additionalImpactBps = halfSpreadBps !== null
      ? Math.max(0, slippageBps - halfSpreadBps)
      : null
  }
  // Makers: halfSpreadBps = spread earned; slippageBps intentionally null

  return { halfSpreadBps, slippageBps, additionalImpactBps }
}

// ─── Single-trade metrics ─────────────────────────────────────────────────────

function computeTradeMetrics(
  fill: HLFill,
  fillTiers: Map<number, NotionalTier>,
  fillHmKeys: Map<number, string>,
  candleMaps: Map<string, Map<number, HLCandle>>,
  candleIntervalMs: Map<string, number>,
  candleFallbackMaps: Map<string, Map<number, HLCandle>>,
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

  // Primary candle map (finest interval that covers the coin's fill history)
  let cMap = candleMaps.get(fill.coin)
  let iMs = candleIntervalMs.get(fill.coin) ?? 60_000  // default 1m
  if (cMap) {
    const candleAtTrade = findNearestCandle(cMap, fill.time, iMs, 10)
    if (candleAtTrade) {
      midAtTrade = candleMid(candleAtTrade)
      candleOpen = parseFloat(candleAtTrade.o)
    }
    // "5 min later" generalised to "5 intervals later" for coarse candles
    const fiveIntervalsMs = Math.max(5 * 60_000, 5 * iMs)
    const candle5 = findNearestCandle(cMap, fill.time + fiveIntervalsMs, iMs, 10)
    if (candle5) midPlus5 = candleMid(candle5)
  }

  // ── 1d fallback: for fills that predate the primary candle window ────────
  // Example: ETH/SOL fills from Oct-Dec 2023 (HL launch) are before the 4h
  // window that starts Dec 19 2023.  Daily candles go back to 2020 for major
  // coins and cover the entire HL history.
  if (midAtTrade === null) {
    const fbMap = candleFallbackMaps.get(fill.coin)
    if (fbMap) {
      const DAY_MS = 86_400_000
      const fbCandle = findNearestCandle(fbMap, fill.time, DAY_MS, 3)
      if (fbCandle) {
        midAtTrade = candleMid(fbCandle)
        candleOpen = parseFloat(fbCandle.o)
        const candle5fb = findNearestCandle(fbMap, fill.time + 5 * DAY_MS, DAY_MS, 3)
        if (candle5fb) midPlus5 = candleMid(candle5fb)
        // Switch cMap/iMs to fallback so estimateCandleSlippage uses 1d candles
        cMap = fbMap
        iMs = DAY_MS
      }
    }
  }

  // ── Slippage & spread from Hydromancer (fix #2, #3) ─────────────────────
  let halfSpreadBps: number | null = null
  let rawBuySlippageBps: number | null = null
  let rawSellSlippageBps: number | null = null
  let slippageBps: number | null = null
  let additionalImpactBps: number | null = null
  let slippageSource: TradeExecutionMetrics['slippageSource'] = 'unavailable'

  const tier = fillTiers.get(fill.tid)
  // fillHmKeys stores the correct Hydromancer cache key (e.g. "xyz:TSLA:1000")
  // which differs from the raw HL coin name for HIP-3 markets.
  const hmKey = fillHmKeys.get(fill.tid)
  if (tier && hmKey && !isSpot) {
    const pts = slippageCache[hmKey] ?? []
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

  // ── Candle-based estimation ───────────────────────────────────────────────
  // Applies to BOTH perp and spot fills:
  //   • Perps: fires when Hydromancer has no data point (pre-Dec 2025 fills,
  //     coins not covered by Hydromancer, or gaps in the 15-min sampling).
  //   • Spot: always fires (no Hydromancer coverage for spot markets).
  // Uses CS(2012) + Roll(1984) + Range/√n spread estimators and the
  // Almgren-Chriss √-impact model.  Mid-price is the OHLC typical price
  // of the nearest candle (1m / 1h / 4h depending on fill age).
  if (slippageSource !== 'hydromancer' && midAtTrade !== null && cMap) {
    const est = estimateCandleSlippage(cMap, fill.time, fillPx, midAtTrade, side, isTaker, notional, iMs)
    if (est.halfSpreadBps !== null || est.slippageBps !== null) {
      halfSpreadBps = est.halfSpreadBps
      slippageBps = est.slippageBps
      additionalImpactBps = est.additionalImpactBps
      slippageSource = 'candle'
    } else {
      // Debug: log why we still have no estimate after candle fallback
      if (process.env.NODE_ENV !== 'production') {
        console.debug(`[metrics] no estimate for ${fill.coin} tid=${fill.tid}`, {
          midAtTrade,
          cMapSize: cMap.size,
          iMs,
          fillPx,
          time: new Date(fill.time).toISOString(),
        })
      }
    }
  } else if (slippageSource !== 'hydromancer') {
    // Debug: log why candle path wasn't entered
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[metrics] candle path skipped for ${fill.coin} tid=${fill.tid}: midAtTrade=${midAtTrade} hasCMap=${!!cMap} source=${slippageSource}`)
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

  // Coverage: fraction of all trades that have any slippage/spread estimate.
  // Hydromancer = observed order-book data (perps only, Dec 2025+).
  // Candle     = model estimate from OHLCV (all assets, any age within candle history).
  const slippageDataCoverage =
    trades.length > 0
      ? trades.filter((t) => t.slippageSource === 'hydromancer' || t.slippageSource === 'candle').length / trades.length
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
