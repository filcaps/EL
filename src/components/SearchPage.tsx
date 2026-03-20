import { useState } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import { Search, ArrowRight, Activity, BarChart2, Layers, Wallet } from 'lucide-react'

interface SearchPageProps {
  onAnalyse: (address: string) => void
  loading: boolean
}

export function SearchPage({ onAnalyse, loading }: SearchPageProps) {
  const [input, setInput] = useState('')
  const { ready, authenticated, login } = usePrivy()
  const { wallets } = useWallets()
  const connectedAddress = wallets[0]?.address

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const addr = input.trim()
    if (!addr) return
    onAnalyse(addr)
  }

  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col items-center justify-center px-6 py-20">
      {/* Hero */}
      <div className="text-center mb-12 max-w-xl">
        {/* Logo mark */}
        <div className="flex items-center justify-center mb-8">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: '#235051' }}>
            <svg width="28" height="20" viewBox="0 0 28 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="5" cy="5" r="4.5" fill="white" fillOpacity="0.9" />
              <path d="M1.5 9 Q1 14 3.5 18" stroke="white" strokeOpacity="0.9" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="19" cy="5" r="4.5" fill="white" fillOpacity="0.6" />
              <path d="M15.5 9 Q15 14 17.5 18" stroke="white" strokeOpacity="0.6" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <h1 className="text-3xl font-semibold text-text-primary mb-3 tracking-tight">
          Quote Execution Alpha
        </h1>
        <p className="text-text-secondary text-sm leading-relaxed">
          Measure the true cost of every fill on Hyperliquid. Spread, market impact, and fees
          decomposed into basis points — across your complete trade history.
        </p>
      </div>

      <div className="w-full max-w-lg space-y-3">
        {/* Connect wallet CTA — shown when not connected */}
        {ready && !authenticated && (
          <button
            onClick={login}
            className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg border border-accent-blue/40 bg-accent-blue/10 text-accent-blue text-sm font-medium hover:bg-accent-blue/20 transition-colors"
          >
            <Wallet className="w-4 h-4" />
            Connect Wallet
            <span className="text-xs font-normal opacity-60 ml-0.5">via Privy</span>
          </button>
        )}

        {/* Analyse my wallet — shown when connected */}
        {ready && authenticated && connectedAddress && (
          <button
            onClick={() => onAnalyse(connectedAddress)}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg border border-accent-blue/40 bg-accent-blue/10 text-accent-blue text-sm font-medium hover:bg-accent-blue/20 transition-colors disabled:opacity-50"
          >
            <Wallet className="w-4 h-4" />
            Analyse my wallet
            <span className="font-mono text-xs opacity-70">
              {connectedAddress.slice(0, 6)}…{connectedAddress.slice(-4)}
            </span>
          </button>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-text-dim">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Manual address input */}
        <form onSubmit={handleSubmit}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                className="input w-full pl-10 pr-4 py-3 text-sm"
                placeholder="Enter wallet address (0x…)"
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
        </form>

        <p className="text-xs text-text-muted text-center">
          Powered by HyperCore data
        </p>
      </div>

      {/* Feature grid */}
      <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-3 max-w-2xl w-full">
        <FeatureCard
          icon={<Activity className="w-4 h-4" style={{ color: '#235051' }} />}
          title="Execution Cost"
          body="Spread, market impact, and fees decomposed into basis points per trade."
        />
        <FeatureCard
          icon={<BarChart2 className="w-4 h-4" style={{ color: '#235051' }} />}
          title="Historical Slippage"
          body="Historical sampled data matched to each fill."
        />
        <FeatureCard
          icon={<Layers className="w-4 h-4" style={{ color: '#235051' }} />}
          title="Asset Breakdown"
          body="Per-market analysis with volume, fees, spread, and arrival cost."
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
    <div className="card p-4">
      <div className="mb-2.5">{icon}</div>
      <h3 className="text-xs font-semibold text-text-primary mb-1">{title}</h3>
      <p className="text-xs text-text-muted leading-relaxed">{body}</p>
    </div>
  )
}
