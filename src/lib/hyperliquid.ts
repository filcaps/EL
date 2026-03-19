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
 * Fetch ALL fills for an address, paginating backwards through history.
 * The /info userFills endpoint caps at 2000 results. When the cap is hit we
 * call userFillsByTime with endTime = (oldest seen fill time − 1ms) and
 * repeat until a page comes back with fewer than 2000 results.
 */
export async function getAllUserFills(
  address: string,
  onProgress?: (fetched: number) => void,
): Promise<HLFill[]> {
  const PAGE = 2000
  const user = address.toLowerCase()

  const first = await post<HLFill[]>('userFills', { user })
  onProgress?.(first.length)
  if (first.length < PAGE) return first

  const all: HLFill[] = [...first]
  let oldestTime = first.reduce((m, f) => Math.min(m, f.time), Infinity)

  while (true) {
    const batch = await post<HLFill[]>('userFillsByTime', {
      user,
      startTime: 0,
      endTime: oldestTime - 1,
    })
    if (batch.length === 0) break
    all.push(...batch)
    onProgress?.(all.length)
    if (batch.length < PAGE) break
    oldestTime = batch.reduce((m, f) => Math.min(m, f.time), oldestTime)
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
export async function fetchOrderBuilderFee(
  user: string,
  oid: number,
): Promise<number> {
  try {
    type OrderStatusResp = {
      status: string
      order?: {
        order?: { builderFee?: string | number }
      }
    }
    const resp = await post<OrderStatusResp>('orderStatus', {
      user: user.toLowerCase(),
      oid,
    })
    const raw = resp?.order?.order?.builderFee
    if (raw !== undefined && raw !== null) {
      // HL expresses builderFee in tenths of bps; convert to a USD amount
      // requires knowing the notional — caller must multiply by notional / 10_000 / 10
      // For now return the raw tenths-of-bps value so callers can scale
      return typeof raw === 'string' ? parseFloat(raw) : Number(raw)
    }
  } catch {
    // non-fatal — leave as 0
  }
  return 0
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
 */
export async function getCandles(
  coin: string,
  startTime: number,
  endTime: number,
  interval = '1m',
): Promise<HLCandle[]> {
  return post<HLCandle[]>('candleSnapshot', {
    req: { coin, interval, startTime, endTime },
  })
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
    '1m': 60_000,
    '3m': 180_000,
    '5m': 300_000,
    '15m': 900_000,
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
