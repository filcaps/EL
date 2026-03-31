import type {
  HLFill,
  HLCandle,
  HLL2Book,
  HLAssetContext,
  HLMeta,
  HLHistoricalOrder,
} from '../types'

const BASE = 'https://api.hyperliquid.xyz'

async function post<T>(type: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BASE}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, ...extra }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Hyperliquid ${type}: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

// ─── Fills ────────────────────────────────────────────────────────────────────

export async function getUserFills(address: string): Promise<HLFill[]> {
  return post<HLFill[]>('userFills', { user: address.toLowerCase() })
}

/**
 * Fetch ALL fills for an address with no cap.
 *
 * Key facts about the HL API (verified empirically):
 *  - userFills        → most-recent ≤ 2000 fills, sorted DESCENDING (newest first)
 *  - userFillsByTime  → fills in [startTime, endTime], sorted ASCENDING (oldest first),
 *                       capped at 2000 per call
 *
 * Because userFillsByTime is oldest-first, the correct strategy is FORWARD
 * pagination: start at the HL genesis timestamp, take 2000 oldest fills, then
 * advance startTime to (newestInBatch + 1ms) and repeat until the batch is
 * smaller than the page size.  A dedup set by tid handles any timestamp
 * collisions at page boundaries.
 */
export async function getAllUserFills(
  address: string,
  onProgress?: (fetched: number) => void,
): Promise<HLFill[]> {
  const PAGE = 2000
  const user = address.toLowerCase()
  // HL mainnet launched ~Oct 2023; use a safe early epoch to catch everything.
  const HL_GENESIS = 1_672_531_200_000 // 2023-01-01T00:00:00Z

  // Dedup key: tid when non-zero, otherwise fall back to "coin|time|oid" composite
  // because dust-conversion fills share tid = 0.
  const seen = new Set<string>()
  const fillKey = (f: HLFill) =>
    f.tid !== 0 ? String(f.tid) : `${f.coin}|${f.time}|${f.oid}`

  const all: HLFill[] = []
  let startTime = HL_GENESIS

  while (true) {
    const batch = await post<HLFill[]>('userFillsByTime', { user, startTime })

    if (batch.length === 0) break

    for (const f of batch) {
      const k = fillKey(f)
      if (!seen.has(k)) {
        seen.add(k)
        all.push(f)
      }
    }
    onProgress?.(all.length)

    if (batch.length < PAGE) break // final (incomplete) page — done

    // Advance cursor to just after the newest fill in this batch
    const newestInBatch = batch.reduce((m, f) => Math.max(m, f.time), 0)
    startTime = newestInBatch + 1
  }

  return all
}

// ─── Builder fee enrichment ───────────────────────────────────────────────────

/**
 * Attempt to fetch the builder fee for a single fill, identified by its order ID.
 *
 * Hyperliquid's public REST API does not currently expose builder fees in the
 * fills response or via a transaction-hash lookup.  The `orderStatus` endpoint
 * returns the original order object, but the `builderFee` action field is not
 * forwarded in the response either.
 *
 * This function is the single hook point: when HL adds the field (or a tx-level
 * endpoint becomes available), only this function needs to change.  All UI wiring
 * (background batch loading, reactive state updates) is already in place.
 *
 * Returns 0 when the fee cannot be determined.
 */
export interface BuilderFeeResult {
  /** Fee rate in tenths of basis points (HL native unit). 0 if none. */
  tenthsBps: number
  /**
   * The builder's wallet address, if HL ever exposes it in orderStatus.
   * Currently null — the address lives in the L1 transaction action which
   * is not returned by any public REST endpoint.
   */
  builderAddress: string | null
}

export async function fetchOrderBuilderFee(
  user: string,
  oid: number,
): Promise<BuilderFeeResult> {
  try {
    type OrderStatusResp = {
      status: string
      order?: {
        order?: {
          builderFee?: string | number
          builder?: { b?: string; f?: string | number } | string
        }
      }
    }
    const resp = await post<OrderStatusResp>('orderStatus', {
      user: user.toLowerCase(),
      oid,
    })
    const inner = resp?.order?.order
    if (!inner) return { tenthsBps: 0, builderAddress: null }

    // Fee rate: present as a number (tenths of bps) in some order types
    const raw = inner.builderFee
    const tenthsBps = raw !== undefined && raw !== null
      ? typeof raw === 'string' ? parseFloat(raw) : Number(raw)
      : 0

    // Builder address: HL includes a "builder" field in the action when a
    // builder code was used. Format: { "b": "0x...", "f": <tenthsBps> }
    let builderAddress: string | null = null
    if (inner.builder) {
      if (typeof inner.builder === 'string') {
        builderAddress = inner.builder.toLowerCase()
      } else if (inner.builder.b) {
        builderAddress = (inner.builder.b as string).toLowerCase()
      }
    }

    return { tenthsBps, builderAddress }
  } catch {
    // non-fatal
  }
  return { tenthsBps: 0, builderAddress: null }
}

