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
    chunks.push(...candles)
    if (candles.length === 0) break
    cursor = chunkEnd + 1
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
  [{ tokens: Array<{ name: string; index: number; tokenId: string; szDecimals: number }> }, unknown[]]
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
