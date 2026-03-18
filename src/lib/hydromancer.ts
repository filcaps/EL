import type { HMSlippagePoint } from '../types'

// In dev, route through the Vite proxy to avoid CORS preflight rejection on the Authorization header
const BASE = import.meta.env.DEV ? '/api/hydromancer' : 'https://api.hydromancer.xyz'
const API_KEY = import.meta.env.VITE_HYDROMANCER_API_KEY as string

// Supported notional tiers (USD)
export const NOTIONAL_TIERS = [1_000, 5_000, 10_000, 30_000, 50_000, 100_000, 250_000, 500_000, 1_000_000] as const
export type NotionalTier = (typeof NOTIONAL_TIERS)[number]

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}/info`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
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

        const firstBatch = await getSlippageHistory({
          coin,
          amount: tier,
          startTime,
          endTime,
          limit: 2000,
        })
        allPoints.push(...firstBatch)

        // Page if the batch was full (there may be more)
        if (firstBatch.length === 2000) {
          const lastTs = firstBatch[firstBatch.length - 1].timestamp
          const more = await getSlippageHistory({
            coin,
            amount: tier,
            startTime: lastTs + 1,
            endTime,
            limit: 2000,
          })
          allPoints.push(...more)
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