export async function getUserFillsByTime(
  address: string,
  startTime: number,
  endTime?: number,
): Promise<HLFill[]> {
  const extra: Record<string, unknown> = { user: address.toLowerCase(), startTime }
  if (endTime !== undefined) extra.endTime = endTime
  return post<HLFill[]>('userFillsByTime', extra)
}

// ─── Historical orders (for cancel/trade ratio) ───────────────────────────────

export async function getHistoricalOrders(address: string): Promise<HLHistoricalOrder[]> {
  return post<HLHistoricalOrder[]>('historicalOrders', { user: address.toLowerCase() })
}

// ─── Candles (1-min OHLCV for mid-price estimation) ──────────────────────────

/**
 * Fetch 1-minute candles for a coin over a time range.
 * The API caps at 5000 candles per request (~83 hours of 1-min candles).
 * For longer ranges, callers must page.
 *
 * Retries once on 429 (rate-limit) with a 1-second back-off.
 */
export async function getCandles(
  coin: string,
  startTime: number,
  endTime: number,
  interval = '1m',
): Promise<HLCandle[]> {
  try {
    return await post<HLCandle[]>('candleSnapshot', {
      req: { coin, interval, startTime, endTime },
    })
  } catch (err) {
    // Retry once on rate-limit (429) after a short back-off
    if (err instanceof Error && err.message.includes('429')) {
      await new Promise((r) => setTimeout(r, 1000))
      return post<HLCandle[]>('candleSnapshot', {
        req: { coin, interval, startTime, endTime },
      })
    }
    throw err
  }
}

/**
 * Fetch candles across an arbitrary range, chunking into 5000-candle pages.
 */
export async function getCandlesFull(
  coin: string,
  startTime: number,
  endTime: number,
  interval = '1m',
): Promise<HLCandle[]> {
  const INTERVAL_MS: Record<string, number> = {
    '1m':   60_000,
    '3m':  180_000,
    '5m':  300_000,
    '15m': 900_000,
    '1h': 3_600_000,
    '2h': 7_200_000,
    '4h':14_400_000,
    '8h':28_800_000,
    '1d':86_400_000,
  }
  const step = (INTERVAL_MS[interval] ?? 60_000) * 5000

  const chunks: HLCandle[] = []
  let cursor = startTime
  while (cursor < endTime) {
    const chunkEnd = Math.min(cursor + step, endTime)
    const candles = await getCandles(coin, cursor, chunkEnd, interval)
    if (candles) chunks.push(...candles)
    cursor = chunkEnd + 1 // always advance — a single empty chunk must not abort the whole range
  }
  return chunks
}

// ─── Order book (live) ────────────────────────────────────────────────────────

export async function getL2Book(coin: string): Promise<HLL2Book> {
  return post<HLL2Book>('l2Book', { coin })
}

// ─── Market metadata + asset contexts ────────────────────────────────────────

export async function getMetaAndAssetCtxs(): Promise<[HLMeta, HLAssetContext[]]> {
  return post<[HLMeta, HLAssetContext[]]>('metaAndAssetCtxs')
}

// ─── Spot metadata + asset contexts ──────────────────────────────────────────

export async function getSpotMetaAndAssetCtxs(): Promise<
  [{
    tokens: Array<{ name: string; index: number; tokenId: string; szDecimals: number }>
    universe: Array<{ name: string; index: number; tokens: number[]; isCanonical: boolean }>
  }, unknown[]]
> {
  return post('spotMetaAndAssetCtxs')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a coin to a perp-market name.
 * Spot coins on Hyperliquid use "@N" notation; we return null for them so
 * callers know to skip perp-specific logic.
 */
export function isPerpCoin(coin: string): boolean {
  return !coin.startsWith('@')
}

/**
 * Build a lookup map: coinName -> index in metaAndAssetCtxs arrays.
 */
export function buildCoinIndex(meta: HLMeta): Map<string, number> {
  const m = new Map<string, number>()
  meta.universe.forEach((u, i) => m.set(u.name, i))
  return m
}
