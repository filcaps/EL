import { getMetaAndAssetCtxs, getSpotMetaAndAssetCtxs } from './hyperliquid'

// ─── Open Interest map (symbol → OI in USD) ─────────────────────────────────

export async function getOpenInterestMap(): Promise<Map<string, number>> {
  const [meta, ctxs] = await getMetaAndAssetCtxs()
  const oiMap = new Map<string, number>()
  meta.universe.forEach((asset, i) => {
    const ctx = ctxs[i]
    if (ctx) {
      oiMap.set(
        asset.name.toUpperCase(),
        parseFloat(ctx.openInterest) * parseFloat(ctx.markPx),
      )
    }
  })
  return oiMap
}

// ─── HIP-3 Volume (24h notional per asset) ──────────────────────────────────

export interface Hip3VolumeEntry {
  coin: string
  volume24h: number
}

export async function getHip3Volumes(): Promise<Hip3VolumeEntry[]> {
  // Fetch spot meta — HIP-3 assets are non-canonical spot tokens
  const [spotMeta, spotCtxs] = await getSpotMetaAndAssetCtxs()

  const entries: Hip3VolumeEntry[] = []

  for (let i = 0; i < spotMeta.universe.length; i++) {
    const market = spotMeta.universe[i]
    if (market.isCanonical) continue // skip canonical spot (BTC, ETH, etc.)

    const ctx = spotCtxs[i] as { dayNtlVlm?: string; markPx?: string } | undefined
    if (!ctx?.dayNtlVlm) continue

    const volume = parseFloat(ctx.dayNtlVlm)
    if (volume <= 0) continue

    // Resolve human-readable name from the base token
    const baseTokenIdx = market.tokens[0]
    const token = spotMeta.tokens.find((t) => t.index === baseTokenIdx)
    const name = token?.name ?? market.name

    entries.push({ coin: name, volume24h: volume })
  }

  return entries.sort((a, b) => b.volume24h - a.volume24h)
}

// ─── Dune: HIP-3 vs Hyperliquid volume ─────────────────────────────────────

const DUNE_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

export interface DuneVolumeRow {
  date: string
  cryptoVolume: number
  hip3Volume: number
}

export async function fetchDuneHip3VsHl(queryId: string): Promise<DuneVolumeRow[]> {
  // Check localStorage cache first
  const cacheKey = `dune_${queryId}`
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
      const { data, ts } = JSON.parse(cached) as { data: DuneVolumeRow[]; ts: number }
      if (Date.now() - ts < DUNE_CACHE_TTL) return data
    }
  } catch { /* ignore corrupt cache */ }

  const apiKey = import.meta.env.VITE_DUNE_API_KEY
  if (!apiKey) throw new Error('VITE_DUNE_API_KEY not set')

  const res = await fetch(
    `https://api.dune.com/api/v1/query/${queryId}/results?limit=1000`,
    { headers: { 'X-DUNE-API-KEY': apiKey } },
  )
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Dune query ${queryId}: ${res.status} ${text}`)
  }

  const json = await res.json()
  const rows = json.result?.rows ?? []

  // Group by date, pairing Crypto and HIP-3 rows
  const byDate = new Map<string, { crypto: number; hip3: number }>()

  for (const r of rows) {
    const dateStr = (r.time as string).slice(0, 10) // "2025-11-10"
    if (!byDate.has(dateStr)) byDate.set(dateStr, { crypto: 0, hip3: 0 })
    const entry = byDate.get(dateStr)!
    if (r.category === 'Crypto') entry.crypto = r.daily_usd_volume as number
    else if (r.category === 'HIP-3') entry.hip3 = r.daily_usd_volume as number
  }

  const result = Array.from(byDate.entries())
    .map(([date, v]) => ({ date, cryptoVolume: v.crypto, hip3Volume: v.hip3 }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Persist to localStorage
  try {
    localStorage.setItem(cacheKey, JSON.stringify({ data: result, ts: Date.now() }))
  } catch { /* storage full — ignore */ }

  return result
}

// ─── Curated Token Unlocks ──────────────────────────────────────────────────
// Manually maintained — update periodically with upcoming major unlocks.

export interface TokenUnlock {
  token: string
  symbol: string
  logo: string         // URL to coin icon
  unlockDate: string   // ISO date e.g. "2026-04-15"
  amountLabel: string  // e.g. "$1.2B"
  percentOfSupply: number
  venue: string        // most liquid venue
}

export const CURATED_UNLOCKS: TokenUnlock[] = [
  {
    token: 'Solana',
    symbol: 'SOL',
    logo: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
    unlockDate: '2026-04-07',
    amountLabel: '$1.5B',
    percentOfSupply: 2.3,
    venue: 'Binance',
  },
  {
    token: 'Sui',
    symbol: 'SUI',
    logo: 'https://assets.coingecko.com/coins/images/26375/small/sui-ocean-square.png',
    unlockDate: '2026-04-01',
    amountLabel: '$260M',
    percentOfSupply: 2.67,
    venue: 'Binance',
  },
  {
    token: 'Aptos',
    symbol: 'APT',
    logo: 'https://assets.coingecko.com/coins/images/26455/small/aptos_round.png',
    unlockDate: '2026-04-12',
    amountLabel: '$69M',
    percentOfSupply: 1.87,
    venue: 'Binance',
  },
  {
    token: 'Arbitrum',
    symbol: 'ARB',
    logo: 'https://assets.coingecko.com/coins/images/16547/small/arb.jpg',
    unlockDate: '2026-04-16',
    amountLabel: '$42M',
    percentOfSupply: 2.13,
    venue: 'Binance',
  },
  {
    token: 'Worldcoin',
    symbol: 'WLD',
    logo: 'https://assets.coingecko.com/coins/images/31069/small/worldcoin.jpeg',
    unlockDate: '2026-04-23',
    amountLabel: '$37M',
    percentOfSupply: 1.52,
    venue: 'Bybit',
  },
]

// ─── Formatting helpers ─────────────────────────────────────────────────────

export function fmtCompact(v: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(2)}`
}
