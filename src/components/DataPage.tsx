import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { format } from 'date-fns'
import { RefreshCw, Camera } from 'lucide-react'
import html2canvas from 'html2canvas'
import { getTopMarkets, type CoinMarket } from '../lib/coingecko'
import {
  getOpenInterestMap,
  fetchDuneHip3VsHl,
  CURATED_UNLOCKS,
  fmtCompact,
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

async function saveAsImage(el: HTMLElement | null, filename: string) {
  if (!el) return
  const canvas = await html2canvas(el, { backgroundColor: '#0a0a0a', scale: 2 })
  const link = document.createElement('a')
  link.download = `${filename}.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

export function DataPage() {
  const [markets, setMarkets] = useState<Cached<CoinMarket[]>>({ data: null, fetchedAt: 0 })
  const [oiMap, setOiMap] = useState<Cached<Map<string, number>>>({ data: null, fetchedAt: 0 })
  const [dune, setDune] = useState<Cached<DuneVolumeRow[]>>({ data: null, fetchedAt: 0 })
  const [loading, setLoading] = useState(true)

  const topAssetsRef = useRef<HTMLElement>(null)
  const tokenUnlocksRef = useRef<HTMLElement>(null)
  const hip3VolumeRef = useRef<HTMLElement>(null)
  const hip3VsHlRef = useRef<HTMLElement>(null)

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
      <section className="card" ref={topAssetsRef}>
        <div className="card-header">
          <span className="card-title">Top 10 Crypto Assets</span>
          <SaveButton onClick={() => saveAsImage(topAssetsRef.current, 'top-10-crypto')} />
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
      <section className="card" ref={tokenUnlocksRef}>
        <div className="card-header">
          <span className="card-title">Upcoming Token Unlocks</span>
          <SaveButton onClick={() => saveAsImage(tokenUnlocksRef.current, 'token-unlocks')} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th w-10">#</th>
                <th className="th">Token</th>
                <th className="th text-right">Unlock Date</th>
                <th className="th text-right">Amount</th>
                <th className="th text-right">% of Supply</th>
                <th className="th text-right">Most Liquid Venue</th>
              </tr>
            </thead>
            <tbody>
              {CURATED_UNLOCKS.map((u, i) => (
                <tr key={u.symbol} className="table-row-hover">
                  <td className="td text-text-muted">{i + 1}</td>
                  <td className="td-primary">
                    <div className="flex items-center gap-2">
                      <img src={u.logo} alt={u.token} className="w-5 h-5 rounded-full" />
                      <span className="font-sans">{u.token}</span>
                      <span className="text-text-muted text-xs">{u.symbol}</span>
                    </div>
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

      {/* ── Section 3: HIP-3 All-Time Volume ─────────────────────────────── */}
      <section className="card" ref={hip3VolumeRef}>
        <div className="flex justify-end px-5 pt-4">
          <SaveButton onClick={() => saveAsImage(hip3VolumeRef.current, 'hip3-all-time-volume')} />
        </div>
        <div className="p-6 pt-0">
          {dune.data && dune.data.length > 0 ? (
            <Hip3AllTimeVolume data={dune.data} />
          ) : dune.error ? (
            <ErrorNote msg={dune.error} />
          ) : (
            <div className="flex items-center justify-center h-80 text-text-muted text-sm">
              {loading ? 'Loading volume data…' : 'No volume data'}
            </div>
          )}
        </div>
      </section>

      {/* ── Section 4: HIP-3 vs Hyperliquid Volume ──────────────────────────── */}
      <section className="card" ref={hip3VsHlRef}>
        <div className="card-header">
          <span className="card-title">HIP-3 vs Hyperliquid Volume</span>
          <SaveButton onClick={() => saveAsImage(hip3VsHlRef.current, 'hip3-vs-hyperliquid')} />
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

function Hip3AllTimeVolume({ data }: { data: DuneVolumeRow[] }) {
  const allTimeTotal = useMemo(
    () => data.reduce((sum, d) => sum + d.hip3Volume, 0),
    [data],
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-xs">
        <div className="text-text-muted mb-1">{format(new Date(label), 'MMM d, yyyy')}</div>
        <div className="text-text-secondary">
          Volume: <span className="font-mono" style={{ color: '#6EE7B7' }}>{fmtCompact(payload[0].value)}</span>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="text-center mb-6">
        <div className="card-title mb-3">
          All-Time HIP-3 Volume
        </div>
        <div className="text-4xl font-semibold text-text-primary font-mono tracking-tight">
          {fmtCompact(allTimeTotal)}
        </div>
      </div>
      {/* Chart */}
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 40, bottom: 0, left: 8 }} barCategoryGap={1}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => format(new Date(v), 'MMM d')}
              tick={{ fill: '#555', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={50}
            />
            <YAxis
              tickFormatter={(v) => fmtCompact(v)}
              tick={{ fill: '#555', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={0}
              orientation="right"
              mirror
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
            <Bar dataKey="hip3Volume" fill="#6EE7B7" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function DuneVolumeChart({ data }: { data: DuneVolumeRow[] }) {
  // Convert to 100% stacked percentages
  const pctData = useMemo(
    () =>
      data.map((d) => {
        const total = d.cryptoVolume + d.hip3Volume
        if (total === 0) return { ...d, hip3Pct: 0, cryptoPct: 100 }
        return {
          ...d,
          hip3Pct: (d.hip3Volume / total) * 100,
          cryptoPct: (d.cryptoVolume / total) * 100,
        }
      }),
    [data],
  )

  // Date suffix helper: 1st, 2nd, 3rd, 4th…
  function ordinal(day: number): string {
    if (day >= 11 && day <= 13) return `${day}th`
    const last = day % 10
    if (last === 1) return `${day}st`
    if (last === 2) return `${day}nd`
    if (last === 3) return `${day}rd`
    return `${day}th`
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const row = data.find((d) => d.date === label)
    const hip3Pct = payload.find((p: any) => p.dataKey === 'hip3Pct')?.value ?? 0
    return (
      <div className="bg-surface-3 border border-border rounded-lg px-3 py-2 text-xs">
        <div className="text-text-muted mb-1.5">
          {format(new Date(label), 'MMM')} {ordinal(new Date(label).getDate())}
        </div>
        <div className="space-y-0.5">
          <div className="text-text-secondary">
            Hyperliquid: <span className="text-text-primary font-mono">{row ? fmtCompact(row.cryptoVolume) : '—'}</span>
          </div>
          <div className="text-text-secondary">
            HIP-3: <span className="font-mono" style={{ color: '#6EE7B7' }}>{row ? fmtCompact(row.hip3Volume) : '—'}</span>
            <span className="text-text-muted ml-1">({hip3Pct.toFixed(1)}%)</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={pctData} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barCategoryGap={0} barGap={0}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(v) => {
                const d = new Date(v)
                return `${format(d, 'MMM')} ${ordinal(d.getDate())}`
              }}
              tick={{ fill: '#555', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={60}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tickFormatter={(v) => `${v}%`}
              tick={{ fill: '#555', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={40}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
            <Bar
              dataKey="hip3Pct"
              name="HIP-3"
              stackId="pct"
              fill="#6EE7B7"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="cryptoPct"
              name="Hyperliquid"
              stackId="pct"
              fill="#1c1c1c"
              stroke="#333"
              strokeWidth={0.5}
              radius={[0, 0, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center justify-center gap-4 pt-3 text-[11px] text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#6EE7B7' }} />
          HIP-3
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm border border-[#333]" style={{ backgroundColor: '#1c1c1c' }} />
          Hyperliquid
        </span>
      </div>
    </div>
  )
}

function SaveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="btn-ghost flex items-center gap-1 text-[10px] text-text-muted hover:text-text-secondary"
      title="Save as image"
    >
      <Camera className="w-3.5 h-3.5" />
    </button>
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
