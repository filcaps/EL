import { useState } from 'react'
import { Search, ArrowRight, Activity, BarChart2, Layers } from 'lucide-react'

interface SearchPageProps {
  onAnalyse: (address: string) => void
  loading: boolean
}


export function SearchPage({ onAnalyse, loading }: SearchPageProps) {
  const [input, setInput] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const addr = input.trim()
    if (!addr) return
    onAnalyse(addr)
  }

  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center px-6 py-20">
      {/* Hero */}
      <div className="text-center mb-12 max-w-2xl">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-surface-3 border border-border rounded-full text-xs text-text-secondary mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-blue" />
          Powered by Hyperliquid · Hydromancer
        </div>

        <h1 className="text-4xl font-bold text-text-primary mb-4 leading-tight">
          Execution Quality
          <br />
          <span className="text-accent-blue">Analytics</span>
        </h1>
        <p className="text-text-secondary text-base leading-relaxed">
          Quantify the true cost of your trades on Hyperliquid. Measure spread,
          market impact, effective spread, and arrival cost — in basis points —
          across your entire trading history.
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="w-full max-w-xl">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              className="input w-full pl-10 pr-4 py-3 text-sm"
              placeholder="Enter wallet address  (0x…)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <button
            type="submit"
            className="btn-primary flex items-center gap-2 px-5"
            disabled={loading || !input.trim()}
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            Analyse
          </button>
        </div>

        {/* Example */}
        <p className="mt-3 text-xs text-text-muted text-center">
          Enter any Hyperliquid wallet to analyse execution quality across all trades
        </p>
      </form>

      {/* Feature grid */}
      <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl w-full">
        <FeatureCard
          icon={<Activity className="w-5 h-5 text-accent-blue" />}
          title="Execution Cost Breakdown"
          body="Spread, market impact, and fees decomposed into basis points for every trade."
        />
        <FeatureCard
          icon={<BarChart2 className="w-5 h-5 text-accent-purple" />}
          title="Historical Slippage"
          body="15-minute sampled slippage data from Hydromancer matched to each fill."
        />
        <FeatureCard
          icon={<Layers className="w-5 h-5 text-accent-cyan" />}
          title="Order Book Depth"
          body="Live liquidity metrics: depth at 10/50/100/200 bps, OBI, and touch liquidity."
        />
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="card p-5">
      <div className="mb-3">{icon}</div>
      <h3 className="text-sm font-semibold text-text-primary mb-1.5">{title}</h3>
      <p className="text-xs text-text-secondary leading-relaxed">{body}</p>
    </div>
  )
}
