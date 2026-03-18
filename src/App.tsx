import { useState, useCallback, useEffect, useRef } from 'react'
import { usePrivy, useWallets } from '@privy-io/react-auth'
import type { WalletSummary } from './types'
import { analyseWallet } from './lib/metrics'
import { Header } from './components/Header'
import { SearchPage } from './components/SearchPage'
import { WalletDashboard } from './components/WalletDashboard'
import { LoadingState, ErrorBanner } from './components/LoadingState'

type AppState =
  | { view: 'search' }
  | { view: 'loading'; address: string; stage: string; detail?: string }
  | { view: 'error'; address: string; message: string }
  | { view: 'dashboard'; summary: WalletSummary }

export default function App() {
  const [state, setState] = useState<AppState>({ view: 'search' })
  const { ready, authenticated } = usePrivy()
  const { wallets } = useWallets()
  const connectedAddress = wallets[0]?.address?.toLowerCase()

  // Track the last address we auto-analysed so we don't repeat on re-renders
  const autoAnalysedRef = useRef<string | null>(null)

  const handleAnalyse = useCallback(async (address: string) => {
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
    setState({ view: 'search' })
  }, [])

  const handleRefresh = useCallback(() => {
    if (state.view === 'dashboard') {
      handleAnalyse(state.summary.address)
    }
  }, [state, handleAnalyse])

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
        <WalletDashboard summary={state.summary} onRefresh={handleRefresh} />
      )}
    </div>
  )
}
