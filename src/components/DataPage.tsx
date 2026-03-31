import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { format } from 'date-fns'
import { RefreshCw } from 'lucide-react'
import { getTopMarkets, type CoinMarket } from '../lib/coingecko'
import {
  getOpenInterestMap,
  getHip3Volumes,
  fetchDuneHip3VsHl,
  CURATED_UNLOCKS,
  fmtCompact,
  type Hip3VolumeEntry,
  type DuneVolumeRow,
} from '../lib/data-fetchers'

// ─── Cache config ────────────────────────────────────────────────────────────

const MARKET_STALE_MS = 6 * 60 * 60 * 1000  // 6 hours
const DUNE_STALE_MS = 24 * 60 * 60 * 1000   // 24 hours

interface Cached<T> {
  data: T | null
  fetchedAt: number
  error?: string
}

function isStale<T>(c: Cached<T>, maxAge: number): boolean {
  return !c.data || Date.now() - c.fetchedAt > maxAge
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DataPage() {
  const [markets, setMarkets] = useState<Cached<CoinMarket[]>>({ data: null, fetchedAt: 0 })
  const [oiMap, setOiMap] = useState<Cached<Map<string, number>>>({ data: null, fetchedAt: 0 })
  const [hip3, setHip3] = useState<Cached<Hip3VolumeEntry[]>>({ data: null, fetchedAt: 0 })
  const [dune, setDune] = useState<Cached<DuneVolumeRow[]>>({ data: null, fetchedAt: 0 })
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async (force = false) => {
    setLoading(true)

    const jobs: Promise<void>[] = []

    // Market data + OI (6h cache)
    if (force || isStale(markets, MARKET_STALE_MS)) {
      jobs.push(
        getTopMarkets(10)
          .then((data) => setMarkets({ data, fetchedAt: Date.now() }))
          .catch((e) => setMarkets((prev) => ({ ...prev, error: e.message }))),
      )
      jobs.push(
        getOpenInterestMap()
          .then((data) => setOiMap({ data, fetchedAt: Date.now() }))
          .catch((e) => setOiMap((prev) => ({ ...prev, error: e.message }))),
      )
    }

    // HIP-3 volumes (6h cache)
    if (force || isStale(hip3, MARKET_STALE_MS)) {
      jobs.push(
        getHip3Volumes()
          .then((data) => setHip3({ data, fetchedAt: Date.now() }))
          .catch((e) => setHip3((prev) => ({ ...prev, error: e.message }))),
      )
    }

    // Dune data (24h cache — expensive API)
    if (force || isStale(dune, DUNE_STALE_MS)) {
      jobs.push(
        fetchDuneHip3VsHl('6280948')
          .then((data) => setDune({ data, fetchedAt: Date.now() }))
          .catch((e) => setDune((prev) => ({ ...prev, error: e.message }))),
      )
    }

    await Promise.allSettled(jobs)
    setLoading(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-8 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-text-primary">Market Data</h1>
        <button
          onClick={() => fetchAll(true)}
          disabled={loading}
          className="btn-ghost flex items-center gap-1.5 text-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* ── Section 1: Top 10 Crypto Assets ─────────────────────────────────── */}
      <section className="card">
        <div className="card-header">
          <span className="card-title">Top 10 Crypto Assets</span>
          {markets.fetchedAt > 0 && (
            <span className="text-[10px] text-text-dim">
              Updated {format(new Date(markets.fetchedAt), 'MMM d, HH:mm')}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th w-10">#</th>
                <th className="th">Name</th>
                <th className="th text-right">Price</th>
                <th className="th text-right">24h %</th>
                <th className="th text-right">Market Cap</th>
                <th className="th text-right">Volume (24h)</th>
                <th className="th text-right">Open Interest</th>
              </tr>
            </thead>
            <tbody>
              {markets.data ? (
                markets.data.map((c) => (
                  <MarketRow key={c.id} coin={c} oiMap={oiMap.data} />
                ))
              ) : (
                Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} cols={7} />)
              )}
            </tbody>
          </table>
        </div>
        {markets.error && <ErrorNote msg={markets.error} />}
      </section>

      {/* ── Section 2: Top Token Unlocks ─────────────────────────────────────── */}
      <section className="card">
        <div className="card-header">
          <span className="card-title">Upcoming Token Unlocks</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Token</th>
                <th className="th text-right">Unlock Date</th>
                <th className="th text-right">Amount</th>
                <th className="th text-right">% of Supply</th>
                <th className="th text-right">Most Liquid Venue</th>
              </tr>
            </thead>
            <tbody>
              {CURATED_UNLOCKS.map((u) => (
                <tr key={u.symbol} className="table-row-hover">
                  <td className="td-primary">
                    <span className="font-sans">{u.token}</span>{' '}
                    <span className="text-text-muted text-xs">{u.symbol}</span>
                  </td>
                  <td className="td text-right">{format(new Date(u.unlockDate), 'MMM d, yyyy')}</td>
                  <td className="td text-right">{u.amountLabel}</td>
                  <td className="td text-right">{u.percentOfSupply.toFixed(2)}%</td>
                  <td className="td text-right">{u.venue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Section 3: HIP-3 Volume Bar Chart ───────────────────────────────── */}
      <section className="card">
        <div className="card-header">
          <span className="card-title">HIP-3 24h Volume by Asset</span>
          {hip3.fetchedAt > 0 && (
            <span className="text-[10px] text-text-dim">
              Updated {format(new Date(hip3.fetchedAt), 'MMM d, HH:mm')}
            </span>
          )}
        </div>
        <div className="p-4 h-80">
          {hip3.data && hip3.data.length > 0 ? (
            <Hip3VolumeChart data={hip3.data} />
          ) : hip3.error ? (
            <ErrorNote msg={hip3.error} />
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              {loading ? 'Loading HIP-3 volume…' : 'No HIP-3 volume data'}
            </div>
          )}
        </div>
      </section>

      {/* ── Section 4: HIP-3 vs Hyperliquid Volume ──────────────────────────── */}
      <section className="card">
        <div className="card-header">
          <span className="card-title">HIP-3 vs Hyperliquid Volume</span>
          {dune.fetchedAt > 0 && (
            <span className="text-[10px] text-text-dim">
              Updated {format(new Date(dune.fetchedAt), 'MMM d, HH:mm')}
            </span>
          )}
        </div>
        <div className="p-4 h-96">
          {dune.data && dune.data.length > 0 ? (
            <DuneVolumeChart data={dune.data} />
          ) : dune.error ? (
            <ErrorNote msg={dune.error} />
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted text-sm">
              {loading ? 'Loading Dune data…' : 'No volume data'}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function MarketRow({
  coin,
  oiMap,
}: {
  coin: CoinMarket
  oiMap: Map<string, number> | null
}) {
  const pctChange = coin.price_change_percentage_24h
  const oi = oiMap?.get(coin.symbol.toUpperCase())

  return (
    <tr className="table-row-hover">
      <td className="td text-text-muted">{coin.market_cap_rank}</td>
      <td className="td-primary">
        <div className="flex items-center gap-2">
          <img src={coin.image} alt={coin.name} className="w-5 h-5 rounded-full" />
          <span className="font-sans">{coin.name}</span>
          <span className="text-text-muted text-xs uppercase">{coin.symbol}</span>
        </div>
      </td>
      <td className="td text-right">
        ${coin.current_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </td>
      <td className={`td text-right ${pctChange !== null && pctChange >= 0 ? 'text-pos' : 'text-neg'}`}>
        {pctChange !== null ? `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(2)}%` : '—'}
      </td>
      <td className="td text-right">{fmtCompact(coin.market_cap)}</td>
      <td className="td text-right">{fmtCompact(coin.total_volume)}</td>
      <td className="td text-right">{oi ? fmtCompact(oi) : '—'}</td>
    </tr>
  )
}

function Hip3VolumeChart({ data }: { data: Hip3VolumeEntry[] }) {
  // Take top 20 for readability
  const chartData = useMemo(() => data.slice(0, 20), [data])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-xs">
        <div className="text-text-primary font-medium mb-1">{label}</div>
        <div className="text-text-secondary">
          24h Volume: <span className="text-text-primary font-mono">{fmtCompact(payload[0].value)}</span>
        </div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
        <XAxis
          dataKey="coin"
          tick={{ fill: '#555', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-45}
          textAnchor="end"
          height={60}
        />
        <YAxis
          tickFormatter={(v) => fmtCompact(v)}
          tick={{ fill: '#555', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Bar dataKey="volume24h" fill="#235051" radius={[3, 3, 0, 0]} maxBarSize={40} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function DuneVolumeChart({ data }: { data: DuneVolumeRow[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const crypto = payload.find((p: any) => p.dataKey === 'cryptoVolume')?.value ?? 0
    const hip3 = payload.find((p: any) => p.dataKey === 'hip3Volume')?.value ?? 0
    return (
      <div className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-xs">
        <div className="text-text-muted mb-1.5">{label}</div>
        <div className="space-y-0.5">
          <div className="text-text-secondary">
            Crypto: <span className="text-text-primary font-mono">{fmtCompact(crypto)}</span>
          </div>
          <div className="text-text-secondary">
            HIP-3: <span className="text-accent-purple font-mono">{fmtCompact(hip3)}</span>
          </div>
          <div className="text-text-secondary">
            Total: <span className="text-text-primary font-mono">{fmtCompact(crypto + hip3)}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="cryptoBarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#235051" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#235051" stopOpacity={0.6} />
          </linearGradient>
          <linearGradient id="hip3BarGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.9} />
            <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0.6} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => format(new Date(v), 'MMM d')}
          tick={{ fill: '#555', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          tickFormatter={(v) => fmtCompact(v)}
          tick={{ fill: '#555', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          iconType="square"
          iconSize={10}
        />
        <Bar
          dataKey="cryptoVolume"
          name="Crypto"
          stackId="vol"
          fill="url(#cryptoBarGrad)"
          radius={[0, 0, 0, 0]}
        />
        <Bar
          dataKey="hip3Volume"
          name="HIP-3"
          stackId="vol"
          fill="url(#hip3BarGrad)"
          radius={[3, 3, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="td">
          <div className="h-4 bg-surface-4 rounded animate-pulse w-16" />
        </td>
      ))}
    </tr>
  )
}

function ErrorNote({ msg }: { msg: string }) {
  return (
    <div className="px-5 py-3 text-xs text-neg">
      {msg}
    </div>
  )
}
