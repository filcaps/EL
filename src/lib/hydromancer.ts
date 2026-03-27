import type { HMSlippagePoint } from '../types'

// Always route through /api/hydromancer — the Vite proxy handles this in dev,
// and the Vercel serverless function handles it in production (keeping the API key server-side).
const BASE = '/api/hydromancer'

// Supported notional tiers (USD)
export const NOTIONAL_TIERS = [1_000, 5_000, 10_000, 30_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const
export type NotionalTier = (typeof NOTIONAL_TIERS)[number]

// ─── HIP-3 coin → Hydromancer coin key mapping ───────────────────────────────
//
// Hydromancer tracks HIP-3 RWA markets under a dex-prefixed coin name:
//   standard perps:  "BTC", "ETH", "HYPE"  (no prefix — dex="hyperliquid")
//   HIP-3 xyz DEX:   "xyz:TSLA", "xyz:NVDA" (dex="xyz")
//   HIP-3 cash DEX:  "cash:WTI"             (dex="cash", only where xyz has no data)
//
// Coins absent from this map have no Hydromancer coverage; they fall back to
// the candle-based estimation model in metrics.ts.
//
// Tested 2026-03-27 against startTime=1769817600000 (2026-02-01).
export const HIP3_HYDROMANCER_KEYS: Record<string, string> = {
  // ── Stocks (xyz) ────────────────────────────────────────────────────────
  AAPL:    'xyz:AAPL',
  AMD:     'xyz:AMD',
  AMZN:    'xyz:AMZN',
  BABA:    'xyz:BABA',
  COIN:    'xyz:COIN',
  CRWV:    'xyz:CRWV',
  GOOGL:   'xyz:GOOGL',
  HOOD:    'xyz:HOOD',
  HYUNDAI: 'xyz:HYUNDAI',
  INTC:    'xyz:INTC',
  META:    'xyz:META',
  MSFT:    'xyz:MSFT',
  MU:      'xyz:MU',
  NFLX:    'xyz:NFLX',
  NVDA:    'xyz:NVDA',
  ORCL:    'xyz:ORCL',
  PLTR:    'xyz:PLTR',
  RIVN:    'xyz:RIVN',
  SNDK:    'xyz:SNDK',
  TSLA:    'xyz:TSLA',
  // ── Commodities ──────────────────────────────────────────────────────────
  GOLD:      'xyz:GOLD',
  SILVER:    'xyz:SILVER',
  COPPER:    'xyz:COPPER',
  NATGAS:    'xyz:NATGAS',
  PALLADIUM: 'xyz:PALLADIUM',
  PLATINUM:  'xyz:PLATINUM',
  WTI:       'cash:WTI',   // only available on cash DEX
  // ── Forex ────────────────────────────────────────────────────────────────
  JPY: 'xyz:JPY',
  // ── ETFs ─────────────────────────────────────────────────────────────────
  URNM: 'xyz:URNM',
  EWJ:  'xyz:EWJ',
  // Coins with no Hydromancer coverage fall through to candle model:
  //   CLX, RTX, TSMS, OIL, 100BRENT, USOIL, US500, USTECH, SMALL2000,
  //   USENERGY, EURUSD, GLD, SEMI, USBOND, EWYM, MINE, N, BMNR, CRC,
  //   KHX, LM, SMS, STR, UEWY, USAR, YZ
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Hydromancer ${body.type}: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

// ─── Slippage history ─────────────────────────────────────────────────────────

export interface SlippageHistoryParams {
  coin: string
  amount: NotionalTier
  startTime: number
  endTime?: number
  limit?: number
}

export async function getSlippageHistory(
  params: SlippageHistoryParams,
): Promise<HMSlippagePoint[]> {
  const body: Record<string, unknown> = {
    type: 'slippageHistory',
    coin: params.coin,
    amount: params.amount,
    startTime: params.startTime,
  }
  if (params.endTime !== undefined) body.endTime = params.endTime
  if (params.limit !== undefined) body.limit = params.limit
  return post<HMSlippagePoint[]>(body)
}

// ─── Tier helpers ─────────────────────────────────────────────────────────────

/**
 * Round up to the next supported notional tier.
 * Returns the highest tier when notional exceeds $1M.
 */
export function closestTier(notionalUsd: number): NotionalTier {
  for (const tier of NOTIONAL_TIERS) {
    if (notionalUsd <= tier) return tier
  }
  return NOTIONAL_TIERS[NOTIONAL_TIERS.length - 1]
}

// ─── Binary-search nearest point ─────────────────────────────────────────────

/**
 * Given a sorted (ascending by timestamp) array of slippage points, return
 * the nearest point to targetMs using binary search (O(log n)).
 * Returns null when the nearest point is further than maxGapMs away.
 */
export function nearestSlippagePoint(
  points: HMSlippagePoint[],
  targetMs: number,
  maxGapMs = 30 * 60 * 1000,
): HMSlippagePoint | null {
  if (points.length === 0) return null

  // Binary search: find insertion point
  let lo = 0
  let hi = points.length - 1

  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].timestamp < targetMs) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }

  // lo is the index of the first point >= targetMs; check lo-1 as well
  const candidates: HMSlippagePoint[] = [points[lo]]
  if (lo > 0) candidates.push(points[lo - 1])

  let best = candidates[0]
  for (const c of candidates) {
    if (Math.abs(c.timestamp - targetMs) < Math.abs(best.timestamp - targetMs)) {
      best = c
    }
  }

  return Math.abs(best.timestamp - targetMs) <= maxGapMs ? best : null
}

// ─── Bulk cache builder ───────────────────────────────────────────────────────

export interface SlippageCache {
  // key: `${coin}:${tier}`  → sorted array of slippage points
  [key: string]: HMSlippagePoint[]
}

/**
 * Batch-fetch slippage history for a set of (coin, tier) pairs in parallel.
 * De-duplicates pairs before fetching.
 * Returns a cache keyed by `${coin}:${tier}`.
 */
export async function buildSlippageCache(
  pairs: Array<{ coin: string; tier: NotionalTier }>,
  startTime: number,
  endTime: number,
): Promise<SlippageCache> {
  const cache: SlippageCache = {}

  const unique = Array.from(
    new Map(pairs.map((p) => [`${p.coin}:${p.tier}`, p])).values(),
  )

  await Promise.allSettled(
    unique.map(async ({ coin, tier }) => {
      const key = `${coin}:${tier}`
      try {
        const allPoints: HMSlippagePoint[] = []
        let cursor = startTime

        // Paginate until we get a partial batch (< 2000), mirroring getAllUserFills logic.
        // A 3-month window at 15-min intervals = ~8,640 points; must not stop after 2 pages.
        while (true) {
          const batch = await getSlippageHistory({
            coin,
            amount: tier,
            startTime: cursor,
            endTime,
            limit: 2000,
          })
          if (batch.length === 0) break
          allPoints.push(...batch)
          if (batch.length < 2000) break
          cursor = batch[batch.length - 1].timestamp + 1
        }

        allPoints.sort((a, b) => a.timestamp - b.timestamp)
        cache[key] = allPoints
      } catch (err) {
        console.warn(`Hydromancer slippage unavailable for ${key}:`, err)
        cache[key] = []
      }
    }),
  )

  return cache
}
