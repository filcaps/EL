const BASE = 'https://api.coingecko.com/api/v3'

export interface CoinMarket {
  id: string
  symbol: string
  name: string
  image: string
  current_price: number
  market_cap: number
  market_cap_rank: number
  total_volume: number
  price_change_percentage_24h: number | null
  circulating_supply: number
  total_supply: number | null
  max_supply: number | null
  last_updated: string
}

export async function getTopMarkets(perPage = 10): Promise<CoinMarket[]> {
  const url = `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=false`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`CoinGecko markets: ${res.status} ${text}`)
  }
  return res.json() as Promise<CoinMarket[]>
}
