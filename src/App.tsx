import { useState, useCallback, useEffect, useRef } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import type { WalletSummary } from './types'
import { analyseWallet } from './lib/metrics'
import { fetchOrderBuilderFee } from './lib/hyperliquid'
import { Header } from './components/Header'
import { SearchPage } from './components/SearchPage'
import { WalletDashboard } from './components/WalletDashboard'
import { LoadingState, ErrorBanner } from './components/LoadingState'

type AppState =
  | { view: 'search' }
  | { view: 'loading'; address: string; stage: string; detail?: string }
  | { view: 'error'; address: string; message: string }
  | { view: 'dashboard'; summary: WalletSummary }

/** tid → builder fee in USD (populated in the background after initial load) */
export type BuilderFeeMap = Map<number, number>

const ENRICH_CONCURRENCY = 15 // concurrent orderStatus requests
const ZERO_HASH = /^0x0+$/

export default function App() {
  const [state, setState] = useState<AppState>({ view: 'search' })
  const [builderFeeMap, setBuilderFeeMap] = useState<BuilderFeeMap>(new Map())
  const enrichCancelRef = useRef<boolean>(false)

  const { ready, authenticated } = usePrivy()
  const { wallets } = useWallets()
  const connectedAddress = wallets[0]?.address?.toLowerCase()

  // Track the last address we auto-analysed so we don't repeat on re-renders
  const autoAnalysedRef = useRef<string | null>(null)

  const handleAnalyse = useCallback(async (address: string) => {
    // Cancel any in-flight enrichment from a previous analysis
    enrichCancelRef.current = true
    setBuilderFeeMap(new Map())

    setState({ view: 'loading', address, stage: 'Initialising…' })

    try {
      const summary = await analyseWallet(address, ({ stage, detail }) => {
        setState({ view: 'loading', address, stage, detail })
      })
      setState({ view: 'dashboard', summary })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setState({ view: 'error', address: address, message: msg })
    }
  }, [])

  const handleReset = useCallback(() => {
    enrichCancelRef.current = true
    setState({ view: 'search' })
    setBuilderFeeMap(new Map())
  }, [])

  const handleRefresh = useCallback(() => {
    if (state.view === 'dashboard') {
      handleAnalyse(state.summary.address)
    }
  }, [state, handleAnalyse])

  // ── Background builder-fee enrichment ───────────────────────────────────────
  // Fires after the dashboard is shown. Processes trades in batches so the
  // main render is never blocked. Each trade that returns a non-zero fee
  // triggers a reactive map update, so the UI updates incrementally.
  useEffect(() => {
    if (state.view !== 'dashboard') return

    enrichCancelRef.current = false
    const { address, trades } = state.summary

    // Only trades with a real order ID and a non-zero hash are worth querying
    const candidates = trades.filter(
      (t) => t.oid > 0 && !ZERO_HASH.test(t.hash),
    )
    if (candidates.length === 0) return

    let active = true

    async function runEnrichment() {
      for (let i = 0; i < candidates.length; i += ENRICH_CONCURRENCY) {
        if (!active || enrichCancelRef.current) break

        const batch = candidates.slice(i, i + ENRICH_CONCURRENCY)

        await Promise.allSettled(
          batch.map(async (t) => {
            if (!active || enrichCancelRef.current) return
            // fetchOrderBuilderFee returns tenths-of-bps; multiply by notional
            // to get USD. Returns 0 when the API doesn't expose the field yet.
            const tenthsBps = await fetchOrderBuilderFee(address, t.oid)
            if (tenthsBps > 0 && active && !enrichCancelRef.current) {
              const feeUsd = (tenthsBps / 10 / 10_000) * t.notionalUsd
              setBuilderFeeMap((prev) => {
                const next = new Map(prev)
                next.set(t.tid, feeUsd)
                return next
              })
            }
          }),
        )
      }
    }

    runEnrichment()

    return () => {
      active = false
    }
  // Re-run only when the analysed address changes (not on every render)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.view === 'dashboard' ? state.summary.address : null])

  // Auto-analyse when a wallet connects for the first time in this session
  useEffect(() => {
    if (!ready || !authenticated || !connectedAddress) return
    if (state.view !== 'search') return
    if (autoAnalysedRef.current === connectedAddress) return

    autoAnalysedRef.current = connectedAddress
    handleAnalyse(connectedAddress)
  }, [ready, authenticated, connectedAddress, state.view, handleAnalyse])

  const walletAddress =
    state.view === 'loading' || state.view === 'error'
      ? state.address
      : state.view === 'dashboard'
      ? state.summary.address
      : undefined

  return (
    <div className="min-h-screen bg-surface-0">
      <Header onReset={handleReset} walletAddress={walletAddress} />

      {state.view === 'search' && (
        <SearchPage onAnalyse={handleAnalyse} loading={false} />
      )}

      {state.view === 'loading' && (
        <LoadingState stage={state.stage} detail={state.detail} />
      )}

      {state.view === 'error' && (
        <ErrorBanner
          message={state.message}
          onRetry={() => handleAnalyse(state.address)}
        />
      )}

      {state.view === 'dashboard' && (
        <WalletDashboard
          summary={state.summary}
          builderFeeMap={builderFeeMap}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  )
}
